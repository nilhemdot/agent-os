// X API (Twitter) core signing and chunking logic — pure JS, importable by both
// TS lib (via dynamic import) and CLI scripts. OAuth 1.0a HMAC-SHA1 per RFC 5849.

import { createHmac, randomBytes } from "node:crypto";

/**
 * RFC 3986 percent-encode: reserved chars → %HH, !'()* escaped as per spec.
 * @param {string} str
 * @returns {string}
 */
export function percentEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A");
}

/**
 * Sort OAuth params by key, then by value if keys are equal.
 * @param {Record<string, string>} params
 * @returns {Array<[string, string]>}
 */
export function sortOAuthParams(params) {
  return Object.entries(params).sort(([k1, v1], [k2, v2]) => {
    if (k1 !== k2) return k1.localeCompare(k2);
    return v1.localeCompare(v2);
  });
}

/**
 * Build OAuth signature base string per RFC 5849.
 * @param {string} method HTTP method (GET, POST, etc.)
 * @param {string} url Base URL (without query string or fragment)
 * @param {Record<string, string>} allParams All request params (oauth_* + others, no body)
 * @returns {string} Signature base string
 */
export function signatureBaseString(method, url, allParams) {
  const sorted = sortOAuthParams(allParams);
  const paramString = sorted
    .map(([k, v]) => `${percentEncode(k)}=${percentEncode(v)}`)
    .join("&");
  return `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(paramString)}`;
}

/**
 * Compute HMAC-SHA1 OAuth signature.
 * @param {string} baseString Signature base string
 * @param {string} consumerSecret OAuth consumer secret
 * @param {string} tokenSecret OAuth token secret
 * @returns {string} Base64-encoded signature
 */
export function computeSignature(baseString, consumerSecret, tokenSecret) {
  const key = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  return createHmac("sha1", key).update(baseString).digest("base64");
}

/**
 * Generate a random 16+ char alphanumeric nonce.
 * @returns {string}
 */
export function generateNonce() {
  return randomBytes(16).toString("hex");
}

/**
 * Build OAuth Authorization header value with signed params.
 * @typedef {Object} OAuthHeaderOptions
 * @property {string} method HTTP method
 * @property {string} url Base URL
 * @property {string} consumerKey
 * @property {string} consumerSecret
 * @property {string} tokenKey OAuth access token
 * @property {string} tokenSecret OAuth access token secret
 * @property {Record<string, string>} [bodyParams] Additional params (non-body for JSON endpoints)
 * @param {OAuthHeaderOptions} options
 * @returns {string} Authorization header value
 */
export function buildOAuthHeader({
  method,
  url,
  consumerKey,
  consumerSecret,
  tokenKey,
  tokenSecret,
  bodyParams = {},
}) {
  const nonce = generateNonce();
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const oauthParams = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: tokenKey,
    oauth_version: "1.0",
  };

  // For signing, include all params (oauth_* + body params, but NOT the body itself for JSON endpoints)
  const allParams = { ...oauthParams, ...bodyParams };
  const baseString = signatureBaseString(method, url, allParams);
  const signature = computeSignature(baseString, consumerSecret, tokenSecret);

  // Authorization header includes only oauth_* params + signature
  const authParams = {
    ...oauthParams,
    oauth_signature: signature,
  };

  const headerParts = sortOAuthParams(authParams)
    .map(([k, v]) => `${k}="${percentEncode(v)}"`)
    .join(", ");

  return `OAuth ${headerParts}`;
}

/**
 * Extract all URLs from text (https?://\S+). Count each as 23 chars for Twitter weighting.
 * @param {string} text
 * @returns {Array<{url: string, start: number, end: number}>}
 */
export function extractUrls(text) {
  const regex = /https?:\/\/\S+/g;
  const urls = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    urls.push({ url: match[0], start: match.index, end: match.index + match[0].length });
  }
  return urls;
}

/**
 * Count weighted length: URLs count as 23, other chars as 1.
 * @param {string} text
 * @returns {number}
 */
export function weightedLength(text) {
  const urls = extractUrls(text);
  if (!urls.length) return text.length;

  let count = 0;
  let lastEnd = 0;

  for (const { start, end, url } of urls) {
    // Non-URL text before this URL
    count += start - lastEnd;
    // URL counts as 23
    count += 23;
    lastEnd = end;
  }

  // Remaining text after last URL
  count += text.length - lastEnd;
  return count;
}

/**
 * Split text at sentence boundaries: ". ", "! ", "? ".
 * Returns chunks, each trying to stay ≤ maxChars (weighted).
 * Falls back to word boundary if sentence split exceeds limit.
 * Appends " (n/m)" suffix to each chunk ONLY when m > 1 (suffix counts toward limit).
 * Pure function.
 *
 * @param {string} text
 * @param {number} [maxChars=280]
 * @returns {string[]}
 */
export function chunkThread(text, maxChars = 280) {
  if (!text) return [];

  const weighted = weightedLength(text);
  if (weighted <= maxChars) {
    return [text]; // Fits in one tweet unchanged
  }

  // Estimate chunk count so we can compute suffix length upfront
  let estimatedChunks = Math.ceil(weighted / (maxChars - 10)); // Reserve ~10 for suffix overhead
  if (estimatedChunks < 2) estimatedChunks = 2;

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Try sentence boundary split first
    let chunk = remaining.slice(0, maxChars); // Rough slice
    let splitPos = -1;

    // Find sentence boundary: ". ", "! ", "? "
    for (const boundary of [". ", "! ", "? "]) {
      const idx = chunk.lastIndexOf(boundary);
      if (idx > 0) {
        const candidate = chunk.slice(0, idx + boundary.length);
        if (weightedLength(candidate) <= maxChars) {
          splitPos = remaining.indexOf(candidate) + candidate.length;
          break;
        }
      }
    }

    // Fall back to word boundary if no sentence boundary works
    if (splitPos < 0) {
      // Binary search for max chunk that fits
      let lo = 0;
      let hi = remaining.length;
      while (lo < hi) {
        const mid = Math.floor((lo + hi + 1) / 2);
        if (weightedLength(remaining.slice(0, mid)) <= maxChars) {
          lo = mid;
        } else {
          hi = mid - 1;
        }
      }
      splitPos = lo;

      // Try to not split mid-word
      if (splitPos < remaining.length) {
        const spaceIdx = remaining.lastIndexOf(" ", splitPos);
        if (spaceIdx > 0 && spaceIdx > splitPos - 50) {
          splitPos = spaceIdx;
        }
      }
    }

    if (splitPos <= 0) splitPos = Math.min(10, remaining.length); // Avoid infinite loop

    chunk = remaining.slice(0, splitPos).trim();
    remaining = remaining.slice(splitPos).trim();

    chunks.push(chunk);
  }

  // Add suffix if multi-part
  if (chunks.length > 1) {
    const total = chunks.length;
    const withSuffix = chunks.map((chunk, i) => {
      const suffix = ` (${i + 1}/${total})`;
      // Truncate chunk if suffix pushes it over limit
      const available = maxChars - weightedLength(suffix);
      let truncated = chunk;
      if (weightedLength(chunk) > available) {
        // Truncate by chars until it fits
        let j = chunk.length;
        while (j > 0 && weightedLength(chunk.slice(0, j) + suffix) > maxChars) j--;
        truncated = chunk.slice(0, j).trim();
      }
      return truncated + suffix;
    });
    return withSuffix;
  }

  return chunks;
}

// X API (Twitter) client — OAuth 1.0a signed requests for writes, bearer for reads.
// Credentials via credentialBroker with env fallback. Rate limit handling with retry.

import { redactText } from "./credentialBroker";
import {
  buildOAuthHeader,
  chunkThread as coreChunkThread,
  percentEncode,
} from "./xApiCore.mjs";

export interface PostResponse {
  id: string;
  url: string;
}

export type PostThreadResponse = PostResponse;

export interface UserResponse {
  id: string;
}

export interface RateLimitMeta {
  rateRemaining?: number;
  rateResetAt?: number;
}

export interface SearchResponse {
  data?: Array<{ id: string; text: string; created_at?: string }>;
  meta?: { result_count?: number; next_token?: string };
}

export interface MetricsResponse {
  data?: Array<{
    id: string;
    public_metrics?: {
      like_count?: number;
      retweet_count?: number;
      reply_count?: number;
      quote_count?: number;
    };
  }>;
}

export interface MentionsResponse {
  data?: Array<{ id: string; text: string; author_id?: string; created_at?: string }>;
  meta?: { result_count?: number };
}

/**
 * Resolve X API credential from environment. Never logs values.
 * @param envKey e.g. "X_CONSUMER_KEY"
 * @returns credential value or null
 */
function resolveCred(envKey: string): string | null {
  return process.env[envKey] || null;
}

/**
 * Get all required credentials for signing (OAuth 1.0a writes).
 * @returns {Object | null} {consumerKey, consumerSecret, tokenKey, tokenSecret} or null if any missing
 */
function getSigningCreds(): {
  consumerKey: string;
  consumerSecret: string;
  tokenKey: string;
  tokenSecret: string;
} | null {
  const consumerKey = resolveCred("X_CONSUMER_KEY");
  const consumerSecret = resolveCred("X_CONSUMER_SECRET");
  const tokenKey = resolveCred("X_ACCESS_TOKEN");
  const tokenSecret = resolveCred("X_ACCESS_TOKEN_SECRET");

  if (!consumerKey || !consumerSecret || !tokenKey || !tokenSecret) {
    return null;
  }

  return { consumerKey, consumerSecret, tokenKey, tokenSecret };
}

/**
 * Get bearer token for read requests.
 * @returns bearer token or null
 */
function getBearerToken(): string | null {
  return resolveCred("X_BEARER_TOKEN");
}

/**
 * Make a signed POST request with OAuth 1.0a. JSON body not included in signature.
 */
async function signedPost(
  url: string,
  body: Record<string, unknown>,
  creds: Awaited<ReturnType<typeof getSigningCreds>>
): Promise<{ data?: Record<string, unknown>; meta?: RateLimitMeta }> {
  if (!creds) throw new Error("X API: missing OAuth credentials");

  const authHeader = buildOAuthHeader({
    method: "POST",
    url,
    consumerKey: creds.consumerKey,
    consumerSecret: creds.consumerSecret,
    tokenKey: creds.tokenKey,
    tokenSecret: creds.tokenSecret,
  });

  let response: Response;
  let retries = 0;

  while (retries < 2) {
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      // Rate limit headers
      const remaining = parseInt(
        response.headers.get("x-rate-limit-remaining") || "0"
      );
      const resetStr = response.headers.get("x-rate-limit-reset");
      const reset = resetStr ? parseInt(resetStr) : undefined;

      if (response.status === 429) {
        // Rate limited: wait until reset
        if (reset) {
          const now = Math.floor(Date.now() / 1000);
          const waitSecs = Math.min(reset - now, 60);
          if (waitSecs > 0) {
            await new Promise((r) => setTimeout(r, waitSecs * 1000));
          }
        }
        retries++;
        continue;
      }

      if (!response.ok) {
        const errText = await response.text();
        const msg = `X API POST ${response.status}: ${errText.slice(0, 200)}`;
        throw new Error(redactText(msg, [creds.consumerKey, creds.tokenKey]));
      }

      const data = await response.json();
      return {
        data,
        meta: { rateRemaining: remaining, rateResetAt: reset },
      };
    } catch (err) {
      if (retries < 1 && err instanceof Error && err.message.includes("429")) {
        retries++;
        continue;
      }
      throw err;
    }
  }

  throw new Error("X API: 429 rate limit after retry");
}

/**
 * Make a bearer-token read request.
 */
async function bearerGet(
  url: string,
  token: string
): Promise<{ data?: unknown; meta?: RateLimitMeta }> {
  if (!token) throw new Error("X API: missing bearer token");

  let response: Response;
  let retries = 0;

  while (retries < 2) {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const remaining = parseInt(
      response.headers.get("x-rate-limit-remaining") || "0"
    );
    const resetStr = response.headers.get("x-rate-limit-reset");
    const reset = resetStr ? parseInt(resetStr) : undefined;

    if (response.status === 429) {
      if (reset) {
        const now = Math.floor(Date.now() / 1000);
        const waitSecs = Math.min(reset - now, 60);
        if (waitSecs > 0) {
          await new Promise((r) => setTimeout(r, waitSecs * 1000));
        }
      }
      retries++;
      continue;
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`X API GET ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    return { data, meta: { rateRemaining: remaining, rateResetAt: reset } };
  }

  throw new Error("X API: 429 rate limit after retry");
}

/**
 * Post a single tweet.
 */
export async function postTweet(
  text: string,
  opts?: { replyTo?: string }
): Promise<PostResponse & RateLimitMeta> {
  const creds = getSigningCreds();
  if (!creds) throw new Error("X API: credentials not available for posting");

  const body: Record<string, unknown> = { text };
  if (opts?.replyTo) {
    body.reply = { in_reply_to_tweet_id: opts.replyTo };
  }

  const result = await signedPost("https://api.x.com/2/tweets", body, creds);
  const tweetId = (result.data as { data?: { id?: string } })?.data?.id;
  if (!tweetId) throw new Error("X API: no tweet ID in response");

  return {
    id: tweetId,
    url: `https://x.com/i/web/status/${tweetId}`,
    rateRemaining: result.meta?.rateRemaining,
    rateResetAt: result.meta?.rateResetAt,
  };
}

/**
 * Post a thread of tweets.
 */
export async function postThread(
  texts: string[]
): Promise<(PostThreadResponse & RateLimitMeta)[]> {
  const creds = getSigningCreds();
  if (!creds) throw new Error("X API: credentials not available for posting");

  const results: (PostThreadResponse & RateLimitMeta)[] = [];
  let replyToId: string | undefined;

  for (const text of texts) {
    const body: Record<string, unknown> = { text };
    if (replyToId) {
      body.reply = { in_reply_to_tweet_id: replyToId };
    }

    const result = await signedPost("https://api.x.com/2/tweets", body, creds);
    const tweetId = (result.data as { data?: { id?: string } })?.data?.id;
    if (!tweetId) throw new Error("X API: no tweet ID in response");

    results.push({
      id: tweetId,
      url: `https://x.com/i/web/status/${tweetId}`,
      rateRemaining: result.meta?.rateRemaining,
      rateResetAt: result.meta?.rateResetAt,
    });

    replyToId = tweetId;
  }

  return results;
}

/**
 * Split text into tweet-sized chunks (≤280 chars, URLs weighted 23).
 * Appends " (n/m)" suffix when multi-part. Pure function.
 */
export function chunkThread(text: string, max?: number): string[] {
  return coreChunkThread(text, max);
}

/**
 * Search recent tweets.
 */
export async function searchRecent(
  query: string,
  params?: Record<string, string>
): Promise<SearchResponse & RateLimitMeta> {
  const token = getBearerToken();
  if (!token) throw new Error("X API: bearer token not available for search");

  const queryStr = new URLSearchParams({
    query,
    "tweet.fields": "created_at,public_metrics",
    ...params,
  });

  const result = await bearerGet(
    `https://api.x.com/2/tweets/search/recent?${queryStr}`,
    token
  );

  return {
    ...((result.data as SearchResponse) || {}),
    rateRemaining: result.meta?.rateRemaining,
    rateResetAt: result.meta?.rateResetAt,
  };
}

/**
 * Get mentions of the authenticated user.
 */
export async function getMentions(
  params?: Record<string, string>
): Promise<MentionsResponse & RateLimitMeta> {
  const token = getBearerToken();
  if (!token) throw new Error("X API: bearer token not available");

  const queryStr = new URLSearchParams({
    "tweet.fields": "created_at,author_id",
    ...params,
  });

  const result = await bearerGet(
    `https://api.x.com/2/users/me/mentions?${queryStr}`,
    token
  );

  return {
    ...((result.data as MentionsResponse) || {}),
    rateRemaining: result.meta?.rateRemaining,
    rateResetAt: result.meta?.rateResetAt,
  };
}

/**
 * Get user by username.
 */
export async function getUserByUsername(username: string): Promise<UserResponse & RateLimitMeta> {
  const token = getBearerToken();
  if (!token) throw new Error("X API: bearer token not available");

  const result = await bearerGet(
    `https://api.x.com/2/users/by/username/${percentEncode(username)}`,
    token
  );

  const userId = (result.data as { data?: { id?: string } })?.data?.id;
  if (!userId) throw new Error(`X API: user ${username} not found`);

  return {
    id: userId,
    rateRemaining: result.meta?.rateRemaining,
    rateResetAt: result.meta?.rateResetAt,
  };
}

/**
 * Get public metrics for tweet IDs.
 */
export async function postMetrics(
  ids: string[]
): Promise<MetricsResponse & RateLimitMeta> {
  const token = getBearerToken();
  if (!token) throw new Error("X API: bearer token not available");

  const queryStr = new URLSearchParams({
    ids: ids.join(","),
    "tweet.fields": "public_metrics",
  });

  const result = await bearerGet(
    `https://api.x.com/2/tweets?${queryStr}`,
    token
  );

  return {
    ...((result.data as MetricsResponse) || {}),
    rateRemaining: result.meta?.rateRemaining,
    rateResetAt: result.meta?.rateResetAt,
  };
}

/**
 * Check which credentials are available without throwing.
 */
export function xCredsAvailable(): { write: boolean; read: boolean } {
  const writeOk = getSigningCreds() !== null;
  const readOk = getBearerToken() !== null;
  return { write: writeOk, read: readOk };
}

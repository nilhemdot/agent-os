#!/usr/bin/env node
// X API CLI — minimal subcommand dispatcher for X (Twitter) operations.
// Credentials from env (X_CONSUMER_KEY, X_ACCESS_TOKEN, X_BEARER_TOKEN, etc).
// Usage: npm run x -- post "text" | npm run x -- thread <file> | npm run x -- search "q"
// Output: JSON to stdout, errors to stderr, exit 1 on failure.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildOAuthHeader } from "../src/lib/xApiCore.mjs";

const args = process.argv.slice(2);
if (!args.length) {
  console.error("Usage: npm run x -- <command> [args...]");
  console.error("Commands:");
  console.error("  post <text>          Post a single tweet");
  console.error("  thread <file>        Post a thread from a file (one line per tweet)");
  console.error("  search <query>       Search recent tweets");
  console.error("  mentions             Get mentions of authenticated user");
  console.error("  metrics <id> ...     Get metrics for tweet IDs");
  process.exit(1);
}

const [cmd, ...cmdArgs] = args;

// Cred helpers
function getCred(envKey) {
  const val = process.env[envKey];
  if (!val) throw new Error(`Missing env: ${envKey}`);
  return val;
}

function getSigningCreds() {
  return {
    consumerKey: getCred("X_CONSUMER_KEY"),
    consumerSecret: getCred("X_CONSUMER_SECRET"),
    tokenKey: getCred("X_ACCESS_TOKEN"),
    tokenSecret: getCred("X_ACCESS_TOKEN_SECRET"),
  };
}

function getBearerToken() {
  return getCred("X_BEARER_TOKEN");
}

// Helper: make signed OAuth POST request
async function signedFetch(url, body) {
  const creds = getSigningCreds();
  const authHeader = buildOAuthHeader({
    method: "POST",
    url,
    consumerKey: creds.consumerKey,
    consumerSecret: creds.consumerSecret,
    tokenKey: creds.tokenKey,
    tokenSecret: creds.tokenSecret,
  });

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (resp.status === 429) {
    const reset = resp.headers.get("x-rate-limit-reset");
    if (reset) {
      const now = Math.floor(Date.now() / 1000);
      const wait = Math.min(parseInt(reset) - now, 60);
      if (wait > 0) {
        await new Promise((r) => setTimeout(r, wait * 1000));
      }
    }
    const retry = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!retry.ok) throw new Error(`Rate limit 429 after retry: ${retry.status}`);
    return retry;
  }

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`X API ${resp.status}: ${text}`);
  }

  return resp;
}

// Helper: make bearer GET request
async function bearerFetch(url) {
  const token = getBearerToken();
  const resp = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (resp.status === 429) {
    const reset = resp.headers.get("x-rate-limit-reset");
    if (reset) {
      const now = Math.floor(Date.now() / 1000);
      const wait = Math.min(parseInt(reset) - now, 60);
      if (wait > 0) {
        await new Promise((r) => setTimeout(r, wait * 1000));
      }
    }
    const retry = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!retry.ok) throw new Error(`Rate limit 429 after retry: ${retry.status}`);
    return retry;
  }

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`X API ${resp.status}: ${text}`);
  }

  return resp;
}

// Subcommands
async function runPost() {
  if (!cmdArgs.length) throw new Error("Usage: x post <text>");
  const text = cmdArgs.join(" ");
  const resp = await signedFetch("https://api.x.com/2/tweets", { text });
  const json = await resp.json();
  const id = json?.data?.id;
  console.log(
    JSON.stringify({
      id,
      url: `https://x.com/i/web/status/${id}`,
      data: json,
    })
  );
}

async function runThread() {
  if (!cmdArgs.length) throw new Error("Usage: x thread <file>");
  const filePath = resolve(cmdArgs[0]);
  const content = readFileSync(filePath, "utf8");
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l);

  const results = [];
  let replyToId;

  for (const text of lines) {
    const body = { text };
    if (replyToId) body.reply = { in_reply_to_tweet_id: replyToId };
    const resp = await signedFetch("https://api.x.com/2/tweets", body);
    const json = await resp.json();
    const id = json?.data?.id;
    if (!id) throw new Error("No tweet ID in response");
    results.push({
      id,
      url: `https://x.com/i/web/status/${id}`,
    });
    replyToId = id;
  }

  console.log(JSON.stringify(results));
}

async function runSearch() {
  if (!cmdArgs.length) throw new Error("Usage: x search <query>");
  const query = cmdArgs.join(" ");
  const params = new URLSearchParams({
    query,
    "tweet.fields": "created_at,public_metrics",
  });
  const resp = await bearerFetch(
    `https://api.x.com/2/tweets/search/recent?${params}`
  );
  const json = await resp.json();
  console.log(JSON.stringify(json));
}

async function runMentions() {
  const params = new URLSearchParams({
    "tweet.fields": "created_at,author_id",
  });
  const resp = await bearerFetch(
    `https://api.x.com/2/users/me/mentions?${params}`
  );
  const json = await resp.json();
  console.log(JSON.stringify(json));
}

async function runMetrics() {
  if (!cmdArgs.length) throw new Error("Usage: x metrics <id> [<id> ...]");
  const ids = cmdArgs;
  const params = new URLSearchParams({
    ids: ids.join(","),
    "tweet.fields": "public_metrics",
  });
  const resp = await bearerFetch(`https://api.x.com/2/tweets?${params}`);
  const json = await resp.json();
  console.log(JSON.stringify(json));
}

// Dispatch
try {
  switch (cmd) {
    case "post":
      await runPost();
      break;
    case "thread":
      await runThread();
      break;
    case "search":
      await runSearch();
      break;
    case "mentions":
      await runMentions();
      break;
    case "metrics":
      await runMetrics();
      break;
    default:
      throw new Error(`Unknown command: ${cmd}`);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

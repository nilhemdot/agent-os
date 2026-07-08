import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// Indexceptional indexing API (Basic Auth). Lets the SEO tab check the credit
// balance and submit freshly-deployed URLs for indexing in one click.
//
// Credentials are read (in order) from:
//   1. env vars INDEXCEPTIONAL_USER / INDEXCEPTIONAL_APP_PASSWORD
//   2. a .env file — AGENTIC_OS_INDEX_ENV, then ~/SEO Content Output/.env,
//      then ~/.agentic-os/indexceptional.env
// Secrets are never stored in config.json or returned to the client.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = "https://www.indexceptional.com/wp-json/index/api/v1";

function parseEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const raw of readFileSync(file, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      out[key] = val;
    }
  } catch { /* ignore */ }
  return out;
}

function creds(): { user: string; pass: string } | null {
  let user = process.env.INDEXCEPTIONAL_USER ?? "";
  let pass = process.env.INDEXCEPTIONAL_APP_PASSWORD ?? "";
  if (!user || !pass) {
    const candidates = [
      process.env.AGENTIC_OS_INDEX_ENV,
      path.join(os.homedir(), "SEO Content Output", ".env"),
      path.join(os.homedir(), ".agentic-os", "indexceptional.env"),
    ].filter(Boolean) as string[];
    for (const f of candidates) {
      if (!existsSync(f)) continue;
      const e = parseEnvFile(f);
      user = user || e.INDEXCEPTIONAL_USER || "";
      pass = pass || e.INDEXCEPTIONAL_APP_PASSWORD || "";
      if (user && pass) break;
    }
  }
  if (!user || !pass) return null;
  return { user, pass };
}

function authHeader(c: { user: string; pass: string }): string {
  return "Basic " + Buffer.from(`${c.user}:${c.pass}`).toString("base64");
}

// GET → credit balance (also tells the UI whether creds are configured)
export async function GET() {
  const c = creds();
  if (!c) return NextResponse.json({ configured: false });
  try {
    const r = await fetch(`${BASE}/check-balance`, {
      headers: { Authorization: authHeader(c), Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) return NextResponse.json({ configured: true, error: `HTTP ${r.status}`, data }, { status: 200 });
    return NextResponse.json({ configured: true, balance: data });
  } catch (e) {
    return NextResponse.json({ configured: true, error: String(e) }, { status: 200 });
  }
}

// POST { urls: string[] } → submit a drip-index order (1 credit per URL, max 500)
export async function POST(req: Request) {
  const c = creds();
  if (!c) return NextResponse.json({ error: "Indexceptional credentials not set" }, { status: 400 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad body" }, { status: 400 }); }
  const rawUrls = (body as { urls?: unknown })?.urls;
  if (!Array.isArray(rawUrls)) return NextResponse.json({ error: "urls must be an array" }, { status: 400 });

  const urls = Array.from(new Set(
    rawUrls.map((u) => String(u).trim()).filter((u) => /^https?:\/\//i.test(u))
  ));
  if (urls.length === 0) return NextResponse.json({ error: "no valid http(s) URLs" }, { status: 400 });
  if (urls.length > 500) return NextResponse.json({ error: `max 500 URLs per order (got ${urls.length})` }, { status: 400 });

  try {
    const r = await fetch(`${BASE}/order`, {
      method: "POST",
      headers: { Authorization: authHeader(c), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ urls, validated: true }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) return NextResponse.json({ error: `HTTP ${r.status}`, data, submitted: urls.length }, { status: 200 });
    return NextResponse.json({ ok: true, submitted: urls.length, data });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 200 });
  }
}

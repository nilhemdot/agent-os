import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { readState, writeState, GMAIL_PY } from "@/lib/outreach";
import { getFirecrawlKey, firecrawlKeySource, getHunterKey, hunterKeySource, maskKey, writeOutreachConfig } from "@/lib/outreachConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOME = os.homedir();

// GET — settings + backend status (never returns full secrets).
export async function GET() {
  const state = await readState();
  const fkey = await getFirecrawlKey();
  const source = await firecrawlKeySource();
  const hkey = await getHunterKey();
  const hsource = await hunterKeySource();
  const gmailReady = existsSync(path.join(HOME, ".gmail-mcp", "sa-key.json")) && existsSync(GMAIL_PY);
  const himalayaReady = existsSync(path.join(HOME, ".config", "himalaya", "goldie.pass"));
  return NextResponse.json({
    firecrawl: { configured: Boolean(fkey), masked: maskKey(fkey), source },
    hunter: { configured: Boolean(hkey), masked: maskKey(hkey), source: hsource },
    gmail: { ready: gmailReady, mailbox: "hermes@goldie.agency" },
    himalaya: { ready: himalayaReady },
    dailyCap: state.meta.dailyCap,
    paused: Boolean(state.meta.paused),
  });
}

// POST — update firecrawl key, daily cap, and/or pause. Partial updates allowed.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const out: Record<string, unknown> = {};

  if (typeof body.firecrawlKey === "string") {
    const key = body.firecrawlKey.trim();
    if (key && key.length < 10) return NextResponse.json({ error: "that doesn't look like a valid key" }, { status: 400 });
    await writeOutreachConfig({ firecrawlKey: key || undefined });
    out.firecrawl = key ? { configured: true, masked: maskKey(key), source: "scoped" } : { configured: false };
  }

  if (typeof body.hunterKey === "string") {
    const key = body.hunterKey.trim();
    if (key && key.length < 10) return NextResponse.json({ error: "that doesn't look like a valid key" }, { status: 400 });
    await writeOutreachConfig({ hunterKey: key || undefined });
    out.hunter = key ? { configured: true, masked: maskKey(key), source: "scoped" } : { configured: false };
  }

  if (body.dailyCap !== undefined || body.paused !== undefined) {
    const state = await readState();
    if (body.dailyCap !== undefined) state.meta.dailyCap = Math.max(1, Math.min(500, Number(body.dailyCap) || 25));
    if (body.paused !== undefined) state.meta.paused = Boolean(body.paused);
    await writeState(state);
    out.dailyCap = state.meta.dailyCap;
    out.paused = Boolean(state.meta.paused);
  }

  return NextResponse.json({ ok: true, ...out });
}

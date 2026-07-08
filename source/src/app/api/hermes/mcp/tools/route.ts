// /api/hermes/mcp/tools — per-tool tools.include editor.
//
//   GET  ?name=<server>     → returns the current tools.include (or null = "all tools")
//   POST { name, tools: [] } → overwrites tools.include for that server
//
// Used by the InstalledRow's tool-chip editor: list current included tools as
// chips with × buttons, click × to drop a tool. Setting tools to [] removes
// the include filter entirely (matches docs: "If you select everything, no
// filter is written").

import { NextResponse } from "next/server";
import { getToolsInclude, setToolsInclude } from "@/lib/hermesMcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const name = url.searchParams.get("name");
  if (!name) {
    return NextResponse.json({ ok: false, error: "name query param required" }, { status: 400 });
  }
  const tools = await getToolsInclude(name);
  return NextResponse.json({ ok: true, tools });
}

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 }); }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "missing body" }, { status: 400 });
  }
  const { name, tools } = body as { name?: string; tools?: unknown };
  if (!name || !Array.isArray(tools)) {
    return NextResponse.json({ ok: false, error: "name and tools[] required" }, { status: 400 });
  }
  if (!tools.every((t): t is string => typeof t === "string")) {
    return NextResponse.json({ ok: false, error: "tools must all be strings" }, { status: 400 });
  }
  const r = await setToolsInclude(name, tools);
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}

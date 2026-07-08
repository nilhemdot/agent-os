// POST /api/hermes/mcp/add
// Body: { name, transport: "stdio" | "http", command?, args?, url?, auth?, preset?, envVars? }
//
// Wraps `hermes mcp add ...` non-interactively. Used by the AddCustomModal to
// register MCP servers outside the Nous-approved catalogue (e.g. GitHub,
// Filesystem, Slack, custom internal servers).
//
// Unlike the catalogue install route, this one doesn't stream — `hermes mcp
// add` is a quick config-write operation, no git clone or bootstrap. We just
// return the final result.

import { NextResponse } from "next/server";
import { addCustomServer, type AddCustomSpec } from "@/lib/hermesMcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 }); }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "missing body" }, { status: 400 });
  }
  const spec = body as Partial<AddCustomSpec>;
  if (!spec.name || !spec.transport) {
    return NextResponse.json({ ok: false, error: "name and transport required" }, { status: 400 });
  }
  if (spec.transport !== "stdio" && spec.transport !== "http") {
    return NextResponse.json({ ok: false, error: "transport must be stdio or http" }, { status: 400 });
  }
  // Normalise undefined into "" so the type satisfies AddCustomSpec.
  const r = await addCustomServer({
    name: spec.name,
    transport: spec.transport,
    command: spec.command,
    args: spec.args,
    url: spec.url,
    auth: spec.auth,
    preset: spec.preset,
    envVars: spec.envVars,
  });
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}

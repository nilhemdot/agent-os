// GET /api/hermes/mcp/manifest?name=<catalog-entry>
// Returns the parsed manifest for an MCP catalog entry. Used by the install
// modal to render the credential form + show the trust-model details (source
// URL, bootstrap commands, manifest version).
//
// Returns 404 if the manifest can't be located on disk — typically because the
// user hasn't run `hermes update` yet, or the entry name is unknown.

import { NextResponse } from "next/server";
import { loadManifest } from "@/lib/hermesMcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const name = url.searchParams.get("name");
  if (!name) {
    return NextResponse.json({ ok: false, error: "name query param required" }, { status: 400 });
  }
  const manifest = await loadManifest(name);
  if (!manifest) {
    return NextResponse.json({ ok: false, error: "manifest not found — run `hermes update` to refresh the catalogue" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, manifest });
}

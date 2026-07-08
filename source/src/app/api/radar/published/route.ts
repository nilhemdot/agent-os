import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// History of everything the Oracle has published to WordPress (newest first).
const PUBLISHED_LOG = path.join(os.homedir(), ".agentic-os", "radar", "published.json");

export async function GET() {
  try {
    const log = JSON.parse(await readFile(PUBLISHED_LOG, "utf8"));
    return Response.json({ ok: true, items: Array.isArray(log) ? log : [] });
  } catch {
    return Response.json({ ok: true, items: [] });
  }
}

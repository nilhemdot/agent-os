import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Returns the last cached radar sweep so the page paints instantly. The morning cron
// (or the SWEEP button) refreshes it. Empty/never-run → { ok:true, signals:[] }.

const LATEST = path.join(os.homedir(), ".agentic-os", "radar", "latest.json");

export async function GET() {
  try {
    const txt = await readFile(LATEST, "utf8");
    const data = JSON.parse(txt);
    return Response.json(data);
  } catch {
    return Response.json({ ok: true, scannedAt: null, signals: [] });
  }
}

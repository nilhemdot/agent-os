import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Past radar sweeps, one entry per day (newest first). Each carries its full signals
// so the UI can load a previous day instantly when you click it.

const HISTORY_DIR = path.join(os.homedir(), ".agentic-os", "radar", "history");

export async function GET() {
  try {
    const files = (await readdir(HISTORY_DIR)).filter((f) => f.endsWith(".json")).sort().reverse();
    const days = [];
    for (const f of files.slice(0, 30)) {
      try {
        const d = JSON.parse(await readFile(path.join(HISTORY_DIR, f), "utf8"));
        days.push({ day: d.day || f.replace(/\.json$/, ""), scannedAt: d.scannedAt || null, count: (d.signals || []).length, signals: d.signals || [] });
      } catch { /* skip a corrupt file */ }
    }
    return Response.json({ ok: true, days });
  } catch {
    return Response.json({ ok: true, days: [] });
  }
}

import { NextResponse } from "next/server";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOG_DIRS = [
  { agent: "openclaw", dir: config.openclawLogs },
  { agent: "hermes", dir: config.hermesLogs },
];

interface Entry { ts: number; agent: string; text: string; level?: string; }

async function tailFile(file: string, agent: string, max = 40): Promise<Entry[]> {
  try {
    const data = await readFile(file, "utf8");
    const lines = data.split(/\r?\n/).filter(Boolean).slice(-max);
    const st = await stat(file);
    const baseTs = st.mtimeMs;
    return lines.map((line, i) => ({
      ts: baseTs - (lines.length - i) * 200,
      agent,
      text: line.length > 400 ? line.slice(0, 400) + "…" : line,
      level: /error|fail/i.test(line) ? "err" : /warn/i.test(line) ? "warn" : "info",
    }));
  } catch { return []; }
}

export async function GET() {
  const out: Entry[] = [];
  for (const { agent, dir } of LOG_DIRS) {
    try {
      const items = await readdir(dir);
      const files = items.filter((f) => /\.log$/.test(f)).slice(0, 3);
      for (const f of files) {
        out.push(...(await tailFile(path.join(dir, f), agent, 20)));
      }
    } catch { /* ignore */ }
  }
  out.sort((a, b) => b.ts - a.ts);
  return NextResponse.json({ entries: out.slice(0, 80) });
}

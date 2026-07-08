// YouTube thumbnail sessions — saved to the Obsidian vault so the tool learns.
//
//   <vault>/Thumbnails/<session>/input.png        the uploaded thumbnail
//   <vault>/Thumbnails/<session>/v1.jpg …         the generated versions
//   <vault>/Thumbnails/Thumbnails Log.md          one entry per generation
//
// Each entry records the instruction/feedback + the versions, with Obsidian
// image embeds so it all renders in the vault. recentThumbnailFeedback() feeds
// past instructions back into the next prompt → it gets better every time.

import { writeFile, mkdir, appendFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { VAULT_ROOT } from "./vault";

const DIR = VAULT_ROOT ? path.join(VAULT_ROOT, "Thumbnails") : "";
const LOG = DIR ? path.join(DIR, "Thumbnails Log.md") : "";

const pad = (n: number) => String(n).padStart(2, "0");
function stamp(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

export interface ThumbSession {
  id: string;
  ts: number;
  instructions: string;
  folder: string;
  took: string;               // how long the generation took, e.g. "2m 27s"
  inputFiles: string[];       // vault-relative reference images under Thumbnails/
  outputs: string[];          // vault-relative paths under Thumbnails/
}

export async function saveThumbnailSession(opts: {
  instructions: string;
  inputs: { buf: Buffer; ext: string }[];
  outputs: { name: string; buf: Buffer }[];
  durationMs?: number;
}): Promise<ThumbSession | null> {
  if (!DIR) return null;
  const ts = Date.now();
  const folder = `${stamp(ts)}-${Math.random().toString(36).slice(2, 6)}`;
  await mkdir(path.join(DIR, folder), { recursive: true });

  const inputFiles: string[] = [];
  for (let i = 0; i < opts.inputs.length; i++) {
    const ext = (opts.inputs[i].ext || "png").replace(/[^a-z0-9]/gi, "") || "png";
    const rel = `${folder}/input-${i + 1}.${ext}`;
    await writeFile(path.join(DIR, rel), opts.inputs[i].buf);
    inputFiles.push(rel);
  }
  const outputs: string[] = [];
  for (const o of opts.outputs) {
    const rel = `${folder}/${o.name}`;
    await writeFile(path.join(DIR, rel), o.buf);
    outputs.push(rel);
  }

  const d = new Date(ts);
  const when = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const took = opts.durationMs ? fmtDur(opts.durationMs) : "";
  const header = existsSync(LOG) ? "" : "# Thumbnails\n\nEvery thumbnail generation — the instruction/feedback you gave, how long it took, and the versions made.\n";
  let entry = `\n## ${when}${took ? ` · ${took}` : ""} — ${opts.instructions.replace(/\n/g, " ")}\n`;
  if (inputFiles.length) entry += `\n**References:**\n${inputFiles.map((f) => `![[${f}]]`).join("\n")}\n`;
  entry += `\n**Generated:**\n${outputs.map((o) => `![[${o}]]`).join("\n")}\n`;
  await appendFile(LOG, header + entry, "utf8");

  return { id: `t_${ts.toString(36)}`, ts, instructions: opts.instructions, folder, took, inputFiles, outputs };
}

// Past instructions/feedback (newest first) — fed back into the next prompt.
export async function recentThumbnailFeedback(limit = 8): Promise<string[]> {
  if (!LOG || !existsSync(LOG)) return [];
  try {
    const txt = await readFile(LOG, "utf8");
    const heads = txt.split(/\r?\n/).filter((l) => l.startsWith("## "));
    return heads.slice(-limit).reverse()
      .map((l) => l.replace(/^##\s*[\d-]+\s+[\d:]+\s+—\s*/, "").trim())
      .filter((l) => l.length > 1);
  } catch { return []; }
}

// Recent sessions for the history view (parsed from the log markdown).
export async function listThumbnailSessions(limit = 24): Promise<ThumbSession[]> {
  if (!LOG || !existsSync(LOG)) return [];
  try {
    const txt = await readFile(LOG, "utf8");
    const blocks = txt.split(/\n## /).slice(1);
    const out: ThumbSession[] = [];
    for (const b of blocks) {
      const head = b.slice(0, b.indexOf("\n") === -1 ? undefined : b.indexOf("\n"));
      const m = head.match(/^([\d-]+)\s+([\d:]+)(?:\s+·\s+([^—]+?))?\s+—\s+([\s\S]*)$/);
      const took = (m && m[3] ? m[3] : "").trim();
      const instructions = m ? m[4].trim() : head.trim();
      const embeds = [...b.matchAll(/!\[\[([^\]]+)\]\]/g)].map((x) => x[1]);
      const inputFiles = embeds.filter((e) => /\/input[.-]/.test(e));
      const outputs = embeds.filter((e) => !/\/input[.-]/.test(e));
      const folder = (outputs[0] || inputFiles[0] || "").split("/")[0];
      if (folder) out.push({ id: folder, ts: 0, instructions, folder, took, inputFiles, outputs });
    }
    return out.reverse().slice(0, limit);
  } catch { return []; }
}

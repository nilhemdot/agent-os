import { NextResponse } from "next/server";
import { callTool } from "@/lib/notebooklmClient";
import { mkdir, stat } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const NLM_BIN = existsSync(path.join(os.homedir(), ".local", "bin", "nlm")) ? path.join(os.homedir(), ".local", "bin", "nlm") : "nlm";
// artifact_type → `nlm download <cmd>` subcommand (handles types download_artifact can't).
const CLI_CMD: Record<string, string> = {
  audio: "audio", video: "video", infographic: "infographic", slide_deck: "slide-deck",
  report: "report", mind_map: "mind-map", flashcards: "flashcards", quiz: "quiz", data_table: "data-table",
};

const ASSETS_DIR = path.join(os.homedir(), "Documents", "Obsidian Vault", "Agentic OS", "Notebooks", "_assets");

const MIME: Record<string, string> = {
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav", ".ogg": "audio/ogg",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".html": "text/html", ".htm": "text/html",
  ".md": "text/markdown", ".txt": "text/plain",
  ".json": "application/json", ".csv": "text/csv",
};
function mimeFor(p: string): string { return MIME[path.extname(p).toLowerCase()] ?? "application/octet-stream"; }

// Sensible default extension per artifact type so the file lands with the right type.
function extFor(artifact_type: string): string {
  switch (artifact_type) {
    case "audio":       return ".mp3";
    case "video":       return ".mp4";
    case "infographic": return ".png";
    case "slide_deck":  return ".pdf";
    case "report":      return ".md";
    case "mind_map":    return ".json";
    case "data_table":  return ".csv";
    case "flashcards":
    case "quiz":        return ".json";
    default:            return ".bin";
  }
}

function slugify(s: string): string {
  return (s || "artifact")
    .replace(/[^A-Za-z0-9 _-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 80) || "artifact";
}

// POST → call download_artifact, write to vault assets dir, return the saved path.
// GET ?path=... → stream a saved asset file with Range support.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const notebook_id: string = body.notebook_id;
    const artifact_type: string = body.artifact_type;
    const artifact_id: string | undefined = body.artifact_id;
    const title: string = body.title || body.notebook_name || "artifact";
    const notebook_name: string = body.notebook_name || "default";
    if (!notebook_id || !artifact_type) {
      return NextResponse.json({ error: "notebook_id and artifact_type required" }, { status: 400 });
    }

    const safeNotebook = slugify(notebook_name);
    const safeTitle = slugify(title);
    const ext = extFor(artifact_type);
    const dir = path.join(ASSETS_DIR, safeNotebook);
    await mkdir(dir, { recursive: true });

    // Make filename unique per artifact_id so we don't clobber on re-download.
    const idSuffix = artifact_id ? `-${artifact_id.slice(0, 8)}` : "";
    const output_path = path.join(dir, `${safeTitle}${idSuffix}${ext}`);

    const args: Record<string, unknown> = {
      notebook_id,
      artifact_type,
      output_path,
    };
    if (artifact_id) args.artifact_id = artifact_id;
    if (artifact_type === "slide_deck") args.slide_deck_format = body.slide_deck_format || "pdf";
    if (body.output_format) args.output_format = body.output_format;

    let result: Record<string, unknown> = {};
    try { result = (await callTool<Record<string, unknown>>("download_artifact", args)) ?? {}; }
    catch (e) { result = { error: String(e) }; }
    let savedPath = (result.filePath ?? result.file_path ?? result.path ?? (existsSync(output_path) ? output_path : null)) as string | null;

    // Fallback: download_artifact can't fetch report / mind_map / flashcards / slides — use the `nlm` CLI.
    if (!savedPath && CLI_CMD[artifact_type]) {
      try {
        // No --id (per-notebook-per-type is one artifact; studio ids break --id) and no --no-progress
        // (only audio/video accept it).
        const cliArgs = ["download", CLI_CMD[artifact_type], notebook_id, "--output", output_path];
        await execFileAsync(NLM_BIN, cliArgs, { timeout: 240_000 });
        if (existsSync(output_path)) { savedPath = output_path; result.via = "nlm-cli"; }
      } catch (e) { result.cliError = String(e); }
    }
    if (!savedPath) {
      return NextResponse.json({ error: (result.error as string) || "download failed", details: result }, { status: 422 });
    }
    return NextResponse.json({ ...result, savedPath, output_path });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const p = url.searchParams.get("path");
  if (!p) return new Response("missing path", { status: 400 });
  const abs = path.resolve(p);
  if (abs !== ASSETS_DIR && !abs.startsWith(ASSETS_DIR + path.sep)) {
    return new Response("forbidden", { status: 403 });
  }
  if (!existsSync(abs)) return new Response("not found", { status: 404 });
  const s = await stat(abs);
  const total = s.size;
  const mime = mimeFor(abs);
  const range = req.headers.get("range");

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      const start = m[1] === "" ? 0 : Number(m[1]);
      const end = m[2] === "" ? total - 1 : Math.min(Number(m[2]), total - 1);
      if (start <= end && start < total) {
        const stream = createReadStream(abs, { start, end });
        const web = Readable.toWeb(stream) as unknown as NodeReadableStream<Uint8Array>;
        return new Response(web as unknown as ReadableStream<Uint8Array>, {
          status: 206,
          headers: {
            "Content-Type": mime,
            "Content-Length": String(end - start + 1),
            "Content-Range": `bytes ${start}-${end}/${total}`,
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
          },
        });
      }
    }
  }

  const stream = createReadStream(abs);
  const web = Readable.toWeb(stream) as unknown as NodeReadableStream<Uint8Array>;
  return new Response(web as unknown as ReadableStream<Uint8Array>, {
    headers: { "Content-Type": mime, "Content-Length": String(total), "Accept-Ranges": "bytes", "Cache-Control": "no-store" },
  });
}

import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/video/auto/example
// Returns a pointer to a pre-built worked example (a real video the Director
// produced end-to-end), so the UI can show finished outputs instantly. The
// pointer is written to ~/.agentic-os/video-director-example.json by the build.
const POINTER = path.join(os.homedir(), ".agentic-os", "video-director-example.json");

export async function GET() {
  if (!existsSync(POINTER)) return NextResponse.json({ ok: false, error: "no example yet" }, { status: 404 });
  try {
    const j = JSON.parse(await readFile(POINTER, "utf8"));
    return NextResponse.json({ ok: true, example: j });
  } catch {
    return NextResponse.json({ ok: false, error: "bad example pointer" }, { status: 500 });
  }
}

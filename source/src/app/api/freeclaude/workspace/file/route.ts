import { NextResponse } from "next/server";
import { readProjectFile } from "@/lib/freeClaudeWorkspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/freeclaude/workspace/file?project=<name>&path=<rel> — read text contents
export async function GET(req: Request) {
  const url = new URL(req.url);
  const project = url.searchParams.get("project") ?? "";
  const rel = url.searchParams.get("path") ?? "";
  if (!project || !rel) return NextResponse.json({ error: "project and path required" }, { status: 400 });
  const res = await readProjectFile(project, rel);
  if (!res) return NextResponse.json({ error: "file not found" }, { status: 404 });
  return NextResponse.json(res);
}

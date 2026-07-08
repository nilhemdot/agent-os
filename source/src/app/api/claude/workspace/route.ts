import { NextResponse } from "next/server";
import { listProjects, listProjectFiles, ensureProject } from "@/lib/claudeWorkspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/claude/workspace                — list every Claude scratch project
// GET  /api/claude/workspace?project=<name> — list files inside a project
// POST /api/claude/workspace { name }       — create / ensure a project exists
export async function GET(req: Request) {
  const url = new URL(req.url);
  const project = url.searchParams.get("project");
  if (project) {
    const res = await listProjectFiles(project);
    if (!res) return NextResponse.json({ error: "project not found" }, { status: 404 });
    return NextResponse.json(res);
  }
  const projects = await listProjects();
  return NextResponse.json({ projects });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const raw = String(body.name ?? "").trim();
  const name = raw.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  if (!name) return NextResponse.json({ error: "valid name required" }, { status: 400 });
  const dir = await ensureProject(name);
  if (!dir) return NextResponse.json({ error: "could not create project" }, { status: 500 });
  return NextResponse.json({ name, root: dir });
}

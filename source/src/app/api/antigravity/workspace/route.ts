import { NextResponse } from "next/server";
import { listProjects, listProjectFiles } from "@/lib/antigravityWorkspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const project = url.searchParams.get("project");
  if (kind && project) {
    const data = await listProjectFiles(kind, project);
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(data);
  }
  const projects = await listProjects();
  return NextResponse.json({ projects });
}

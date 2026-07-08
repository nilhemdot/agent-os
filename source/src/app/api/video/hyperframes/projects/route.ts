import { NextResponse } from "next/server";
import { listProjects } from "@/lib/videoProjects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/video/hyperframes/projects — list every HyperFrames project under
// ~/.agentic-os/video-projects/ with metadata + the most recent render.
export async function GET() {
  const projects = await listProjects();
  return NextResponse.json({ count: projects.length, projects });
}

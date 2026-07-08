import { NextResponse } from "next/server";
import { readProjectFile } from "@/lib/antigravityWorkspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "";
  const project = url.searchParams.get("project") ?? "";
  const p = url.searchParams.get("path") ?? "";
  if (!kind || !project || !p) return NextResponse.json({ error: "kind, project, path required" }, { status: 400 });
  const data = await readProjectFile(kind, project, p);
  if (!data) return NextResponse.json({ error: "not found or forbidden" }, { status: 404 });
  return NextResponse.json(data);
}

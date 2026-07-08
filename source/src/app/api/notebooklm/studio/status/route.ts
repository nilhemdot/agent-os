import { NextResponse } from "next/server";
import { callTool } from "@/lib/notebooklmClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Poll the status of a specific artifact generation (or list all artifacts in a notebook).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const notebook_id = url.searchParams.get("notebook_id");
  const artifact_id = url.searchParams.get("artifact_id");
  if (!notebook_id) return NextResponse.json({ error: "notebook_id required" }, { status: 400 });
  try {
    const args: Record<string, unknown> = { notebook_id };
    if (artifact_id) args.artifact_id = artifact_id;
    const result = await callTool("studio_status", args);
    return NextResponse.json(result);
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}

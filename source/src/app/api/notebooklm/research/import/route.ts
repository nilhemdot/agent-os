import { NextResponse } from "next/server";
import { callTool } from "@/lib/notebooklmClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Import the sources a research task discovered into the notebook, so you can then
// query them in Chat or generate visual studio outputs from them.
export async function POST(req: Request) {
  try {
    const { notebook_id, task_id, indices } = await req.json();
    if (!notebook_id) return NextResponse.json({ error: "notebook_id required" }, { status: 400 });
    const args: Record<string, unknown> = { notebook_id };
    if (task_id) args.task_id = task_id;
    if (typeof indices === "string" && indices.trim()) args.indices = indices.trim();
    const result = await callTool("research_import", args);
    return NextResponse.json(result ?? { ok: true });
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}

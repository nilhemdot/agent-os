import { NextResponse } from "next/server";
import { callTool } from "@/lib/notebooklmClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The 9 artifact types `studio_create` actually accepts (per the new MCP's schema).
// Matches `download_artifact` too — they're symmetric.
const ALLOWED_TYPES = new Set([
  "audio", "video", "infographic", "slide_deck", "report",
  "flashcards", "quiz", "data_table", "mind_map",
]);

// POST → studio_create (kick off generation). Must pass `confirm: true` or the MCP refuses.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const notebook_id: string = body.notebook_id;
    const artifact_type: string = body.artifact_type ?? body.type;
    if (!notebook_id) return NextResponse.json({ error: "notebook_id required" }, { status: 400 });
    if (!ALLOWED_TYPES.has(artifact_type)) {
      return NextResponse.json({
        error: `artifact_type must be one of: ${[...ALLOWED_TYPES].join(", ")}`,
      }, { status: 400 });
    }

    const args: Record<string, unknown> = {
      notebook_id,
      artifact_type,
      confirm: true, // required — without this the MCP returns a confirmation prompt instead of running
    };
    // Optional pass-throughs
    for (const k of ["source_ids", "audio_format", "audio_length", "video_format", "report_style", "custom_prompt"]) {
      if (body[k] !== undefined) args[k] = body[k];
    }
    const result = await callTool("studio_create", args);
    return NextResponse.json(result);
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}

// GET → studio_status (list every artifact in the notebook with URLs + status).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const notebook_id = url.searchParams.get("notebook_id");
  if (!notebook_id) return NextResponse.json({ error: "notebook_id required" }, { status: 400 });
  try {
    const result = await callTool("studio_status", { notebook_id });
    return NextResponse.json(result);
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}

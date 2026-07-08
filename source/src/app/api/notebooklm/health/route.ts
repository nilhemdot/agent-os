import { NextResponse } from "next/server";
import { callTool } from "@/lib/notebooklmClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The new MCP doesn't expose a `get_health` tool — we synthesise one by calling
// `notebook_list` with a tiny limit. If it succeeds we're authenticated.
export async function GET() {
  try {
    const data = await callTool<{ notebooks?: unknown[]; total?: number; error?: string }>("notebook_list", { max_results: 1 });
    const ok = !data?.error;
    return NextResponse.json({
      success: ok,
      data: {
        status: ok ? "ok" : "error",
        authenticated: ok,
        total_notebooks: (data as { total?: number; notebooks?: unknown[] })?.total
          ?? ((data as { notebooks?: unknown[] })?.notebooks?.length ?? 0),
        error: data?.error,
      },
    });
  } catch (e) {
    const msg = String(e);
    // The MCP throws on auth errors — surface them so the frontend can prompt re-auth
    return NextResponse.json({
      success: false,
      data: { status: "error", authenticated: false, error: msg },
    });
  }
}

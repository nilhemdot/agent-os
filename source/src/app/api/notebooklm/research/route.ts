import { NextResponse } from "next/server";
import { callTool } from "@/lib/notebooklmClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// NotebookLM's NEW agentic research — the dashboard surface for `research_start` /
// `research_status`. Start a task to discover sources across the web; poll status
// for progress + the sources it finds. Import happens via ./import.

type ResearchResult = {
  task_id?: string; taskId?: string;
  notebook_id?: string; notebookId?: string;
  status?: string; state?: string;
  sources?: unknown[]; results?: unknown[];
  [k: string]: unknown;
};

// POST = start a research task
export async function POST(req: Request) {
  try {
    const { query, mode, title, notebook_id } = await req.json();
    if (!query || typeof query !== "string") return NextResponse.json({ error: "query required" }, { status: 400 });
    const args: Record<string, unknown> = {
      query,
      source: "web",
      mode: mode === "deep" ? "deep" : "fast", // fast ≈ 30s/~10 sources, deep ≈ 5min/~40
    };
    if (notebook_id) args.notebook_id = notebook_id;
    else args.title = (typeof title === "string" && title.trim()) || query.slice(0, 60);
    const result = await callTool<ResearchResult>("research_start", args);
    return NextResponse.json({
      ...result,
      task_id: result?.task_id ?? result?.taskId,
      notebook_id: result?.notebook_id ?? result?.notebookId ?? notebook_id,
    });
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}

// GET = check status of a research task (single check; the client polls)
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const notebook_id = url.searchParams.get("notebook_id");
    const task_id = url.searchParams.get("task_id") || undefined;
    if (!notebook_id) return NextResponse.json({ error: "notebook_id required" }, { status: 400 });
    const args: Record<string, unknown> = { notebook_id, max_wait: 0 };
    if (task_id) args.task_id = task_id;
    const result = await callTool<ResearchResult>("research_status", args);
    return NextResponse.json({
      ...result,
      status: result?.status ?? result?.state,
      sources: result?.sources ?? result?.results ?? [],
    });
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}

import { NextResponse } from "next/server";
import { callTool } from "@/lib/notebooklmClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const max = Math.min(200, Math.max(1, Number(url.searchParams.get("max") ?? "100")));
  try {
    const result = await callTool("notebook_list", { max_results: max });
    return NextResponse.json(result);
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}

// Create a new NotebookLM notebook (server-side, not a link import).
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const title: string = body.title?.trim() || `Notebook ${new Date().toISOString().slice(0, 10)}`;
    const result = await callTool("notebook_create", { title });
    return NextResponse.json(result);
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}

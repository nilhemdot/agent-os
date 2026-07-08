import { NextResponse } from "next/server";
import { readWorkspaceFile } from "@/lib/kanbanWorkspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const rel = url.searchParams.get("path") ?? "";
  const board = url.searchParams.get("board") ?? undefined;
  if (!rel) return NextResponse.json({ error: "path required" }, { status: 400 });
  const file = await readWorkspaceFile(id, rel, board);
  if (!file) return NextResponse.json({ error: "not found or forbidden" }, { status: 404 });
  return NextResponse.json({ path: rel, ...file });
}

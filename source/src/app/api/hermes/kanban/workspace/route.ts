import { NextResponse } from "next/server";
import { listWorkspaceFiles, taskWorkspaceRoot } from "@/lib/kanbanWorkspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const board = url.searchParams.get("board") ?? undefined;
  const root = taskWorkspaceRoot(id, board);
  if (!root) return NextResponse.json({ error: "bad id or board" }, { status: 400 });
  const files = await listWorkspaceFiles(id, board, 100);
  return NextResponse.json({ root, files });
}

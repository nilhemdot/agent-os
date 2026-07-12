import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { approveWorkspaceConfig, scanWorkspaceConfig } from "@/lib/configFirewall";

export const runtime = "nodejs";
const workspaceFrom = (value: unknown) => typeof value === "string" && path.isAbsolute(value) && existsSync(value) && statSync(value).isDirectory() ? value : null;

export async function GET(req: Request) {
  const workspace = workspaceFrom(new URL(req.url).searchParams.get("workspace"));
  return workspace ? NextResponse.json({ workspace, drift: scanWorkspaceConfig(workspace) }) : NextResponse.json({ error: "existing absolute workspace required" }, { status: 400 });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})), workspace = workspaceFrom(body.workspace);
  if (!workspace || body.approve !== true || !Array.isArray(body.files)) return NextResponse.json({ error: "workspace, displayed file hashes, and explicit approve=true required" }, { status: 400 });
  const current = scanWorkspaceConfig(workspace).map(({ path, sha256, kind }) => ({ path, sha256, kind })).sort((a, b) => a.path.localeCompare(b.path));
  const displayed = body.files.map((file: Record<string, unknown>) => ({ path: String(file.path || ""), sha256: String(file.sha256 || ""), kind: String(file.kind || "") })).sort((a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path));
  if (JSON.stringify(current) !== JSON.stringify(displayed)) return NextResponse.json({ error: "config changed since display; review the new literal diff" }, { status: 409 });
  approveWorkspaceConfig(workspace, typeof body.actor === "string" ? body.actor.slice(0, 200) : "local-user");
  return NextResponse.json({ approved: true, workspace });
}

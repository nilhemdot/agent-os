import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { createRun, getRun } from "@/lib/ledger";
import { validateAgentArgs, type AgentName } from "@/lib/runner";
import { breakerPolicy } from "@/lib/circuitBreaker";

export const runtime = "nodejs";
const agents: AgentName[] = ["claude", "openclaw", "hermes", "antigravity", "fcc", "codex", "kimi", "grok", "ruflo", "ant"];

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (!agents.includes(body.agent) || !Array.isArray(body.args) || !body.args.every((v: unknown) => typeof v === "string"))
    return NextResponse.json({ error: "valid agent and args required" }, { status: 400 });
  if (typeof body.cwd !== "string" || !path.isAbsolute(body.cwd) || !existsSync(body.cwd) || !statSync(body.cwd).isDirectory())
    return NextResponse.json({ error: "existing absolute cwd required" }, { status: 400 });
  try { validateAgentArgs(body.args); }
  catch { return NextResponse.json({ error: "unsafe agent argument" }, { status: 403 }); }
  const run = createRun({ agent: body.agent, args: body.args, workspace: body.cwd,
    objective: typeof body.objective === "string" ? body.objective.slice(0, 4_000) : undefined,
    policy: { ...breakerPolicy(body.policy), secretRefs: body.secretRefs, sandbox: body.sandbox },
  });
  return NextResponse.json({ runId: run.id }, { status: 202 });
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const run = getRun(id);
  return run ? NextResponse.json({ run }) : NextResponse.json({ error: "not found" }, { status: 404 });
}

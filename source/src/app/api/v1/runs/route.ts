import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { createRun, getRun } from "@/lib/ledger";
import { validateAgentArgs, type AgentName } from "@/lib/runner";
import { breakerPolicy } from "@/lib/circuitBreaker";
import { normalizeContract, parseContractFromWorkspace, persistCriteria, type ContractInput } from "@/lib/contract";

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

  // M4.1/M4.2: a run may carry a contract — either explicit in the body, or read
  // from a Spec Kit / Kiro spec in the workspace. Criteria are validated BEFORE
  // the run row is created so a required-contract rejection never leaves an
  // orphan queued run. requireContract gates M4 opt-in (contract-less runs still work).
  const requireContract = body.requireContract === true;
  const contract: ContractInput | null =
    body.contract && typeof body.contract === "object" ? body.contract : parseContractFromWorkspace(body.cwd);
  const criteria = contract ? normalizeContract(contract) : [];
  if (requireContract && criteria.length === 0)
    return NextResponse.json({ error: "a run without criteria is not a run" }, { status: 400 });

  const run = createRun({ agent: body.agent, args: body.args, workspace: body.cwd,
    objective: typeof body.objective === "string" ? body.objective.slice(0, 4_000) : undefined,
    policy: { ...breakerPolicy(body.policy), secretRefs: body.secretRefs, sandbox: body.sandbox, requireContract },
  });
  if (criteria.length) persistCriteria(run.id, criteria, contract ?? undefined);
  return NextResponse.json({ runId: run.id, criteria: criteria.length }, { status: 202 });
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const run = getRun(id);
  return run ? NextResponse.json({ run }) : NextResponse.json({ error: "not found" }, { status: 404 });
}

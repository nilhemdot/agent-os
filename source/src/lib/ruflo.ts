// Ruflo swarm telemetry + control.
//
// Ruflo (ruvnet/ruflo) keeps clean JSON state under ~/.claude-flow/ — far more
// reliable than scraping the CLI's ASCII tables (`swarm status`/`agent list`
// ignore --json). We read:
//   agents/store.json        — the agent registry { agents: { id: {...} } }
//   swarm/swarm-state.json    — swarms { swarms: { id: {...} } }
//   metrics/swarm-activity.json — live activity flags
//
// Writes go through the `ruflo` CLI (swarm init / agent spawn / swarm start)
// so all of Ruflo's own coordination side-effects fire.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { run } from "@/lib/runner";

const CF_ROOT = process.env.AGENTIC_OS_CLAUDEFLOW ?? path.join(os.homedir(), ".claude-flow");
const AGENTS_STORE = path.join(CF_ROOT, "agents", "store.json");
const SWARM_STATE = path.join(CF_ROOT, "swarm", "swarm-state.json");
const ACTIVITY = path.join(CF_ROOT, "metrics", "swarm-activity.json");

export interface RufloAgent {
  id: string;
  type: string;       // researcher, coder, seo-specialist, …
  name?: string;
  status: string;     // idle, active, busy, completed, …
  health: number;     // 0-1
  taskCount: number;
  model?: string;     // haiku / sonnet / opus
  domain?: string;    // research, development, architecture, …
  createdAt?: string;
}

export interface RufloSwarm {
  id: string;
  topology: string;
  maxAgents: number;
  status: string;     // running, terminated
  strategy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface RufloState {
  installed: boolean;
  swarm: RufloSwarm | null;     // the active (running) swarm, else most recent
  agents: RufloAgent[];
  activity: { active: boolean; agentCount: number; coordinationActive: boolean } | null;
}

async function readJson<T>(p: string): Promise<T | null> {
  if (!existsSync(p)) return null;
  try { return JSON.parse(await readFile(p, "utf8")) as T; }
  catch { return null; }
}

export async function readState(): Promise<RufloState> {
  const installed = existsSync(CF_ROOT);
  const agentsDoc = await readJson<{ agents: Record<string, Record<string, unknown>> }>(AGENTS_STORE);
  const swarmDoc = await readJson<{ swarms: Record<string, Record<string, unknown>> }>(SWARM_STATE);
  const actDoc = await readJson<Record<string, unknown>>(ACTIVITY);

  const agents: RufloAgent[] = [];
  if (agentsDoc?.agents) {
    for (const [id, a] of Object.entries(agentsDoc.agents)) {
      agents.push({
        id,
        type: String(a["agentType"] ?? "agent"),
        name: typeof a["name"] === "string" ? (a["name"] as string) : undefined,
        status: String(a["status"] ?? "idle"),
        health: typeof a["health"] === "number" ? (a["health"] as number) : 1,
        taskCount: typeof a["taskCount"] === "number" ? (a["taskCount"] as number) : 0,
        model: typeof a["model"] === "string" ? (a["model"] as string) : undefined,
        domain: typeof a["domain"] === "string" ? (a["domain"] as string) : undefined,
        createdAt: typeof a["createdAt"] === "string" ? (a["createdAt"] as string) : undefined,
      });
    }
  }
  // newest first
  agents.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  let swarm: RufloSwarm | null = null;
  if (swarmDoc?.swarms) {
    const all = Object.values(swarmDoc.swarms);
    const pick = all.find((s) => s["status"] === "running")
      ?? all.sort((a, b) => String(b["updatedAt"] ?? "").localeCompare(String(a["updatedAt"] ?? "")))[0];
    if (pick) {
      swarm = {
        id: String(pick["swarmId"] ?? "swarm"),
        topology: String(pick["topology"] ?? "hierarchical"),
        maxAgents: typeof pick["maxAgents"] === "number" ? (pick["maxAgents"] as number) : 0,
        status: String(pick["status"] ?? "unknown"),
        strategy: typeof (pick["config"] as Record<string, unknown>)?.["strategy"] === "string"
          ? ((pick["config"] as Record<string, unknown>)["strategy"] as string) : undefined,
        createdAt: typeof pick["createdAt"] === "string" ? (pick["createdAt"] as string) : undefined,
        updatedAt: typeof pick["updatedAt"] === "string" ? (pick["updatedAt"] as string) : undefined,
      };
    }
  }

  const activity = actDoc?.["swarm"] && typeof actDoc["swarm"] === "object" ? {
    active: Boolean((actDoc["swarm"] as Record<string, unknown>)["active"]),
    agentCount: Number((actDoc["swarm"] as Record<string, unknown>)["agent_count"] ?? 0),
    coordinationActive: Boolean((actDoc["swarm"] as Record<string, unknown>)["coordination_active"]),
  } : null;

  return { installed, swarm, agents, activity };
}

// The SEO mission roster — each entry becomes a spawned Ruflo agent (the name
// carries the SEO role; type maps to a valid Ruflo agent category). This is what
// makes the swarm graph fan out into a labelled SEO team on screen.
export const SEO_ROSTER: { type: string; name: string }[] = [
  { type: "researcher",    name: "keyword-research" },
  { type: "researcher",    name: "search-intent" },
  { type: "seo-specialist", name: "competitor-analysis" },
  { type: "seo-specialist", name: "technical-audit" },
  { type: "architect",     name: "content-architecture" },
  { type: "researcher",    name: "serp-analysis" },
  { type: "seo-specialist", name: "on-page-optimizer" },
  { type: "seo-specialist", name: "schema-strategist" },
  { type: "researcher",    name: "backlink-gap" },
  { type: "frontend-dev",  name: "core-web-vitals" },
  { type: "seo-specialist", name: "internal-linking" },
  { type: "reviewer",      name: "seo-qa-reviewer" },
];

export interface LaunchResult { ok: boolean; swarmId?: string; spawned: number; objective: string; errors: string[]; }

// Launch an SEO swarm: init coordination, spawn the roster (each registers in
// store.json → appears as a node), and kick swarm start in the background.
export async function launchSeoSwarm(objective: string): Promise<LaunchResult> {
  const errors: string[] = [];
  const obj = objective.trim().slice(0, 400) || "Build a complete SEO strategy";

  // 1. init swarm coordination
  const init = await run("ruflo", ["swarm", "init", "--topology", "hierarchical", "--max-agents", "14"], { timeoutMs: 30000 });
  if (!init.ok) errors.push(`init: ${init.stderr.slice(0, 200)}`);

  // 2. spawn the SEO roster (each is a quick registration)
  let spawned = 0;
  for (const r of SEO_ROSTER) {
    if (!/^[a-z0-9-]{1,40}$/.test(r.type) || !/^[a-z0-9-]{1,40}$/.test(r.name)) continue;
    const s = await run("ruflo", ["agent", "spawn", "-t", r.type, "-n", r.name, "--task", `${r.name.replace(/-/g, " ")} for: ${obj}`, "--timeout", "120"], { timeoutMs: 25000 });
    if (s.ok) spawned++;
  }

  // 3. kick the swarm to actually coordinate work (background — don't block).
  //    We don't await long; just fire it so agents activate. The graph polls state.
  void run("ruflo", ["swarm", "start", "-o", obj, "--parallel"], { timeoutMs: 8000 }).catch(() => {});

  const state = await readState();
  return { ok: errors.length === 0, swarmId: state.swarm?.id, spawned, objective: obj, errors };
}

// Colour + glyph mapping for agent roles (used by the graph).
export function roleColor(typeOrName: string): string {
  const s = typeOrName.toLowerCase();
  if (/review|qa|audit/.test(s)) return "#f472b6";       // pink — verification
  if (/research|keyword|intent|serp|backlink/.test(s)) return "#60a5fa"; // blue — research
  if (/seo|optim|schema|link/.test(s)) return "#d4a574";  // gold — seo
  if (/architect|content/.test(s)) return "#c4607e";      // plum — architecture
  if (/front|web-vital|coder|dev/.test(s)) return "#5ab896"; // emerald — build
  return "#a59783";
}

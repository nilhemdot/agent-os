// Helpers for the Managed Agents cockpit — drives the `ant` CLI (Claude Platform)
// to list agents, run a live session in a hosted "cloud" environment, and pull the
// event trace. Verified flow:
//   create session(agent, env) → send user.message → poll events:list → render trace.

import { run } from "@/lib/runner";

const ENV_NAME = "Agent OS Cockpit";

export interface AntAgent { id: string; name: string; description?: string; model?: string; system?: string; }
export interface TraceEvent { type: string; text?: string; tool?: string; raw?: unknown; }

// jsonl → array of objects
function parseJsonl(s: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of s.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try { out.push(JSON.parse(t)); } catch { /* skip */ }
  }
  return out;
}

function modelId(m: unknown): string | undefined {
  if (typeof m === "string") return m;
  if (m && typeof m === "object" && "id" in m) return String((m as { id: unknown }).id);
  return undefined;
}

export async function listAgents(): Promise<AntAgent[]> {
  const out = await run("ant", ["beta:agents", "list", "--format", "jsonl"], { cwd: process.cwd(), timeoutMs: 20000 });
  return parseJsonl(out.stdout)
    .filter((a) => typeof a.id === "string" && String(a.id).startsWith("agent_"))
    .map((a) => ({ id: String(a.id), name: String(a.name ?? "Agent"), description: a.description ? String(a.description) : undefined, model: modelId(a.model), system: a.system ? String(a.system) : undefined }));
}

// Find a reusable cloud environment, or create one.
export async function ensureEnvironment(): Promise<string | null> {
  const list = await run("ant", ["beta:environments", "list", "--format", "jsonl"], { cwd: process.cwd(), timeoutMs: 15000 });
  const existing = parseJsonl(list.stdout).find((e) => e.name === ENV_NAME && e.archived_at == null);
  if (existing && typeof existing.id === "string") return existing.id;
  const made = await run("ant", ["beta:environments", "create", "--name", ENV_NAME, "--format", "json"], { cwd: process.cwd(), timeoutMs: 20000 });
  try { const j = JSON.parse(made.stdout.slice(made.stdout.indexOf("{"))); return j.id ?? null; } catch { return null; }
}

// Start a run: create session + send the user message. Returns sessionId.
export async function startRun(agentId: string, prompt: string): Promise<{ sessionId?: string; error?: string }> {
  const envId = await ensureEnvironment();
  if (!envId) return { error: "could not create a session environment" };
  const sess = await run("ant", ["beta:sessions", "create", "--agent", agentId, "--environment-id", envId, "--title", "Cockpit run", "--format", "json"], { cwd: process.cwd(), timeoutMs: 20000 });
  let sessionId: string | undefined;
  try { sessionId = JSON.parse(sess.stdout.slice(sess.stdout.indexOf("{"))).id; } catch { /* */ }
  if (!sessionId) return { error: (sess.stderr || sess.stdout).slice(-300) };
  const ev = `type: user.message\ncontent:\n  - type: text\n    text: ${JSON.stringify(prompt)}`;
  const send = await run("ant", ["beta:sessions:events", "send", "--session-id", sessionId, "--event", ev, "--format", "json"], { cwd: process.cwd(), timeoutMs: 30000 });
  if (!send.ok && /error/i.test(send.stdout + send.stderr)) return { sessionId, error: (send.stderr || send.stdout).slice(-200) };
  return { sessionId };
}

// Pull the trace. done = session reached idle/terminated.
export async function getTrace(sessionId: string): Promise<{ events: TraceEvent[]; done: boolean }> {
  const out = await run("ant", ["beta:sessions:events", "list", "--session-id", sessionId, "--format", "jsonl"], { cwd: process.cwd(), timeoutMs: 20000 });
  const rows = parseJsonl(out.stdout);
  let done = false;
  const events: TraceEvent[] = rows.map((d) => {
    const type = String(d.type ?? "?");
    if (type === "session.status_idle" || type === "session.status_terminated") done = true;
    let text: string | undefined;
    const c = d.content;
    if (Array.isArray(c)) for (const b of c) { if (b && typeof b === "object" && "text" in b) text = String((b as { text: unknown }).text); }
    const tool = (d.name ?? (d as { tool_name?: string }).tool_name) as string | undefined;
    return { type, text, tool };
  });
  return { events, done };
}

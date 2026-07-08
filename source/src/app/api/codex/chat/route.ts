import { spawnStream } from "@/lib/runner";
import { codexApprovalArgs } from "@/lib/codexWorkspace";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODEX_SCRATCH_ROOT = process.env.AGENTIC_OS_CODEX_SCRATCH
  ?? path.join(os.homedir(), "codex-scratch");

async function ensureCodexProject(name: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) return null;
  if (!existsSync(CODEX_SCRATCH_ROOT)) await mkdir(CODEX_SCRATCH_ROOT, { recursive: true });
  const dir = path.join(CODEX_SCRATCH_ROOT, name);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  return dir;
}

// Codex streaming chat — `codex exec --json <prompt>` emits one JSON object per
// line on stdout for every event (assistant deltas, tool calls, results, etc).
// We just forward the NDJSON to the browser, same shape as our other agents.
//
// Codex behaves like `claude -p`: single-shot per invocation. For multi-turn
// memory we pack prior history into the prompt (same trick used by FreeClaude).
interface ChatMsg { role: "user" | "assistant" | "system"; text: string; }

function buildPromptWithHistory(history: ChatMsg[], current: string): string {
  if (!history.length) return current;
  const recent = history.slice(-24);
  const lines: string[] = [
    "The following is the prior conversation between you and the user.",
    "Read it, then answer the user's latest message at the bottom.",
    "",
    "--- prior conversation ---",
  ];
  let bytes = 0;
  const MAX_BYTES = 8000;
  for (const m of recent) {
    const role = m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : "System";
    const line = `${role}: ${m.text}`;
    if (bytes + line.length > MAX_BYTES) { lines.push("…[earlier turns trimmed]"); break; }
    lines.push(line);
    bytes += line.length;
  }
  lines.push("--- end prior conversation ---", "", `User: ${current}`, "Assistant:");
  return lines.join("\n");
}

export async function POST(req: Request) {
  const body = await req.json();
  const prompt = body.prompt;
  const model = typeof body.model === "string" && /^[A-Za-z0-9._:/-]+$/.test(body.model) ? body.model : null;
  const history: ChatMsg[] = Array.isArray(body.history) ? body.history : [];
  if (typeof prompt !== "string" || prompt.length === 0) {
    return new Response("missing prompt", { status: 400 });
  }
  if (prompt.length > 16_000) {
    return new Response("prompt too long", { status: 413 });
  }
  const fullPrompt = buildPromptWithHistory(history, prompt);

  // Pin Codex's cwd to a scratch project so anything it writes (HTML, scripts,
  // generated assets) lands somewhere the Workspace tab can find. Same pattern
  // as the Free Claude Code chat endpoint.
  let cwd: string | undefined;
  if (typeof body.project === "string" && /^[A-Za-z0-9_.-]+$/.test(body.project)) {
    cwd = (await ensureCodexProject(body.project)) ?? undefined;
  } else if (typeof body.cwd === "string") {
    cwd = body.cwd;
  } else {
    cwd = (await ensureCodexProject("codex-default")) ?? path.join(CODEX_SCRATCH_ROOT, "codex-default");
  }

  // Codex runs non-interactively here, so its terminal approval prompt can't be
  // answered from the browser — pass an explicit approval policy or it blocks.
  const args = ["exec", "--json", "--skip-git-repo-check", ...codexApprovalArgs(body.approvalMode)];
  if (model) args.push("--model", model);
  args.push(fullPrompt);

  const child = spawnStream("codex", args, { cwd });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(chunk)); }
        catch { closed = true; }
      };
      const safeClose = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch {}
      };
      child.stdout.on("data", (b: Buffer) => send(b.toString()));
      child.stderr.on("data", (b: Buffer) => {
        send(JSON.stringify({ type: "stderr", text: b.toString() }) + "\n");
      });
      child.on("close", (code) => {
        send(JSON.stringify({ type: "done", code }) + "\n");
        safeClose();
      });
      child.on("error", (e) => {
        send(JSON.stringify({ type: "error", message: String(e) }) + "\n");
        safeClose();
      });
    },
    cancel() { try { child.kill("SIGTERM"); } catch {} },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

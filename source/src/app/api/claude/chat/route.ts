import { spawnStream } from "@/lib/runner";
import { CLAUDE_MODEL } from "@/lib/config";
import { ensureProject, CLAUDE_SCRATCH_ROOT } from "@/lib/claudeWorkspace";
import { newRun, applyEvent, saveRun, getRun, makeRunId, type UltracodeRun } from "@/lib/ultracodeRuns";
import { logTokens } from "@/lib/tokenLog";
import { registerProc, unregisterProc, isStopped } from "@/lib/ultracodeProcs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatMsg { role: "user" | "assistant" | "system"; text: string; }

// `claude -p` starts a FRESH session every invocation (see freeclaude/chat for the same
// note), so --resume is not reliable for keeping a plain chat's memory. The proven fix —
// used by the Kimi, Free-Claude, and Grok tabs — is to pack the prior turns into the
// prompt itself. That's what gives the basic Claude tab real conversation context.
function buildPromptWithHistory(history: ChatMsg[], current: string): string {
  if (!Array.isArray(history) || !history.length) return current;
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
    if (!m || typeof m.text !== "string") continue;
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
  const { prompt, cwd, ultracode, project, resumeRunId, history } = await req.json();
  if (typeof prompt !== "string" || prompt.length === 0) {
    return new Response("missing prompt", { status: 400 });
  }
  if (prompt.length > 16_000) {
    return new Response("prompt too long", { status: 413 });
  }

  // ── Resume path ──────────────────────────────────────────────────────────
  // If resumeRunId points at a saved run with a captured Claude session id, we
  // continue THAT session (--resume) and append to the SAME run record, so the
  // reply box in the Ultracode tab carries full context (the team design, the
  // assumptions, etc) instead of starting cold.
  let resumeRun: UltracodeRun | null = null;
  let resumeSessionId: string | null = null;
  if (typeof resumeRunId === "string" && /^[A-Za-z0-9_.-]+$/.test(resumeRunId)) {
    resumeRun = await getRun(resumeRunId);
    if (resumeRun?.sessionId) resumeSessionId = resumeRun.sessionId;
  }

  // Pin cwd. On resume, reuse the original run's project so files land together.
  let runCwd: string | undefined = typeof cwd === "string" && cwd ? cwd : undefined;
  if (!runCwd) {
    const projName =
      (resumeRun?.project && /^[A-Za-z0-9_.-]+$/.test(resumeRun.project)) ? resumeRun.project
      : (typeof project === "string" && /^[A-Za-z0-9_.-]+$/.test(project)) ? project
      : "claude-default";
    runCwd = (await ensureProject(projName)) ?? path.join(CLAUDE_SCRATCH_ROOT, projName);
  }

  // Ultracode = xhigh effort → dynamic workflows. When on, we ALSO capture the
  // run (parsing system/task_* + result events) and persist it so it's
  // replayable in the Workspace's Ultracode tab.
  const isUltra = ultracode === true || !!resumeRun?.ultracode;
  // When we're resuming a captured session (the ultracode reply path), that session already
  // holds the context, so send the raw prompt. Otherwise pack the prior turns in, because
  // `claude -p` is stateless per call — this is what keeps a normal chat's memory.
  const effectivePrompt = resumeSessionId ? prompt : buildPromptWithHistory(history, prompt);
  const args: string[] = ["-p", "--model", CLAUDE_MODEL];
  if (resumeSessionId) args.push("--resume", resumeSessionId);
  if (isUltra) args.push("--effort", "xhigh", "--include-hook-events");
  args.push(
    "--output-format=stream-json",
    "--include-partial-messages",
    "--verbose",
    effectivePrompt,
  );

  const child = spawnStream("claude", args, { cwd: runCwd });

  // Register the live process so the Stop button (a separate request) can kill
  // it by run id. Registered below once runId is known.

  // Set up run capture (only persisted when ultracode is on, or when resuming
  // an existing ultracode run).
  let run: UltracodeRun | null = null;
  let runId: string | null = null;
  let priorCost = 0; // for cumulative cost across resumed turns
  if (resumeRun) {
    // Continue the same record: re-open it, append this turn, accumulate cost.
    run = resumeRun;
    runId = resumeRun.id;
    priorCost = resumeRun.costUsd ?? 0;
    run.status = "running";
    run.finishedAt = undefined;
    run.liveText = undefined;   // clear prior turn's streamed text
    run.resultText = undefined; // will be set by this turn's result
    run.turns = run.turns ?? [{ prompt: run.prompt, at: 0 }];
    run.turns.push({ prompt, at: Date.now() - run.startedAt });
  } else if (isUltra) {
    runId = makeRunId();
    run = newRun({
      id: runId,
      prompt,
      model: CLAUDE_MODEL,
      ultracode: true,
      project: runCwd ? path.basename(runCwd) : undefined,
    });
  }
  // Make this run killable by the Stop button (a separate request).
  if (runId) registerProc(runId, child);
  let parseBuf = ""; // line-buffer for run capture (separate from forwarding)
  let lastSave = 0;
  const maybeSave = async (force = false) => {
    if (!run) return;
    const now = Date.now();
    if (force || now - lastSave > 1200) {
      lastSave = now;
      try { await saveRun(run); } catch { /* best-effort */ }
    }
  };
  const captureLine = (line: string) => {
    if (!run) return;
    const t = line.trim();
    if (!t) return;
    try { applyEvent(run, JSON.parse(t)); } catch { /* non-JSON, ignore */ }
  };

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

      // Tell the client the run id up front so it can deep-link to the replay.
      if (runId) send(JSON.stringify({ type: "ultracode_run_started", runId }) + "\n");

      child.stdout.on("data", (b: Buffer) => {
        const s = b.toString();
        send(s); // forward raw to client (live Swarm Map parses the same events)
        if (run) {
          parseBuf += s;
          let idx: number;
          while ((idx = parseBuf.indexOf("\n")) >= 0) {
            const line = parseBuf.slice(0, idx);
            parseBuf = parseBuf.slice(idx + 1);
            captureLine(line);
          }
          void maybeSave();
        }
      });
      child.stderr.on("data", (b: Buffer) => {
        send(JSON.stringify({ type: "stderr", text: b.toString() }) + "\n");
      });
      child.on("close", async (code) => {
        const userStopped = runId ? isStopped(runId) : false;
        if (runId) unregisterProc(runId);
        if (run) {
          if (parseBuf.trim()) captureLine(parseBuf);
          if (run.status === "running") {
            run.status = userStopped ? "stopped" : (code === 0 ? "completed" : "failed");
          }
          if (!run.finishedAt) run.finishedAt = Date.now();
          // applyEvent set run.costUsd to THIS turn's cost; add prior turns'.
          if (priorCost > 0) run.costUsd = priorCost + (run.costUsd ?? 0);
          // Record token usage for the dashboard (Claude CLI reports it in result events).
          void logTokens({ agent: "claude", model: CLAUDE_MODEL, totalTokens: run.tokensTotal ?? 0, costUsd: run.costUsd ?? 0, kind: "chat" });
          await maybeSave(true);
          send(JSON.stringify({ type: "ultracode_run_saved", runId }) + "\n");
        }
        send(JSON.stringify({ type: "done", code }) + "\n");
        safeClose();
      });
      child.on("error", async (e) => {
        if (runId) unregisterProc(runId);
        if (run) { run.status = "failed"; run.finishedAt = Date.now(); await maybeSave(true); }
        send(JSON.stringify({ type: "error", message: String(e) }) + "\n");
        safeClose();
      });
    },
    cancel() {
      // Client disconnected (tab closed / navigated away). Kill the child.
      const userStopped = runId ? isStopped(runId) : false;
      try { child.kill("SIGTERM"); } catch {}
      if (runId) unregisterProc(runId);
      if (run) {
        if (run.status === "running") run.status = userStopped ? "stopped" : "failed";
        run.finishedAt = Date.now();
        void saveRun(run);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

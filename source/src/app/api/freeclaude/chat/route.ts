import { spawnStream } from "@/lib/runner";
import { fccSpawnEnv, probeReachable } from "@/lib/fcc";
import { ensureProject, FCC_SCRATCH_ROOT } from "@/lib/freeClaudeWorkspace";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatMsg { role: "user" | "assistant" | "system"; text: string; }

// Pack prior turns into a single prompt the `claude -p` single-shot mode can
// understand. The CLI starts a fresh session for every -p invocation, so this
// is the only way to give it conversation memory without using --continue
// (which doesn't work with --bare). Trims to fit Claude's context budget.
function buildPromptWithHistory(history: ChatMsg[], current: string): string {
  if (!history.length) return current;
  // Cap to last ~12 turns or 8 KB of context, whichever is tighter
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

// Free Claude Code chat — same shape as /api/claude/chat but the spawned
// `claude` CLI is pointed at the local fcc-server via env vars, which routes
// the request to the configured upstream (OpenRouter Owl Alpha by default).
//
// If fcc-server isn't reachable on :8082 we surface that clearly instead of
// letting the CLI fail with a confusing connection error.
export async function POST(req: Request) {
  const body = await req.json();
  const prompt = body.prompt;
  const history: ChatMsg[] = Array.isArray(body.history) ? body.history : [];
  if (typeof prompt !== "string" || prompt.length === 0) {
    return new Response("missing prompt", { status: 400 });
  }
  if (prompt.length > 16_000) {
    return new Response("prompt too long", { status: 413 });
  }
  const fullPrompt = buildPromptWithHistory(history, prompt);

  // Pin the spawn's cwd to a scratch project so anything claude writes
  // (HTML pages, scripts, HyperFrames renders, etc.) lands somewhere the
  // Workspace tab can find. If the client passed `project: "name"`, we use
  // that. Otherwise the client may pass an explicit `cwd: "/abs/path"`.
  // Final fallback: a default `freeclaude-default` project.
  let cwd: string | undefined;
  if (typeof body.project === "string" && /^[A-Za-z0-9_.-]+$/.test(body.project)) {
    cwd = (await ensureProject(body.project)) ?? undefined;
  } else if (typeof body.cwd === "string") {
    cwd = body.cwd;
  } else {
    cwd = (await ensureProject("freeclaude-default")) ?? path.join(FCC_SCRATCH_ROOT, "freeclaude-default");
  }

  if (!(await probeReachable())) {
    return new Response(
      JSON.stringify({
        type: "error",
        message:
          "fcc-server is not running on :8082. Start it from your terminal with `fcc-server`, then try again.",
      }) + "\n",
      {
        status: 503,
        headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
      },
    );
  }

  // `--bare` is essential: per `claude --help` it forces auth to come strictly
  // from ANTHROPIC_API_KEY (env), bypassing OAuth/keychain. Without this the
  // CLI uses the user's `claude login` credentials and fcc-server returns 401.
  // Side effect: skips hooks/LSP/plugins/CLAUDE.md discovery — acceptable for
  // a chat-style panel since we're not running Claude-Code-as-coding-agent here.
  const child = spawnStream("fcc", [
    "--bare",
    "-p",
    "--output-format=stream-json",
    "--include-partial-messages",
    "--verbose",
    fullPrompt,
  ], { cwd, extraEnv: fccSpawnEnv() });

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

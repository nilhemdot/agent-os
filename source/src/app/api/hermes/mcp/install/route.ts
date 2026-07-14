// POST /api/hermes/mcp/install
// Body: { name: string, envVars?: Record<string, string> }
//
// Pre-writes envVars to ~/.hermes/.env (atomic, preserves existing keys),
// then spawns `hermes mcp install <name>` and streams its stdout/stderr to
// the client as newline-delimited JSON events:
//
//   {"type": "step",   "label": "Writing env vars"}
//   {"type": "stdout", "text": "Cloning into …"}
//   {"type": "stderr", "text": "…"}
//   {"type": "done",   "code": 0, "ok": true}
//   {"type": "error",  "text": "…"}
//
// The UI displays these line-by-line in the install modal's live log.

import { spawn } from "node:child_process";
import { agentEnv } from "@/lib/runner";
import { config, hermesHome } from "@/lib/config";
import { upsertEnv } from "@/lib/hermesMcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { name?: string; envVars?: Record<string, string> };
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "invalid json" }), { status: 400 }); }
  const name = body.name;
  if (!name || !/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
    return new Response(JSON.stringify({ error: "valid name required" }), { status: 400 });
  }
  if (!config.hermes) {
    return new Response(JSON.stringify({ error: "hermes CLI not installed or not configured" }), { status: 500 });
  }
  const hermesBin = config.hermes;
  const envVars = body.envVars ?? {};

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (obj: Record<string, unknown>) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n")); } catch { /* closed */ }
      };

      // Step 1 — write env vars (if any) to ~/.hermes/.env.
      if (Object.keys(envVars).length > 0) {
        emit({ type: "step", label: "Writing credentials to ~/.hermes/.env" });
        const r = await upsertEnv(envVars);
        if (!r.ok) {
          emit({ type: "error", text: `env write failed: ${r.error}` });
          emit({ type: "done", ok: false, code: 1, reason: "env write failed" });
          try { controller.close(); } catch { /* already closed */ }
          return;
        }
        emit({ type: "step", label: `Wrote ${r.written.length} env var(s): ${r.written.join(", ")}` });
      } else {
        emit({ type: "step", label: "No credentials required" });
      }

      // Step 2 — spawn `hermes mcp install <name>` and stream stdout/stderr.
      // We force a non-TTY env so the CLI doesn't try to use the interactive
      // pager / spinner. Pre-set credentials in env so the CLI sees them and
      // can skip its own prompts where supported.
      emit({ type: "step", label: `Running: hermes mcp install ${name}` });
      const childEnv = agentEnv({
        ...envVars,
        NO_COLOR: "1",
        FORCE_COLOR: "0",
        TERM: "dumb",
        // HERMES_ACCEPT_HOOKS=1 auto-approves any shell hook prompts; without
        // it the install can hang waiting on a TTY confirm we can't satisfy.
        HERMES_ACCEPT_HOOKS: "1",
      });
      const child = spawn(hermesBin, ["mcp", "install", name], {
        cwd: hermesHome(),
        env: childEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const flushLine = (kind: "stdout" | "stderr") => {
        let buf = "";
        return (chunk: Buffer) => {
          buf += chunk.toString();
          let idx: number;
          while ((idx = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            if (line.length > 0) emit({ type: kind, text: line });
          }
        };
      };
      child.stdout.on("data", flushLine("stdout"));
      child.stderr.on("data", flushLine("stderr"));

      // Close stdin immediately — the CLI will see EOF for any prompts it
      // tries to display. If it absolutely requires input we couldn't pre-bake,
      // it'll fail fast rather than hang on a missing TTY.
      try { child.stdin.end(); } catch { /* ignore */ }

      child.on("error", (e) => {
        emit({ type: "error", text: `spawn failed: ${e}` });
        emit({ type: "done", ok: false, code: -1 });
        try { controller.close(); } catch { /* already closed */ }
      });
      child.on("close", (code) => {
        emit({ type: "done", ok: code === 0, code });
        try { controller.close(); } catch { /* already closed */ }
      });

      // Hard timeout — 5 minutes max for any install. Git clones + pip installs
      // can be slow on a slow network but anything beyond 5min is hung.
      const TIMEOUT_MS = 5 * 60 * 1000;
      const timeoutHandle = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* ignore */ }
        emit({ type: "error", text: `install timed out after ${TIMEOUT_MS / 1000}s` });
      }, TIMEOUT_MS);
      child.on("close", () => clearTimeout(timeoutHandle));
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

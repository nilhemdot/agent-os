import { spawnStream } from "@/lib/runner";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { glmcodeSpawnEnv, GLM_CODE_MODEL } from "@/lib/glmcode";
import { appendGlmHistory } from "@/lib/glmCodeHistory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The dev server is often launched detached (launchd) with a minimal PATH that
// excludes ~/.local/bin (where `claude` lives) and Homebrew. Prepend them so the
// spawn always resolves `claude`, regardless of how the server was started.
const BIN_PATH = [
  path.join(os.homedir(), ".local/bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  path.join(os.homedir(), ".npm-global/bin"),
  process.env.PATH || "",
].filter(Boolean).join(":");

const ROOT = path.join(os.homedir(), ".agentic-os", "glm-code", "builds");

function slugify(s: string): string {
  return (s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "build");
}

export async function POST(req: Request) {
  const { prompt, project } = await req.json();
  if (typeof prompt !== "string" || !prompt.trim()) {
    return new Response(JSON.stringify({ error: "missing prompt" }), { status: 400 });
  }

  // Each build gets its own project dir so Claude Code can read/write freely.
  const name = (typeof project === "string" && /^[a-z0-9-]{1,48}$/.test(project))
    ? project
    : `${slugify(prompt)}-${Date.now().toString(36).slice(-5)}`;
  const cwd = path.join(ROOT, name);
  await mkdir(cwd, { recursive: true });

  const args = [
    "-p", prompt.trim(),
    "--output-format", "stream-json",
    "--verbose",
    "--model", GLM_CODE_MODEL,
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const emit = (obj: Record<string, unknown>) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n")); } catch { /* closed */ }
      };

      emit({ type: "start", project: name, model: GLM_CODE_MODEL, cwd });

      // captured from the final result event so we can log it (history + Obsidian)
      let resOk = false, resCost: number | undefined, resTurns: number | undefined, resMs: number | undefined;

      const child = spawnStream("claude", args, { cwd, extraEnv: { ...glmcodeSpawnEnv(), PATH: BIN_PATH } });
      // `claude -p` waits ~3s for piped stdin; we have none, so close it immediately.
      try { child.stdin?.end(); } catch {}

      // 12-minute hard cap so a stuck agentic loop can't run forever.
      const killer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 12 * 60_000);

      let buf = "";
      const handleLine = (line: string) => {
        if (!line.trim()) return;
        let e: Record<string, unknown>;
        try { e = JSON.parse(line); } catch { return; }
        const t = e.type;
        if (t === "assistant") {
          const msg = (e.message ?? {}) as { content?: Array<Record<string, unknown>> };
          for (const b of msg.content ?? []) {
            if (b.type === "text" && String(b.text ?? "").trim()) emit({ type: "text", text: b.text });
            else if (b.type === "tool_use") emit({ type: "tool", name: b.name, input: b.input });
          }
        } else if (t === "user") {
          const msg = (e.message ?? {}) as { content?: Array<Record<string, unknown>> };
          for (const b of msg.content ?? []) {
            if (b.type === "tool_result") {
              const c = b.content;
              const text = Array.isArray(c) ? c.map((x) => (x as { text?: string }).text ?? "").join("") : String(c ?? "");
              emit({ type: "tool_result", text: text.slice(0, 400) });
            }
          }
        } else if (t === "result") {
          resOk = e.subtype === "success"; resCost = e.total_cost_usd as number; resTurns = e.num_turns as number; resMs = e.duration_ms as number;
          emit({ type: "result", subtype: e.subtype, cost: e.total_cost_usd, turns: e.num_turns, ms: e.duration_ms, result: typeof e.result === "string" ? (e.result as string).slice(0, 600) : undefined });
        } else if (t === "system" && e.subtype === "init") {
          emit({ type: "system", model: e.model, tools: Array.isArray(e.tools) ? (e.tools as string[]).length : undefined });
        }
      };

      child.stdout.on("data", (d) => {
        buf += d.toString();
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) { handleLine(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
      });
      child.stderr.on("data", (d) => {
        const s = d.toString().trim();
        if (s) emit({ type: "stderr", text: s.slice(0, 300) });
      });
      child.on("error", (err) => { emit({ type: "error", text: String(err).slice(0, 200) }); });
      child.on("close", (code) => {
        clearTimeout(killer);
        if (buf.trim()) handleLine(buf);
        // log this build to history + the Obsidian vault (fire-and-forget)
        appendGlmHistory({ ts: Date.now(), prompt: prompt.trim(), project: name, ok: resOk, cost: resCost, turns: resTurns, ms: resMs, model: GLM_CODE_MODEL }).catch(() => {});
        emit({ type: "done", code: code ?? 0, project: name });
        try { controller.close(); } catch {}
      });

      // Abort the child if the client disconnects.
      req.signal.addEventListener("abort", () => { try { child.kill("SIGKILL"); } catch {} });
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

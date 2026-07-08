import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { config } from "./config";

// "fcc" is the Free Claude Code agent — it runs the same `claude` CLI but with
// the local fcc-server proxy env vars injected, routing requests to OpenRouter
// / NVIDIA NIM / Kimi / etc instead of api.anthropic.com.
// "codex" is OpenAI's Codex CLI (≥ 0.125 — supports `codex exec --json` for streaming).
export type AgentName = "claude" | "openclaw" | "hermes" | "antigravity" | "fcc" | "codex" | "kimi" | "grok" | "ruflo" | "ant";

function binFor(agent: AgentName): string {
  // fcc is a virtual agent — it spawns the regular claude binary, just with
  // different env vars (see fccSpawnEnv in lib/fcc.ts).
  const key = agent === "fcc" ? "claude" : agent;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bin = (config as any)[key];
  if (!bin) throw new Error(`${agent} is not installed or not configured. Set AGENTIC_OS_${key.toUpperCase()}_BIN or install the CLI.`);
  return bin;
}

// Build an env that agents can actually run subprocesses inside. The Next.js dev server's
// own process.env can be missing SHELL or have a stripped PATH, which causes Antigravity to
// crash mid-task with `fork/exec /bin/zsh: no such file or directory` and similar.
// We force SHELL + a baseline PATH covering all the standard macOS bin dirs + Homebrew + the
// user's local Node, so any tool the agent shells out to can be resolved.
function agentEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const base = process.env;
  const ensurePath = [
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
    `${process.env.HOME ?? "/Users/juliangoldie"}/.local/bin`,
    `${process.env.HOME ?? "/Users/juliangoldie"}/local/node/bin`,
    `${process.env.HOME ?? "/Users/juliangoldie"}/.kimi-code/bin`,
  ];
  const existing = (base.PATH ?? "").split(":").filter(Boolean);
  const merged = [...new Set([...existing, ...ensurePath])].join(":");
  return {
    ...base,
    PATH: merged,
    SHELL: base.SHELL || "/bin/zsh",
    HOME: base.HOME || `/Users/${process.env.USER || "juliangoldie"}`,
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    ...extra,
  };
}

const FLAG_PATTERN = /^[A-Za-z0-9_\-./:=,@+%]+$/;
const MAX_ARG_LEN = 32_000;

export function validateFlagArgs(args: readonly string[]): string[] {
  return args.filter((a) => typeof a === "string" && a.length < MAX_ARG_LEN && FLAG_PATTERN.test(a));
}

function safeArg(a: unknown): string | null {
  if (typeof a !== "string") return null;
  if (a.length === 0 || a.length > MAX_ARG_LEN) return null;
  if (a.includes("\0")) return null;
  return a;
}

export interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export async function run(
  agent: AgentName,
  args: readonly string[],
  opts: { timeoutMs?: number; cwd?: string; input?: string; extraEnv?: Record<string, string> } = {}
): Promise<RunResult> {
  const cleanArgs = args.map(safeArg).filter((a): a is string => a !== null);
  const started = Date.now();

  let bin: string;
  try { bin = binFor(agent); }
  catch (e) {
    return { ok: false, code: -1, stdout: "", stderr: String(e), durationMs: 0 };
  }

  return new Promise<RunResult>((resolve) => {
    const child = spawn(bin, cleanArgs, {
      cwd: opts.cwd ?? process.env.HOME,
      env: agentEnv(opts.extraEnv ?? {}),
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
    }, opts.timeoutMs ?? 15_000);

    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ ok: code === 0, code, stdout, stderr, durationMs: Date.now() - started });
    });
    child.on("error", (e) => {
      clearTimeout(timeout);
      resolve({ ok: false, code: -1, stdout, stderr: String(e), durationMs: Date.now() - started });
    });

    if (opts.input) child.stdin.write(opts.input);
    try { child.stdin.end(); } catch {}
  });
}

export function spawnStream(
  agent: AgentName,
  args: readonly string[],
  opts: { cwd?: string; input?: string; extraEnv?: Record<string, string> } = {}
): ChildProcessWithoutNullStreams {
  const bin = binFor(agent);
  const cleanArgs = args.map(safeArg).filter((a): a is string => a !== null);
  const child = spawn(bin, cleanArgs, {
    cwd: opts.cwd ?? process.env.HOME,
    env: agentEnv(opts.extraEnv ?? {}),
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
  if (typeof opts.input === "string" && opts.input.length > 0) {
    // Write the prompt to stdin (no OS arg-length limit, no per-arg cap).
    child.stdin.write(opts.input);
  }
  try { child.stdin.end(); } catch {}
  return child;
}

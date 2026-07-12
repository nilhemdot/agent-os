import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { config } from "./config";
import { appendRunEvent, budgetPrecheck, createRun, getRun, runPolicy, tripRun, updateRunMetadata } from "./ledger";
import { parseJsonlUsage } from "./runAdapters";
import { billingRefusal, breakerPolicy, CircuitBreaker, type BreakerPolicy } from "./circuitBreaker";
import { scanWorkspaceConfig } from "./configFirewall";
import { listCriteria } from "./contract";
import { canaryForRun, containsSecret, redactText, RedactTransform, resolveSecretRefs } from "./credentialBroker";
import { recordSecretUsage, setRunSandbox } from "./ledger";
import { selectSandbox } from "./sandbox";

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

const versions = new Map<string, string>();
function cliVersion(agent: AgentName, bin: string, cwd: string): string {
  const cached = versions.get(bin); if (cached) return cached;
  const value = spawnSync(bin, ["--version"], { cwd, env: agentEnv(), encoding: "utf8", timeout: 2_000 });
  const version = `${agent}:${(value.stdout || value.stderr || "unknown").trim().slice(0, 120)}`;
  versions.set(bin, version); return version;
}

function telemetryEnv(runId: string, workspace: string, extra: Record<string, string>): Record<string, string> {
  return {
    CLAUDE_CODE_ENABLE_TELEMETRY: "1", OTEL_METRICS_EXPORTER: "otlp", OTEL_LOGS_EXPORTER: "otlp",
    OTEL_TRACES_EXPORTER: "otlp", OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318", OTEL_METRIC_EXPORT_INTERVAL: "10000",
    // OTEL_LOG_TOOL_DETAILS is deliberately NOT set: with it enabled the claude CLI
    // emits raw tool params (which can contain secret values) into the OTLP log body.
    // Dropping it removes that exfil surface at the source (M3.7 fail-safe).
    OTEL_LOGS_EXPORT_INTERVAL: "5000",
    OTEL_RESOURCE_ATTRIBUTES: `agentos.run_id=${runId},agentos.workspace=${workspace.replaceAll(",", "_")}`,
    OTEL_EXPORTER_OTLP_HEADERS: `x-agentos-run-id=${runId}`, AGENTOS_RUN_ID: runId, ...extra,
  };
}

// Build an env that agents can actually run subprocesses inside. The Next.js dev server's
// own process.env can be missing SHELL or have a stripped PATH, which causes Antigravity to
// crash mid-task with `fork/exec /bin/zsh: no such file or directory` and similar.
// We force SHELL + a baseline PATH covering all the standard macOS bin dirs + Homebrew + the
// user's local Node, so any tool the agent shells out to can be resolved.
export function agentEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const { PATH, HOME, SHELL, LANG, TERM } = process.env;
  const ensurePath = [
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
    HOME && path.join(HOME, ".local/bin"),
    HOME && path.join(HOME, "local/node/bin"),
    HOME && path.join(HOME, ".kimi-code/bin"),
  ].filter((entry): entry is string => Boolean(entry));
  const existing = (PATH ?? "").split(path.delimiter).filter(Boolean);
  const merged = [...new Set([...existing, ...ensurePath])].join(":");
  return {
    PATH: merged,
    ...(HOME ? { HOME } : {}),
    SHELL: SHELL || "/bin/sh",
    ...(LANG ? { LANG } : {}),
    ...(TERM ? { TERM } : {}),
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    ...extra,
  } as unknown as NodeJS.ProcessEnv;
}

const FLAG_PATTERN = /^[A-Za-z0-9_\-./:=,@+%]+$/;
const MAX_ARG_LEN = 32_000;

export function validateFlagArgs(args: readonly string[]): string[] {
  return args.filter((a) => typeof a === "string" && a.length < MAX_ARG_LEN && FLAG_PATTERN.test(a));
}

const FORBIDDEN_AGENT_ARGS = new Set(["--dangerously-skip-permissions", "--dangerously-bypass-approvals-and-sandbox", "bypassPermissions", "--no-sandbox"]);

export function validateAgentArgs(args: readonly string[]): string[] {
  const clean = args.map(safeArg);
  if (clean.some((arg) => arg === null) || clean.some((arg) => arg && FORBIDDEN_AGENT_ARGS.has(arg))) {
    throw new Error("unsafe agent argument rejected");
  }
  return clean as string[];
}

export function requireWorkspace(cwd?: string): string {
  if (!cwd || !path.isAbsolute(cwd)) throw new Error("an absolute workspace cwd is required");
  return cwd;
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

type RunOptions = { cwd: string; timeoutMs?: number; input?: string; extraEnv?: Record<string, string>; runId?: string;
  policy?: Partial<BreakerPolicy> & { secretRefs?: unknown; sandbox?: unknown }; detached?: boolean };

// In-memory map of runId -> secret/canary values, populated at spawn and cleared
// on finish. Never persisted. The OTLP receiver (same worker process) reads it to
// redact/detect secret values in telemetry bodies (M3.7).
export const runSecretValues = new Map<string, string[]>();

const SCAN_SKIP = new Set([".git", "node_modules", ".next", ".turbo", "dist", "out", "coverage"]);
const SCAN_MAX_FILES = 2_000;
const SCAN_MAX_BYTES = 1_000_000;

// Post-run scan of the workspace for the canary + secret-value variants written to
// disk during the run. mtime>=run-start covers both git and non-git workspaces
// (superset of `git diff`). Bounded by file count + per-file size.
// ponytail: mtime walk instead of `git diff` — strictly a superset, one code path.
export function scanWorkspaceForSecrets(cwd: string, sinceMs: number, values: string[]): string[] {
  if (!values.length) return [];
  const hits: string[] = [];
  let budget = SCAN_MAX_FILES;
  const walk = (dir: string) => {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (budget <= 0 || hits.length >= 20) return;
      if (SCAN_SKIP.has(name)) continue;
      const full = path.join(dir, name);
      let stat: ReturnType<typeof statSync>;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory()) { walk(full); continue; }
      if (!stat.isFile() || stat.mtimeMs < sinceMs || stat.size > SCAN_MAX_BYTES) continue;
      budget--;
      let text: string;
      try { text = readFileSync(full, "utf8"); } catch { continue; }
      if (containsSecret(text, values)) hits.push(path.relative(cwd, full));
    }
  };
  walk(cwd);
  return hits;
}

function prepareRun(agent: AgentName, args: readonly string[], opts: RunOptions) {
  const cleanArgs = validateAgentArgs(args), cwd = requireWorkspace(opts.cwd), originalBin = binFor(agent);
  const version = cliVersion(agent, originalBin, cwd);
  const runId = opts.runId || createRun({ agent, workspace: cwd, args, cliVersion: version, policy: opts.policy }).id;
  if (opts.runId) updateRunMetadata(runId, { cliVersion: version });
  const rawPolicy = { ...runPolicy(runId), ...opts.policy } as Record<string, unknown>;
  const policy = breakerPolicy(rawPolicy), drift = scanWorkspaceConfig(cwd);
  if (drift.length) {
    appendRunEvent(runId, "config_quarantined", { files: drift });
    const reason = `config_firewall: ${drift.map((file) => `${file.kind}:${file.path}`).join(", ")}`;
    tripRun(runId, reason); throw new Error(reason);
  }
  // M4.1 pre-flight (opt-in): when policy.requireContract is set, a run missing
  // criteria fails before the broker/spawn. Gated so existing M1-M3 contract-less
  // runs still launch. "A run without criteria is not a run."
  if (rawPolicy.requireContract && listCriteria(runId).length === 0) {
    const reason = "contract: a run without criteria is not a run";
    tripRun(runId, reason); throw new Error(reason);
  }
  let secrets: ReturnType<typeof resolveSecretRefs>;
  try { secrets = resolveSecretRefs(rawPolicy.secretRefs); }
  catch (error) { const reason = `credential_broker: ${String(error)}`; tripRun(runId, reason); throw error; }
  secrets.refs.forEach((ref) => recordSecretUsage(runId, ref.id, ref.env));
  for (const envName of Object.keys(opts.extraEnv || {}).filter((name) => /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(name)))
    recordSecretUsage(runId, `inline:${envName}`, envName);
  const canary = canaryForRun(runId);
  const env = agentEnv(telemetryEnv(runId, cwd, { ...opts.extraEnv, ...secrets.env, AGENTOS_CANARY_SECRET: canary }));
  let launch: ReturnType<typeof selectSandbox>;
  try { launch = selectSandbox(agent, originalBin, cleanArgs, rawPolicy.sandbox); }
  catch (error) { const reason = `sandbox: ${String(error)}`; tripRun(runId, reason); throw error; }
  setRunSandbox(runId, launch.sandbox);
  // Explicit sandbox:"none" opt-out is honored but never silent (M3.10).
  if (launch.sandbox === "none") appendRunEvent(runId, "security_alert", { kind: "sandbox_disabled", agent });
  const billingEnv = { ...env,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
    AGENTOS_ANTHROPIC_PLAN: process.env.AGENTOS_ANTHROPIC_PLAN,
    AGENTOS_ALLOW_API_KEY: process.env.AGENTOS_ALLOW_API_KEY,
  } as NodeJS.ProcessEnv;
  const run = getRun(runId);
  const refusal = billingRefusal(agent, args, billingEnv, policy)
    || ((run?.cost_usd || 0) + policy.estimatedCallUsd > policy.maxCostUsd ? `budget: run $${policy.maxCostUsd} hard cap` : null)
    || budgetPrecheck(runId, policy.estimatedCallUsd);
  if (refusal) { tripRun(runId, refusal); throw new Error(refusal); }
  if (!opts.runId) appendRunEvent(runId, "started", {});
  const redactions = [...secrets.values, canary];
  runSecretValues.set(runId, redactions);
  return { bin: launch.bin, cleanArgs: launch.args.map((arg) => redactText(arg, secrets.values)), cwd, runId, policy, env,
    input: opts.input ? redactText(opts.input, secrets.values) : undefined,
    secrets: secrets.values, redactions, canary };
}

function killProcessTree(child: ChildProcessWithoutNullStreams) {
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  } catch { try { child.kill("SIGKILL"); } catch {} }
}

// Exported for parent-supervision tests: the breaker runs HERE, in the worker
// process, never inside the agent child. On trip it writes the ledger first
// (synchronous SQLite) and only then SIGKILLs the process tree.
export function monitorChild(child: ChildProcessWithoutNullStreams, runId: string, policy: BreakerPolicy, secrets: string[], canary: string) {
  let stalled = false;
  let securityCarry = "";
  const breaker = new CircuitBreaker(policy, Date.now(), (reason) => { tripRun(runId, reason); killProcessTree(child); });
  const feed = (text: string) => {
    if (getRun(runId)?.tripped_reason) return;
    if (text) stalled = false;
    const securityText = securityCarry + text; securityCarry = securityText.slice(-512);
    if (containsSecret(securityText, [canary])) { appendRunEvent(runId, "security_alert", { kind: "canary_exposed" }); tripRun(runId, "canary_exposed"); killProcessTree(child); return; }
    if (containsSecret(securityText, secrets)) { appendRunEvent(runId, "security_alert", { kind: "secret_exposed" }); tripRun(runId, "secret_exposed"); killProcessTree(child); return; }
    breaker.feed(text);
  };
  const timer = setInterval(() => {
    const now = Date.now();
    if (getRun(runId)?.tripped_reason && !breaker.trippedReason) { killProcessTree(child); return; }
    if (!stalled && breaker.isStalled(now)) { stalled = true; appendRunEvent(runId, "stalled", { since: new Date(breaker.lastOutputAt).toISOString() }); }
    breaker.tick(now, getRun(runId)?.cost_usd || 0);
  }, 250);
  return { breaker, feed, stop: () => clearInterval(timer) };
}

function finishRun(runId: string, agent: AgentName, code: number | null, stdout: string, stderr: string, secrets: string[], cwd: string, startedMs: number) {
  const usage = parseJsonlUsage(stdout);
  if (usage.inputTokens || usage.outputTokens || usage.cacheTokens || usage.costUsd) appendRunEvent(runId, "usage", usage);
  if (usage.externalRunId) updateRunMetadata(runId, { externalSource: agent, externalRunId: usage.externalRunId });
  // Post-run: scan files the run wrote for canary + secret-value variants (M3.8/M3.12).
  const leaked = scanWorkspaceForSecrets(cwd, startedMs, secrets);
  if (leaked.length) { appendRunEvent(runId, "security_alert", { kind: "secret_in_artifact", files: leaked }); tripRun(runId, "secret_in_artifact"); }
  runSecretValues.delete(runId);
  const safeErr = redactText(stderr, secrets);
  if (getRun(runId)?.tripped_reason) appendRunEvent(runId, "process_exited", { code, afterTrip: true });
  else appendRunEvent(runId, code === 0 ? "completed" : "failed", { code, stderr: safeErr.slice(-2_000) });
}

export async function run(
  agent: AgentName,
  args: readonly string[],
  opts: RunOptions
): Promise<RunResult> {
  const started = Date.now();
  let prepared: ReturnType<typeof prepareRun>;
  try { prepared = prepareRun(agent, args, opts); }
  catch (e) {
    return { ok: false, code: -1, stdout: "", stderr: String(e), durationMs: 0 };
  }

  return new Promise<RunResult>((resolve) => {
    const child = spawn(prepared.bin, prepared.cleanArgs, { cwd: prepared.cwd, env: prepared.env, detached: process.platform !== "win32" }) as ChildProcessWithoutNullStreams;
    const monitor = monitorChild(child, prepared.runId, prepared.policy, prepared.secrets, prepared.canary);
    let stdout = "";
    let stderr = "";
    const timeoutMs = opts.timeoutMs ?? prepared.policy.maxDurationMs;
    const timeout = setTimeout(() => {
      tripRun(prepared.runId, `timeout: ${timeoutMs}ms`); killProcessTree(child);
    }, timeoutMs);

    child.stdout.on("data", (b) => { const text = b.toString(); stdout += text; monitor.feed(text); });
    child.stderr.on("data", (b) => { const text = b.toString(); stderr += text; monitor.feed(text); });
    child.on("close", (code) => {
      clearTimeout(timeout); monitor.feed("\n"); monitor.stop(); finishRun(prepared.runId, agent, code, stdout, stderr, prepared.redactions, prepared.cwd, started);
      resolve({ ok: code === 0 && !getRun(prepared.runId)?.tripped_reason, code,
        stdout: redactText(stdout, prepared.redactions), stderr: redactText(stderr, prepared.redactions), durationMs: Date.now() - started });
    });
    child.on("error", (e) => {
      clearTimeout(timeout); monitor.stop(); runSecretValues.delete(prepared.runId); appendRunEvent(prepared.runId, "failed", { error: String(e) });
      resolve({ ok: false, code: -1, stdout, stderr: String(e), durationMs: Date.now() - started });
    });

    if (prepared.input) child.stdin.write(prepared.input);
    try { child.stdin.end(); } catch {}
  });
}

export function spawnStream(
  agent: AgentName,
  args: readonly string[],
  opts: RunOptions
): ChildProcessWithoutNullStreams {
  const started = Date.now();
  const prepared = prepareRun(agent, args, opts);
  const child = spawn(prepared.bin, prepared.cleanArgs, {
    cwd: prepared.cwd,
    env: prepared.env,
    detached: opts.detached ?? process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
  if (typeof prepared.input === "string" && prepared.input.length > 0) {
    // Write the prompt to stdin (no OS arg-length limit, no per-arg cap).
    child.stdin.write(prepared.input);
  }
  try { child.stdin.end(); } catch {}
  const monitor = monitorChild(child, prepared.runId, prepared.policy, prepared.secrets, prepared.canary);
  const safeStdout = child.stdout.pipe(new RedactTransform(prepared.redactions));
  const safeStderr = child.stderr.pipe(new RedactTransform(prepared.redactions));
  let stdout = "", stderr = "";
  child.stdout.on("data", (b) => { const text = b.toString(); stdout += text; monitor.feed(text); });
  child.stderr.on("data", (b) => { const text = b.toString(); stderr += text; monitor.feed(text); });
  child.on("close", (code) => {
    monitor.feed("\n"); monitor.stop(); finishRun(prepared.runId, agent, code, stdout, stderr, prepared.redactions, prepared.cwd, started);
  });
  child.on("error", (e) => { monitor.stop(); runSecretValues.delete(prepared.runId); appendRunEvent(prepared.runId, "failed", { error: String(e) }); });
  return new Proxy(child, { get(target, property) {
    if (property === "stdout") return safeStdout;
    if (property === "stderr") return safeStderr;
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  } }) as ChildProcessWithoutNullStreams;
}

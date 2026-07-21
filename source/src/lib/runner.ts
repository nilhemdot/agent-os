import { spawn, spawnSync, execFile, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, readdirSync, statSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { config } from "./config";
import { appendRunEvent, budgetPrecheck, createRun, getRun, runPolicy, tripRun, updateRunMetadata } from "./ledger";
import { parseJsonlUsage } from "./runAdapters";
import { billingRefusal, breakerPolicy, CircuitBreaker, type BreakerPolicy } from "./circuitBreaker";
import { scanWorkspaceConfig } from "./configFirewall";
import { criteriaCoveringPath, linkEvidence, listCriteria, recordArtifact } from "./contract";
import { canaryForRun, containsSecret, redactText, RedactTransform, resolveSecretRefs } from "./credentialBroker";
import { recordSecretUsage, setRunSandbox } from "./ledger";
import { selectSandbox } from "./sandbox";
import { recordActionRequest } from "./actions";
import { createCheckpoint } from "./checkpoints";

// M5.3 producer helper — a policy rule that BLOCKS an action emits a 'policy_denied'
// run_event so reviewData's policy_denials consumer surfaces it. `rule` is the policy
// family (text before the first ':' in the refusal), e.g. "sandbox", "billing_guard",
// "budget"; `reason` carries the full human-readable refusal.
function policyDenied(runId: string, reason: string): void {
  const rule = reason.split(":")[0]?.trim() || null;
  appendRunEvent(runId, "policy_denied", { rule, reason });
}

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

// R1 — subprocess firewall: route all non-agent subprocess launches through here to enforce
// minimal environment (array args, no API key leakage). ponytail: no shell interpretation,
// minimal env only (PATH/HOME/SHELL/LANG/TERM); callers pass extra env as needed.
export interface SpawnSubprocessOptions {
  cwd?: string;
  env?: Record<string, string>;
  detached?: boolean;
  stdio?: import("node:child_process").StdioOptions; // pass through to spawn
  encoding?: BufferEncoding; // encoding for spawnSync stdout/stderr
  timeout?: number; // timeout for spawnSync
  maxBuffer?: number; // maxBuffer for spawnSync
}

export function spawnSubprocess(
  cmd: string,
  args: string[],
  opts?: SpawnSubprocessOptions
): ChildProcessWithoutNullStreams {
  const env = agentEnv(opts?.env);
  return spawn(cmd, args, {
    cwd: opts?.cwd,
    env,
    detached: opts?.detached ?? false,
    ...(opts?.stdio !== undefined && { stdio: opts.stdio }),
  }) as ChildProcessWithoutNullStreams;
}

// R1 — spawnSync wrapper: synchronous subprocess with minimal env (for routes that need blocking calls)
export function spawnSubprocessSync(
  cmd: string,
  args: string[],
  opts?: SpawnSubprocessOptions
): ReturnType<typeof spawnSync> {
  const env = agentEnv(opts?.env);
  return spawnSync(cmd, args, {
    cwd: opts?.cwd,
    env,
    ...(opts?.stdio !== undefined && { stdio: opts.stdio }),
    ...(opts?.encoding !== undefined && { encoding: opts.encoding }),
    ...(opts?.timeout !== undefined && { timeout: opts.timeout }),
    ...(opts?.maxBuffer !== undefined && { maxBuffer: opts.maxBuffer }),
  });
}

// R1 — execFile wrapper: route file execution through runner with minimal env
export const spawnSubprocessExecFile = promisify(execFile);
export async function execSubprocess(
  cmd: string,
  args: string[],
  opts?: SpawnSubprocessOptions & { timeout?: number; maxBuffer?: number }
): Promise<{ stdout: string; stderr: string }> {
  const env = agentEnv(opts?.env);
  return spawnSubprocessExecFile(cmd, args, {
    cwd: opts?.cwd,
    env,
    timeout: opts?.timeout,
    maxBuffer: opts?.maxBuffer,
  });
}

// M6.4 — hand the agent a free localhost port via $AGENTOS_PORT. Bind :0, read the
// kernel-assigned port, release it, hand it back. Best-effort: the run never blocks on this.
// ponytail: bind-release has a TOCTOU window; add a DB port-lease table if concurrent workers land.
export function allocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error("no port assigned"))));
    });
  });
}

// M6.4 — pure env merge so run()'s port injection is testable without spawning. A null port
// (allocation failed) leaves the env untouched; the run proceeds without the var.
export function withPortEnv(extraEnv: Record<string, string> | undefined, port: number | null): Record<string, string> {
  return port == null ? { ...extraEnv } : { ...extraEnv, AGENTOS_PORT: String(port) };
}

// M6.1 — decide whether a finished run has a native (adapter-owned) checkpoint to record.
// Record-only; restore paths are unchanged. Only the claude adapter exposes a resumable
// session id today (parsing distinct native checkpoint ids is deferred per plan R2).
export function nativeCheckpointEvent(
  agent: AgentName, externalRunId: string | null | undefined
): { adapter: "claude"; sessionId: string; resume: string } | null {
  if (agent !== "claude" || !externalRunId) return null;
  return { adapter: "claude", sessionId: externalRunId, resume: `claude --resume ${externalRunId}` };
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
    const summary = drift.map((file) => `${file.kind}:${file.path}`).join(", ");
    // M5.3 producer: a quarantined config change needs a human decision — record it as
    // a pending, normalized action_request (irreversible config edit) so the reviewer
    // can approve/deny it. The run still fails safe (trips) until that decision lands.
    recordActionRequest(runId, {
      tool: "config_firewall", command: `apply quarantined config change: ${summary}`,
      affectedPaths: drift.map((file) => file.path), networkDest: null,
      secretsRequested: [], reversible: false, policyRule: "config_firewall",
    });
    const reason = `config_firewall: ${summary}`;
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
  catch (error) { const reason = `sandbox: ${String(error)}`; policyDenied(runId, reason); tripRun(runId, reason); throw error; }
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
  if (refusal) { policyDenied(runId, refusal); tripRun(runId, refusal); throw new Error(refusal); }
  // M5.2 — pre-run checkpoint (additive, fail-safe). retry_step resets the workspace to this.
  try { createCheckpoint(runId, cwd, "pre"); } catch { /* checkpointing is additive; never blocks a run */ }
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

// M5.1 producer — capture the workspace's actual diff hunks as kind:"diff" artifacts so
// the review surface renders the change grouped by criterion, not just a file path. Runs
// after (and independently of) the git-free secret scan above — this is strictly additive.
// Args-array spawn, minimal env, no shell. Fail-safe: any git problem records nothing and
// logs a loud "diff_capture_unavailable" event; never throws into the run-finish path.
export const GIT_DIFF_MAX_BODY = 64 * 1024;
export const GIT_DIFF_MAX_FILES = 100;

function gitRun(args: string[], cwd: string) {
  return spawnSync("git", args, { cwd, env: agentEnv(), encoding: "utf8", timeout: 30_000, maxBuffer: 128 * 1024 * 1024 });
}

// Split a unified diff into per-file sections keyed by the post-image ("b/") path.
function parseDiffByFile(diff: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of diff.split(/^diff --git /m)) {
    if (!part.trim()) continue;
    const firstLine = part.split("\n", 1)[0];
    const match = firstLine.match(/ b\/(.+)$/);
    const p = (match ? match[1] : firstLine.split(" ")[0]?.replace(/^a\//, "")) ?? "";
    if (!p) continue;
    const section = "diff --git " + part;
    map.set(p, map.has(p) ? `${map.get(p)}\n${section}` : section);
  }
  return map;
}

// Enumerate changed files from `git status --porcelain`, resolving renames to the new
// path and flagging untracked entries (which have no tracked-diff hunk).
function parseChangedFiles(porcelain: string): Array<{ path: string; untracked: boolean }> {
  const out: Array<{ path: string; untracked: boolean }> = [];
  for (const line of porcelain.split("\n")) {
    if (line.length < 4) continue;
    const xy = line.slice(0, 2);
    let rest = line.slice(3);
    const arrow = rest.indexOf(" -> ");
    if (arrow >= 0) rest = rest.slice(arrow + 4);
    rest = rest.replace(/^"(.*)"$/, "$1");
    out.push({ path: rest, untracked: xy === "??" });
  }
  return out;
}

function truncateDiffBody(body: string): string {
  return body.length > GIT_DIFF_MAX_BODY ? body.slice(0, GIT_DIFF_MAX_BODY) + "\n...truncated" : body;
}

export function captureGitDiff(runId: string, cwd: string, redactions: string[]): void {
  try {
    const probe = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, env: agentEnv(), encoding: "utf8", timeout: 5_000 });
    if (probe.error || probe.status !== 0 || (probe.stdout || "").trim() !== "true") {
      appendRunEvent(runId, "diff_capture_unavailable", { reason: probe.error ? "git unavailable" : "not a git repo" });
      return;
    }
    const status = gitRun(["status", "--porcelain"], cwd);
    if (status.error || status.status !== 0) {
      appendRunEvent(runId, "diff_capture_unavailable", { reason: "git status failed" });
      return;
    }
    const files = parseChangedFiles(status.stdout || "");
    if (!files.length) { appendRunEvent(runId, "diff_captured", { files: 0 }); return; }

    const unstaged = gitRun(["diff", "--no-color"], cwd);
    const staged = gitRun(["diff", "--cached", "--no-color"], cwd);
    if ((unstaged.error || unstaged.status !== 0) && (staged.error || staged.status !== 0)) {
      appendRunEvent(runId, "diff_capture_unavailable", { reason: "git diff failed" });
      return;
    }
    const byFile = parseDiffByFile((unstaged.stdout || "") + "\n" + (staged.stdout || ""));

    const total = files.length;
    const capped = total > GIT_DIFF_MAX_FILES;
    // Loud cap: never silently drop files beyond the limit.
    if (capped) appendRunEvent(runId, "diff_capture_capped", { total, captured: GIT_DIFF_MAX_FILES });
    for (const file of capped ? files.slice(0, GIT_DIFF_MAX_FILES) : files) {
      let raw = byFile.get(file.path);
      if (raw === undefined && file.untracked) {
        try { raw = readFileSync(path.join(cwd, file.path), "utf8"); } catch { raw = undefined; }
      }
      const body = raw === undefined ? undefined : truncateDiffBody(redactText(raw, redactions));
      const artifactId = recordArtifact(runId, "diff", file.path, body);
      // M5.1: auto-link the hunk to every criterion covering its path (same rule as
      // the M4.5 scope detector). No covering criterion → leave unlinked; that IS the
      // scope-expansion signal. Linking failures degrade loudly, never crash finishRun.
      try {
        for (const criterionId of criteriaCoveringPath(runId, file.path)) {
          linkEvidence({ criterionId, artifactId, linkType: "implements", result: "unavailable" });
        }
      } catch (error) {
        appendRunEvent(runId, "diff_link_failed", { ref: file.path, reason: String(error).slice(0, 200) });
      }
    }
    appendRunEvent(runId, "diff_captured", { files: Math.min(total, GIT_DIFF_MAX_FILES), capped });
  } catch (error) {
    appendRunEvent(runId, "diff_capture_unavailable", { reason: String(error).slice(0, 200) });
  }
}

function finishRun(runId: string, agent: AgentName, code: number | null, stdout: string, stderr: string, secrets: string[], cwd: string, startedMs: number) {
  const usage = parseJsonlUsage(stdout);
  if (usage.inputTokens || usage.outputTokens || usage.cacheTokens || usage.costUsd) appendRunEvent(runId, "usage", usage);
  if (usage.externalRunId) updateRunMetadata(runId, { externalSource: agent, externalRunId: usage.externalRunId });
  // M6.1 — record the adapter's native checkpoint (record-only; restore paths unchanged).
  const native = nativeCheckpointEvent(agent, usage.externalRunId);
  if (native) appendRunEvent(runId, "native_checkpoint", native);
  // Post-run: scan files the run wrote for canary + secret-value variants (M3.8/M3.12).
  const leaked = scanWorkspaceForSecrets(cwd, startedMs, secrets);
  if (leaked.length) { appendRunEvent(runId, "security_alert", { kind: "secret_in_artifact", files: leaked }); tripRun(runId, "secret_in_artifact"); }
  // M5.1: capture redacted diff hunks as artifacts (additive to the scan above).
  captureGitDiff(runId, cwd, secrets);
  // M5.2 — post-run checkpoint (additive, fail-safe). fork/restore materialize this.
  try { createCheckpoint(runId, cwd, "post"); } catch { /* checkpointing is additive; never blocks a run */ }
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
  // M6.4 — allocate a free localhost port and inject it as $AGENTOS_PORT via the extraEnv
  // seam (extraEnv → telemetryEnv → agentEnv). Fail-safe: allocation failure proceeds
  // without the var and is recorded loudly once the runId exists; it never blocks the run.
  let port: number | null = null;
  let portError: unknown = null;
  try { port = await allocatePort(); } catch (e) { portError = e; }
  const preparedOpts = { ...opts, extraEnv: withPortEnv(opts.extraEnv, port) };

  let prepared: ReturnType<typeof prepareRun>;
  try { prepared = prepareRun(agent, args, preparedOpts); }
  catch (e) {
    return { ok: false, code: -1, stdout: "", stderr: String(e), durationMs: 0 };
  }
  if (port != null) appendRunEvent(prepared.runId, "port_allocated", { port });
  else appendRunEvent(prepared.runId, "port_allocation_failed", { error: String(portError).slice(0, 200) });

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

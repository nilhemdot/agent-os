import { createServer } from "node:http";
import { existsSync } from "node:fs";
import os from "node:os";
import { appendRunEvent, claimNextRun, createRun, getRun, heartbeat, reconcileLost, tripRun } from "./lib/ledger";
import { parseClaudeOtelJson, parseClaudeOtelProtobuf, parseHermesRow } from "./lib/runAdapters";
import { run, runSecretValues, type AgentName } from "./lib/runner";
import { listSessions } from "./lib/codexWorkspace";
import { listBoards, listTasks, showTask } from "./lib/kanbanDb";
import { canaryForRun, containsSecret } from "./lib/credentialBroker";

const workerId = `${os.hostname()}:${process.pid}`;
let busy = false;

const receiver = createServer((req, res) => {
  const signal = req.url?.split("/").pop() || "unknown";
  const runId = req.headers["x-agentos-run-id"];
  const chunks: Buffer[] = [];
  req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  req.on("end", () => {
    if (typeof runId === "string") {
      const body = Buffer.concat(chunks);
      const contentType = String(req.headers["content-type"] || "");
      // Detect the canary AND any of the run's secret values (in-memory, same process
      // as prepareRun) in the telemetry body before it is parsed/recorded (M3.7).
      const secrets = runSecretValues.get(runId) || [canaryForRun(runId)];
      if (containsSecret(body.toString("utf8"), secrets)) {
        const canary = canaryForRun(runId);
        const kind = containsSecret(body.toString("utf8"), [canary]) ? "canary_exposed" : "secret_exposed";
        appendRunEvent(runId, "security_alert", { kind, channel: "otel" });
        tripRun(runId, kind);
      }
      appendRunEvent(runId, "otel.batch", { signal, contentType, bytes: body.length });
      try {
        const usage = contentType.includes("json") ? parseClaudeOtelJson(JSON.parse(body.toString("utf8"))) : parseClaudeOtelProtobuf(body);
        const current = getRun(runId);
        const delta = current && {
          inputTokens: Math.max(0, usage.inputTokens - current.input_tokens), outputTokens: Math.max(0, usage.outputTokens - current.output_tokens),
          cacheTokens: Math.max(0, usage.cacheTokens - current.cache_tokens), costUsd: Math.max(0, usage.costUsd - current.cost_usd),
        };
        if (delta && (delta.inputTokens || delta.outputTokens || delta.cacheTokens || delta.costUsd)) appendRunEvent(runId, "usage", delta);
      } catch { /* raw batch remains recorded */ }
    }
    res.writeHead(200, { "content-type": "application/x-protobuf" }); res.end();
  });
});
receiver.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.warn("OTLP receiver port 4318 already owned by another worker — continuing without receiver");
    return;
  }
  throw error;
});
receiver.listen(4318, "127.0.0.1");

async function tick() {
  if (busy) return;
  const row = claimNextRun(workerId); if (!row) return;
  busy = true;
  const pulse = setInterval(() => heartbeat(row.id, workerId), 5_000);
  try {
    await run(row.agent as AgentName, JSON.parse(row.args_json), { cwd: row.workspace, runId: row.id });
  } catch (error) {
    appendRunEvent(row.id, "failed", { error: String(error) });
  } finally {
    clearInterval(pulse); busy = false;
  }
}

async function importHistory() {
  for (const session of await listSessions(100)) {
    const imported = createRun({ agent: "codex", objective: session.threadName, workspace: process.cwd(),
      externalSource: "codex", externalRunId: session.id, cliVersion: "codex:imported" });
    if (getRun(imported.id)?.status === "queued") appendRunEvent(imported.id, "completed", { imported: true });
  }
  for (const board of listBoards()) {
    if (!existsSync(board.dbPath)) continue;
    for (const task of listTasks(board.slug).slice(0, 200)) {
      for (const source of showTask(task.id, board.slug)?.runs || []) {
        const imported = createRun({ agent: "hermes", objective: task.title, workspace: task.workspace_path || process.cwd(),
          externalSource: "hermes", externalRunId: `${board.slug}:${source.id}`, cliVersion: "hermes:sqlite" });
        if (getRun(imported.id)?.status !== "queued") continue;
        const usage = parseHermesRow(source.metadata || {});
        if (usage.inputTokens || usage.outputTokens || usage.cacheTokens || usage.costUsd) appendRunEvent(imported.id, "usage", usage);
        appendRunEvent(imported.id, source.status === "completed" ? "completed" : "failed", { imported: true, outcome: source.outcome, error: source.error });
      }
    }
  }
}

async function main() {
  await importHistory();
  reconcileLost();
  setInterval(() => reconcileLost(), 15_000);
  setInterval(() => void tick(), 500);
  void tick();
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });

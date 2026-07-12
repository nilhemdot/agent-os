import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type RunStatus = "queued" | "running" | "completed" | "failed" | "worker_lost";
export interface RunRow {
  id: string; status: RunStatus; agent: string; objective: string; workspace: string;
  args_json: string; cli_version: string | null; external_source: string | null;
  external_run_id: string | null; input_tokens: number; output_tokens: number;
  cache_tokens: number; cost_usd: number; created_at: string; updated_at: string;
  started_at: string | null; finished_at: string | null; worker_id: string | null;
  heartbeat_at: string | null;
  policy_json: string; tripped_reason: string | null; sandbox: string | null;
}
export interface RunEvent { id: string; run_id: string; seq: number; type: string; payload: unknown; created_at: string }

const migrations = [
  `CREATE TABLE runs (
    id TEXT PRIMARY KEY, status TEXT NOT NULL, agent TEXT NOT NULL, objective TEXT NOT NULL,
    workspace TEXT NOT NULL, args_json TEXT NOT NULL, cli_version TEXT,
    external_source TEXT, external_run_id TEXT, input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0, cache_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    started_at TEXT, finished_at TEXT, worker_id TEXT, heartbeat_at TEXT
  );
  CREATE UNIQUE INDEX runs_external_id ON runs(external_source, external_run_id)
    WHERE external_source IS NOT NULL AND external_run_id IS NOT NULL;
  CREATE TABLE run_events (
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL, type TEXT NOT NULL, payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL, UNIQUE(run_id, seq)
  );
  CREATE INDEX run_events_run_seq ON run_events(run_id, seq);
  CREATE VIRTUAL TABLE run_events_fts USING fts5(run_id UNINDEXED, type, payload);
  CREATE TRIGGER run_events_fts_insert AFTER INSERT ON run_events BEGIN
    INSERT INTO run_events_fts(rowid, run_id, type, payload)
    VALUES (new.rowid, new.run_id, new.type, new.payload_json);
  END;`,
  `ALTER TABLE runs ADD COLUMN policy_json TEXT NOT NULL DEFAULT '{}';
   ALTER TABLE runs ADD COLUMN tripped_reason TEXT;
   CREATE TABLE budget_limits (
     id TEXT PRIMARY KEY, scope TEXT NOT NULL, scope_id TEXT NOT NULL, max_usd REAL NOT NULL,
     window_seconds INTEGER NOT NULL, hard_stop INTEGER NOT NULL DEFAULT 1, warn_pct REAL NOT NULL DEFAULT 0.8,
     UNIQUE(scope, scope_id)
   );`,
  `ALTER TABLE runs ADD COLUMN sandbox TEXT;
   CREATE TABLE workspace_config_baselines (
     workspace TEXT NOT NULL, path TEXT NOT NULL, sha256 TEXT NOT NULL, content TEXT NOT NULL,
     approved_at TEXT NOT NULL, approved_by TEXT NOT NULL, PRIMARY KEY(workspace,path)
   );
   CREATE TABLE secret_refs (id TEXT PRIMARY KEY, backend TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE secret_usage (
     id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), secret_id TEXT NOT NULL,
     env_name TEXT NOT NULL, created_at TEXT NOT NULL
   );`,
  // M4 "the contract" — §4.3 data model. A run without criteria is not a run.
  `CREATE TABLE criteria (
     id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
     ordinal INTEGER NOT NULL, kind TEXT NOT NULL, ears_text TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'unmet'
   );
   CREATE INDEX criteria_run ON criteria(run_id, ordinal);
   CREATE TABLE artifacts (
     id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
     kind TEXT NOT NULL, ref TEXT NOT NULL, created_at TEXT NOT NULL
   );
   CREATE TABLE decisions (
     id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
     seq INTEGER NOT NULL, question TEXT NOT NULL, chosen TEXT NOT NULL,
     rejected_json TEXT NOT NULL, criterion_id TEXT REFERENCES criteria(id),
     evidence_event_id TEXT REFERENCES run_events(id), UNIQUE(run_id, seq)
   );
   CREATE TABLE evidence_links (
     id TEXT PRIMARY KEY, criterion_id TEXT NOT NULL REFERENCES criteria(id) ON DELETE CASCADE,
     artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
     link_type TEXT NOT NULL, verifier TEXT, verifier_version TEXT, result TEXT NOT NULL
   );`,
];

let singleton: DatabaseSync | undefined;
export function ledgerDb(): DatabaseSync {
  if (singleton) return singleton;
  const file = process.env.AGENTOS_DB_PATH || path.join(os.homedir(), ".agentic-os", "agentos.db");
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);");
  migrations.forEach((sql, i) => {
    const version = i + 1;
    db.exec("BEGIN IMMEDIATE");
    try {
      if (!db.prepare("SELECT 1 FROM schema_migrations WHERE version=?").get(version)) {
        db.exec(sql); db.prepare("INSERT INTO schema_migrations(version) VALUES (?)").run(version);
      }
      db.exec("COMMIT");
    }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  });
  singleton = db;
  return db;
}

export function createRun(input: {
  agent: string; objective?: string; workspace: string; args?: readonly string[];
  cliVersion?: string; externalSource?: string; externalRunId?: string; id?: string; policy?: unknown;
}): RunRow {
  const db = ledgerDb();
  if (input.externalSource && input.externalRunId) {
    const existing = db.prepare("SELECT * FROM runs WHERE external_source=? AND external_run_id=?").get(input.externalSource, input.externalRunId) as unknown as RunRow | undefined;
    if (existing) return existing;
  }
  const id = input.id || randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO runs(id,status,agent,objective,workspace,args_json,cli_version,external_source,external_run_id,created_at,updated_at,policy_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, "queued", input.agent, input.objective || input.args?.join(" ") || input.agent,
      input.workspace, JSON.stringify(input.args || []), input.cliVersion || null, input.externalSource || null, input.externalRunId || null, now, now, JSON.stringify(input.policy || {}));
  appendRunEvent(id, "queued", { agent: input.agent });
  return getRun(id)!;
}

export function appendRunEvent(runId: string, type: string, payload: unknown = {}): RunEvent {
  const db = ledgerDb();
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const seq = Number((db.prepare("SELECT COALESCE(MAX(seq),0)+1 AS seq FROM run_events WHERE run_id=?").get(runId) as { seq: number }).seq);
    const id = randomUUID();
    db.prepare("INSERT INTO run_events(id,run_id,seq,type,payload_json,created_at) VALUES (?,?,?,?,?,?)")
      .run(id, runId, seq, type, JSON.stringify(payload), now);
    const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
    const status = type === "started" ? "running" : type === "completed" ? "completed" : type === "failed" || type === "breaker_tripped" ? "failed" : type === "worker_lost" ? "worker_lost" : null;
    db.prepare(`UPDATE runs SET
      status=CASE WHEN status IN ('completed','failed','worker_lost') THEN status ELSE COALESCE(?,status) END,
      updated_at=?,
      started_at=CASE WHEN status IN ('completed','failed','worker_lost') THEN started_at WHEN ?='running' THEN COALESCE(started_at,?) ELSE started_at END,
      finished_at=CASE WHEN status IN ('completed','failed','worker_lost') THEN finished_at WHEN ? IN ('completed','failed','worker_lost') THEN ? ELSE finished_at END,
      input_tokens=input_tokens+?, output_tokens=output_tokens+?, cache_tokens=cache_tokens+?, cost_usd=cost_usd+?,
      tripped_reason=CASE WHEN ?='breaker_tripped' THEN ? ELSE tripped_reason END
      WHERE id=?`).run(status, now, status, now, status, now, Number(p.inputTokens || 0), Number(p.outputTokens || 0), Number(p.cacheTokens || 0), Number(p.costUsd || 0), type, String(p.trippedReason || ""), runId);
    db.exec("COMMIT");
    return { id, run_id: runId, seq, type, payload, created_at: now };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function getRun(id: string): RunRow | null {
  return (ledgerDb().prepare("SELECT * FROM runs WHERE id=?").get(id) as unknown as RunRow | undefined) || null;
}

export function updateRunMetadata(id: string, values: { cliVersion?: string; externalSource?: string; externalRunId?: string }): void {
  ledgerDb().prepare(`UPDATE runs SET cli_version=COALESCE(?,cli_version), external_source=COALESCE(?,external_source),
    external_run_id=COALESCE(?,external_run_id), updated_at=? WHERE id=?`)
    .run(values.cliVersion || null, values.externalSource || null, values.externalRunId || null, new Date().toISOString(), id);
}

export function setRunSandbox(id: string, sandbox: string): void {
  ledgerDb().prepare("UPDATE runs SET sandbox=?,updated_at=? WHERE id=?").run(sandbox, new Date().toISOString(), id);
}

export function recordSecretUsage(runId: string, secretId: string, envName: string): void {
  ledgerDb().prepare("INSERT INTO secret_usage(id,run_id,secret_id,env_name,created_at) VALUES (?,?,?,?,?)")
    .run(randomUUID(), runId, secretId, envName, new Date().toISOString());
  appendRunEvent(runId, "secret_used", { secretId, envName });
}

export function runPolicy(id: string): Record<string, unknown> {
  try { return JSON.parse(getRun(id)?.policy_json || "{}"); } catch { return {}; }
}

export function tripRun(id: string, reason: string): void {
  if (!getRun(id)?.tripped_reason) appendRunEvent(id, "breaker_tripped", { trippedReason: reason });
}

export function setBudgetLimit(input: { scope: "global" | "agent" | "workspace"; scopeId: string; maxUsd: number; windowSeconds?: number }): void {
  ledgerDb().prepare(`INSERT INTO budget_limits(id,scope,scope_id,max_usd,window_seconds) VALUES (?,?,?,?,?)
    ON CONFLICT(scope,scope_id) DO UPDATE SET max_usd=excluded.max_usd,window_seconds=excluded.window_seconds`)
    .run(randomUUID(), input.scope, input.scopeId, input.maxUsd, input.windowSeconds || 3600);
}

export function listBudgetLimits(): Array<Record<string, unknown>> {
  return ledgerDb().prepare("SELECT scope,scope_id,max_usd,window_seconds,hard_stop,warn_pct FROM budget_limits ORDER BY scope,scope_id").all() as Array<Record<string, unknown>>;
}

export function budgetPrecheck(runId: string, estimatedUsd: number): string | null {
  const db = ledgerDb(), run = getRun(runId); if (!run) return "budget: run missing";
  const policy = runPolicy(runId), runCap = Number(policy.maxCostUsd || 0);
  if (runCap > 0 && run.cost_usd + estimatedUsd > runCap) return `budget: run $${runCap} hard cap`;
  const limits = db.prepare("SELECT * FROM budget_limits WHERE (scope='global' AND scope_id='*') OR (scope='agent' AND scope_id=?) OR (scope='workspace' AND scope_id=?)").all(run.agent, run.workspace) as Array<Record<string, unknown>>;
  for (const limit of limits) {
    const cutoff = new Date(Date.now() - Number(limit.window_seconds) * 1000).toISOString();
    const clause = limit.scope === "agent" ? " AND r.agent=?" : limit.scope === "workspace" ? " AND r.workspace=?" : "";
    const args = limit.scope === "agent" ? [cutoff, run.agent] : limit.scope === "workspace" ? [cutoff, run.workspace] : [cutoff];
    const spent = Number((db.prepare(`SELECT COALESCE(SUM(CAST(json_extract(e.payload_json,'$.costUsd') AS REAL)),0) AS spent
      FROM run_events e JOIN runs r ON r.id=e.run_id WHERE e.type='usage' AND e.created_at>=?${clause}`).get(...args) as { spent: number }).spent);
    if (Number(limit.hard_stop) && spent + estimatedUsd > Number(limit.max_usd)) return `budget: ${limit.scope} $${limit.max_usd} hard cap`;
  }
  return null;
}

export function listRunEvents(runId: string, after = 0): RunEvent[] {
  return ledgerDb().prepare("SELECT * FROM run_events WHERE run_id=? AND seq>? ORDER BY seq").all(runId, after).map((row) => {
    const r = row as Record<string, unknown>;
    return { id: String(r.id), run_id: String(r.run_id), seq: Number(r.seq), type: String(r.type), payload: JSON.parse(String(r.payload_json)), created_at: String(r.created_at) };
  });
}

export function claimNextRun(workerId: string): RunRow | null {
  const db = ledgerDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT id FROM runs WHERE status='queued' ORDER BY created_at LIMIT 1").get() as { id?: string } | undefined;
    if (!row?.id) { db.exec("COMMIT"); return null; }
    const now = new Date().toISOString();
    db.prepare("UPDATE runs SET status='running',worker_id=?,heartbeat_at=?,updated_at=?,started_at=COALESCE(started_at,?) WHERE id=? AND status='queued'").run(workerId, now, now, now, row.id);
    db.exec("COMMIT");
    appendRunEvent(row.id, "started", { workerId });
    return getRun(row.id);
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function heartbeat(runId: string, workerId: string): void {
  const now = new Date().toISOString();
  ledgerDb().prepare("UPDATE runs SET heartbeat_at=?,updated_at=? WHERE id=? AND worker_id=? AND status='running'").run(now, now, runId, workerId);
}

export function reconcileLost(maxAgeMs = 30_000): number {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const ids = ledgerDb().prepare("SELECT id FROM runs WHERE status='running' AND (heartbeat_at IS NULL OR heartbeat_at<?)").all(cutoff) as Array<{ id: string }>;
  ids.forEach(({ id }) => appendRunEvent(id, "worker_lost", {}));
  return ids.length;
}

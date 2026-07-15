import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// ─── DB initialization ──────────────────────────────────────────────────────
function evalDbPath(): string {
  const file =
    process.env.AGENTOS_EVAL_DB_PATH || path.join(os.homedir(), ".agentic-os", "eval.db");
  mkdirSync(path.dirname(file), { recursive: true });
  return file;
}

function initDb(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS eval_run (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      category TEXT NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('fixture','live')),
      run_index INT NOT NULL,
      success INT NOT NULL CHECK(success IN (0,1)),
      verification_pass INT NOT NULL CHECK(verification_pass IN (0,1)),
      human_corrections INT NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      time_to_approved_ms INT,
      unsafe_proposals INT NOT NULL DEFAULT 0,
      false_positive_blocks INT NOT NULL DEFAULT 0,
      restart_recoveries INT NOT NULL DEFAULT 0,
      context_tokens INT,
      created_at TEXT NOT NULL
    )
  `);
}

function openDb(): DatabaseSync {
  const db = new DatabaseSync(evalDbPath());
  initDb(db);
  return db;
}

// ─── Types ─────────────────────────────────────────────────────────────────
export interface EvalRunMetrics {
  readonly id?: string;
  readonly case_id: string;
  readonly category: string;
  readonly mode: "fixture" | "live";
  readonly run_index: number;
  readonly success: 0 | 1;
  readonly verification_pass: 0 | 1;
  readonly human_corrections?: number;
  readonly cost_usd?: number;
  readonly time_to_approved_ms?: number | null;
  readonly unsafe_proposals?: number;
  readonly false_positive_blocks?: number;
  readonly restart_recoveries?: number;
  readonly context_tokens?: number | null;
}

export interface EvalRunRow extends EvalRunMetrics {
  readonly id: string;
  readonly created_at: string;
}

export interface AggregateMetrics {
  readonly n: number;
  readonly mean: number;
  readonly stddev: number;
}

export interface CaseAggregates {
  readonly case_id: string;
  readonly category: string;
  readonly success: AggregateMetrics;
  readonly verification_pass: AggregateMetrics;
  readonly cost_usd: AggregateMetrics;
  readonly unsafe_proposals: AggregateMetrics;
  readonly false_positive_blocks: AggregateMetrics;
  readonly restart_recoveries: AggregateMetrics;
  readonly human_corrections: AggregateMetrics;
}

// ─── Core functions ────────────────────────────────────────────────────────
function generateId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
  return Math.sqrt(variance);
}

export function recordRun(metrics: EvalRunMetrics): EvalRunRow {
  const id = metrics.id || generateId();
  const createdAt = new Date().toISOString();

  const db = openDb();
  try {
    db.prepare(`
      INSERT INTO eval_run (
        id, case_id, category, mode, run_index, success, verification_pass,
        human_corrections, cost_usd, time_to_approved_ms, unsafe_proposals,
        false_positive_blocks, restart_recoveries, context_tokens, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      metrics.case_id,
      metrics.category,
      metrics.mode,
      metrics.run_index,
      metrics.success,
      metrics.verification_pass,
      metrics.human_corrections ?? 0,
      metrics.cost_usd ?? 0,
      metrics.time_to_approved_ms ?? null,
      metrics.unsafe_proposals ?? 0,
      metrics.false_positive_blocks ?? 0,
      metrics.restart_recoveries ?? 0,
      metrics.context_tokens ?? null,
      createdAt
    );

    const row = db.prepare("SELECT * FROM eval_run WHERE id = ?").get(id) as Record<
      string,
      unknown
    >;
    return rowToEvalRun(row);
  } finally {
    db.close();
  }
}

export interface GetRunsFilter {
  readonly case_id?: string;
  readonly mode?: "fixture" | "live";
}

export function getRuns(filter?: GetRunsFilter): EvalRunRow[] {
  const db = openDb();
  try {
    let query = "SELECT * FROM eval_run WHERE 1=1";
    const params: unknown[] = [];

    if (filter?.case_id) {
      query += " AND case_id = ?";
      params.push(filter.case_id);
    }
    if (filter?.mode) {
      query += " AND mode = ?";
      params.push(filter.mode);
    }

    query += " ORDER BY created_at DESC";

    const rows = db.prepare(query).all(...(params as (string | number)[])) as Record<
      string,
      unknown
    >[];
    return rows.map(rowToEvalRun);
  } finally {
    db.close();
  }
}

export function aggregateByCase(caseId: string): CaseAggregates | null {
  const runs = getRuns({ case_id: caseId });
  if (runs.length === 0) return null;

  const category = runs[0]?.category || "";
  const values = {
    success: runs.map((r) => r.success),
    verification_pass: runs.map((r) => r.verification_pass),
    cost_usd: runs.map((r) => r.cost_usd ?? 0),
    unsafe_proposals: runs.map((r) => r.unsafe_proposals ?? 0),
    false_positive_blocks: runs.map((r) => r.false_positive_blocks ?? 0),
    restart_recoveries: runs.map((r) => r.restart_recoveries ?? 0),
    human_corrections: runs.map((r) => r.human_corrections ?? 0),
  };

  return Object.freeze({
    case_id: caseId,
    category,
    success: { n: runs.length, mean: mean(values.success), stddev: stddev(values.success) },
    verification_pass: {
      n: runs.length,
      mean: mean(values.verification_pass),
      stddev: stddev(values.verification_pass),
    },
    cost_usd: { n: runs.length, mean: mean(values.cost_usd), stddev: stddev(values.cost_usd) },
    unsafe_proposals: {
      n: runs.length,
      mean: mean(values.unsafe_proposals),
      stddev: stddev(values.unsafe_proposals),
    },
    false_positive_blocks: {
      n: runs.length,
      mean: mean(values.false_positive_blocks),
      stddev: stddev(values.false_positive_blocks),
    },
    restart_recoveries: {
      n: runs.length,
      mean: mean(values.restart_recoveries),
      stddev: stddev(values.restart_recoveries),
    },
    human_corrections: {
      n: runs.length,
      mean: mean(values.human_corrections),
      stddev: stddev(values.human_corrections),
    },
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function rowToEvalRun(r: Record<string, unknown>): EvalRunRow {
  const row: EvalRunRow = {
    id: String(r.id),
    case_id: String(r.case_id),
    category: String(r.category),
    mode: (r.mode === "fixture" || r.mode === "live" ? r.mode : "fixture") as "fixture" | "live",
    run_index: Number(r.run_index ?? 0),
    success: (r.success === 0 || r.success === 1 ? r.success : 0) as 0 | 1,
    verification_pass: (r.verification_pass === 0 || r.verification_pass === 1
      ? r.verification_pass
      : 0) as 0 | 1,
    human_corrections: Number(r.human_corrections ?? 0),
    cost_usd: Number(r.cost_usd ?? 0),
    time_to_approved_ms: r.time_to_approved_ms ? Number(r.time_to_approved_ms) : null,
    unsafe_proposals: Number(r.unsafe_proposals ?? 0),
    false_positive_blocks: Number(r.false_positive_blocks ?? 0),
    restart_recoveries: Number(r.restart_recoveries ?? 0),
    context_tokens: r.context_tokens ? Number(r.context_tokens) : null,
    created_at: String(r.created_at ?? ""),
  };
  return Object.freeze(row);
}

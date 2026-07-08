// Direct read-only access to the Hermes kanban SQLite database.
// Shelling out to `hermes kanban list --json` costs ~2 seconds per call (Python cold start),
// and the board page used to do 4 of those calls in parallel — total ~8s render time.
// Reading the same data straight from SQLite is sub-50ms.
//
// Writes still go through `hermes kanban …` so we don't bypass event emission, the dispatcher
// notification path, or the gateway's runtime locks.

import { DatabaseSync } from "node:sqlite";
import { hermesHome } from "@/lib/config";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const HERMES_HOME = path.join(hermesHome());

export interface BoardEntry { slug: string; name: string; current: boolean; dbPath: string; }
export interface TaskRow {
  id: string; title: string; body: string | null; assignee: string | null;
  status: string; priority: number; tenant: string | null;
  workspace_kind: string; workspace_path: string | null;
  created_by: string | null; created_at: number;
  started_at: number | null; completed_at: number | null;
  result: string | null; skills: string[];
}
export interface CommentRow { id: number; body: string; author: string | null; created_at: number; }
export interface EventRow { id: number; kind: string; payload: Record<string, unknown> | null; created_at: number; run_id: number | null; }
export interface RunRow {
  id: number; profile: string | null; status: string;
  started_at: number; ended_at: number | null;
  outcome: string | null; summary: string | null;
  metadata: Record<string, unknown> | null; error: string | null;
}

// ─── DB path resolution ─────────────────────────────────────────────────────
export function listBoards(): BoardEntry[] {
  const out: BoardEntry[] = [];
  const defaultDb = path.join(HERMES_HOME, "kanban.db");
  out.push({ slug: "default", name: "Default", current: false, dbPath: defaultDb });

  const boardsRoot = path.join(HERMES_HOME, "kanban", "boards");
  if (existsSync(boardsRoot)) {
    try {
      for (const entry of readdirSync(boardsRoot)) {
        if (entry.startsWith("_")) continue; // skip _archived
        const full = path.join(boardsRoot, entry);
        try {
          if (!statSync(full).isDirectory()) continue;
        } catch { continue; }
        const dbPath = path.join(full, "kanban.db");
        if (!existsSync(dbPath)) continue;
        // Display name lives in board.json if present
        let name = entry;
        try {
          const metaPath = path.join(full, "board.json");
          if (existsSync(metaPath)) {
            const m = JSON.parse(readFileSync(metaPath, "utf8"));
            if (typeof m.name === "string") name = m.name;
          }
        } catch {}
        out.push({ slug: entry, name, current: false, dbPath });
      }
    } catch {}
  }

  // Current pointer
  const currentFile = path.join(HERMES_HOME, "kanban", "current");
  let currentSlug = "default";
  if (existsSync(currentFile)) {
    try { currentSlug = readFileSync(currentFile, "utf8").trim() || "default"; }
    catch {}
  }
  for (const b of out) b.current = b.slug === currentSlug;
  return out;
}

function dbPathForBoard(slug: string | undefined): string {
  if (!slug || slug === "default") return path.join(HERMES_HOME, "kanban.db");
  if (!/^[a-z0-9_-]{1,64}$/.test(slug)) throw new Error("invalid board slug");
  return path.join(HERMES_HOME, "kanban", "boards", slug, "kanban.db");
}

function openDb(slug?: string): DatabaseSync {
  const p = dbPathForBoard(slug);
  if (!existsSync(p)) throw new Error(`board db not found: ${p}`);
  // readonly + open immediately; closed by the caller via try/finally
  return new DatabaseSync(p, { readOnly: true });
}

// ─── Queries ────────────────────────────────────────────────────────────────
function parseJsonField<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

function rowToTask(r: Record<string, unknown>): TaskRow {
  return {
    id: String(r.id),
    title: String(r.title ?? ""),
    body: (r.body as string | null) ?? null,
    assignee: (r.assignee as string | null) ?? null,
    status: String(r.status ?? "todo"),
    priority: Number(r.priority ?? 0),
    tenant: (r.tenant as string | null) ?? null,
    workspace_kind: String(r.workspace_kind ?? "scratch"),
    workspace_path: (r.workspace_path as string | null) ?? null,
    created_by: (r.created_by as string | null) ?? null,
    created_at: Number(r.created_at ?? 0),
    started_at: r.started_at == null ? null : Number(r.started_at),
    completed_at: r.completed_at == null ? null : Number(r.completed_at),
    result: (r.result as string | null) ?? null,
    skills: parseJsonField<string[]>(r.skills as string | null, []),
  };
}

export function listTasks(slug?: string, includeArchived = true): TaskRow[] {
  const db = openDb(slug);
  try {
    const sql = includeArchived
      ? "SELECT * FROM tasks ORDER BY created_at DESC"
      : "SELECT * FROM tasks WHERE status != 'archived' ORDER BY created_at DESC";
    const rows = db.prepare(sql).all() as Record<string, unknown>[];
    return rows.map(rowToTask);
  } finally { db.close(); }
}

export function statsFor(slug?: string): { by_status: Record<string, number>; by_assignee: Record<string, Record<string, number>>; oldest_ready_age_seconds: number | null; now: number } {
  const db = openDb(slug);
  try {
    const byStatus: Record<string, number> = {};
    const byStatusRows = db.prepare("SELECT status, COUNT(*) as c FROM tasks GROUP BY status").all() as { status: string; c: number }[];
    for (const r of byStatusRows) byStatus[r.status] = r.c;

    const byAssignee: Record<string, Record<string, number>> = {};
    const byAsigneeRows = db.prepare("SELECT assignee, status, COUNT(*) as c FROM tasks WHERE assignee IS NOT NULL GROUP BY assignee, status").all() as { assignee: string; status: string; c: number }[];
    for (const r of byAsigneeRows) {
      const a = byAssignee[r.assignee] ?? (byAssignee[r.assignee] = {});
      a[r.status] = r.c;
    }

    const oldest = db.prepare("SELECT MIN(created_at) as t FROM tasks WHERE status = 'ready'").get() as { t: number | null } | undefined;
    const now = Math.floor(Date.now() / 1000);
    return {
      by_status: byStatus,
      by_assignee: byAssignee,
      oldest_ready_age_seconds: oldest?.t ? now - oldest.t : null,
      now,
    };
  } finally { db.close(); }
}

export function assigneesFor(slug?: string): { name: string; on_disk: boolean; counts: Record<string, number> }[] {
  const db = openDb(slug);
  try {
    // Counts by assignee from this board
    const rows = db.prepare("SELECT assignee, status, COUNT(*) as c FROM tasks WHERE assignee IS NOT NULL GROUP BY assignee, status").all() as { assignee: string; status: string; c: number }[];
    const counts: Record<string, Record<string, number>> = {};
    for (const r of rows) {
      const a = counts[r.assignee] ?? (counts[r.assignee] = {});
      a[r.status] = r.c;
    }
    // Union with profiles on disk
    const profiles = new Set(Object.keys(counts));
    const profileRoot = path.join(HERMES_HOME, "profiles");
    if (existsSync(profileRoot)) {
      try {
        for (const p of readdirSync(profileRoot)) {
          try {
            if (statSync(path.join(profileRoot, p)).isDirectory()) profiles.add(p);
          } catch {}
        }
      } catch {}
    }
    return Array.from(profiles).sort().map((name) => ({
      name,
      on_disk: existsSync(path.join(profileRoot, name)),
      counts: counts[name] ?? {},
    }));
  } finally { db.close(); }
}

export function showTask(taskId: string, slug?: string): {
  task: TaskRow;
  latest_summary: string | null;
  parents: TaskRow[];
  children: TaskRow[];
  comments: CommentRow[];
  events: EventRow[];
  runs: RunRow[];
} | null {
  if (!/^t_[a-z0-9_-]+$/i.test(taskId)) return null;
  const db = openDb(slug);
  try {
    const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Record<string, unknown> | undefined;
    if (!row) return null;
    const task = rowToTask(row);

    const parentRows = db.prepare(
      "SELECT t.* FROM task_links l JOIN tasks t ON t.id = l.parent_id WHERE l.child_id = ?"
    ).all(taskId) as Record<string, unknown>[];

    const childRows = db.prepare(
      "SELECT t.* FROM task_links l JOIN tasks t ON t.id = l.child_id WHERE l.parent_id = ?"
    ).all(taskId) as Record<string, unknown>[];

    const commentRows = db.prepare(
      "SELECT id, author, body, created_at FROM task_comments WHERE task_id = ? ORDER BY created_at ASC"
    ).all(taskId) as { id: number; author: string | null; body: string; created_at: number }[];

    const eventRows = db.prepare(
      "SELECT id, kind, payload, created_at, run_id FROM task_events WHERE task_id = ? ORDER BY id ASC"
    ).all(taskId) as { id: number; kind: string; payload: string | null; created_at: number; run_id: number | null }[];

    const runRows = db.prepare(
      "SELECT id, profile, status, started_at, ended_at, outcome, summary, metadata, error FROM task_runs WHERE task_id = ? ORDER BY started_at ASC"
    ).all(taskId) as { id: number; profile: string | null; status: string; started_at: number; ended_at: number | null; outcome: string | null; summary: string | null; metadata: string | null; error: string | null }[];

    // Latest non-null summary from completed runs
    let latest_summary: string | null = null;
    for (let i = runRows.length - 1; i >= 0; i--) {
      if (runRows[i].summary) { latest_summary = runRows[i].summary; break; }
    }

    return {
      task,
      latest_summary,
      parents: parentRows.map(rowToTask),
      children: childRows.map(rowToTask),
      comments: commentRows,
      events: eventRows.map((e) => ({
        id: e.id, kind: e.kind, run_id: e.run_id, created_at: e.created_at,
        payload: parseJsonField<Record<string, unknown> | null>(e.payload, null),
      })),
      runs: runRows.map((r) => ({
        id: r.id, profile: r.profile, status: r.status,
        started_at: r.started_at, ended_at: r.ended_at,
        outcome: r.outcome, summary: r.summary, error: r.error,
        metadata: parseJsonField<Record<string, unknown> | null>(r.metadata, null),
      })),
    };
  } finally { db.close(); }
}

// Shared types + helpers for the Hermes Kanban dashboard tab.
// All operations route through `hermes kanban ...` JSON output so we never duplicate state.

export type KanbanStatus = "triage" | "todo" | "ready" | "running" | "blocked" | "done" | "archived";

export interface KanbanTask {
  id: string;
  title: string;
  body: string | null;
  assignee: string | null;
  status: KanbanStatus;
  priority: number;
  tenant: string | null;
  workspace_kind?: string;
  workspace_path: string | null;
  created_by?: string;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  result: string | null;
  skills?: string[];
}

export interface KanbanComment {
  id?: number;
  body: string;
  author: string | null;
  created_at: number;
}

export interface KanbanEvent {
  id?: number;
  kind: string;
  payload?: Record<string, unknown>;
  created_at: number;
}

export interface KanbanRun {
  id?: number;
  outcome?: string;
  profile?: string | null;
  started_at?: number;
  ended_at?: number | null;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
  error?: string | null;
}

// Matches `hermes kanban show <id> --json` shape.
export interface KanbanTaskDetail {
  task: KanbanTask;
  latest_summary?: string | null;
  parents: KanbanTask[];
  children: KanbanTask[];
  comments: KanbanComment[];
  events: KanbanEvent[];
  runs: KanbanRun[];
}

export interface KanbanStats {
  by_status: Record<string, number>;
  by_assignee: Record<string, Record<string, number>>;
  oldest_ready_age_seconds: number | null;
  now: number;
}

export interface KanbanAssignee {
  name: string;
  on_disk: boolean;
  counts: Record<string, number>;
}

// The order columns appear left → right in the UI.
export const COLUMNS: { key: KanbanStatus; label: string; accent: string }[] = [
  { key: "triage",   label: "Triage",   accent: "#a855f7" },
  { key: "todo",     label: "Todo",     accent: "#94a3b8" },
  { key: "ready",    label: "Ready",    accent: "#22d3ee" },
  { key: "running",  label: "Running",  accent: "#fbbf24" },
  { key: "blocked",  label: "Blocked",  accent: "#f87171" },
  { key: "done",     label: "Done",     accent: "#86efac" },
];

export const STATUS_COLOUR: Record<KanbanStatus, string> = {
  triage:   "#a855f7",
  todo:     "#94a3b8",
  ready:    "#22d3ee",
  running:  "#fbbf24",
  blocked:  "#f87171",
  done:     "#86efac",
  archived: "#5a5d80",
};

// Helpers for safely browsing the kanban workspace directory of a single task.
// Workspaces live under ~/.hermes/kanban/workspaces/<task_id>/ (or per-board path).
// We only allow reads strictly inside one validated task workspace — path-traversal blocked.

import { readdir, readFile, stat } from "node:fs/promises";
import { hermesHome } from "@/lib/config";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const TASK_ID_RE = /^t_[a-z0-9_-]+$/i;
const BOARD_RE = /^[a-z0-9_-]{1,64}$/;

function boardDbPath(board?: string): string {
  if (board && board !== "default") {
    return path.join(hermesHome(), "kanban", "boards", board, "kanban.db");
  }
  return path.join(hermesHome(), "kanban.db");
}

// A task created with `--workspace dir:<path>` runs in a custom directory (e.g. a
// shared dir for a chain). The DB stores that absolute path on the task. The drawer
// must browse THAT dir, not the per-task default — otherwise it shows "0 files".
function taskCustomWorkspace(taskId: string, board?: string): string | null {
  try {
    const db = boardDbPath(board);
    if (!existsSync(db)) return null;
    // Load node:sqlite at runtime via process.getBuiltinModule so Next's webpack
    // bundler doesn't try to resolve it. node:sqlite is sync — fine for a drawer open.
    const getBuiltin = (process as unknown as { getBuiltinModule?: (m: string) => typeof import("node:sqlite") }).getBuiltinModule;
    const sqlite = getBuiltin ? getBuiltin("node:sqlite") : null;
    if (!sqlite) return null;
    const { DatabaseSync } = sqlite;
    const d = new DatabaseSync(db, { readOnly: true });
    const row = d.prepare("SELECT workspace_path FROM tasks WHERE id = ?").get(taskId) as { workspace_path?: string } | undefined;
    d.close();
    let wp = (row?.workspace_path || "").trim();
    if (wp.startsWith("dir:")) wp = wp.slice(4);
    if (wp.startsWith("~")) wp = path.join(os.homedir(), wp.slice(1));
    if (wp && path.isAbsolute(wp) && existsSync(wp)) return wp;
    return null;
  } catch { return null; }
}

export function taskWorkspaceRoot(taskId: string, board?: string): string | null {
  if (!TASK_ID_RE.test(taskId)) return null;
  if (board && !BOARD_RE.test(board)) return null;
  const custom = taskCustomWorkspace(taskId, board);
  if (custom) return custom;
  const base = path.join(hermesHome(), "kanban");
  if (board && board !== "default") {
    return path.join(base, "boards", board, "workspaces", taskId);
  }
  return path.join(base, "workspaces", taskId);
}

export interface WsFile { name: string; relPath: string; bytes: number; mtime: number; isText: boolean; }

// Resolve a workspace-relative path to an absolute path, blocking ../ escape.
// Returns null if the task/board is invalid or the path escapes the workspace.
// Used by the raw streaming route (video/audio/image preview in the kanban card).
export function resolveWorkspaceFilePath(taskId: string, relPath: string, board?: string): string | null {
  const root = taskWorkspaceRoot(taskId, board);
  if (!root) return null;
  const abs = path.resolve(root, relPath);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

const TEXT_EXTS = new Set([
  ".md", ".markdown", ".txt", ".json", ".yaml", ".yml", ".html", ".htm",
  ".css", ".js", ".ts", ".tsx", ".jsx", ".py", ".sh", ".log", ".csv", ".tsv",
  ".xml", ".toml", ".env",
]);

const SKIP_DIRS = new Set([".git", "node_modules", ".venv", "__pycache__", ".next"]);

export async function listWorkspaceFiles(taskId: string, board?: string, maxFiles = 100): Promise<WsFile[]> {
  const maybeRoot = taskWorkspaceRoot(taskId, board);
  if (!maybeRoot) return [];
  // Hoist into a non-nullable local so the nested async walk() closure sees a
  // string (TS 5.9 + Next 16 don't propagate the truthy narrowing across the
  // async closure boundary).
  const root: string = maybeRoot;
  const out: WsFile[] = [];
  async function walk(dir: string, depth: number) {
    if (out.length >= maxFiles || depth > 4) return;
    let items;
    try { items = await readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const it of items) {
      if (out.length >= maxFiles) break;
      if (SKIP_DIRS.has(it.name)) continue;
      const full = path.join(dir, it.name);
      if (it.isDirectory()) {
        await walk(full, depth + 1);
      } else if (it.isFile()) {
        try {
          const s = await stat(full);
          const ext = path.extname(it.name).toLowerCase();
          out.push({
            name: it.name,
            relPath: path.relative(root, full),
            bytes: s.size,
            mtime: s.mtimeMs,
            isText: TEXT_EXTS.has(ext),
          });
        } catch {}
      }
    }
  }
  await walk(root, 0);
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

export async function readWorkspaceFile(taskId: string, relPath: string, board?: string): Promise<{ content: string; bytes: number; mtime: number; truncated: boolean } | null> {
  const root = taskWorkspaceRoot(taskId, board);
  if (!root) return null;
  const abs = path.resolve(root, relPath);
  // Must stay inside the workspace — block ../ escape.
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  try {
    const s = await stat(abs);
    if (!s.isFile()) return null;
    // Cap reads at 1MB to keep the dashboard snappy
    const MAX = 1_000_000;
    const truncated = s.size > MAX;
    const buf = await readFile(abs);
    const trimmed = truncated ? buf.subarray(0, MAX) : buf;
    return { content: trimmed.toString("utf8"), bytes: s.size, mtime: s.mtimeMs, truncated };
  } catch { return null; }
}

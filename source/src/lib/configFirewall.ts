import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync, readdirSync } from "node:fs";
import path from "node:path";
import { ledgerDb } from "./ledger";

const guarded = [
  ".claude/settings.json", ".claude/settings.local.json", ".mcp.json", "CLAUDE.md", "AGENTS.md", ".cursorrules",
  ".claude/hooks", ".claude/agents", ".claude/skills", ".vscode/tasks.json",
];
export interface ConfigDrift { path: string; kind: "added" | "changed" | "removed"; sha256: string; content: string }
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function files(root: string): Map<string, { sha256: string; content: string }> {
  const found = new Map<string, { sha256: string; content: string }>();
  const dirManifests = new Map<string, string>();
  const add = (full: string) => {
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) {
      const content = `SYMLINK -> ${readlinkSync(full)}`, relative = path.relative(root, full);
      found.set(relative, { content, sha256: hash(content) }); return;
    }
    if (stat.isDirectory()) {
      const entries = readdirSync(full);
      // ponytail: hash manifest of ALL entry names+count (not just first 200) so additions beyond 200 still trip diff
      const manifestHash = hash(JSON.stringify({ names: entries.sort(), count: entries.length }));
      dirManifests.set(full, manifestHash);
      for (const name of entries.slice(0, 200)) add(path.join(full, name));
      return;
    }
    if (!stat.isFile()) return;
    const bytes = readFileSync(full), relative = path.relative(root, full);
    const content = bytes.length > 1_000_000 ? `${bytes.subarray(0, 1_000_000).toString("utf8")}\n...[truncated; hash covers ${bytes.length} bytes]` : bytes.toString("utf8");
    found.set(relative, { content, sha256: createHash("sha256").update(bytes).digest("hex") });
  };
  for (const relative of guarded) { const full = path.join(root, relative); if (existsSync(full)) add(full); }
  // Include manifest hashes in the baseline so directory changes beyond 200 entries still trip diff
  for (const [dir, manifestHash] of dirManifests) {
    const relative = path.relative(root, dir);
    found.set(`${relative}/.manifest`, { content: `manifest of ${relative}`, sha256: manifestHash });
  }
  return found;
}

export function scanWorkspaceConfig(workspace: string): ConfigDrift[] {
  const current = files(workspace), db = ledgerDb();
  const approved = new Map((db.prepare("SELECT path,sha256,content FROM workspace_config_baselines WHERE workspace=?").all(workspace) as Array<Record<string, unknown>>)
    .map((row) => [String(row.path), { sha256: String(row.sha256), content: String(row.content) }]));
  const drift: ConfigDrift[] = [];
  for (const [relative, value] of current) {
    const prior = approved.get(relative);
    if (!prior || prior.sha256 !== value.sha256) drift.push({ path: relative, kind: prior ? "changed" : "added", ...value });
    approved.delete(relative);
  }
  for (const [relative] of approved) drift.push({ path: relative, kind: "removed", sha256: "", content: "" });
  return drift;
}

export function approveWorkspaceConfig(workspace: string, actor: string): void {
  const db = ledgerDb(), current = files(workspace), now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM workspace_config_baselines WHERE workspace=?").run(workspace);
    const insert = db.prepare("INSERT INTO workspace_config_baselines(workspace,path,sha256,content,approved_at,approved_by) VALUES (?,?,?,?,?,?)");
    for (const [relative, value] of current) insert.run(workspace, relative, value.sha256, value.content, now, actor);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

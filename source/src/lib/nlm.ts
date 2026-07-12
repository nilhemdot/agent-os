// Thin wrapper around the `nlm` CLI (notebooklm-mcp-cli) for the Short Video
// Generator. The CLI (v0.8.0+) is what supports the new vertical `short` video
// format — the older MCP server only did landscape `brief`.
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { agentEnv } from "@/lib/runner";

// The dev server is often launched detached (launchd) with a minimal PATH that
// excludes ~/.local/bin (where `nlm` lives). Prepend the usual bin dirs.
const BIN_PATH = [
  path.join(os.homedir(), ".local/bin"),
  "/opt/homebrew/bin", "/usr/local/bin",
  path.join(os.homedir(), ".npm-global/bin"),
  process.env.PATH || "",
].filter(Boolean).join(":");

export const SHORTS_CACHE = path.join(os.homedir(), ".agentic-os", "notebooklm-shorts");

export function runNlm(args: string[], timeoutMs = 60_000): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    let child;
    try { child = spawn("nlm", args, { cwd: process.cwd(), env: agentEnv({ PATH: BIN_PATH }) }); }
    catch (e) { return resolve({ ok: false, stdout: "", stderr: String(e), code: -1 }); }
    let stdout = "", stderr = "";
    const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => { clearTimeout(t); resolve({ ok: code === 0, stdout, stderr, code: code ?? -1 }); });
    child.on("error", (e) => { clearTimeout(t); resolve({ ok: false, stdout, stderr: String(e), code: -1 }); });
  });
}

export interface NlmNotebook { id: string; title: string; source_count?: number }

export async function listNotebooks(): Promise<NlmNotebook[]> {
  const r = await runNlm(["notebook", "list", "--json"], 30_000);
  if (!r.ok) return [];
  try { const arr = JSON.parse(r.stdout); return Array.isArray(arr) ? arr : []; } catch { return []; }
}

// Kick off a vertical short video. Returns the new artifact id.
export async function createShort(notebookId: string, focus: string): Promise<{ ok: boolean; artifactId?: string; error?: string }> {
  const args = ["video", "create", notebookId, "--format", "short", "--confirm"];
  if (focus && focus.trim()) args.push("--focus", focus.trim().slice(0, 1200));
  const r = await runNlm(args, 120_000);
  const m = (r.stdout + "\n" + r.stderr).match(/Artifact ID:\s*([a-f0-9-]{36})/i);
  if (m) return { ok: true, artifactId: m[1] };
  return { ok: false, error: (r.stderr || r.stdout || "failed to start").trim().slice(0, 200) };
}

export interface NlmArtifact { id: string; type: string; status: string; video_url?: string; custom_instructions?: string }

export async function studioStatus(notebookId: string): Promise<NlmArtifact[]> {
  const r = await runNlm(["studio", "status", notebookId], 30_000);
  if (!r.ok) return [];
  try { const arr = JSON.parse(r.stdout); return Array.isArray(arr) ? arr : []; } catch { return []; }
}

export async function downloadVideo(notebookId: string, artifactId: string, outPath: string): Promise<boolean> {
  const r = await runNlm(["download", "video", notebookId, "--id", artifactId, "-o", outPath, "--no-progress"], 180_000);
  return r.ok;
}

// Is the CLI installed + authenticated?
export async function nlmAuthOk(): Promise<boolean> {
  const r = await runNlm(["login", "--check"], 20_000);
  return /valid|✓/i.test(r.stdout + r.stderr) && !/error|expired/i.test(r.stdout + r.stderr);
}

import { spawnSync } from "node:child_process";
import type { AgentName } from "./runner";

export interface SandboxPolicy { mode?: "auto" | "native" | "srt" | "none"; failIfUnavailable?: boolean }
export interface SandboxLaunch { bin: string; args: string[]; sandbox: string }

let srtVersionCache: string | undefined;
function srtVersion(bin: string): string {
  if (srtVersionCache) return srtVersionCache;
  const out = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 2_000 });
  srtVersionCache = (out.stdout || out.stderr || "unknown").trim().slice(0, 40) || "unknown";
  return srtVersionCache;
}

// Fail-closed: any agent that requires a sandbox but cannot get one throws.
// The ONLY path that returns sandbox:"none" is an explicit `mode:"none"` opt-out
// (prepareRun emits a loud security_alert on that resolution — never silent).
export function selectSandbox(agent: AgentName, bin: string, inputArgs: readonly string[], value: unknown): SandboxLaunch {
  const policy = value && typeof value === "object" ? value as SandboxPolicy : {};
  const mode = policy.mode || "auto", args = [...inputArgs];
  if (mode === "none") return { bin, args, sandbox: "none" };
  if (agent === "codex" && args[0] === "exec") {
    if (!args.includes("--sandbox") && !args.includes("-s")) args.splice(1, 0, "--sandbox", "workspace-write");
    const index = Math.max(args.indexOf("--sandbox"), args.indexOf("-s"));
    return { bin, args, sandbox: `codex-landlock:${args[index + 1] || "workspace-write"}` };
  }
  const srt = spawnSync("sh", ["-c", "command -v srt"], { encoding: "utf8" }).stdout.trim();
  // Wrap via argv form (`srt -- <cmd> <args...>`) — no shell-escaping. The child
  // still receives prepareRun's minimal env + canary (env is applied at spawn).
  if (srt && (mode === "auto" || mode === "srt")) return { bin: srt, args: ["--", bin, ...args], sandbox: `srt:${srtVersion(srt)}` };
  throw new Error(`sandbox unavailable for ${agent}; refusing unsandboxed launch (set sandbox.mode="none" to explicitly opt out)`);
}

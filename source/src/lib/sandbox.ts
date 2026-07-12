import { spawnSync } from "node:child_process";
import type { AgentName } from "./runner";

export interface SandboxPolicy { mode?: "auto" | "native" | "srt" | "none"; failIfUnavailable?: boolean }
export interface SandboxLaunch { bin: string; args: string[]; sandbox: string }

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
  if (srt && (mode === "auto" || mode === "srt")) return { bin: srt, args: ["--", bin, ...args], sandbox: "srt" };
  if (policy.failIfUnavailable || mode === "srt" || mode === "native") throw new Error(`sandbox unavailable for ${agent}; refusing unsandboxed launch`);
  return { bin, args, sandbox: "none" };
}

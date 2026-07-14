import { afterEach, describe, expect, it } from "vitest";
import { agentEnv, requireWorkspace, validateAgentArgs } from "@/lib/runner";
import { verificationResult } from "@/app/api/loop/run/route";
import { resolveWorkspaceFilePath } from "@/lib/kanbanWorkspace";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("M0 security gates", () => {
  it("allowlists inherited environment variables", () => {
    process.env.OPENAI_API_KEY = "must-not-leak";
    const env = agentEnv({ RUN_SECRET: "explicit" });
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.RUN_SECRET).toBe("explicit");
  });

  it("requires an absolute workspace", () => {
    expect(() => requireWorkspace()).toThrow();
    expect(() => requireWorkspace("relative/path")).toThrow();
    expect(requireWorkspace("/tmp/workspace")).toBe("/tmp/workspace");
  });

  it("rejects unsafe agent flags", () => {
    expect(() => validateAgentArgs(["--dangerously-skip-permissions"])).toThrow();
  });

  it("keeps verifier results tri-state", () => {
    expect(verificationResult(false, [])).toBe("unavailable");
    expect(verificationResult(true, ["broken"])).toBe("failed");
    expect(verificationResult(true, [])).toBe("passed");
  });

  it("rejects paths that escape a workspace", () => {
    expect(resolveWorkspaceFilePath("t_m0", "../../etc/passwd")).toBeNull();
  });
});

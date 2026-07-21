import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { readFileSync } from "node:fs";
import { agentEnv } from "@/lib/runner";

// H1 (backlog §2): non-agent subprocess launches must not inherit the full
// parent env — API keys stay out of ffprobe/netlify/brew/cloudflared/notebooklm.

const H1_FILES = [
  "src/lib/videoAuto.ts",
  "src/lib/notebooklmClient.ts",
  "src/lib/hermesPhone.ts",
  "src/lib/claudeArtifacts.ts",
];

describe("H1: env leakage — non-agent subprocesses use minimal env", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-h1-canary";
    process.env.OPENAI_API_KEY = "sk-h1-canary";
  });
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  it("agentEnv() never carries API keys", () => {
    const env = agentEnv();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.PATH).toBeTruthy();
  });

  it("H1 modules contain no full-env spread into a child process", () => {
    for (const rel of H1_FILES) {
      const src = readFileSync(path.join(process.cwd(), rel), "utf8");
      expect(src, `${rel} spreads full process.env`).not.toMatch(/\.\.\.process\.env/);
    }
  });

  it("H1 modules spawn only through the runner chokepoint", () => {
    for (const rel of H1_FILES) {
      const src = readFileSync(path.join(process.cwd(), rel), "utf8");
      // raw spawn( from child_process is banned; spawnSubprocess( is the chokepoint
      expect(src, `${rel} imports spawn directly`).not.toMatch(
        /import\s*{[^}]*\bspawn\b[^}]*}\s*from\s*["']node:child_process["']/
      );
    }
  });
});

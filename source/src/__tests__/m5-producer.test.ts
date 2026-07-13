import path from "node:path";
import os from "node:os";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M5.3 production producer — exercises the REAL runner chokepoint. A workspace with an
// unbaselined guarded config file (CLAUDE.md) trips the config firewall inside
// prepareRun, which must now (a) append a config_quarantined event AND (b) record a
// pending action_request for the reviewer. Env is set before importing the modules that
// capture config at load time; vitest isolates this file's module registry.
describe("M5.3 production producers (real runner chokepoints)", () => {
  it("config quarantine records a config_quarantined event + a pending action_request", async () => {
    process.env.AGENTOS_DB_PATH = path.join(os.tmpdir(), `agentos-m5prod-${process.pid}.db`);
    rmSync(process.env.AGENTOS_DB_PATH, { force: true });
    process.env.AGENTIC_OS_CLAUDE_BIN = "/bin/echo"; // harmless real bin for cliVersion

    const { run } = await import("@/lib/runner");
    const { createRun, listRunEvents } = await import("@/lib/ledger");
    const { listActionViews } = await import("@/lib/actions");

    const ws = mkdtempSync(path.join(os.tmpdir(), "agentos-ws-"));
    writeFileSync(path.join(ws, "CLAUDE.md"), "# unbaselined guarded config\n");

    const runId = createRun({ agent: "claude", workspace: ws }).id;
    const res = await run("claude", ["-p", "hi"], { cwd: ws, runId });

    // The run fails safe (refuses) on quarantine.
    expect(res.ok).toBe(false);

    const events = listRunEvents(runId);
    expect(events.some((e) => e.type === "config_quarantined")).toBe(true);
    expect(events.some((e) => e.type === "action_requested")).toBe(true);

    const req = listActionViews(runId).find((a) => a.policy_rule === "config_firewall");
    expect(req).toBeTruthy();
    expect(req!.status).toBe("pending");
    expect(req!.reversible).toBe(false);
    expect(req!.affected_paths).toContain("CLAUDE.md");
  });
});

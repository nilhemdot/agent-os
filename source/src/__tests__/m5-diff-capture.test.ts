import path from "node:path";
import os from "node:os";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { captureGitDiff, GIT_DIFF_MAX_BODY } from "@/lib/runner";
import { appendRunEvent, createRun, ledgerDb, listRunEvents } from "@/lib/ledger";
import { createContract, linkEvidence, recordArtifact } from "@/lib/contract";
import { groupDiffHunks } from "@/lib/reviewData";
import { POST } from "@/app/api/v1/runs/[id]/actions/route";

beforeAll(() => {
  process.env.AGENTOS_DB_PATH = path.join(os.tmpdir(), `agentos-m5diff-${process.pid}.db`);
  rmSync(process.env.AGENTOS_DB_PATH, { force: true });
});

const SECRET = "sk-fake-planted-secret-value-1234567890";

function git(cwd: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

function initRepo(): string {
  const ws = mkdtempSync(path.join(os.tmpdir(), "agentos-gitws-"));
  git(ws, ["init", "-q"]);
  git(ws, ["config", "user.email", "t@t.dev"]);
  git(ws, ["config", "user.name", "tester"]);
  writeFileSync(path.join(ws, "committed.txt"), "line1\nline2\n");
  git(ws, ["add", "."]);
  git(ws, ["commit", "-q", "-m", "init"]);
  return ws;
}

function diffArtifacts(runId: string): Array<{ ref: string; body: string | null }> {
  return ledgerDb()
    .prepare("SELECT ref, body FROM artifacts WHERE run_id=? AND kind='diff' ORDER BY ref")
    .all(runId) as Array<{ ref: string; body: string | null }>;
}

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("M5.1 git-diff capture producer", () => {
  it("records redacted diff artifacts with hunk bodies for tracked + untracked changes", () => {
    const ws = initRepo();
    // Tracked modification whose hunk carries a planted secret the redactor knows.
    writeFileSync(path.join(ws, "committed.txt"), `line1\nline2\nAPI_KEY=${SECRET}\n`);
    // Untracked plain file (captured via file read, not a tracked hunk).
    writeFileSync(path.join(ws, "new.txt"), "brand new untracked content\n");

    const runId = createRun({ agent: "claude", workspace: ws }).id;
    captureGitDiff(runId, ws, [SECRET]);

    const arts = diffArtifacts(runId);
    const refs = arts.map((a) => a.ref);
    expect(refs).toContain("committed.txt");
    expect(refs).toContain("new.txt");

    const tracked = arts.find((a) => a.ref === "committed.txt")!;
    expect(tracked.body).toBeTruthy();
    expect(tracked.body).toContain("@@"); // real unified-diff hunk header
    // Redaction applied: the raw secret never lands in the stored body.
    expect(tracked.body).not.toContain(SECRET);
    expect(tracked.body).toContain("[REDACTED]");

    const untracked = arts.find((a) => a.ref === "new.txt")!;
    expect(untracked.body).toContain("brand new untracked content");

    expect(listRunEvents(runId).some((e) => e.type === "diff_captured")).toBe(true);
    rmSync(ws, { recursive: true, force: true });
  });

  it("truncates an oversize body with a ...truncated marker", () => {
    const ws = initRepo();
    writeFileSync(path.join(ws, "big.txt"), "A".repeat(GIT_DIFF_MAX_BODY + 5_000));

    const runId = createRun({ agent: "claude", workspace: ws }).id;
    captureGitDiff(runId, ws, []);

    const big = diffArtifacts(runId).find((a) => a.ref === "big.txt")!;
    expect(big.body).toBeTruthy();
    expect(big.body!.endsWith("...truncated")).toBe(true);
    expect(big.body!.length).toBeLessThanOrEqual(GIT_DIFF_MAX_BODY + "\n...truncated".length);
    rmSync(ws, { recursive: true, force: true });
  });

  it("caps at 100 files with a loud diff_capture_capped event", () => {
    const ws = initRepo();
    for (let i = 0; i < 105; i++) writeFileSync(path.join(ws, `f${i}.txt`), `content ${i}\n`);

    const runId = createRun({ agent: "claude", workspace: ws }).id;
    captureGitDiff(runId, ws, []);

    expect(diffArtifacts(runId).length).toBe(100);
    const capped = listRunEvents(runId).find((e) => e.type === "diff_capture_capped");
    expect(capped).toBeTruthy();
    expect((capped!.payload as { total: number }).total).toBe(105);
    rmSync(ws, { recursive: true, force: true });
  });

  it("degrades loudly (no crash, no artifacts) outside a git repo", () => {
    const ws = mkdtempSync(path.join(os.tmpdir(), "agentos-nogit-"));
    writeFileSync(path.join(ws, "x.txt"), "hi\n");

    const runId = createRun({ agent: "claude", workspace: ws }).id;
    expect(() => captureGitDiff(runId, ws, [])).not.toThrow();

    expect(diffArtifacts(runId).length).toBe(0);
    expect(listRunEvents(runId).some((e) => e.type === "diff_capture_unavailable")).toBe(true);
    rmSync(ws, { recursive: true, force: true });
  });
});

describe("M5.1 diff capture auto-links hunks to covering criteria", () => {
  it("links a covered path's hunk to its criterion and leaves an uncovered path unlinked", () => {
    const ws = initRepo();
    // Two tracked files the run modifies: a.txt (a criterion covers it) and b.txt (none).
    writeFileSync(path.join(ws, "a.txt"), "alpha\n");
    writeFileSync(path.join(ws, "b.txt"), "bravo\n");
    git(ws, ["add", "."]);
    git(ws, ["commit", "-q", "-m", "add a and b"]);
    writeFileSync(path.join(ws, "a.txt"), "alpha changed\n");
    writeFileSync(path.join(ws, "b.txt"), "bravo changed\n");

    const runId = createRun({ agent: "claude", workspace: ws }).id;
    const [c1] = createContract(runId, {
      objective: "change a",
      acceptance_criteria: ["WHEN a changes THE SYSTEM SHALL update a.txt"],
    });
    // Prior evidence whose ref covers a.txt (exact path) — the coverage the scope
    // detector keys off. b.txt is covered by nothing.
    const cover = recordArtifact(runId, "test", "a.txt");
    linkEvidence({ criterionId: c1.id, artifactId: cover, linkType: "tests", result: "passed" });

    captureGitDiff(runId, ws, []);

    const { byCriterion, unlinked } = groupDiffHunks(runId);
    // a.txt's hunk is grouped under the covering criterion.
    expect(byCriterion.get(c1.id)?.map((h) => h.ref)).toEqual(["a.txt"]);
    // b.txt's hunk is scope expansion — linked to no criterion.
    expect(unlinked.map((h) => h.ref)).toEqual(["b.txt"]);
    rmSync(ws, { recursive: true, force: true });
  });
});

describe("M5.2 cancel guard on the actions endpoint", () => {
  async function cancel(runId: string) {
    return POST(
      new Request("http://localhost/api", { method: "POST", body: JSON.stringify({ action: "cancel" }) }),
      paramsFor(runId),
    );
  }

  it("cancels an active (running) run", async () => {
    const runId = createRun({ agent: "claude", workspace: "/tmp" }).id;
    appendRunEvent(runId, "started", {}); // status -> running
    const res = await cancel(runId);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("cancelled");
  });

  it("refuses to cancel a terminal run with 409", async () => {
    const runId = createRun({ agent: "claude", workspace: "/tmp" }).id;
    appendRunEvent(runId, "completed", {}); // terminal
    const res = await cancel(runId);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/terminal/);
    expect(json.status).toBe("completed");
  });

  it("refuses to re-cancel an already-cancelled (tripped) run with 409", async () => {
    const runId = createRun({ agent: "claude", workspace: "/tmp" }).id;
    appendRunEvent(runId, "started", {});
    expect((await cancel(runId)).status).toBe(200); // first cancel trips the breaker
    const res = await cancel(runId); // second cancel must not re-trip
    expect(res.status).toBe(409);
  });
});

import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { beforeAll, describe, expect, it } from "vitest";
import { appendRunEvent, createRun } from "@/lib/ledger";
import {
  approveAction, burnGrant, consumeGrant, denyAction, hashAction, isActionApproved,
  listActionViews, recordActionRequest, type NormalizedAction,
} from "@/lib/actions";
import { assembleReview } from "@/lib/reviewData";
import { POST } from "@/app/api/v1/runs/[id]/actions/route";

beforeAll(() => {
  process.env.AGENTOS_DB_PATH = path.join("/tmp", `agentos-m5actions-${process.pid}.db`);
  rmSync(process.env.AGENTOS_DB_PATH, { force: true });
});

const base: NormalizedAction = {
  tool: "shell", command: "rm -rf ./build", affectedPaths: ["./build"],
  networkDest: null, secretsRequested: [], reversible: false, policyRule: "fs.delete",
};

function future(ms: number): string { return new Date(Date.now() + ms).toISOString(); }
function paramsFor(id: string) { return { params: Promise.resolve({ id }) }; }

describe("M5.3/M5.4 action requests + hashed approvals", () => {
  it("records a normalized request and a deterministic hash", () => {
    const runId = createRun({ agent: "claude", workspace: "/tmp" }).id;
    const ar = recordActionRequest(runId, base);
    expect(ar.status).toBe("pending");
    expect(ar.command).toBe("rm -rf ./build");
    expect(ar.reversible).toBe(0);
    expect(ar.request_hash).toBe(hashAction(base));
    // path reorder of the same set is not a modification; adding a path is.
    expect(hashAction({ ...base, affectedPaths: ["./build"] })).toBe(ar.request_hash);
    expect(hashAction({ ...base, affectedPaths: ["./build", "./dist"] })).not.toBe(ar.request_hash);
  });

  it("approves with scope+expiry and grants only against the matching hash", () => {
    const runId = createRun({ agent: "claude", workspace: "/tmp" }).id;
    const ar = recordActionRequest(runId, base);
    const grant = approveAction(ar.id, "run", future(60_000));
    expect(grant.scope).toBe("run");
    expect(grant.grant_hash).toBe(ar.request_hash);

    // isActionApproved true ONLY on the exact hash.
    expect(isActionApproved(ar.request_hash, runId)).toBe(true);
    // MODIFIED action → different hash → not approved (invalidation / re-prompt).
    const modified = hashAction({ ...base, command: "rm -rf /" });
    expect(isActionApproved(modified, runId)).toBe(false);
  });

  it("a grant in one run does not authorize the same action in another run (scope)", () => {
    const runA = createRun({ agent: "claude", workspace: "/tmp" }).id;
    const runB = createRun({ agent: "claude", workspace: "/tmp" }).id;
    const ar = recordActionRequest(runA, { ...base, command: "kubectl delete ns prod" });
    approveAction(ar.id, "run", future(60_000));
    expect(isActionApproved(ar.request_hash, runA)).toBe(true);
    // identical normalized action (same hash) in a different run is NOT authorized.
    expect(isActionApproved(ar.request_hash, runB)).toBe(false);
  });

  it("a once grant is consumed by burnGrant — no unbounded replay", () => {
    const runId = createRun({ agent: "claude", workspace: "/tmp" }).id;
    const ar = recordActionRequest(runId, { ...base, command: "deploy prod" });
    approveAction(ar.id, "once", future(60_000));
    expect(isActionApproved(ar.request_hash, runId)).toBe(true); // first execution allowed
    burnGrant(ar.request_hash, runId);
    expect(isActionApproved(ar.request_hash, runId)).toBe(false); // replay blocked after burn
  });

  it("deny is terminal — a denied request cannot be re-approved", () => {
    const runId = createRun({ agent: "claude", workspace: "/tmp" }).id;
    const ar = recordActionRequest(runId, { ...base, command: "rm -rf /etc" });
    denyAction(ar.id);
    expect(() => approveAction(ar.id, "once")).toThrow(/denied/);
  });

  it("does not honor an expired grant", () => {
    const runId = createRun({ agent: "claude", workspace: "/tmp" }).id;
    const ar = recordActionRequest(runId, { ...base, command: "curl evil.example" });
    approveAction(ar.id, "once", future(-1_000)); // already expired
    expect(isActionApproved(ar.request_hash, runId)).toBe(false);
  });

  it("deny marks the request denied and never approves", () => {
    const runId = createRun({ agent: "claude", workspace: "/tmp" }).id;
    const ar = recordActionRequest(runId, { ...base, command: "chmod 777 /" });
    denyAction(ar.id);
    expect(isActionApproved(ar.request_hash, runId)).toBe(false);
    const view = listActionViews(runId).find((a) => a.id === ar.id)!;
    expect(view.status).toBe("denied");
  });
});

describe("M5.2 consumeGrant — atomic burn-then-check execution gate", () => {
  it("burns a once grant atomically — the second consume must fail (no double-spend)", () => {
    const runId = createRun({ agent: "claude", workspace: "/tmp" }).id;
    const ar = recordActionRequest(runId, { ...base, command: "ship once" });
    approveAction(ar.id, "once", future(60_000));
    expect(consumeGrant(ar.request_hash, runId)).toBe(true);  // first execution authorized
    expect(consumeGrant(ar.request_hash, runId)).toBe(false); // double-spend blocked
  });

  it("does not burn a reusable run grant — repeated consume stays authorized", () => {
    const runId = createRun({ agent: "claude", workspace: "/tmp" }).id;
    const ar = recordActionRequest(runId, { ...base, command: "run scope reuse" });
    approveAction(ar.id, "run", future(60_000));
    expect(consumeGrant(ar.request_hash, runId)).toBe(true);
    expect(consumeGrant(ar.request_hash, runId)).toBe(true);
  });

  it("refuses to consume an unapproved / modified action", () => {
    const runId = createRun({ agent: "claude", workspace: "/tmp" }).id;
    const ar = recordActionRequest(runId, { ...base, command: "unapproved" });
    expect(consumeGrant(ar.request_hash, runId)).toBe(false);
  });
});

describe("M5.4 active invalidation — a modified request supersedes the prior one", () => {
  it("invalidates a prior approved request (same run + policy rule) and voids its grant", () => {
    const runId = createRun({ agent: "claude", workspace: "/tmp" }).id;
    const a = recordActionRequest(runId, { ...base, command: "deploy v1" });
    approveAction(a.id, "run", future(60_000));
    expect(isActionApproved(a.request_hash, runId)).toBe(true);

    // Modified action, SAME policy rule → supersedes A.
    const aPrime = recordActionRequest(runId, { ...base, command: "deploy v2" });
    expect(aPrime.status).toBe("pending");
    expect(aPrime.request_hash).not.toBe(a.request_hash);

    const reloadedA = listActionViews(runId).find((x) => x.id === a.id)!;
    expect(reloadedA.status).toBe("invalidated");
    // A's grant no longer authorizes A's original hash.
    expect(isActionApproved(a.request_hash, runId)).toBe(false);
  });
});

describe("M5.3 workspace-scoped grants authorize other runs of the same workspace", () => {
  it("a workspace grant authorizes the same action in another run of the same workspace", () => {
    const runA = createRun({ agent: "claude", workspace: "/ws/alpha" }).id;
    const runB = createRun({ agent: "claude", workspace: "/ws/alpha" }).id;
    const ar = recordActionRequest(runA, { ...base, command: "kubectl apply ws" });
    approveAction(ar.id, "workspace", future(60_000));
    expect(isActionApproved(ar.request_hash, runB)).toBe(true);
  });

  it("a workspace grant does NOT authorize a run in a different workspace", () => {
    const runA = createRun({ agent: "claude", workspace: "/ws/alpha" }).id;
    const runOther = createRun({ agent: "claude", workspace: "/ws/beta" }).id;
    const ar = recordActionRequest(runA, { ...base, command: "kubectl apply cross" });
    approveAction(ar.id, "workspace", future(60_000));
    expect(isActionApproved(ar.request_hash, runOther)).toBe(false);
  });

  it("a workspace grant does NOT match a run with an empty workspace (fail-safe)", () => {
    const runA = createRun({ agent: "claude", workspace: "/ws/alpha" }).id;
    const runEmpty = createRun({ agent: "claude", workspace: "" }).id;
    const ar = recordActionRequest(runA, { ...base, command: "kubectl apply empty" });
    approveAction(ar.id, "workspace", future(60_000));
    expect(isActionApproved(ar.request_hash, runEmpty)).toBe(false);
  });
});

describe("M5.1 review surface surfaces pending + denied actions", () => {
  it("splits pending, denied, and policy_denied into their sections", () => {
    const runId = createRun({ agent: "claude", workspace: "/tmp" }).id;
    // Distinct policy rules: these are different logical actions, so recording the
    // second must NOT supersede/invalidate the first (M5.4 invalidation keys on
    // same run + same policy_rule).
    const pending = recordActionRequest(runId, { ...base, command: "git push --force", policyRule: "vcs.force_push" });
    const denied = recordActionRequest(runId, { ...base, command: "drop database", policyRule: "db.drop" });
    denyAction(denied.id);
    appendRunEvent(runId, "policy_denied", { rule: "network.egress", reason: "unlisted host" });

    const model = assembleReview(runId)!;
    expect(model.actions_pending.map((a) => a.id)).toContain(pending.id);
    expect(model.actions_pending.map((a) => a.id)).not.toContain(denied.id);
    expect(model.actions_denied.map((a) => a.id)).toContain(denied.id);
    expect(model.policy_denials).toEqual([{ rule: "network.egress", reason: "unlisted host" }]);
    // normalized preview is intact on the pending item.
    const p = model.actions_pending.find((a) => a.id === pending.id)!;
    expect(p.reversible).toBe(false);
    expect(p.policy_rule).toBe("vcs.force_push");
  });
});

describe("M5.2 actions endpoint", () => {
  it("approves a valid request through the endpoint", async () => {
    const runId = createRun({ agent: "claude", workspace: "/tmp" }).id;
    const ar = recordActionRequest(runId, base);
    const res = await POST(
      new Request("http://localhost/api", { method: "POST", body: JSON.stringify({ action: "approve", actionRequestId: ar.id, scope: "once" }) }),
      paramsFor(runId),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(isActionApproved(ar.request_hash, runId)).toBe(true);
  });

  it("rejects an unknown action and a mismatched actionRequestId", async () => {
    const runId = createRun({ agent: "claude", workspace: "/tmp" }).id;
    const otherRun = createRun({ agent: "claude", workspace: "/tmp" }).id;
    const ar = recordActionRequest(otherRun, base); // belongs to a different run
    const bad = await POST(new Request("http://localhost/api", { method: "POST", body: JSON.stringify({ action: "nope" }) }), paramsFor(runId));
    expect(bad.status).toBe(400);
    const wrongRun = await POST(
      new Request("http://localhost/api", { method: "POST", body: JSON.stringify({ action: "approve", actionRequestId: ar.id }) }),
      paramsFor(runId),
    );
    expect(wrongRun.status).toBe(400);
  });

  it("retry_step is real, not a stub — a non-git workspace fails 409 (checkpointing unavailable)", async () => {
    // A non-git workspace can't be checkpointed: the verb must refuse (409), never record a stub.
    const nonGit = mkdtempSync(path.join(tmpdir(), "agentos-nongit-"));
    const runId = createRun({ agent: "claude", workspace: nonGit }).id;
    const res = await POST(new Request("http://localhost/api", { method: "POST", body: JSON.stringify({ action: "retry_step" }) }), paramsFor(runId));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.stub).toBeUndefined();
    expect(json.error).toMatch(/not a git workspace/);
  });

  it("404s an unknown run", async () => {
    const res = await POST(new Request("http://localhost/api", { method: "POST", body: JSON.stringify({ action: "cancel" }) }), paramsFor("nope"));
    expect(res.status).toBe(404);
  });
});

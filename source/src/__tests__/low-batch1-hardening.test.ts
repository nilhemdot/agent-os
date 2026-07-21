import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { POST as demotePOST } from "@/app/api/memory/demote/route";
import { isWorkingTreeDirty } from "@/lib/checkpoints";

// LOW hardening batch 1 (backlog §8 M5-1/M5-2 + R3-O8 residual):
// - demote route 404s a missing id instead of 500
// - isWorkingTreeDirty fails CLOSED on git error

const testDbDir = mkdtempSync(path.join(os.tmpdir(), "low-batch1-"));
process.env.AGENTOS_MEMORY_DB_PATH = path.join(testDbDir, "memory.db");

function demoteReq(body: unknown): Request {
  return new Request("http://127.0.0.1/api/memory/demote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("demote route: missing id → 404", () => {
  it("returns 404 for a well-formed id that does not exist", async () => {
    const res = await demotePOST(demoteReq({ id: "mem_1700000000000_zzzz", actor: "user" }));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBe("Memory not found");
  });

  it("still rejects metachar ids with 400 before the lookup (R3.8)", async () => {
    const res = await demotePOST(demoteReq({ id: "mem_1_a.*", actor: "user" }));
    expect(res.status).toBe(400);
  });

  it("404s an unknown legacy-format id (no metachars → valid shape, absent row)", async () => {
    const res = await demotePOST(demoteReq({ id: "legacy-id-that-does-not-exist", actor: "user" }));
    expect(res.status).toBe(404);
  });
});

describe("M5-1: isWorkingTreeDirty fails closed", () => {
  it("treats a non-git / unreadable directory as dirty (git errors)", () => {
    const notARepo = mkdtempSync(path.join(os.tmpdir(), "low-batch1-notgit-"));
    expect(isWorkingTreeDirty(notARepo)).toBe(true);
  });
});

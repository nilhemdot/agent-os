import path from "node:path";
import os from "node:os";
import net from "node:net";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";

// config (loaded transitively by runner) captures AGENTIC_OS_CLAUDE_BIN + AGENTOS_DB_PATH
// at import time, so they MUST be set before runner is loaded. Static ESM imports are
// hoisted above top-level code, so runner is pulled in via top-level-await dynamic import
// AFTER these assignments run.
process.env.AGENTIC_OS_CLAUDE_BIN = "/bin/echo"; // echoes its args to stdout
process.env.AGENTOS_DB_PATH = path.join(os.tmpdir(), `agentos-m6env-${process.pid}.db`);

const { allocatePort, withPortEnv, nativeCheckpointEvent, agentEnv } = await import("@/lib/runner");

// Bind a server on a specific port; resolves once listening. Used to prove a port
// is free (bindable) and to hold a port so the kernel cannot re-hand it out.
function bind(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
const close = (s: net.Server) => new Promise<void>((res) => s.close(() => res()));

describe("M6.4 allocatePort", () => {
  it("returns a port that is actually bindable after it is released", async () => {
    const port = await allocatePort();
    expect(port).toBeGreaterThan(1024);
    expect(port).toBeLessThan(65536);
    // If allocatePort truly released the port, we can bind it ourselves.
    const server = await bind(port);
    await close(server);
  });

  it("does not hand out a port that is currently in use (distinct usable ports)", async () => {
    const first = await allocatePort();
    const holder = await bind(first); // occupy `first`
    const second = await allocatePort(); // kernel must pick a different free port
    await close(holder);
    expect(second).not.toBe(first);
    const server = await bind(second); // and `second` is itself usable
    await close(server);
  });
});

describe("M6.4 withPortEnv (the injection seam)", () => {
  it("lands AGENTOS_PORT in the env agentEnv actually computes", () => {
    const env = agentEnv(withPortEnv({ FOO: "bar" }, 51234));
    expect(env.AGENTOS_PORT).toBe("51234");
    expect(env.FOO).toBe("bar");
  });

  it("leaves the env untouched when allocation failed (null port)", () => {
    const merged = withPortEnv({ FOO: "bar" }, null);
    expect(merged.AGENTOS_PORT).toBeUndefined();
    expect(merged.FOO).toBe("bar");
    // and does not mutate the caller's object
    const original = { FOO: "bar" };
    withPortEnv(original, 42);
    expect(original).not.toHaveProperty("AGENTOS_PORT");
  });
});

describe("M6.1 nativeCheckpointEvent (the emit decision)", () => {
  it("builds a resume record for a claude run with a session id", () => {
    const ev = nativeCheckpointEvent("claude", "sess-abc");
    expect(ev).toEqual({ adapter: "claude", sessionId: "sess-abc", resume: "claude --resume sess-abc" });
  });

  it("emits nothing for a non-claude adapter", () => {
    expect(nativeCheckpointEvent("codex", "sess-abc")).toBeNull();
  });

  it("emits nothing when the claude run has no session id", () => {
    expect(nativeCheckpointEvent("claude", null)).toBeNull();
    expect(nativeCheckpointEvent("claude", undefined)).toBeNull();
  });
});

// End-to-end through the real run() chokepoint: a claude run whose stdout carries a
// JSONL session_id must land both a port_allocated event AND a native_checkpoint event.
describe("M6 run() chokepoint (real spawn)", () => {
  it("records port_allocated and native_checkpoint for a claude run", async () => {
    const { run } = await import("@/lib/runner");
    const { createRun, listRunEvents } = await import("@/lib/ledger");

    const ws = mkdtempSync(path.join(os.tmpdir(), "agentos-m6-ws-"));
    const runId = createRun({ agent: "claude", workspace: ws }).id;
    // /bin/echo prints this JSONL line to stdout → parseJsonlUsage reads session_id.
    await run("claude", ['{"session_id":"sess-xyz"}'], { cwd: ws, runId });

    const events = listRunEvents(runId);
    const portEvent = events.find((e) => e.type === "port_allocated");
    expect(portEvent).toBeTruthy();
    expect((portEvent!.payload as { port: number }).port).toBeGreaterThan(1024);

    const native = events.find((e) => e.type === "native_checkpoint");
    expect(native).toBeTruthy();
    expect(native!.payload).toMatchObject({
      adapter: "claude",
      sessionId: "sess-xyz",
      resume: "claude --resume sess-xyz",
    });
  });
});

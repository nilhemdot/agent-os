import { NextResponse } from "next/server";
import { run } from "@/lib/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Process-wide cache + in-flight de-dupe.
// Without this, every Vitals/Overview tick spawns 5 CLI processes; with multiple
// open dashboard tabs that's ~15 forks every 4s. Cache for 5s, coalesce concurrent
// requests onto one inflight Promise. CLI statuses don't change faster than this.
const CACHE_TTL_MS = 5000;
let cached: { ts: number; body: unknown } | null = null;
let inflight: Promise<unknown> | null = null;

async function computeVitals() {
  const [claude, openclaw, hermes, antigravity] = await Promise.all([
    run("claude", ["--version"], { cwd: process.cwd(), timeoutMs: 6000 }),
    run("openclaw", ["health"], { cwd: process.cwd(), timeoutMs: 6000 }),
    run("hermes", ["status"], { cwd: process.cwd(), timeoutMs: 8000 }),
    run("antigravity", ["--version"], { cwd: process.cwd(), timeoutMs: 6000 }),
  ]);
  return { claude, openclaw, hermes, antigravity };
}

export async function GET() {
  const now = Date.now();
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json(cached.body, { headers: { "X-Vitals-Cache": "hit" } });
  }
  if (!inflight) {
    inflight = computeVitals().finally(() => { inflight = null; });
  }
  const { claude, openclaw, hermes, antigravity } = (await inflight) as Awaited<ReturnType<typeof computeVitals>>;

  const ocAgents = (() => {
    const m = openclaw.stdout.match(/Agents:\s*(.*)/);
    if (!m) return [];
    return m[1].split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
  })();

  const ocSessions = (() => {
    const m = openclaw.stdout.match(/\((\d+)\s+entries\)/);
    return m ? Number(m[1]) : 0;
  })();

  const hermesModel = (() => {
    const m = hermes.stdout.match(/Model:\s+(\S+)/);
    return m ? m[1] : "unknown";
  })();
  const hermesProvider = (() => {
    const m = hermes.stdout.match(/Provider:\s+([^\n]+)/);
    return m ? m[1].trim() : "unknown";
  })();

  const body = {
    ts: Date.now(),
    claude: {
      ok: claude.ok,
      version: claude.stdout.trim() || claude.stderr.trim(),
      latencyMs: claude.durationMs,
    },
    openclaw: (() => {
      // OpenClaw labels itself "degraded" on any event_loop_utilization > threshold,
      // even when actual response latency (max / p99) is 0ms — which is normal for an
      // always-on supervisor (browser server, canvas, talk-voice etc.). Re-classify:
      // only treat it as truly degraded when there is real measurable delay.
      const max = Number((openclaw.stdout.match(/max=(\d+)ms/) ?? [])[1] ?? 0);
      const p99 = Number((openclaw.stdout.match(/p99=(\d+)ms/) ?? [])[1] ?? 0);
      const reportedDegraded = /degraded/.test(openclaw.stdout);
      const trulyDegraded = reportedDegraded && (max > 100 || p99 > 50);
      return {
        ok: openclaw.ok,
        gateway: /Gateway event loop:/.test(openclaw.stdout) ? "live" : "down",
        degraded: trulyDegraded,
        busy: reportedDegraded && !trulyDegraded,
        loopMaxMs: max,
        loopP99Ms: p99,
        agents: ocAgents,
        sessions: ocSessions,
        latencyMs: openclaw.durationMs,
        raw: openclaw.stdout.slice(0, 2000),
      };
    })(),
    hermes: {
      ok: hermes.ok,
      model: hermesModel,
      provider: hermesProvider,
      latencyMs: hermes.durationMs,
      raw: hermes.stdout.slice(0, 2000),
    },
    antigravity: {
      ok: antigravity.ok,
      version: antigravity.stdout.trim() || antigravity.stderr.trim(),
      latencyMs: antigravity.durationMs,
    },
  };
  cached = { ts: now, body };
  return NextResponse.json(body, { headers: { "X-Vitals-Cache": "miss" } });
}

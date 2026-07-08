import { NextResponse } from "next/server";
import { run } from "@/lib/runner";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Claude Platform CLI (`ant`). Its default output is "explore" — an
// interactive TUI that hangs headlessly — so we always force --output json.
//
// GET  → connection status (and verifies it's the *real* ant, not Apache Ant)
// POST { cmd } → run a read-oriented `ant` subcommand, return its output

// ----- GET: status -----
export async function GET() {
  if (!config.ant) return NextResponse.json({ connected: false, reason: "not-installed" });
  // verify it's Anthropic's ant (Apache Ant also lives at `ant`)
  const v = await run("ant", ["--version"], { timeoutMs: 6000 });
  const txt = (v.stdout + " " + v.stderr).toLowerCase();
  const isApacheAnt = /apache ant/.test(txt);
  const looksClaude = /anthropic|claude|platform/.test(txt) || (v.ok && !isApacheAnt);
  return NextResponse.json({
    connected: looksClaude && !isApacheAnt,
    wrongAnt: isApacheAnt,
    version: v.stdout.trim() || v.stderr.trim(),
    bin: config.ant,
  });
}

// ----- POST: run a command -----
// Block interactive / clearly destructive verbs from the browser surface.
const BLOCKED = [/^auth\s+login/i, /\bdelete\b/i, /\bdestroy\b/i, /\brm\b/i];

export async function POST(req: Request) {
  if (!config.ant) return NextResponse.json({ error: "ant not installed" }, { status: 400 });
  const { cmd } = await req.json();
  if (typeof cmd !== "string" || !cmd.trim()) return NextResponse.json({ error: "missing cmd" }, { status: 400 });
  if (cmd.length > 500) return NextResponse.json({ error: "cmd too long" }, { status: 413 });
  if (BLOCKED.some((re) => re.test(cmd.trim()))) {
    return NextResponse.json({ error: "That command is interactive or destructive — run it in your own terminal instead." }, { status: 403 });
  }

  // Split on whitespace (fine for the read commands the console targets).
  let parts = cmd.trim().split(/\s+/).filter(Boolean);
  // The input already shows an "ant" prefix — if the user typed it too, drop the
  // leading "ant" so "ant beta:agents list" doesn't become "ant ant beta:agents…".
  while (parts[0] === "ant") parts = parts.slice(1);
  if (parts.length === 0) return NextResponse.json({ error: "missing cmd" }, { status: 400 });
  // Force structured output (--format json) so the default "explore" TUI never
  // engages headlessly — unless the user already set a format, or it's a probe.
  const hasFormat = parts.some((p) => p === "--format" || p.startsWith("--format="));
  const isMeta = parts.some((p) => p === "--help" || p === "-h" || p === "--version" || p === "auth");
  const args = hasFormat || isMeta ? parts : [...parts, "--format", "json"];

  const out = await run("ant", args, { timeoutMs: 60_000 });
  let parsed: unknown = null;
  const trimmed = out.stdout.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) { try { parsed = JSON.parse(trimmed); } catch { /* raw */ } }

  return NextResponse.json({
    ok: out.ok,
    cmd: `ant ${args.join(" ")}`,
    parsed,
    stdout: out.stdout.slice(0, 60_000),
    stderr: out.stderr.slice(0, 8_000),
    exitCode: out.code,
    durationMs: out.durationMs,
  });
}

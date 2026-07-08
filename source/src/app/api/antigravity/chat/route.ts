import { NextResponse } from "next/server";
import { run } from "@/lib/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Antigravity CLI 1.0.0 doesn't stream — it runs `agy -p "..."` and prints the final text.
// (May add stream support in a later release; treat this as a v1 baseline.)
//
// Long timeout because the Antigravity harness can spin up subagents + do tool calls
// for ~30-90s on real tasks. Same shape as our Hermes chat endpoint.
const ANSI_STRIP = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\]\d+;[^\x07\x1b]*(\x07|\x1b\\)/g;
const TIMEOUT_MS = 5 * 60 * 1000; // 5 min

interface ChatMsg { role: "user" | "assistant" | "system"; text: string; }

// `agy -p` is single-shot per call (no memory), so pack the recent turns into the
// prompt — same buildPromptWithHistory pattern as the other chat tabs (no amnesia).
function buildPromptWithHistory(history: ChatMsg[], current: string): string {
  if (!Array.isArray(history) || !history.length) return current;
  const recent = history.slice(-24);
  const lines: string[] = [
    "The following is the prior conversation between you and the user.",
    "Read it, then answer the user's latest message at the bottom.",
    "",
    "--- prior conversation ---",
  ];
  let bytes = 0;
  const MAX_BYTES = 8000;
  for (const m of recent) {
    if (!m || typeof m.text !== "string") continue;
    const role = m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : "System";
    const line = `${role}: ${m.text}`;
    if (bytes + line.length > MAX_BYTES) { lines.push("…[earlier turns trimmed]"); break; }
    lines.push(line);
    bytes += line.length;
  }
  lines.push("--- end prior conversation ---", "", `User: ${current}`, "Assistant:");
  return lines.join("\n");
}

export async function POST(req: Request) {
  const { prompt, dangerouslySkipPermissions, history } = await req.json();
  if (typeof prompt !== "string" || prompt.length === 0) {
    return NextResponse.json({ error: "missing prompt" }, { status: 400 });
  }
  if (prompt.length > 32_000) {
    return NextResponse.json({ error: "prompt too long" }, { status: 413 });
  }

  const args: string[] = ["-p", buildPromptWithHistory(history, prompt)];
  if (dangerouslySkipPermissions === true) args.push("--dangerously-skip-permissions");

  const out = await run("antigravity", args, { timeoutMs: TIMEOUT_MS });
  const text = out.stdout.replace(ANSI_STRIP, "").trim();
  const stderrClean = out.stderr.replace(ANSI_STRIP, "").trim();

  // Build diagnostic on empty output (same pattern as Hermes — never opaque)
  let diagnostic: string | null = null;
  if (!text) {
    const seconds = (out.durationMs / 1000).toFixed(1);
    const probableTimeout = out.durationMs >= TIMEOUT_MS - 2_000;
    const lines = [
      probableTimeout
        ? `⏱ Antigravity was killed after ${seconds}s — the task likely needed longer than the ${Math.round(TIMEOUT_MS/60000)}-minute budget.`
        : `⚠ Antigravity finished in ${seconds}s with exit ${out.code} but no stdout.`,
    ];
    if (stderrClean) {
      lines.push("", "─── stderr ───", stderrClean.length > 4000 ? stderrClean.slice(-4000) : stderrClean);
    }
    diagnostic = lines.join("\n");
  }

  return NextResponse.json({
    ok: out.ok && !!text,
    text: text || diagnostic || "(no response)",
    empty: !text,
    durationMs: out.durationMs,
    exitCode: out.code,
    timedOut: !text && out.durationMs >= TIMEOUT_MS - 2_000,
    stderr: stderrClean,
  });
}

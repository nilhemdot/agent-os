import { NextResponse } from "next/server";
import { run } from "@/lib/runner";
import { hermesHome } from "@/lib/config";
import { existsSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Strip ALL common ANSI escape sequences (CSI, OSC, simple SGR) — not just `[...m`.
// Otherwise terminal control codes can eat the reply or leave it looking empty.
const ANSI_STRIP = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\]\d+;[^\x07\x1b]*(\x07|\x1b\\)/g;

const TIMEOUT_MS = 6 * 60 * 1000; // 6 min — multi-step agentic tasks (skill invocations, video edits) routinely exceed 2 min.

interface ChatMsg { role: "user" | "assistant" | "system"; text: string; }

// `hermes -z` is single-query mode — it has no memory of earlier turns, so a
// back-and-forth chat felt like talking to someone with amnesia. We give it the
// recent conversation by packing it into the prompt (same approach the Claude,
// Kimi, Free-Claude and Grok chat tabs use). Trimmed to fit the context budget.
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
  const { prompt, profile, history, yolo } = await req.json();
  if (typeof prompt !== "string" || prompt.length === 0) {
    return NextResponse.json({ error: "missing prompt" }, { status: 400 });
  }
  if (prompt.length > 16_000) {
    return NextResponse.json({ error: "prompt too long" }, { status: 413 });
  }
  // Optional profile = chat as a specific Hermes employee (seo-writer, etc.).
  if (profile !== undefined && (typeof profile !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(profile))) {
    return NextResponse.json({ error: "bad profile" }, { status: 400 });
  }

  // hermes -z PROMPT  — single-query non-interactive mode.
  // Unsafe approval bypass is opt-in. If the reply is blank,
  // it's almost always auth — run `hermes status` and check the provider shows
  // a ✓ for its API key.
  // A stale/deleted profile selection (e.g. a "kimi" pill left in localStorage from an
  // earlier setup) must NOT hard-fail every message with "Profile 'kimi' does not exist".
  // Only pass --profile when that profile actually exists; otherwise fall back to Hermes'
  // default active profile so the chat still works.
  const profileArgs = profile && existsSync(path.join(hermesHome(), "profiles", profile))
    ? ["--profile", profile]
    : [];
  // Pack the recent conversation in so follow-ups keep context (no more amnesia).
  const fullPrompt = buildPromptWithHistory(history, prompt);
  const unsafeArgs = yolo === true ? ["--yolo", "--accept-hooks"] : [];
  const out = await run("hermes", [...profileArgs, "-z", fullPrompt, ...unsafeArgs], { cwd: hermesHome(), timeoutMs: TIMEOUT_MS });

  const text = out.stdout.replace(ANSI_STRIP, "").trim();
  const stderrClean = out.stderr.replace(ANSI_STRIP, "").trim();

  // If Hermes produced no usable text, build a diagnostic reply instead of returning the opaque "(no response)".
  let diagnostic: string | null = null;
  if (!text) {
    const seconds = (out.durationMs / 1000).toFixed(1);
    const probableTimeout = out.durationMs >= TIMEOUT_MS - 2_000;
    const lines: string[] = [];
    lines.push(probableTimeout
      ? `⏱ Hermes was killed after ${seconds}s — the task likely needed longer than the ${Math.round(TIMEOUT_MS/60000)}-minute budget. Multi-step agentic tasks (skill invocations, video edits) often exceed this.`
      : `⚠ Hermes finished in ${seconds}s with exit ${out.code} but no stdout.`
    );
    if (stderrClean) {
      lines.push("");
      lines.push("─── stderr ───");
      lines.push(stderrClean.length > 4000 ? stderrClean.slice(-4000) : stderrClean);
    } else {
      lines.push("");
      lines.push("(no stderr either) — blank output with no error is almost always auth or provider config:");
      lines.push("  1. Run `hermes status` — does your provider show a ✓ next to its API key?");
      lines.push("  2. If ✗, run `hermes login` (or set the key in ~/.hermes/.env) for that provider.");
      lines.push("  3. Check the Model + Provider lines in `hermes status` are a real, supported combo.");
      lines.push("  4. Then `hermes doctor` for a full config check.");
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
    stderr: stderrClean, // full, no trunc — useful for diagnosing
  });
}

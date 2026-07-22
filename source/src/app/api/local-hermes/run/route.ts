import { NextResponse } from "next/server";
import { hermesHome } from "@/lib/config";
import { run } from "@/lib/runner";
import path from "node:path";
import { mkdir, readdir, stat } from "node:fs/promises";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// eslint-disable-next-line no-control-regex
const ANSI_STRIP = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\]\d+;[^\x07\x1b]*(\x07|\x1b\\)/g;
const TIMEOUT_MS = 6 * 60 * 1000;
const WORKSPACE = path.join(hermesHome(), "profiles", "local", "workspace");

// Run the offline "local" Hermes agent (llama3.1:8b) with its cwd pinned to the
// profile workspace, so everything it builds lands where the Engine's preview can
// see it (the model otherwise picks its own path, e.g. ~/Sites).
export async function POST(req: Request) {
  const { prompt } = await req.json();
  if (typeof prompt !== "string" || prompt.length === 0) return NextResponse.json({ error: "missing prompt" }, { status: 400 });
  if (prompt.length > 16_000) return NextResponse.json({ error: "prompt too long" }, { status: 413 });

  await mkdir(WORKSPACE, { recursive: true }).catch(() => {});

  // Snapshot the workspace before + after so we can VERIFY the agent actually wrote
  // files (small local models sometimes claim a build and write nothing).
  const snapshot = async (): Promise<Record<string, number>> => {
    const m: Record<string, number> = {};
    try {
      for (const name of await readdir(WORKSPACE)) {
        if (name.startsWith(".")) continue;
        try { m[name] = (await stat(path.join(WORKSPACE, name))).mtimeMs; } catch {}
      }
    } catch {}
    return m;
  };
  const before = await snapshot();

  const out = await run(
    "hermes",
    ["--profile", "local", "-z", prompt],
    { timeoutMs: TIMEOUT_MS, cwd: WORKSPACE },
  );

  const after = await snapshot();
  const built = Object.keys(after).filter((n) => !(n in before) || after[n] !== before[n]).sort();
  // The model "wanted" to build (BUILD-style prompt) but nothing changed on disk.
  const claimedButEmpty = built.length === 0 && /\b(build|create|make|write|save|generate)\b/i.test(prompt);

  const text = out.stdout.replace(ANSI_STRIP, "").trim();
  const stderrClean = out.stderr.replace(ANSI_STRIP, "").trim();
  let diagnostic: string | null = null;
  if (!text) {
    const seconds = (out.durationMs / 1000).toFixed(1);
    const timedOut = out.durationMs >= TIMEOUT_MS - 2_000;
    diagnostic = timedOut
      ? `⏱ The local agent ran past ${Math.round(TIMEOUT_MS / 60000)} min and was stopped. Try a smaller task.`
      : `⚠ Finished in ${seconds}s with no output (exit ${out.code}).${stderrClean ? "\n\n" + stderrClean.slice(-1500) : "\n\nIs Ollama running with llama3.1:8b pulled?"}`;
  }

  return NextResponse.json({
    ok: out.ok && !!text,
    text: text || diagnostic || "(no response)",
    built,                 // files actually created/changed on disk (verified)
    claimedButEmpty,       // agent talked about building but wrote nothing — flag it
    durationMs: out.durationMs,
    exitCode: out.code,
  });
}

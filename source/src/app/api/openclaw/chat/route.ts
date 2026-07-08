import { NextResponse } from "next/server";
import { run } from "@/lib/runner";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatMsg { role: "user" | "assistant" | "system"; text: string; }

// `openclaw agent -m` is single-shot per call (no memory between messages), so a
// back-and-forth would have amnesia like the Claude/Hermes tabs did. Pack the recent
// turns into the prompt — same buildPromptWithHistory pattern as the other chat tabs.
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
  const { prompt, agent, history } = await req.json();
  if (typeof prompt !== "string" || prompt.length === 0) {
    return NextResponse.json({ error: "missing prompt" }, { status: 400 });
  }
  if (prompt.length > 16_000) {
    return NextResponse.json({ error: "prompt too long" }, { status: 413 });
  }
  const agentId = typeof agent === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(agent) ? agent : config.openclawAgent;
  const fullPrompt = buildPromptWithHistory(history, prompt);

  // openclaw agent --local --agent <id> -m <prompt+history> --json --timeout 120
  const out = await run("openclaw", [
    "agent", "--local", "--agent", agentId, "-m", fullPrompt, "--json", "--timeout", "120",
  ], { timeoutMs: 150_000 });

  // Try to parse JSON payload from stdout (may include leading non-JSON log lines)
  let text = "";
  let json: unknown = null;
  const firstBrace = out.stdout.indexOf("{");
  if (firstBrace !== -1) {
    try {
      json = JSON.parse(out.stdout.slice(firstBrace));
      const j = json as { payloads?: { text?: string }[]; meta?: { finalAssistantVisibleText?: string } };
      text = j.meta?.finalAssistantVisibleText
        ?? j.payloads?.[0]?.text
        ?? "";
    } catch {
      text = out.stdout.slice(firstBrace, firstBrace + 800);
    }
  }
  if (!text) text = out.stdout.trim().slice(0, 800) || "(no response)";

  return NextResponse.json({
    ok: out.ok,
    text,
    durationMs: out.durationMs,
    agent: agentId,
    stderr: out.stderr.slice(0, 2000),
  });
}

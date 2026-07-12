import { NextResponse } from "next/server";
import { run } from "@/lib/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/openclaw/studio/chat-quick
// Body: { message: string, history?: { role: "you" | "grok"; text: string }[] }
//
// Fast path for the Talk loop — bypasses `openclaw agent` (which carries
// memory, tools, skills, sandbox checks). Uses `openclaw infer model run
// --gateway` for a direct Grok 4.3 turn with a hard cap: ONE short
// conversational sentence. Saves ~6-8s vs the agent path.

const SYSTEM_PROMPT = `You are Grok on a live voice call. CRITICAL RULES:
- Reply in ONE sentence. Maximum 12 words. Never longer.
- No preamble, no "great question", no markdown, no lists.
- Sound human, not like a chatbot. Casual and brief.
- If asked something long, answer the gist in one short line.`;

function formatHistory(history: { role: "you" | "grok"; text: string }[] = []): string {
  // Last 6 turns max — keeps prompt small for speed.
  return history.slice(-6).map((t) =>
    t.role === "you" ? `User: ${t.text}` : `You: ${t.text}`
  ).join("\n");
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const message = String(body.message ?? "").trim();
  const history = Array.isArray(body.history) ? body.history : [];
  if (!message) return NextResponse.json({ error: "missing message" }, { status: 400 });
  if (message.length > 4000) return NextResponse.json({ error: "message too long" }, { status: 413 });

  const histText = formatHistory(history);
  const prompt = histText
    ? `${SYSTEM_PROMPT}\n\nConversation so far:\n${histText}\n\nUser: ${message}\nYou:`
    : `${SYSTEM_PROMPT}\n\nUser: ${message}\nYou:`;

  const out = await run("openclaw", [
    "infer", "model", "run",
    "--gateway",                    // Reuse the hot gateway — saves 3s of CLI startup
    // No --model override → uses agent's default (xai/grok-4.20-beta-latest-non-reasoning).
    // Non-reasoning model is 5-6s instead of 10-13s for grok-4.3. Perfect for voice.
    "--prompt", prompt,
    "--json",
  ], { cwd: process.cwd(), timeoutMs: 60_000 });

  const firstBrace = out.stdout.indexOf("{");
  let text = "";
  if (firstBrace !== -1) {
    try {
      const j = JSON.parse(out.stdout.slice(firstBrace));
      text = j.text ?? j.outputs?.[0]?.text ?? "";
    } catch { /* fall through */ }
  }
  text = text.trim();

  // Strip common prefixes the model adds despite the system prompt
  text = text.replace(/^(You|Grok|Assistant):\s*/i, "").trim();

  if (!text) {
    return NextResponse.json({
      ok: false,
      error: "Grok returned no text",
      stderr: out.stderr.slice(0, 600),
    }, { status: 200 });
  }

  return NextResponse.json({
    ok: true,
    text,
    durationMs: out.durationMs,
    model: "xai/grok-4.20-beta-latest-non-reasoning",
  });
}

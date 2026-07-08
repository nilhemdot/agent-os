import { NextResponse } from "next/server";
import { minimaxToken } from "@/lib/hermesStudio";
import { logTokens, normalizeUsage } from "@/lib/tokenLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/hermes/talk  { text, voiceId?, history?: {role,text}[] }
// Live voice-chat turn: MiniMax M3 generates a short spoken reply, MiniMax
// speech-02-turbo voices it. Returns { reply, audio } (audio = base64 data URI).
//
// Brain: api.minimax.io/anthropic/v1/messages (model MiniMax-M3) — the same
// model Hermes runs on. Kept terse + thinking-light for low latency (~5-7s/turn).
const SYSTEM =
  "You are Hermes, a warm, witty, fast voice assistant powered by MiniMax M3. " +
  "Reply in ONE short spoken sentence (max ~20 words) — punchy and natural, like a quick voice note. " +
  "Only go longer if explicitly asked. Never use markdown, lists, headings or emoji.";

export async function POST(req: Request) {
  const { text, voiceId, history } = await req.json();
  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "missing text" }, { status: 400 });
  }
  const tok = minimaxToken();
  if (!tok) return NextResponse.json({ error: "MiniMax not connected (run `hermes auth add minimax-oauth`)." }, { status: 400 });
  const H = { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" };

  // Build short rolling context (last 6 turns) for continuity.
  const prior = Array.isArray(history) ? history.slice(-6) : [];
  const messages = [
    ...prior
      .filter((m: { role?: string; text?: string }) => m && (m.role === "user" || m.role === "assistant") && m.text)
      .map((m: { role: string; text: string }) => ({ role: m.role, content: String(m.text).slice(0, 1500) })),
    { role: "user", content: text.slice(0, 1500) },
  ];

  try {
    // 1) M3 reply — thinking DISABLED + tight token budget for low latency.
    //    M3's reasoning pass is ~2s of the round-trip; turning it off (the reply
    //    quality is unaffected for short conversational turns) cuts it to ~3s.
    const r = await fetch("https://api.minimax.io/anthropic/v1/messages", {
      method: "POST", headers: H,
      body: JSON.stringify({
        model: "MiniMax-M3", system: SYSTEM, max_tokens: 70,
        thinking: { type: "disabled" },
        messages,
      }),
    });
    const j = await r.json();
    const blocks = Array.isArray(j?.content) ? j.content : [];
    const reply = blocks.filter((b: { type?: string; text?: string }) => b?.type === "text").map((b: { text?: string }) => b.text || "").join(" ").trim();
    if (!reply) return NextResponse.json({ error: "no reply", detail: j?.base_resp ?? j }, { status: 502 });
    { const nu = normalizeUsage(j?.usage); if (nu) void logTokens({ agent: "hermes", model: "MiniMax-M3", ...nu, kind: "talk" }); }

    // 2) MiniMax voice (turbo = lowest latency)
    const vid = typeof voiceId === "string" && /^[a-z0-9-]+$/i.test(voiceId) ? voiceId : "male-qn-qingse";
    let audio: string | null = null;
    try {
      const tr = await fetch("https://api.minimax.io/v1/t2a_v2", {
        method: "POST", headers: H,
        body: JSON.stringify({
          model: "speech-02-turbo", text: reply, stream: false,
          voice_setting: { voice_id: vid, speed: 1.05, vol: 1, pitch: 0 },
          audio_setting: { format: "mp3", sample_rate: 32000, bitrate: 128000 },
        }),
      });
      const tj = await tr.json();
      const hex = tj?.data?.audio;
      if (hex) audio = `data:audio/mp3;base64,${Buffer.from(hex, "hex").toString("base64")}`;
    } catch { /* reply still returns without audio */ }

    return NextResponse.json({ reply, audio });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

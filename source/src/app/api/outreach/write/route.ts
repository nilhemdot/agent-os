import fs from "node:fs";
import path from "node:path";
import { hermesHome, config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Writes the actual campaign email from a plain-English brief — a real, complete
// cold email (pitch written in, no "[your pitch]" placeholder), personalised with
// {{first_name}} {{domain}} {{reason}} merge tags so every recipient differs.
const OR_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "anthropic/claude-opus-4.8";

function orKey(): string | null {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(hermesHome(), "auth.json"), "utf8"));
    const v = raw.openrouter; const k = typeof v === "string" ? v : v?.api_key;
    if (k) return String(k).trim();
  } catch { /* ignore */ }
  for (const f of [path.join(hermesHome(), "profiles", "fusion", ".env"), path.join(hermesHome(), ".env")]) {
    try { const m = fs.readFileSync(f, "utf8").match(/^OPENROUTER_API_KEY=(.+)$/m); if (m) return m[1].trim(); } catch { /* ignore */ }
  }
  return null;
}

export async function POST(req: Request) {
  const { brief, fromName } = (await req.json().catch(() => ({}))) as { brief?: string; fromName?: string };
  if (!brief?.trim()) return Response.json({ error: "Tell me what the campaign is about first." }, { status: 400 });
  const key = orKey();
  if (!key) return Response.json({ error: "No OpenRouter key found (~/.hermes/auth.json)." }, { status: 500 });
  const who = (fromName || config.userName || "the sender").trim();

  const sys =
    `You write short, high-reply cold outreach emails for ${who}. You are handed a campaign brief and you ` +
    `write ONE complete email a real person would actually reply to.\n\nHARD RULES:\n` +
    `- 4–7 short lines in the body. Plain text. Friendly, specific, human. No "I hope this finds you well", no fluff, no corporate-speak.\n` +
    `- WRITE THE ACTUAL PITCH from the brief. Never leave a "[your pitch]" or any bracketed placeholder — the email must be ready to send as-is.\n` +
    `- Personalise with these exact merge tags so every recipient is different: {{first_name}} (recipient's first name), {{domain}} (their website), {{reason}} (a short note about their business). ` +
    `Use {{first_name}} in the greeting and reference {{domain}} or {{reason}} in the first line so it feels written for them.\n` +
    `- One clear, soft call to action (e.g. "worth a quick chat?" / "want me to send it over?"). Make it easy to say yes.\n` +
    `- Sign off as ${who}.\n` +
    `- Subject: 3–6 words, specific or curiosity-driven, lowercase-ish, NO spammy caps, NO emojis.\n` +
    `Return STRICT JSON only: {"subject":"...","body":"..."} — use \\n for line breaks in the body. No prose outside the JSON.`;

  try {
    const r = await fetch(OR_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "https://aiprofitboardroom.com", "X-Title": "Agent OS · Outreach writer" },
      body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: sys }, { role: "user", content: `Campaign brief:\n${brief.trim()}` }], max_tokens: 700, temperature: 0.7 }),
    });
    if (!r.ok) { const t = await r.text().catch(() => ""); return Response.json({ error: `Writer HTTP ${r.status}: ${t.slice(0, 160)}` }, { status: 502 }); }
    const d = await r.json();
    const txt: string = d.choices?.[0]?.message?.content ?? "";
    let out: { subject?: string; body?: string } = {};
    try { out = JSON.parse(txt.match(/\{[\s\S]*\}/)?.[0] ?? txt); } catch { out = { subject: "", body: txt }; }
    return Response.json({ subject: (out.subject || "").trim(), body: (out.body || "").trim() });
  } catch (e) {
    return Response.json({ error: `Writer error: ${String(e).slice(0, 160)}` }, { status: 500 });
  }
}

import fs from "node:fs";
import { hermesHome } from "@/lib/config";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Fusion chat — streams from OpenRouter's Fusion model (a panel of models +
// a judge that synthesises one answer). OpenAI-compatible endpoint. We relay
// deltas in the same envelope the agent views expect:
//   {"t":"d","c":"chunk"}  ·  {"t":"done"}  ·  {"t":"error","m":"…"}
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "openrouter/fusion";

function fusionKey(): string | null {
  const e = process.env.OPENROUTER_API_KEY;
  if (e) return e.trim();
  // fall back to the fusion profile .env, then the global hermes .env
  const candidates = [
    path.join(hermesHome(), "profiles", "fusion", ".env"),
    path.join(hermesHome(), ".env"),
  ];
  for (const file of candidates) {
    try {
      const env = fs.readFileSync(file, "utf8");
      const m = env.match(/^OPENROUTER_API_KEY=(.+)$/m);
      if (m) return m[1].trim();
    } catch { /* ignore */ }
  }
  return null;
}

interface ChatMsg { role: "user" | "assistant"; text: string; }

export async function POST(req: Request) {
  const { prompt, history = [] } = (await req.json()) as { prompt: string; history?: ChatMsg[] };
  const key = fusionKey();
  const enc = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      if (!key) {
        send({ t: "error", m: "No OpenRouter key found. Set OPENROUTER_API_KEY in ~/.hermes/profiles/fusion/.env" });
        send({ t: "done" }); controller.close(); return;
      }
      const messages = [
        { role: "system", content: "You are the Fusion council, running inside the Agent OS. Behind your reply sits a panel of frontier models deliberating in parallel with web search, then a judge synthesising consensus, contradictions and blind spots. Give the synthesised verdict — decisive and concrete, not a menu of options. Flag where the panel disagreed or where a claim is unverified." },
        ...history.slice(-16).map((h) => ({ role: h.role, content: h.text })),
        { role: "user", content: prompt },
      ];
      try {
        // NOTE: do NOT send a small max_tokens — Fusion 500s if the panel is starved.
        const r = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://aiprofitboardroom.com",
            "X-Title": "Agent OS",
          },
          body: JSON.stringify({ model: MODEL, messages, stream: true }),
        });
        if (!r.ok || !r.body) {
          const t = await r.text().catch(() => "");
          send({ t: "error", m: `OpenRouter HTTP ${r.status}: ${t.slice(0, 240)}` });
          send({ t: "done" }); controller.close(); return;
        }
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const s = line.trim();
            if (!s.startsWith("data:")) continue; // skip keep-alive comment lines
            const data = s.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const j = JSON.parse(data);
              const c = j.choices?.[0]?.delta?.content;
              if (c) send({ t: "d", c });
            } catch { /* skip partial / keep-alive */ }
          }
        }
        send({ t: "done" }); controller.close();
      } catch (e) {
        send({ t: "error", m: String(e) });
        send({ t: "done" }); controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}

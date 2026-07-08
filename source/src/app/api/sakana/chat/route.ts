import fs from "node:fs";
import { hermesHome } from "@/lib/config";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Sakana Fugu Ultra — multi-agent panel API. OpenAI-compatible endpoint.
// Direct competitor to OpenRouter Fusion: same panel idea, ~4× cheaper per call
// on goldiebench. Streams deltas in the agent-view envelope:
//   {"t":"d","c":"chunk"} · {"t":"done"} · {"t":"error","m":"…"}
const ENDPOINT = "https://api.sakana.ai/v1/chat/completions";
const MODEL = "fugu-ultra-20260615";

function sakanaKey(): string | null {
  const e = process.env.SAKANA_API_KEY;
  if (e) return e.trim();
  const candidates = [
    path.join(hermesHome(), "profiles", "sakana-fugu", ".env"),
    path.join(hermesHome(), "profiles", "sakana", ".env"),
    path.join(hermesHome(), ".env"),
  ];
  for (const file of candidates) {
    try {
      const env = fs.readFileSync(file, "utf8");
      const m = env.match(/^SAKANA_API_KEY=(.+)$/m);
      if (m) return m[1].trim();
    } catch { /* ignore */ }
  }
  return null;
}

interface ChatMsg { role: "user" | "assistant"; text: string; }

export async function POST(req: Request) {
  const { prompt, history = [] } = (await req.json()) as { prompt: string; history?: ChatMsg[] };
  const key = sakanaKey();
  const enc = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      if (!key) {
        send({ t: "error", m: "No Sakana key found. Set SAKANA_API_KEY in ~/.hermes/profiles/sakana-fugu/.env" });
        send({ t: "done" }); controller.close(); return;
      }
      const messages = [
        { role: "system", content: "You are Sakana Fugu Ultra, running inside the Agent OS. Behind your reply sits a multi-agent panel of frontier models that vote and synthesise consensus. Be decisive and concrete — give the verdict, not a menu of options. Flag where the panel disagreed or where a claim is unverified." },
        ...history.slice(-16).map((h) => ({ role: h.role, content: h.text })),
        { role: "user", content: prompt },
      ];
      try {
        const r = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model: MODEL, messages, stream: true }),
        });
        if (!r.ok || !r.body) {
          const t = await r.text().catch(() => "");
          send({ t: "error", m: `Sakana HTTP ${r.status}: ${t.slice(0, 240)}` });
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
            if (!s.startsWith("data:")) continue;
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

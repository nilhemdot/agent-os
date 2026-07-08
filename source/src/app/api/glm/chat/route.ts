import fs from "node:fs";
import { hermesHome } from "@/lib/config";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GLM-5.2 chat — streams from the z.ai GLM Coding Plan (OpenAI-compatible).
// GLM has no standalone CLI, so unlike the Kimi/Codex routes we talk to the API
// directly. We relay deltas in the same envelope the agent views expect:
//   {"t":"d","c":"chunk"}  ·  {"t":"done"}  ·  {"t":"error","m":"…"}
const ENDPOINT = "https://api.z.ai/api/coding/paas/v4/chat/completions";
const MODEL = "glm-5.2";

function glmKey(): string | null {
  const e = process.env.GLM_API_KEY || process.env.ZAI_API_KEY || process.env.Z_AI_API_KEY;
  if (e) return e.trim();
  // fall back to the glm-5-2 Hermes profile .env (where we persisted it)
  try {
    const env = fs.readFileSync(path.join(hermesHome(), "profiles", "glm-5-2", ".env"), "utf8");
    const m = env.match(/^(?:GLM_API_KEY|ZAI_API_KEY|Z_AI_API_KEY)=(.+)$/m);
    if (m) return m[1].trim();
  } catch { /* ignore */ }
  return null;
}

interface ChatMsg { role: "user" | "assistant"; text: string; }

export async function POST(req: Request) {
  const { prompt, history = [] } = (await req.json()) as { prompt: string; history?: ChatMsg[] };
  const key = glmKey();
  const enc = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      if (!key) {
        send({ t: "error", m: "No GLM key found. Set GLM_API_KEY in ~/.hermes/profiles/glm-5-2/.env" });
        send({ t: "done" }); controller.close(); return;
      }
      const messages = [
        { role: "system", content: "You are GLM-5.2, Zhipu's frontier coding model, running inside the Agent OS. Be concise and direct. When asked to build something, return complete, self-contained code." },
        ...history.slice(-24).map((h) => ({ role: h.role, content: h.text })),
        { role: "user", content: prompt },
      ];
      try {
        const r = await fetch(ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: MODEL, messages, stream: true, max_tokens: 8000 }),
        });
        if (!r.ok || !r.body) {
          const t = await r.text().catch(() => "");
          send({ t: "error", m: `z.ai HTTP ${r.status}: ${t.slice(0, 240)}` });
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
            } catch { /* skip keep-alives / partial */ }
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

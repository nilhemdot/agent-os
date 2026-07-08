// Shared helpers for driving the local Ollama model (offline) from server routes.
// Used by the Local Agent Kanban so the whole team runs on one warm local model.

const PS = "http://127.0.0.1:11434/api/ps";
const CHAT = "http://127.0.0.1:11434/api/chat";
const FALLBACK = "richardyoung/qwythos-9b-abliterated:latest";

// Use whatever model is ALREADY warm (so we don't load a second one and swap the Mac).
// Falls back to a known builder if nothing is loaded.
export async function resolveModel(): Promise<string> {
  if (process.env.LOCAL_MODEL) return process.env.LOCAL_MODEL;
  try {
    const r = await fetch(PS, { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      const loaded: string[] = (j.models || []).map((m: { name?: string; model?: string }) => m.name || m.model).filter(Boolean);
      if (loaded.length) return loaded[0];
    }
  } catch { /* ollama down */ }
  return FALLBACK;
}

interface ChatOpts { format?: "json"; temperature?: number; numCtx?: number }

export async function localChat(model: string, system: string, user: string, opts: ChatOpts = {}): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    stream: false,
    keep_alive: "30m", // warm during the session, frees when idle — never pin forever
    options: { temperature: opts.temperature ?? 0.4, ...(opts.numCtx ? { num_ctx: opts.numCtx } : {}) },
  };
  if (opts.format === "json") body.format = "json";
  const r = await fetch(CHAT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Ollama HTTP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 160)}`);
  const j = await r.json();
  return (j?.message?.content ?? "").trim();
}

// Trim a candidate down to the real document, dropping any prose an
// instruction-following model (e.g. Ornith) prepends. Anchors on the single real
// <html> tag — NOT a stray "<!doctype html>" the model may mention in an outline.
function trimToDoc(s: string): string {
  const lo = s.toLowerCase();
  const h = lo.indexOf("<html");
  let start = h;
  if (h !== -1) {
    const d = lo.lastIndexOf("<!doctype", h); // doctype immediately before the real <html
    if (d !== -1) start = d;
  } else {
    start = lo.indexOf("<!doctype");
  }
  const end = lo.lastIndexOf("</html>");
  if (start !== -1 && end !== -1 && end > start) return s.slice(start, end + 7).trim();
  return s.trim();
}

// Pull the largest complete single-file HTML doc out of a model reply.
export function extractHtml(text: string): string | null {
  let best: string | null = null;
  const fence = /```(?:[a-zA-Z]*)?\s*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text)) !== null) {
    const b = m[1];
    if (/<!doctype html|<html|<body|<svg|<canvas|<style/i.test(b) && (!best || b.length > best.length)) best = b;
  }
  if (best) return trimToDoc(best);
  const bare = /(<!doctype html[\s\S]*?<\/html>|<html[\s\S]*?<\/html>)/i.exec(text);
  return bare ? trimToDoc(bare[1]) : null;
}

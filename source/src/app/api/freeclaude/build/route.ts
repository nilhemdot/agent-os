import { writeFile, readdir, readFile } from "node:fs/promises";
import { hermesHome } from "@/lib/config";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { FCC_SCRATCH_ROOT, ensureProject } from "@/lib/freeClaudeWorkspace";
import { logTokens, normalizeUsage } from "@/lib/tokenLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fast "speak → build" generation. We do NOT route through the Claude agentic
// CLI (its tool-use loop hangs local general models). Instead we ask a model for
// the HTML in ONE shot, stream the tokens to the UI, then write the file.
//
// Two engines:
//   • "local"  → on-device Ollama (the original $0, offline path)
//   • "n2"     → a strong cloud build model via OpenRouter, still $0 — the fast
//                voice-build engine (much quicker than the local model).
//                Was nex-agi/nex-n2-pro:free until its free tier was retired
//                (OpenRouter 404'd it); now qwen3-coder:free, a strong free coder.

const OLLAMA = process.env.OLLAMA_HOST || "http://localhost:11434";
const N2_MODEL = "qwen/qwen3-coder:free";

function localModel(): string {
  try {
    const env = readFileSync(path.join(os.homedir(), ".fcc", ".env"), "utf8");
    const line = env.split("\n").find((l) => l.startsWith("MODEL="));
    if (line) {
      const v = line.slice(6).replace(/^["']|["']$/g, "").trim();
      if (v.startsWith("ollama/")) return v.slice("ollama/".length);
    }
  } catch { /* ignore */ }
  return "xentriom/gemma-4-12B-coder-fable5-composer2.5-v1";
}

// OpenRouter key for the N2 engine — read from ~/.hermes/.env (never committed,
// never sent to the client).
async function openRouterKey(): Promise<string | null> {
  for (const f of [path.join(hermesHome(), ".env"), path.join(os.homedir(), ".fcc", ".env")]) {
    try {
      const txt = await readFile(f, "utf8");
      const m = txt.match(/OPENROUTER_API_KEY\s*=\s*"?([^"\n]+)"?/i);
      if (m) return m[1].trim();
    } catch { /* next */ }
  }
  return process.env.OPENROUTER_API_KEY || null;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "build";
}

function extractHtml(text: string): string {
  const fence = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  let h = fence ? fence[1] : text;
  const start = h.search(/<!DOCTYPE html|<html/i);
  if (start > 0) h = h.slice(start);
  const end = h.toLowerCase().lastIndexOf("</html>");
  if (end !== -1) h = h.slice(0, end + 7);
  return h.trim();
}

async function uniqueFile(dir: string, slug: string): Promise<string> {
  let names: string[] = [];
  try { names = await readdir(dir); } catch { /* */ }
  let name = `${slug}.html`;
  let n = 2;
  while (names.includes(name)) { name = `${slug}-${n}.html`; n++; }
  return name;
}

const SYSTEM = "You are a world-class creative front-end developer. Output ONLY a single, complete, self-contained HTML file — vanilla JS + HTML5 canvas where useful, NO external libraries, no build step. CRITICAL: NO external resources of any kind — no external images, no <img src> to the web, no icon/image URLs, no web fonts, no CDNs, no network requests. Draw EVERY visual yourself with Canvas, CSS, SVG, gradients, shapes, or emoji so it works perfectly offline. It must be visually stunning, full-window, dark background, smooth 60fps. Start your output with <!DOCTYPE html> and output NOTHING else: no markdown fences, no explanation, no preamble.";

// ── GLM 5.2 (z.ai) — the reliable cloud build engine for voice JARVIS ──
const GLM_ENDPOINT = "https://api.z.ai/api/coding/paas/v4/chat/completions";
const GLM_MODEL = "glm-5.2";
function glmKey(): string | null {
  const e = process.env.GLM_API_KEY || process.env.ZAI_API_KEY || process.env.Z_AI_API_KEY;
  if (e) return e.trim();
  try {
    const env = readFileSync(path.join(hermesHome(), "profiles", "glm-5-2", ".env"), "utf8");
    const m = env.match(/^(?:GLM_API_KEY|ZAI_API_KEY|Z_AI_API_KEY)=(.+)$/m);
    if (m) return m[1].trim();
  } catch { /* ignore */ }
  return null;
}

// GLM build prompt — z.ai's coding plan is slow (~18 tok/s) and cuts a request off
// at ~200s, so we steer GLM to finish a COMPLETE, compact file inside that window
// rather than a sprawling one that truncates before </html>.
const GLM_BUILD_SYS = SYSTEM + " CRITICAL CONSTRAINT: keep the whole file TIGHT — a complete, working app in roughly 120–200 lines. Never write more than you can finish; the document MUST end with </body></html>. A small complete app always beats a large unfinished one. Inline only the CSS and JS you actually need.";

// Stream GLM 5.2 (OpenAI-compatible SSE). Streaming keeps the connection alive (a
// non-streaming request to z.ai is dropped on long builds). Flushes the final
// buffered SSE line after the stream ends — otherwise the last chunk (which carries
// </html>) is lost. Returns the full text.
async function streamGlm(prompt: string, key: string, onTok: (c: string) => void): Promise<string> {
  let full = "";
  const r = await fetch(GLM_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: GLM_MODEL, stream: true, temperature: 0.7, max_tokens: 5000, messages: [{ role: "system", content: GLM_BUILD_SYS }, { role: "user", content: prompt }] }),
  });
  if (!r.ok || !r.body) { const t = await r.text().catch(() => ""); throw new Error(`z.ai ${r.status}: ${t.slice(0, 160)}`); }
  const reader = r.body.getReader(); const dec = new TextDecoder();
  const consume = (chunk: string) => {
    for (const line of chunk.split("\n")) {
      const s = line.trim(); if (!s.startsWith("data:")) continue;
      const data = s.slice(5).trim(); if (!data || data === "[DONE]") continue;
      try { const j = JSON.parse(data); const c = j?.choices?.[0]?.delta?.content; if (c) { full += c; onTok(c); } } catch { /* partial SSE */ }
    }
  };
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const nl = buf.lastIndexOf("\n");
    if (nl >= 0) { consume(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
  }
  if (buf.trim()) consume(buf); // flush the trailing line (carries the closing </html>)
  return full;
}

// Stream the on-device model (Ollama) — used directly for engine "local" and as the
// reliability fallback when a cloud engine returns nothing usable.
async function streamOllama(prompt: string, onTok: (c: string) => void): Promise<string> {
  let full = "";
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: localModel(), stream: true, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }], options: { num_predict: 4096, temperature: 0.7 } }),
  });
  if (!r.ok || !r.body) throw new Error(`ollama ${r.status}`);
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n"); buf = lines.pop() ?? "";
    for (const line of lines) { if (!line.trim()) continue; try { const j = JSON.parse(line); const tok = j?.message?.content; if (tok) { full += tok; onTok(tok); } } catch { /* */ } }
  }
  return full;
}

export async function POST(req: Request) {
  let body: { prompt?: string; project?: string; engine?: string };
  try { body = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
  const prompt = (body.prompt ?? "").toString().trim().slice(0, 2000);
  if (!prompt) return new Response("empty prompt", { status: 400 });

  const engine = body.engine === "glm" ? "glm" : body.engine === "n2" ? "n2" : "local";
  // N2 builds default into the "n2" project so they collect in the n2 workspace folder.
  const fallbackProject = engine === "n2" ? "n2" : "free-claude-code";
  const projectName = typeof body.project === "string" && /^[A-Za-z0-9_.-]+$/.test(body.project)
    ? body.project : fallbackProject;
  const dir = (await ensureProject(projectName)) ?? path.join(FCC_SCRATCH_ROOT, projectName);

  const orKey = engine === "n2" ? await openRouterKey() : null;

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (o: unknown) => { try { controller.enqueue(enc.encode(JSON.stringify(o) + "\n")); } catch { /* */ } };
      let full = "";
      let usage: unknown = null; // OpenRouter usage from the final SSE chunk (N2 only)
      try {
        if (engine === "n2") {
          if (!orKey) { send({ t: "error", m: "No OpenRouter key found for N2 (expected OPENROUTER_API_KEY in ~/.hermes/.env)." }); controller.close(); return; }
          const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${orKey}`,
              "HTTP-Referer": "https://agentos.guide",
              "X-Title": "Agent OS · N2 voice build",
            },
            body: JSON.stringify({
              // 16000 (not 9000): N2 reasons before it writes code, and a
              // functional app (to-do list, calculator) burns a big chunk of the
              // budget thinking. Too small a budget = reasoning eats it all and no
              // HTML streams. 16k leaves plenty of room for the actual build.
              model: N2_MODEL, stream: true, temperature: 0.8, max_tokens: 16000,
              // include_usage → OpenRouter appends a final chunk with token usage.
              stream_options: { include_usage: true },
              // Disable reasoning: N2 is a reasoning model and on some prompts it
              // spends the whole token budget "thinking" and streams no HTML. We
              // want the code straight away, so turn reasoning off for builds.
              reasoning: { enabled: false },
              messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }],
            }),
          });
          if (!r.ok || !r.body) {
            const detail = await r.text().catch(() => "");
            send({ t: "error", m: `N2 (OpenRouter ${r.status}) unreachable. ${detail.slice(0, 160)}` });
            controller.close(); return;
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
              const t = line.trim();
              if (!t.startsWith("data:")) continue;
              const payload = t.slice(5).trim();
              if (payload === "[DONE]") continue;
              try {
                const j = JSON.parse(payload);
                const tok = j?.choices?.[0]?.delta?.content;
                if (tok) { full += tok; send({ t: "d", c: tok }); }
                if (j?.usage) usage = j.usage; // final chunk carries token counts
              } catch { /* partial SSE line */ }
            }
          }
          // N2's free endpoint sometimes streams nothing (reasoning model drops
          // the stream). If we got no usable HTML, retry ONCE non-streaming —
          // that path is reliable — so a voice build never silently fails.
          if (full.replace(/\s/g, "").length < 60) {
            const r2 = await fetch("https://openrouter.ai/api/v1/chat/completions", {
              method: "POST",
              headers: { "content-type": "application/json", authorization: `Bearer ${orKey}`, "HTTP-Referer": "https://agentos.guide", "X-Title": "Agent OS · N2 voice build" },
              body: JSON.stringify({ model: N2_MODEL, temperature: 0.8, max_tokens: 16000, reasoning: { enabled: false }, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }] }),
            });
            if (r2.ok) {
              const j2 = await r2.json().catch(() => null) as { choices?: { message?: { content?: string } }[]; usage?: unknown } | null;
              const c = j2?.choices?.[0]?.message?.content;
              if (c) { full = c; send({ t: "d", c }); }
              if (j2?.usage) usage = j2.usage;
            }
          }
        } else if (engine === "glm") {
          const gk = glmKey();
          if (!gk) { send({ t: "error", m: "No GLM key found (expected GLM_API_KEY in ~/.hermes/profiles/glm-5-2/.env)." }); controller.close(); return; }
          try { full = await streamGlm(prompt, gk, (c) => send({ t: "d", c })); } catch { /* fall through to on-device */ }
          // Reliability: empty OR truncated (no closing </html>, i.e. z.ai cut the build
          // off mid-stream) → fall back to the on-device model so the preview is never broken.
          if (full.replace(/\s/g, "").length < 60 || !/<\/html>/i.test(full)) {
            try {
              full = await streamOllama(prompt, (c) => send({ t: "d", c }));
            } catch {
              send({ t: "error", m: "GLM cut the build off and the on-device fallback (Ollama) isn't running. Start Ollama or try again." });
              controller.close(); return;
            }
          }
        } else {
          const model = localModel();
          const r = await fetch(`${OLLAMA}/api/chat`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model, stream: true,
              messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }],
              options: { num_predict: 4096, temperature: 0.7 },
            }),
          });
          if (!r.ok || !r.body) {
            send({ t: "error", m: `local model not reachable (ollama ${r.status}). Is Ollama running?` });
            controller.close(); return;
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
              if (!line.trim()) continue;
              try {
                const j = JSON.parse(line);
                const tok = j?.message?.content;
                if (tok) { full += tok; send({ t: "d", c: tok }); }
              } catch { /* */ }
            }
          }
        }
      } catch (e) {
        send({ t: "error", m: String(e).slice(0, 200) });
        controller.close(); return;
      }

      const html = extractHtml(full);
      if (!html || html.length < 40) {
        send({ t: "error", m: "model did not return usable HTML — try rephrasing." });
        controller.close(); return;
      }
      try {
        const file = await uniqueFile(dir, slugify(prompt));
        await writeFile(path.join(dir, file), html, "utf8");
        send({ t: "done", file, bytes: html.length, engine, project: projectName });
      } catch (e) {
        send({ t: "error", m: `could not save file: ${String(e).slice(0, 120)}` });
      }
      // Record token usage for the dashboard (N2 only — Ollama is local + untracked).
      if (engine === "n2") {
        const nu = normalizeUsage(usage);
        if (nu) void logTokens({ agent: "freeclaude", model: N2_MODEL, ...nu, kind: "build" });
      }
      controller.close();
    },
  });

  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}

// avoid unused import lint
void existsSync;

// Single source of truth for "which local model is the Local agent using right now".
// The agent FOLLOWS whatever model you've pinned warm in Ollama, so labels never lie
// and you never eat a cold-load. Precedence:
//   1. LOCAL_MODEL env (explicit override) — respected even if not warm
//   2. whatever model is currently loaded/warm (ollama ps) — the common case
//   3. FALLBACK_MODEL (nothing warm, no override)
export const OLLAMA = "http://127.0.0.1:11434";
// Default local model when nothing is warm: Qwythos-9B (Qwen3.5-9B base, Claude-Mythos/Fable
// style, abliterated, 1M ctx) — a 9B Q4 (~5.6GB) that loads light on Apple Silicon and frees
// when idle (keep_alive). Still follows whatever you've pinned warm, so it never forces a swap.
export const FALLBACK_MODEL = "richardyoung/qwythos-9b-abliterated:latest";

// OPTIONAL OpenAI-compatible backend (e.g. an MLX server via `mlx_lm.server`).
// Some models (Qwen3.6 / qwen35 arch) can't run in Ollama/llama.cpp yet — MLX can.
// When LOCAL_OPENAI_BASE is set, the Local engine talks to that endpoint instead of Ollama.
export const LOCAL_OPENAI_BASE = process.env.LOCAL_OPENAI_BASE || "";       // e.g. http://127.0.0.1:8123/v1
export const LOCAL_OPENAI_MODEL = process.env.LOCAL_OPENAI_MODEL || "";     // the model id the server expects
export const LOCAL_MODEL_LABEL = process.env.LOCAL_MODEL_LABEL || "";       // pretty name shown in the UI

export async function resolveModel(): Promise<{ model: string; warm: boolean }> {
  // MLX / OpenAI backend takes precedence — it's an explicit, always-loaded server.
  if (LOCAL_OPENAI_BASE && LOCAL_OPENAI_MODEL) {
    return { model: LOCAL_MODEL_LABEL || LOCAL_OPENAI_MODEL, warm: true };
  }
  const forced = process.env.LOCAL_MODEL;
  if (forced) return { model: forced, warm: true };
  try {
    const r = await fetch(`${OLLAMA}/api/ps`, { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      const loaded: string[] = (j.models || [])
        .map((m: { name?: string; model?: string }) => m.name || m.model)
        .filter(Boolean);
      if (loaded.length) return { model: loaded[0], warm: true };
    }
  } catch { /* ollama down — fall through */ }
  return { model: FALLBACK_MODEL, warm: false };
}

// GLM Code — the real Claude Code CLI (`claude`) running on GLM-5.2 instead of
// Anthropic's models. Same env-override trick as Free Claude Code (fccSpawnEnv),
// but pointed at the LOCAL Ollama daemon, whose Anthropic-compatible endpoint
// (/v1/messages on :11434) proxies `glm-5.2:cloud` up to ollama.com.
//
// Why this is great: you get Claude Code's agentic harness (file editing, tools,
// multi-step plans) driven by GLM-5.2 — 756B params, a usable 1M-token context,
// MIT-licensed — at Ollama Cloud rates instead of Anthropic per-token pricing.
//
// Proven working: `claude -p "..." --model glm-5.2:cloud` with this env writes
// real files via the Write tool (2 turns, ~$0.30 on a small build).

export const GLM_CODE_BASE = process.env.GLM_CODE_BASE || "http://localhost:11434";
export const GLM_CODE_MODEL = process.env.GLM_CODE_MODEL || "glm-5.2:cloud";

// Env injected when we spawn `claude`. Mapping every default model slot to
// glm-5.2:cloud stops Claude Code from ever reaching for an Anthropic model
// (e.g. its small/fast background model), which would 401 against Ollama.
export function glmcodeSpawnEnv(): Record<string, string> {
  const env: Record<string, string> = {
    ANTHROPIC_BASE_URL: GLM_CODE_BASE,
    ANTHROPIC_API_KEY: "ollama",
    ANTHROPIC_AUTH_TOKEN: "ollama",
    ANTHROPIC_MODEL: GLM_CODE_MODEL,
    ANTHROPIC_DEFAULT_OPUS_MODEL: GLM_CODE_MODEL,
    ANTHROPIC_DEFAULT_SONNET_MODEL: GLM_CODE_MODEL,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: GLM_CODE_MODEL,
    ANTHROPIC_SMALL_FAST_MODEL: GLM_CODE_MODEL,
    CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1",
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: "900000", // GLM-5.2 carries ~1M context
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
  };
  if (process.env.OLLAMA_API_KEY) env.OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
  return env;
}

export interface GlmCodeState {
  ollamaUp: boolean;
  model: string;
  base: string;
  ready: boolean;
}

// Is the local Ollama daemon (our Anthropic bridge to GLM-5.2) reachable?
export async function getGlmCodeState(): Promise<GlmCodeState> {
  let ollamaUp = false;
  try {
    const ctl = new AbortController();
    const tid = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch(`${GLM_CODE_BASE}/api/version`, { signal: ctl.signal });
    clearTimeout(tid);
    ollamaUp = r.ok;
  } catch { /* daemon down */ }
  return { ollamaUp, model: GLM_CODE_MODEL, base: GLM_CODE_BASE, ready: ollamaUp };
}

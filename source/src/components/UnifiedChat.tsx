"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Square, BookOpen, Zap, AlertTriangle } from "lucide-react";
import Link from "next/link";
import AgentAvatar, { agentColor, agentLabel, type AgentKey } from "./AgentAvatar";
import VoiceButton from "./VoiceButton";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import HermesPet, { usePetState } from "./HermesPet";

// Render an agent reply as formatted markdown (bold, lists, code, links) instead
// of raw text with visible ** asterisks. User messages stay plain.
function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="chat-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

interface Msg { role: "user" | "assistant"; agent?: AgentKey; text: string; ts: number; }

// Per-agent storage so each thread persists independently across navigation.
// Hermes additionally namespaces by profile — each employee keeps its own thread.
const storageKey = (agent: AgentKey, sub?: string) => `agentic-os-chat-v2:${agent}${sub ? `:${sub}` : ""}`;

// Accent colors for the Hermes profile pills (mirrors HermesProfiles.tsx).
function profileAccent(name: string): string {
  if (name.startsWith("seo-keywords")) return "#fbbf24";
  if (name.startsWith("seo-outline")) return "#8b5cf6";
  if (name.startsWith("seo-writer")) return "#5ab896";
  if (name.startsWith("seo-links")) return "#f472b6";
  if (name === "julian") return "#d4a574";
  return "#60a5fa";
}

function logToVault(agent: AgentKey, user: string, reply: string) {
  fetch("/api/memory/log", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent, kind: "chat", user, reply }),
  }).catch(() => {});
}

interface Props {
  defaultAgent?: AgentKey;
  showAgentSwitcher?: boolean;
  height?: string;
}

export default function UnifiedChat({
  defaultAgent = "claude",
  showAgentSwitcher = true,
  height = "min(72vh, 800px)",
}: Props) {
  const [agent, setAgent] = useState<AgentKey>(defaultAgent);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [partial, setPartial] = useState("");
  // Ultracode: Claude-only. Adds --effort xhigh → unlocks dynamic workflows.
  const [ultracode, setUltracode] = useState(false);
  const [lastLogged, setLastLogged] = useState<string | null>(null);
  // Elapsed seconds counter, for non-streaming agents where you can't see token-by-token progress.
  const [elapsedMs, setElapsedMs] = useState(0);
  const startMsRef = useRef<number>(0);
  // `loaded` guards the persist effect so it doesn't write [] before the load effect
  // has hydrated state from localStorage (which would clobber the saved thread on every mount).
  const [loaded, setLoaded] = useState(false);
  const ctrlRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const interimRef = useRef<string>("");

  // Hermes profile switcher — chat as any employee (each gets its own thread).
  const [hermesProfile, setHermesProfile] = useState<string>(() => {
    try { return localStorage.getItem("agentic-os-hermes-profile") ?? ""; } catch { return ""; }
  });
  const [hermesProfiles, setHermesProfiles] = useState<string[]>([]);
  useEffect(() => {
    if (agent !== "hermes") return;
    fetch("/api/hermes/profiles", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { profiles?: { name: string }[] }) => {
        const names = (j.profiles ?? []).map((p) => p.name).filter((n) => !n.startsWith("swarm"));
        setHermesProfiles(names);
        // Drop a stale selection (a profile that no longer exists on this machine) so we
        // never keep sending a dead `--profile` that fails every message.
        setHermesProfile((cur) => (cur && !names.includes(cur) ? "" : cur));
      })
      .catch(() => {});
  }, [agent]);
  useEffect(() => {
    try { localStorage.setItem("agentic-os-hermes-profile", hermesProfile); } catch {}
  }, [hermesProfile]);
  const threadSub = agent === "hermes" && hermesProfile ? hermesProfile : undefined;

  // Load persisted chat whenever the active agent (or Hermes profile) changes.
  useEffect(() => {
    setLoaded(false);
    try {
      const raw = localStorage.getItem(storageKey(agent, threadSub));
      setMsgs(raw ? JSON.parse(raw) : []);
    } catch {
      setMsgs([]);
    }
    // Mark loaded on next microtask so the persist effect skips the synchronous render cycle.
    queueMicrotask(() => setLoaded(true));
  }, [agent, threadSub]);

  // Persist current thread.
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(storageKey(agent, threadSub), JSON.stringify(msgs.slice(-50))); } catch {}
  }, [msgs, agent, threadSub, loaded]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, partial]);

  async function send() {
    const prompt = input.trim();
    if (!prompt || streaming) return;
    const userMsg: Msg = { role: "user", text: prompt, ts: Date.now() };
    setMsgs((m) => [...m, userMsg]);
    setInput("");
    setPartial("");
    setStreaming(true);
    interimRef.current = "";

    // Elapsed timer for non-streaming agents
    startMsRef.current = Date.now();
    setElapsedMs(0);
    const tick = setInterval(() => setElapsedMs(Date.now() - startMsRef.current), 250);

    let reply = "";

    try {
      if (agent === "claude") {
        reply = await streamClaude(prompt);
      } else if (agent === "hermes") {
        reply = await callHermes(prompt);
      } else if (agent === "antigravity") {
        reply = await callAntigravity(prompt);
      } else {
        reply = await callOpenClaw(prompt);
      }
    } catch (e) {
      reply = `[error: ${String(e)}]`;
    } finally {
      clearInterval(tick);
    }

    setMsgs((m) => [...m, { role: "assistant", agent, text: reply || "(no output)", ts: Date.now() }]);
    setPartial("");
    setStreaming(false);

    // Log to Obsidian
    if (reply && reply.trim()) {
      logToVault(agent, prompt, reply);
      setLastLogged(new Date().toLocaleTimeString("en-GB", { hour12: false }));
    }
  }

  async function streamClaude(prompt: string): Promise<string> {
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    let acc = "";
    const r = await fetch("/api/claude/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, ultracode }),
      signal: ctrl.signal,
    });
    if (!r.body) throw new Error("no body");
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.type === "stream_event" && evt.event?.delta?.text) {
            acc += evt.event.delta.text;
            setPartial(acc);
          } else if (evt.type === "result" && typeof evt.result === "string") {
            if (!acc) { acc = evt.result; setPartial(acc); }
          }
        } catch { /* skip non-JSON */ }
      }
    }
    return acc;
  }

  async function callHermes(prompt: string): Promise<string> {
    setPartial("");
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    // Give the network/proxy 6.5 min — slightly longer than the server-side 6 min hermes timeout
    // so the server gets to send back its own diagnostic message rather than us aborting first.
    const watchdog = setTimeout(() => ctrl.abort(), 6.5 * 60 * 1000);
    // Send the prior turns so Hermes keeps conversation context (hermes -z is single-shot
    // per call, so without this every message was treated as a brand-new conversation).
    const history = msgs.slice(-24).map((m) => ({ role: m.role, text: m.text }));
    try {
      const r = await fetch("/api/hermes/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(hermesProfile ? { prompt, profile: hermesProfile, history } : { prompt, history }),
        signal: ctrl.signal,
      });
      const j = await r.json();
      return j.text ?? "(no response — empty body)";
    } finally {
      clearTimeout(watchdog);
    }
  }

  async function callOpenClaw(prompt: string): Promise<string> {
    setPartial("");
    // Carry the recent turns so OpenClaw keeps context (its -m mode is single-shot per call).
    const history = msgs.slice(-24).map((m) => ({ role: m.role, text: m.text }));
    const r = await fetch("/api/openclaw/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, history }),
    });
    const j = await r.json();
    return j.text ?? "(no response)";
  }

  // Antigravity CLI 1.0.0 doesn't stream — single-shot text return (~10-90s per task).
  // Long network watchdog so the server gets to deliver its own diagnostic on timeout
  // instead of the browser aborting first.
  async function callAntigravity(prompt: string): Promise<string> {
    setPartial("");
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    const watchdog = setTimeout(() => ctrl.abort(), 5.5 * 60 * 1000);
    // Carry the recent turns so Antigravity keeps context (its -p mode is single-shot).
    const history = msgs.slice(-24).map((m) => ({ role: m.role, text: m.text }));
    try {
      const r = await fetch("/api/antigravity/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, history }),
        signal: ctrl.signal,
      });
      const j = await r.json();
      return j.text ?? "(no response — empty body)";
    } finally {
      clearTimeout(watchdog);
    }
  }

  function stop() {
    ctrlRef.current?.abort();
    setStreaming(false);
    setPartial("");
  }

  function handleVoice(t: string, opts: { final: boolean }) {
    if (opts.final) {
      const base = (interimRef.current ? input.replace(/\s*\[voice\][^]*$/, "") : input);
      interimRef.current = "";
      const next = (base + (base.endsWith(" ") || base.length === 0 ? "" : " ") + t).trim();
      setInput(next);
    } else {
      // Show interim with marker
      interimRef.current = t;
      const base = input.replace(/\s*\[voice\][^]*$/, "");
      setInput(`${base}${base.length ? " " : ""}[voice] ${t}`.trim());
    }
  }

  function clearChat() {
    if (!confirm(`Clear ${agentLabel(agent)} chat history?`)) return;
    setMsgs([]);
    setPartial("");
    try { localStorage.removeItem(storageKey(agent)); } catch {}
  }

  const accent = agentColor(agent);

  const petState = usePetState(streaming);

  return (
    <div className="panel flex flex-col overflow-hidden relative" style={{ height }}>
      {/* Animated Hermes pet — mirrors the agent's live state (idle / thinking / done / failed) */}
      {agent === "hermes" && (
        <div className="hermes-pet-dock">
          <HermesPet state={petState} height={104} />
          <span className="pet-state">{petState === "running" ? "thinking" : petState}</span>
        </div>
      )}
      {/* Top: agent switcher */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--panel-border)]">
        <div className="flex items-center gap-2">
          {showAgentSwitcher ? (
            (["claude", "openclaw", "hermes", "antigravity"] as AgentKey[]).map((a) => {
              const active = agent === a;
              const ac = agentColor(a);
              return (
                <button
                  key={a}
                  onClick={() => { if (!streaming) setAgent(a); }}
                  disabled={streaming}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-full border transition disabled:opacity-50"
                  style={{
                    background: active ? `${ac}1f` : "transparent",
                    borderColor: active ? ac : "var(--panel-border)",
                    color: active ? "var(--fg)" : "var(--fg-dim)",
                  }}
                  title={`Switch to ${agentLabel(a)}`}
                >
                  <AgentAvatar agent={a} size={22} />
                  <span className="text-[12.5px] font-medium">{agentLabel(a)}</span>
                </button>
              );
            })
          ) : (
            <div className="flex items-center gap-2">
              <AgentAvatar agent={agent} size={26} pulse={streaming} />
              <span className="text-sm font-medium" style={{ color: accent }}>{agentLabel(agent)}</span>
              {agent === "hermes" && hermesProfile && (
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full border"
                  style={{ color: profileAccent(hermesProfile), borderColor: `${profileAccent(hermesProfile)}55` }}>
                  {hermesProfile}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Ultracode — Claude only. xhigh effort → dynamic workflows. */}
          {agent === "claude" && (
            <button
              onClick={() => setUltracode((v) => !v)}
              disabled={streaming}
              title={ultracode
                ? "Ultracode ON — xhigh effort, dynamic workflows enabled. Uses substantially more tokens."
                : "Turn on Ultracode — xhigh effort + dynamic workflows (parallel subagents). Heavy token use."}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[11px] uppercase tracking-widest transition disabled:opacity-50"
              style={{
                borderColor: ultracode ? "#d97757" : "var(--panel-border)",
                background: ultracode ? "rgba(217,119,87,0.18)" : "transparent",
                color: ultracode ? "#d97757" : "var(--fg-dim)",
              }}
            >
              <Zap size={11} fill={ultracode ? "currentColor" : "none"} />
              Ultracode
            </button>
          )}
          {lastLogged && (
            <Link
              href="/memory"
              className="hidden md:flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] hover:text-[var(--fg-dim)]"
            >
              <BookOpen size={11} /> Logged · {lastLogged}
            </Link>
          )}
          {msgs.length > 0 && (
            <button
              onClick={clearChat}
              className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] hover:text-rose-300 transition"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Hermes staff switcher — chat as any profile, each with its own thread */}
      {agent === "hermes" && hermesProfiles.length > 0 && (
        <div className="flex items-center gap-1.5 px-5 py-2 border-b border-[var(--panel-border)] overflow-x-auto">
          <span className="text-[10px] uppercase tracking-widest shrink-0 mr-1" style={{ color: "var(--fg-dimmer)" }}>Profile</span>
          <button
            onClick={() => { if (!streaming) setHermesProfile(""); }}
            disabled={streaming}
            className="px-2.5 py-1 rounded-full border text-[11.5px] font-medium transition disabled:opacity-50 shrink-0"
            style={{
              borderColor: !hermesProfile ? "#60a5fa" : "var(--panel-border)",
              background: !hermesProfile ? "rgba(96,165,250,0.16)" : "transparent",
              color: !hermesProfile ? "var(--fg)" : "var(--fg-dim)",
            }}
          >
            default
          </button>
          {hermesProfiles.map((p) => {
            const active = hermesProfile === p;
            const pc = profileAccent(p);
            return (
              <button
                key={p}
                onClick={() => { if (!streaming) setHermesProfile(p); }}
                disabled={streaming}
                className="px-2.5 py-1 rounded-full border text-[11.5px] font-medium transition disabled:opacity-50 shrink-0"
                style={{
                  borderColor: active ? pc : "var(--panel-border)",
                  background: active ? `${pc}1f` : "transparent",
                  color: active ? "var(--fg)" : "var(--fg-dim)",
                }}
                title={`Chat as ${p} — separate thread`}
              >
                {p}
              </button>
            );
          })}
        </div>
      )}
      {/* No profiles yet → tell the member the swap bar exists + how to populate it (it's per-user,
          read from THEIR ~/.hermes/profiles — so it's empty until they create some). */}
      {agent === "hermes" && hermesProfiles.length === 0 && (
        <div className="px-5 py-2 border-b border-[var(--panel-border)] text-[11px] leading-snug text-[var(--fg-dimmer)]">
          <span className="uppercase tracking-widest mr-1" style={{ color: "var(--fg-dimmer)" }}>Profile</span>
          Chatting as Hermes&rsquo; default. Add profiles in <code>~/.hermes/profiles/</code> — each is a separate AI &ldquo;employee&rdquo; with its own model &amp; memory — and a quick-swap bar appears right here. Guide: <code>install/4-HERMES.md</code>.
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="scroll flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
        <AnimatePresence initial={false}>
          {msgs.length === 0 && !streaming && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="h-full grid place-items-center text-center"
            >
              <div className="max-w-md">
                <div className="mx-auto mb-3"><AgentAvatar agent={agent} size={56} /></div>
                <h3 className="text-lg font-medium" style={{ color: accent }}>
                  Chat with {agentLabel(agent)}
                </h3>
                <p className="mt-2 text-sm text-[var(--fg-dim)] leading-relaxed">
                  Type or use the mic. Every exchange auto-saves to <code>Agentic OS/Memories/</code> in your Obsidian vault.
                </p>
                <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-[var(--fg-dimmer)]">
                  <kbd className="px-1.5 py-0.5 rounded border border-[var(--panel-border)]">⌘+Enter</kbd>
                  <span>send</span>
                  <span>·</span>
                  <kbd className="px-1.5 py-0.5 rounded border border-[var(--panel-border)]">Esc</kbd>
                  <span>stop</span>
                </div>
              </div>
            </motion.div>
          )}

          {msgs.map((m, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}
            >
              {m.role === "assistant" && m.agent && (
                <AgentAvatar agent={m.agent} size={32} />
              )}
              {m.role === "user" && (
                <div className="w-8 h-8 rounded-full grid place-items-center shrink-0 text-[10px] uppercase tracking-widest text-[var(--fg-dim)] border border-[var(--panel-border)]">
                  you
                </div>
              )}
              <div
                className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap ${
                  m.role === "user"
                    ? "rounded-tr-md bg-[rgba(255,255,255,0.05)] border border-[var(--panel-border)] text-[var(--fg)]"
                    : "rounded-tl-md border"
                }`}
                style={
                  m.role === "assistant"
                    ? {
                        background: `linear-gradient(135deg, ${agentColor(m.agent!)}10, transparent 60%)`,
                        borderColor: `${agentColor(m.agent!)}40`,
                        color: "var(--fg)",
                      }
                    : undefined
                }
              >
                {m.role === "assistant" ? <ChatMarkdown text={m.text} /> : m.text}
              </div>
            </motion.div>
          ))}

          {streaming && (
            <motion.div
              key="partial"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex gap-3"
            >
              <AgentAvatar agent={agent} size={32} pulse />
              <div
                className="max-w-[78%] rounded-2xl rounded-tl-md px-4 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap border"
                style={{
                  background: `linear-gradient(135deg, ${accent}10, transparent 60%)`,
                  borderColor: `${accent}40`,
                  color: "var(--fg)",
                }}
              >
                {partial ? (
                  <ChatMarkdown text={partial} />
                ) : (
                  <span className="inline-flex items-center gap-2 text-[var(--fg-dim)]">
                    <span className="inline-flex items-center">
                      <span className="tick live" style={{ color: accent }} />
                      <span className="tick live" style={{ color: accent, animationDelay: ".15s" }} />
                      <span className="tick live" style={{ color: accent, animationDelay: ".3s" }} />
                    </span>
                    <span>
                      {agentLabel(agent)} thinking
                      {agent !== "claude" && elapsedMs > 0 && (
                        <span className="ml-2 font-[var(--font-geist-mono)] text-[12px]" style={{ color: accent }}>
                          {Math.floor(elapsedMs / 1000)}s
                        </span>
                      )}
                    </span>
                    {agent !== "claude" && elapsedMs > 30_000 && (
                      <span className="text-[11px] text-amber-300/80 ml-1">
                        (slow model, usually 20–40s)
                      </span>
                    )}
                  </span>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Ultracode warning — Claude only, when armed */}
      {agent === "claude" && ultracode && (
        <div className="mx-3 mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-[11.5px] leading-snug border"
             style={{ borderColor: "rgba(217,119,87,0.35)", background: "rgba(217,119,87,0.08)", color: "var(--fg)" }}>
          <AlertTriangle size={13} className="shrink-0 mt-0.5" style={{ color: "#d97757" }} />
          <div>
            <span className="font-semibold" style={{ color: "#d97757" }}>Ultracode is on.</span>{" "}
            Claude runs at <code>xhigh</code> effort and may spin up a dynamic workflow — tens to hundreds of parallel subagents, checked by adversarial reviewers before results return. Best for big jobs: codebase-wide audits, large migrations, work you want stress-tested. <span className="opacity-80">Uses substantially more tokens than a normal chat.</span>
          </div>
        </div>
      )}

      {/* Composer */}
      <div className="border-t border-[var(--panel-border)] p-3">
        <div
          className="flex items-end gap-2 rounded-2xl border bg-[rgba(0,0,0,0.25)] p-2 focus-within:border-[var(--panel-border-hot)] transition"
          style={{ borderColor: "var(--panel-border)" }}
        >
          <VoiceButton onTranscript={handleVoice} size={38} />
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
              if (e.key === "Escape" && streaming) stop();
            }}
            rows={2}
            placeholder={`Message ${agentLabel(agent)}… (⌘+Enter)`}
            className="flex-1 bg-transparent outline-none resize-none px-2 py-2 text-[14px] text-[var(--fg)] placeholder:text-[var(--fg-dimmer)]"
          />
          {streaming ? (
            <button
              onClick={stop}
              className="px-3 h-[38px] rounded-lg bg-[rgba(248,113,113,0.18)] border border-[rgba(248,113,113,0.45)] text-rose-300 text-sm flex items-center gap-1.5 hover:bg-[rgba(248,113,113,0.28)] transition"
            >
              <Square size={14} /> Stop
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!input.trim()}
              className="px-3 h-[38px] rounded-lg flex items-center gap-1.5 text-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: `${accent}24`,
                border: `1px solid ${accent}55`,
                color: accent,
              }}
            >
              <Send size={14} /> Send
            </button>
          )}
        </div>
        <div className="mt-1.5 px-1 flex items-center justify-between text-[10px] text-[var(--fg-dimmer)] uppercase tracking-widest">
          <span>auto-saved to Obsidian</span>
          {agent !== "claude" && (
            <span className="text-amber-400/80">
              {agent === "hermes"
                ? "hermes: 5–15s (Nous Portal)"
                : agent === "antigravity"
                ? "antigravity: 10–90s (Gemini CLI's successor, multi-agent harness)"
                : "openclaw: 20–40s (ollama/deepseek-v4-flash) — keep waiting"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Square, Sparkles, Zap, AlertTriangle } from "lucide-react";
import Panel from "./Panel";

interface Msg { role: "user" | "assistant" | "system"; text: string; }

export default function ClaudePanel() {
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [partial, setPartial] = useState("");
  const [ultracode, setUltracode] = useState(false);
  const ctrlRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, partial]);

  async function send() {
    const prompt = input.trim();
    if (!prompt || streaming) return;
    const history = msgs; // prior turns — sent so `claude -p` (stateless per call) keeps context
    setMsgs((m) => [...m, { role: "user", text: prompt }]);
    setInput("");
    setPartial("");
    setStreaming(true);

    const ctrl = new AbortController();
    ctrlRef.current = ctrl;

    let acc = "";

    try {
      const r = await fetch("/api/claude/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, ultracode, history }),
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
            // Claude stream-json: assistant messages have nested content
            if (evt.type === "assistant" && evt.message?.content) {
              for (const part of evt.message.content) {
                if (part.type === "text" && typeof part.text === "string") {
                  acc += part.text;
                  setPartial(acc);
                }
              }
            } else if (evt.type === "stream_event" && evt.event?.delta?.text) {
              acc += evt.event.delta.text;
              setPartial(acc);
            } else if (evt.type === "result" && typeof evt.result === "string") {
              if (!acc) { acc = evt.result; setPartial(acc); }
            }
          } catch { /* skip non-JSON */ }
        }
      }
    } catch (e) {
      acc += `\n\n[error: ${String(e)}]`;
    }

    setMsgs((m) => [...m, { role: "assistant", text: acc || "(no output)" }]);
    setPartial("");
    setStreaming(false);
  }

  function stop() {
    ctrlRef.current?.abort();
    setStreaming(false);
  }

  return (
    <Panel
      title="Claude — Direct Channel"
      accent="claude"
      icon={<Sparkles size={14} />}
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setMsgs([]); setPartial(""); }}
            disabled={streaming || msgs.length === 0}
            title="Start a fresh conversation (clears context)"
            className="px-2.5 py-1 rounded-full border text-[11px] uppercase tracking-widest transition border-[var(--panel-border)] text-[var(--fg-dim)] hover:text-[var(--fg)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            New chat
          </button>
          <button
            onClick={() => setUltracode((v) => !v)}
            title={ultracode
              ? "Ultracode ON — xhigh effort, dynamic workflows enabled. Uses substantially more tokens."
              : "Turn on Ultracode — xhigh effort + dynamic workflows (parallel subagents). Heavy token use."}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] uppercase tracking-widest transition"
            style={{
              borderColor: ultracode ? "#d97757" : "var(--panel-border)",
              background: ultracode ? "rgba(217,119,87,0.18)" : "transparent",
              color: ultracode ? "var(--claude)" : "var(--fg-dim)",
            }}
          >
            <Zap size={11} fill={ultracode ? "currentColor" : "none"} />
            Ultracode
          </button>
          <span className="pill pill-info">stream-json</span>
        </div>
      }
      className="flex-1 min-h-[600px]"
    >
      <div className="flex flex-col h-full min-h-0">
        <div ref={scrollRef} className="scroll flex-1 min-h-0 overflow-y-auto space-y-3 pr-2">
          <AnimatePresence initial={false}>
            {msgs.length === 0 && !streaming && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-[var(--fg-dim)] text-sm leading-relaxed"
              >
                <p className="text-base text-[var(--fg)]">Mission Channel open.</p>
                <p className="mt-2">
                  Direct line to your Claude Code CLI. Output streams here in real time —
                  no terminal needed.
                </p>
                <ul className="mt-3 text-xs text-[var(--fg-dimmer)] space-y-1">
                  <li>• Multi-turn — keeps context across messages (<strong>New chat</strong> resets)</li>
                  <li>• stream-json with partial deltas</li>
                  <li>• Esc to abort an in-flight call</li>
                  <li>• <strong style={{ color: "var(--claude)" }}>Ultracode</strong> toggle (top-right) → xhigh effort + dynamic workflows for big jobs</li>
                </ul>
              </motion.div>
            )}
            {msgs.map((m, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className={`rounded-xl px-4 py-3 text-sm leading-relaxed border ${
                  m.role === "user"
                    ? "bg-[rgba(217,119,87,0.08)] border-[rgba(217,119,87,0.18)] text-[var(--fg)]"
                    : "bg-[rgba(255,255,255,0.02)] border-[rgba(255,255,255,0.06)] text-[var(--fg)]"
                }`}
              >
                <div className="text-[10px] tracking-widest uppercase mb-1 opacity-60">
                  {m.role === "user" ? "you" : "claude"}
                </div>
                <div className="whitespace-pre-wrap font-[var(--font-geist-mono)]">{m.text}</div>
              </motion.div>
            ))}
            {streaming && (
              <motion.div
                key="partial"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="rounded-xl px-4 py-3 text-sm leading-relaxed border bg-[rgba(255,255,255,0.02)] border-[rgba(255,255,255,0.06)]"
              >
                <div className="text-[10px] tracking-widest uppercase mb-1 opacity-60 flex items-center gap-2">
                  claude
                  <span className="inline-flex">
                    <span className="tick live" style={{ color: "var(--claude)" }} />
                    <span className="tick live" style={{ color: "var(--claude)", animationDelay: ".2s" }} />
                    <span className="tick live" style={{ color: "var(--claude)", animationDelay: ".4s" }} />
                  </span>
                </div>
                <div className="whitespace-pre-wrap font-[var(--font-geist-mono)]">{partial || "thinking…"}</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {ultracode && (
          <div className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-[11.5px] leading-snug border"
               style={{ borderColor: "rgba(217,119,87,0.35)", background: "rgba(217,119,87,0.08)", color: "var(--fg)" }}>
            <AlertTriangle size={13} className="shrink-0 mt-0.5" style={{ color: "var(--claude)" }} />
            <div>
              <span className="font-semibold" style={{ color: "var(--claude)" }}>Ultracode is on.</span>{" "}
              Claude runs at <code>xhigh</code> effort and may spin up a dynamic workflow — tens to hundreds of parallel subagents, checked by adversarial reviewers before results return. Best for big jobs: codebase-wide audits, large migrations, work you want stress-tested. <span className="opacity-80">Uses substantially more tokens than a normal chat.</span>
            </div>
          </div>
        )}

        <div className="mt-4 panel border border-[var(--panel-border)] flex items-end gap-2 p-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
              if (e.key === "Escape" && streaming) stop();
            }}
            rows={2}
            placeholder="Ask Claude anything…  (⌘+Enter to send)"
            className="flex-1 bg-transparent outline-none resize-none px-3 py-2 text-sm text-[var(--fg)] placeholder:text-[var(--fg-dimmer)]"
          />
          {streaming ? (
            <button
              onClick={stop}
              className="px-3 py-2 rounded-lg bg-[rgba(248,113,113,0.15)] border border-[rgba(248,113,113,0.4)] text-rose-300 text-sm flex items-center gap-1.5 hover:bg-[rgba(248,113,113,0.22)] transition"
            >
              <Square size={14} /> Stop
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!input.trim()}
              className="px-3 py-2 rounded-lg bg-[rgba(217,119,87,0.18)] border border-[rgba(217,119,87,0.4)] text-[var(--claude)] text-sm flex items-center gap-1.5 hover:bg-[rgba(217,119,87,0.28)] transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send size={14} /> Send
            </button>
          )}
        </div>
      </div>
    </Panel>
  );
}

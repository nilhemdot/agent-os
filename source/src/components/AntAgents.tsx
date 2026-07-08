"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Play, Loader2, Brain, Wrench, CheckCircle2, MessageSquare, AlertTriangle, ChevronDown } from "lucide-react";

const ACCENT = "#d97757";
type Agent = { id: string; name: string; description?: string; model?: string; system?: string };
type Ev = { type: string; text?: string; tool?: string };

export default function AntAgents() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sel, setSel] = useState<Agent | null>(null);
  const [showSys, setShowSys] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [trace, setTrace] = useState<Ev[]>([]);
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/claude/ant/agents").then((r) => r.json()).then((j) => {
      setConnected(!!j.connected); setAgents(j.agents ?? []);
      if (j.agents?.length) setSel(j.agents[0]);
    }).catch(() => setConnected(false));
    return () => { if (poll.current) clearTimeout(poll.current); };
  }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [trace]);

  async function runAgent() {
    if (!sel || !prompt.trim() || running) return;
    setRunning(true); setTrace([]); setStatus("Creating session…");
    try {
      const r = await fetch("/api/claude/ant/agents/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agentId: sel.id, prompt: prompt.trim() }) });
      const j = await r.json();
      if (!j.sessionId) { setRunning(false); setStatus(`⚠ ${j.error ?? "run failed"}`); return; }
      setStatus("Agent is working…");
      pollTrace(j.sessionId, Date.now());
    } catch (e) { setRunning(false); setStatus(`⚠ ${String(e)}`); }
  }
  async function pollTrace(sid: string, t0: number) {
    try {
      const j = await (await fetch(`/api/claude/ant/agents/trace?sessionId=${sid}`, { cache: "no-store" })).json();
      setTrace(j.events ?? []);
      if (j.done) { setRunning(false); setStatus("✓ Done"); return; }
      const s = Math.round((Date.now() - t0) / 1000);
      setStatus(`Agent is working… ${s}s`);
      poll.current = setTimeout(() => pollTrace(sid, t0), 2500);
    } catch { poll.current = setTimeout(() => pollTrace(sid, t0), 2500); }
  }

  if (connected === false) return (
    <div className="panel p-6 text-[13.5px] text-[var(--fg-dim)] flex items-start gap-2">
      <AlertTriangle size={15} className="text-amber-300 shrink-0 mt-0.5" />
      <span>Connect the Claude Platform CLI first (Claude → Ant CLI tab). Then your Managed Agents appear here.</span>
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
      {/* agent list */}
      <div className="panel p-4 space-y-2 h-fit">
        <div className="flex items-center gap-2 mb-1"><Bot size={16} style={{ color: ACCENT }} /><span className="text-sm font-medium" style={{ color: ACCENT }}>Managed Agents</span><span className="text-[11px] text-[var(--fg-dimmer)]">{agents.length}</span></div>
        {agents.length === 0 && connected && <div className="text-[12.5px] text-[var(--fg-dim)] py-3">No agents yet — create one with <code>ant beta:agents create</code>.</div>}
        {agents.map((a) => {
          const on = sel?.id === a.id;
          return (
            <button key={a.id} onClick={() => { setSel(a); setTrace([]); setStatus(""); }}
              className="w-full text-left rounded-xl border px-3.5 py-3 transition"
              style={{ borderColor: on ? ACCENT : "var(--panel-border)", background: on ? "rgba(217,119,87,.1)" : "transparent" }}>
              <div className="text-[14px] font-medium">{a.name}</div>
              <div className="text-[11.5px] text-[var(--fg-dim)] line-clamp-2 mt-0.5">{a.description}</div>
              <div className="text-[10px] text-[var(--fg-dimmer)] font-[var(--font-geist-mono)] mt-1.5">{a.model}</div>
            </button>
          );
        })}
      </div>

      {/* run + trace */}
      <div className="panel p-5 space-y-4">
        {sel ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-base font-medium">{sel.name}</div>
                <div className="text-[12.5px] text-[var(--fg-dim)]">{sel.description}</div>
              </div>
              {sel.system && <button onClick={() => setShowSys((v) => !v)} className="text-[11px] text-[var(--fg-dimmer)] flex items-center gap-1 hover:text-[var(--fg-dim)]">system <ChevronDown size={12} className={showSys ? "rotate-180" : ""} /></button>}
            </div>
            {showSys && sel.system && <pre className="scroll text-[11.5px] text-[var(--fg-dim)] bg-[rgba(0,0,0,.25)] rounded-lg p-3 max-h-40 overflow-auto whitespace-pre-wrap">{sel.system}</pre>}

            <div className="flex gap-2 items-end">
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runAgent(); } }}
                placeholder={`Give ${sel.name} a task…  (⌘+Enter)`}
                className="flex-1 bg-[rgba(0,0,0,.25)] border rounded-xl px-3 py-2.5 text-[13.5px] outline-none resize-none focus:border-[var(--panel-border-hot)]" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
              <button onClick={runAgent} disabled={running || !prompt.trim()} className="px-4 h-[46px] rounded-xl flex items-center gap-2 text-sm font-medium transition disabled:opacity-40" style={{ background: `${ACCENT}24`, border: `1px solid ${ACCENT}55`, color: ACCENT }}>
                {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}{running ? "Running" : "Run"}
              </button>
            </div>
            {status && <div className="text-[12.5px]" style={{ color: status.startsWith("⚠") ? "#f87171" : status.startsWith("✓") ? "#34d399" : ACCENT }}>{status}</div>}

            {/* trace timeline */}
            {trace.length > 0 && (
              <div ref={scrollRef} className="scroll space-y-2 max-h-[420px] overflow-auto pt-1">
                <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-1">Live trace</div>
                {trace.map((e, i) => <TraceRow key={i} e={e} />)}
              </div>
            )}
          </>
        ) : <div className="text-[13.5px] text-[var(--fg-dim)] py-10 text-center">Select an agent on the left to run it.</div>}
      </div>
    </div>
  );
}

function TraceRow({ e }: { e: Ev }) {
  const t = e.type;
  if (t === "user.message") return (
    <div className="flex flex-row-reverse"><div className="max-w-[80%] rounded-2xl rounded-tr-md px-3.5 py-2 text-[13px] bg-[rgba(255,255,255,.05)] border border-[var(--panel-border)]">{e.text}</div></div>
  );
  if (t === "agent.thinking") return (
    <div className="flex items-start gap-2 text-[12.5px] text-[var(--fg-dim)] italic"><Brain size={14} className="shrink-0 mt-0.5 text-violet-300" /><span>{e.text ? e.text.slice(0, 240) : "thinking…"}</span></div>
  );
  if (t === "agent.message") return (
    <div className="rounded-xl border px-4 py-3 text-[13.5px] leading-relaxed whitespace-pre-wrap" style={{ background: "linear-gradient(135deg, rgba(217,119,87,.12), transparent 60%)", borderColor: "rgba(217,119,87,.4)" }}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest mb-1.5" style={{ color: ACCENT }}><MessageSquare size={12} /> agent reply</div>{e.text}
    </div>
  );
  if (/tool_use/.test(t)) return (
    <div className="inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-full border" style={{ borderColor: "rgba(92,192,163,.4)", color: "#5cc0a3" }}><Wrench size={12} /> {e.tool ?? "tool"}</div>
  );
  if (t.endsWith("status_idle") || t.endsWith("status_terminated")) return (
    <div className="flex items-center gap-1.5 text-[12px] text-emerald-300"><CheckCircle2 size={13} /> {t.endsWith("terminated") ? "session ended" : "done"}</div>
  );
  if (t.startsWith("span.")) return null; // hide low-level model spans
  return <div className="text-[11.5px] text-[var(--fg-dimmer)] font-[var(--font-geist-mono)]">· {t}</div>;
}

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Square, Users, History, Plus, Trash2 } from "lucide-react";
import AgentAvatar, { type AgentKey } from "./AgentAvatar";

interface Agent { id: string; name: string; color: string; model: string; provider: string }
interface Msg { key: number; who: "you" | "system" | string; name?: string; color?: string; text: string; kind?: "context" | "action" }
interface Convo { id: string; title: string; ts: number; msgs: Msg[] }
const CONVOS_KEY = "agentroom/conversations/v1";

export default function GroupChatView() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [present, setPresent] = useState<Set<string>>(new Set());
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState<{ id: string; name: string; color: string } | null>(null);
  const [convos, setConvos] = useState<Convo[]>([]);
  const [currentId, setCurrentId] = useState<string>(() => "c" + Date.now());
  const [showHistory, setShowHistory] = useState(false);
  const ctrlRef = useRef<AbortController | null>(null);
  const keyRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/room").then((r) => r.json()).then((j) => {
      const a: Agent[] = j.agents || [];
      setAgents(a); setPresent(new Set(a.map((x) => x.id)));
    }).catch(() => {});
    // fast: localStorage cache
    try { const c = JSON.parse(localStorage.getItem(CONVOS_KEY) || "[]"); if (Array.isArray(c)) setConvos(c); } catch {}
    // durable: vault-backed history (survives browser clears + shows on any device)
    fetch("/api/room/history").then((r) => r.json()).then((j) => {
      const server: Convo[] = j.conversations || [];
      setConvos((local) => {
        const byId = new Map<string, Convo>();
        [...server, ...local].forEach((c) => { const e = byId.get(c.id); if (!e || (c.ts || 0) > (e.ts || 0)) byId.set(c.id, c); });
        const merged = [...byId.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 80);
        try { localStorage.setItem(CONVOS_KEY, JSON.stringify(merged)); } catch {}
        return merged;
      });
    }).catch(() => {});
  }, []);
  useEffect(() => { if (msgs.length) endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [msgs, typing]);
  // persist the current conversation as it grows — to localStorage (instant) and,
  // debounced, to the vault (durable).
  useEffect(() => {
    if (!msgs.length) return;
    const title = (msgs.find((m) => m.who === "you")?.text || "New chat").slice(0, 50);
    const convo: Convo = { id: currentId, title, ts: Date.now(), msgs };
    setConvos((prev) => {
      const updated = [convo, ...prev.filter((c) => c.id !== currentId)].slice(0, 80);
      try { localStorage.setItem(CONVOS_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch("/api/room/history", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(convo) }).catch(() => {});
    }, 900);
  }, [msgs, currentId]);

  function newChat() { setMsgs([]); setCurrentId("c" + Date.now()); setShowHistory(false); }
  function loadConvo(c: Convo) { setMsgs(c.msgs); setCurrentId(c.id); setShowHistory(false); keyRef.current = Math.max(keyRef.current, ...c.msgs.map((m) => m.key), 0); }
  function deleteConvo(id: string) { setConvos((prev) => { const u = prev.filter((c) => c.id !== id); try { localStorage.setItem(CONVOS_KEY, JSON.stringify(u)); } catch {} return u; }); fetch(`/api/room/history?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {}); if (id === currentId) newChat(); }

  function toggle(id: string) {
    setPresent((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  const send = useCallback(async () => {
    const message = input.trim();
    if (!message || busy) return;
    if (present.size === 0) { return; }
    setInput("");
    const userMsg: Msg = { key: ++keyRef.current, who: "you", text: message };
    setMsgs((m) => [...m, userMsg]);
    setBusy(true);

    // history for the API (speaker + text)
    const history = msgs.map((m) => ({ speaker: m.who === "you" ? "You" : (m.name || "Agent"), text: m.text }));
    const ctrl = new AbortController(); ctrlRef.current = ctrl;
    try {
      const r = await fetch("/api/room", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, history, agents: [...present] }), signal: ctrl.signal,
      });
      if (r.body) {
        const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
        while (true) {
          const { value, done } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n"); buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const j = JSON.parse(line);
              if (j.t === "typing") setTyping({ id: j.id, name: j.name, color: j.color });
              else if (j.t === "msg") { setTyping(null); setMsgs((m) => [...m, { key: ++keyRef.current, who: j.id, name: j.name, color: j.color, text: j.text }]); }
              else if (j.t === "context") { const s = (j.sources || []).map((x: { title: string }) => x.title).join(" · "); setMsgs((m) => [...m, { key: ++keyRef.current, who: "system", kind: "context", text: `Read your vault — ${s}` }]); }
              else if (j.t === "action") { const label = j.kind === "note" ? `saved a note: ${j.label}` : `added to your Pipeline: ${j.label}`; setMsgs((m) => [...m, { key: ++keyRef.current, who: "system", kind: "action", color: j.color, text: `${j.name} ${j.ok === false ? "tried to save (failed)" : label}` }]); }
              else if (j.t === "done") setTyping(null);
            } catch {}
          }
        }
      }
    } catch {}
    setTyping(null); setBusy(false); ctrlRef.current = null;
  }, [input, busy, present, msgs]);

  function stop() { ctrlRef.current?.abort(); setBusy(false); setTyping(null); }

  const presentList = agents.filter((a) => present.has(a.id));
  const ago = (ts: number) => { const m = Math.floor((Date.now() - ts) / 60000); if (m < 1) return "just now"; if (m < 60) return `${m}m ago`; const h = Math.floor(m / 60); return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`; };

  return (
    <div className="max-w-[900px] mx-auto flex flex-col h-[calc(100vh-150px)] min-h-[520px]">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div className="grid place-items-center w-10 h-10 rounded-xl border shrink-0" style={{ borderColor: "rgba(168,85,247,0.4)", background: "rgba(168,85,247,0.12)", color: "#a855f7" }}><Users size={20} /></div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-medium tracking-tight">AI Agent <span style={{ color: "#a855f7" }}>Mastermind</span></h1>
          <div className="text-[12.5px] text-[var(--fg-dim)]">Talk to all your agents at once — each one is a different real model. Tag one with <span className="font-mono">@claude</span> to ask just them.</div>
        </div>
        <div className="relative flex items-center gap-1.5 shrink-0">
          <button onClick={newChat} className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg border border-[var(--panel-border)] hover:border-[var(--panel-border-hot)] text-[12px] text-[var(--fg-dim)]"><Plus size={13} /> New chat</button>
          <button onClick={() => setShowHistory((s) => !s)} className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg border text-[12px]" style={{ borderColor: showHistory ? "#a855f7" : "var(--panel-border)", color: showHistory ? "#a855f7" : "var(--fg-dim)", background: showHistory ? "rgba(168,85,247,0.1)" : "transparent" }}><History size={13} /> History{convos.length ? ` (${convos.length})` : ""}</button>
          {showHistory && (
            <div className="absolute right-0 top-full mt-2 w-[320px] max-h-[64vh] overflow-y-auto rounded-xl border border-[var(--panel-border)] z-30 p-1.5" style={{ background: "var(--bg-panel, #14101a)", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
              {convos.length === 0 && <div className="text-[12px] text-[var(--fg-dimmer)] p-3 text-center">No saved chats yet.</div>}
              {convos.map((c) => (
                <div key={c.id} className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer ${c.id === currentId ? "bg-[rgba(168,85,247,0.12)]" : "hover:bg-[var(--bg-mid)]"}`} onClick={() => loadConvo(c)}>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] text-[var(--fg)] truncate">{c.title}</div>
                    <div className="text-[10.5px] text-[var(--fg-dimmer)]">{ago(c.ts)} · {c.msgs.filter((m) => m.who !== "system").length} msgs</div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); deleteConvo(c.id); }} className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--fg-dimmer)] hover:text-rose-400"><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Roster */}
      <div className="flex items-center gap-1.5 flex-wrap mb-3 pb-3 border-b border-[var(--panel-border)]">
        <span className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mr-1">In the room</span>
        {agents.map((a) => {
          const on = present.has(a.id);
          return (
            <button key={a.id} onClick={() => toggle(a.id)} title={`${a.name} · ${a.model}`}
              className="flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full border text-[12px] transition"
              style={{ borderColor: on ? `${a.color}` : "var(--panel-border)", background: on ? `${a.color}1e` : "transparent", color: on ? "var(--fg)" : "var(--fg-dimmer)", opacity: on ? 1 : 0.55 }}>
              <span style={{ filter: on ? "none" : "grayscale(1)" }}><AgentAvatar agent={a.id as AgentKey} size={18} /></span>
              {a.name}
            </button>
          );
        })}
      </div>

      {/* Composer — kept at the top so it's always reachable */}
      <div className="mb-3 pb-3 border-b border-[var(--panel-border)]">
        <div className="flex gap-2">
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }}
            placeholder={present.size === 0 ? "Add an agent to the room first…" : "Message the room…  (tag @claude / @gemini to ask one)"}
            disabled={present.size === 0}
            className="flex-1 bg-[rgba(0,0,0,0.3)] border border-[var(--panel-border)] rounded-xl px-4 h-11 text-sm outline-none focus:border-[var(--panel-border-hot)] text-[var(--fg)]" />
          {busy
            ? <button onClick={stop} className="px-4 h-11 rounded-xl text-[13px] font-semibold inline-flex items-center gap-1.5 bg-rose-500/20 border border-rose-400/40 text-rose-300"><Square size={14} /> Stop</button>
            : <button onClick={send} disabled={!input.trim() || present.size === 0} className="px-5 h-11 rounded-xl text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-40" style={{ background: "#a855f7", color: "#fff" }}><Send size={15} /> Send</button>}
        </div>
        <div className="text-[10.5px] text-[var(--fg-dimmer)] mt-1.5">{presentList.length} agents in the room · they reply in turn, riff off each other, and read your vault for context · tag @one to ask just them</div>
      </div>

      {/* Transcript */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {msgs.length === 0 && (
          <div className="text-center text-[13px] text-[var(--fg-dimmer)] leading-relaxed pt-10">
            Drop a question and watch them go.<br />
            <span className="text-[var(--fg-dim)]">&ldquo;What should I build next in my Agent OS?&rdquo;</span> · <span className="text-[var(--fg-dim)]">&ldquo;@codex how would you structure this?&rdquo;</span>
          </div>
        )}
        <AnimatePresence initial={false}>
          {msgs.map((m) => m.who === "you" ? (
            <motion.div key={m.key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
              <div className="max-w-[78%] rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-[14px] leading-relaxed" style={{ background: "rgba(212,165,116,0.16)", border: "1px solid rgba(212,165,116,0.35)", color: "var(--fg)" }}>{m.text}</div>
            </motion.div>
          ) : m.who === "system" ? (
            <motion.div key={m.key} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-center">
              <div className="text-[11px] px-3 py-1 rounded-full inline-flex items-center gap-1.5" style={{ background: m.kind === "context" ? "rgba(34,211,238,0.10)" : "rgba(168,85,247,0.12)", border: `1px solid ${m.kind === "context" ? "rgba(34,211,238,0.3)" : "rgba(168,85,247,0.35)"}`, color: "var(--fg-dim)" }}>
                <span>{m.kind === "context" ? "🔎" : "✓"}</span> {m.text}
              </div>
            </motion.div>
          ) : (
            <motion.div key={m.key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex gap-2.5 items-start">
              <span className="shrink-0 mt-0.5"><AgentAvatar agent={m.who as AgentKey} size={26} /></span>
              <div className="max-w-[82%]">
                <div className="text-[11px] font-semibold mb-0.5" style={{ color: m.color }}>{m.name}</div>
                <div className="rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-[14px] leading-relaxed text-[var(--fg)]" style={{ background: "var(--bg-mid)", border: `1px solid ${m.color}33` }}>{m.text}</div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {typing && (
          <div className="flex gap-2.5 items-center">
            <span className="shrink-0"><AgentAvatar agent={typing.id as AgentKey} size={26} /></span>
            <div className="text-[12px] flex items-center gap-1.5" style={{ color: typing.color }}>
              {typing.name} is typing
              <span className="flex gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: typing.color, animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: typing.color, animationDelay: "120ms" }} />
                <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: typing.color, animationDelay: "240ms" }} />
              </span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}

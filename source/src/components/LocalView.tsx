"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Send, Square, Trash2, Loader2, Cpu, Zap, WifiOff,
  MessageSquare, Eye, FolderOpen, Code2, Download, ExternalLink,
  RotateCw, Radio, Wand2,
} from "lucide-react";
import VoiceButton from "./VoiceButton";

const ACCENT = "#5eead4"; // local teal/mint
const HISTORY_KEY = "agentic-os/local/history/v1";
const ARTIFACTS_KEY = "agentic-os/local/artifacts/v1";
const ACTIVE_KEY = "agentic-os/local/active/v1";

interface Msg { role: "user" | "assistant"; text: string; tps?: number; artifactId?: string }
interface Artifact { id: string; title: string; html: string; createdAt: number; prompt: string }
interface ServerBuild { id: string; title: string; prompt: string; model?: string; createdAt: number; bytes: number }

type Tab = "build" | "preview" | "workspace";

let _seq = 0;
const newId = () => `a${Date.now().toString(36)}${(_seq++).toString(36)}`;

// Pull the largest complete HTML doc / block out of an assistant reply.
function extractHtml(text: string): string | null {
  let best: string | null = null;
  const fence = /```(?:[a-zA-Z]*)?\s*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text)) !== null) {
    const body = m[1];
    if (/<!doctype html|<html|<body|<svg|<canvas|<div|<style/i.test(body) && (!best || body.length > best.length)) best = body;
  }
  if (best) return best.trim();
  const bare = /(<!doctype html[\s\S]*?<\/html>|<html[\s\S]*?<\/html>)/i.exec(text);
  return bare ? bare[1].trim() : null;
}

// Chat bubble shouldn't dump 300 lines of HTML — strip the code block, leave the prose.
function stripHtml(text: string): string {
  return text
    .replace(/```(?:[a-zA-Z]*)?\s*\n[\s\S]*?```/g, "")
    .replace(/<!doctype html[\s\S]*?<\/html>/gi, "")
    .replace(/<html[\s\S]*?<\/html>/gi, "")
    .trim();
}

function titleFor(html: string, prompt: string): string {
  const t = /<title>([^<]+)<\/title>/i.exec(html)?.[1]?.trim();
  if (t) return t.slice(0, 52);
  const p = prompt.replace(/^(please\s+)?(build|make|create|design|write|give me|can you|show me)\s+/i, "").trim();
  return (p.split(/\s+/).slice(0, 7).join(" ") || "Untitled build").slice(0, 52);
}

export default function LocalView() {
  const [tab, setTab] = useState<Tab>("build");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [partial, setPartial] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [lastTps, setLastTps] = useState<number | null>(null);
  const [modelName, setModelName] = useState<string | null>(null);
  const [handsFree, setHandsFree] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);

  const ctrlRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const voiceBaseRef = useRef("");
  const [ready, setReady] = useState(false);

  // ---- persistence (fully local) ----
  // `ready` is STATE, not a ref, on purpose: the save effects below capture ready=false
  // on the initial mount renders, so they CANNOT overwrite stored history with the empty
  // starting state before the load lands — even under React Strict Mode's double-invoke
  // (which previously wiped history on every reload).
  useEffect(() => {
    try {
      const h = localStorage.getItem(HISTORY_KEY); if (h) setMsgs(JSON.parse(h).slice(-200));
      const a = localStorage.getItem(ARTIFACTS_KEY); if (a) setArtifacts(JSON.parse(a).slice(-60));
      const id = localStorage.getItem(ACTIVE_KEY); if (id) setActiveId(JSON.parse(id));
    } catch {}
    setReady(true);
  }, []);
  useEffect(() => { if (ready) try { localStorage.setItem(HISTORY_KEY, JSON.stringify(msgs.slice(-200))); } catch {} }, [msgs, ready]);
  useEffect(() => { if (ready) try { localStorage.setItem(ARTIFACTS_KEY, JSON.stringify(artifacts.slice(-60))); } catch {} }, [artifacts, ready]);
  useEffect(() => { if (ready) try { localStorage.setItem(ACTIVE_KEY, JSON.stringify(activeId)); } catch {} }, [activeId, ready]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [msgs, partial]);
  // Show the REAL model the agent will use (follows whatever's pinned warm in Ollama) — never a stale hardcoded name.
  useEffect(() => { fetch("/api/local/model").then((r) => r.json()).then((d) => { if (d?.model) setModelName(d.model); }).catch(() => {}); }, []);

  // Sync server-side builds (generator, scripts) into the workspace, live. Each fetched
  // once, merged as a normal Artifact so all the existing open/preview/download UI just works.
  const syncedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        const res = await fetch("/api/local/builds"); if (!res.ok) return;
        const builds: ServerBuild[] = (await res.json()).builds || [];
        const fresh = builds.filter((b) => !syncedRef.current.has(b.id));
        if (!fresh.length) return;
        const items = await Promise.all(fresh.map(async (b) => {
          const html = await fetch(`/api/local/builds/file/${b.id}`).then((r) => (r.ok ? r.text() : null)).catch(() => null);
          if (html) syncedRef.current.add(b.id);
          return html ? ({ id: b.id, title: b.title, html, createdAt: b.createdAt, prompt: b.prompt } as Artifact) : null;
        }));
        const valid = items.filter(Boolean) as Artifact[];
        if (valid.length && !cancelled) setArtifacts((prev) => {
          const have = new Set(prev.map((a) => a.id));
          const add = valid.filter((v) => !have.has(v.id));
          return add.length ? [...prev, ...add].sort((a, b) => a.createdAt - b.createdAt) : prev;
        });
      } catch { /* ignore */ }
    };
    sync();
    const iv = setInterval(sync, 4000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  const active = useMemo(() => artifacts.find((a) => a.id === activeId) ?? null, [artifacts, activeId]);

  const send = useCallback(async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || streaming) return;
    setErr(null);
    voiceBaseRef.current = "";
    const next = [...msgs, { role: "user" as const, text }];
    setMsgs(next); setInput(""); setStreaming(true); setPartial("");
    const ctrl = new AbortController(); ctrlRef.current = ctrl;
    let acc = "", errMsg: string | null = null, tps: number | undefined;
    try {
      const r = await fetch("/api/local/chat", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: text, history: next.slice(0, -1).map((m) => ({ role: m.role, text: m.text })) }),
        signal: ctrl.signal,
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
              if (j.t === "d") { acc += j.c; setPartial(acc); }
              else if (j.t === "model") { if (j.model) setModelName(j.model); }
              else if (j.t === "stats") { tps = j.tps; setLastTps(j.tps); if (j.model) setModelName(j.model); }
              else if (j.t === "error") { errMsg = j.m; }
            } catch {}
          }
        }
      }
    } catch (e) { if ((e as Error).name !== "AbortError") errMsg = String(e); }

    if (acc.trim()) {
      const html = extractHtml(acc);
      let artifactId: string | undefined;
      if (html) {
        const art: Artifact = { id: newId(), title: titleFor(html, text), html, createdAt: Date.now(), prompt: text };
        artifactId = art.id;
        setArtifacts((a) => [...a, art]);
        setActiveId(art.id);
        setPreviewKey((k) => k + 1);
        setTab("preview"); // it just built something — show it off
      }
      setMsgs((m) => [...m, { role: "assistant", text: acc.trim(), tps, artifactId }]);
    }
    if (errMsg && !acc.trim()) setErr(errMsg);
    setPartial(""); setStreaming(false);
  }, [input, streaming, msgs]);

  function stop() { ctrlRef.current?.abort(); setStreaming(false); setPartial(""); }
  function clearChat() { if (confirm("Clear local chat history? (Workspace builds are kept.)")) { setMsgs([]); try { localStorage.removeItem(HISTORY_KEY); } catch {} } }

  // ---- voice ----
  const onTranscript = useCallback((t: string, opts: { final: boolean }) => {
    if (opts.final) {
      const committed = (voiceBaseRef.current ? voiceBaseRef.current + " " : "") + t;
      voiceBaseRef.current = committed;
      setInput(committed);
      if (handsFree && committed.trim().length > 1) { setInput(""); send(committed); }
    } else {
      setInput((voiceBaseRef.current ? voiceBaseRef.current + " " : "") + t);
    }
  }, [handsFree, send]);

  // ---- artifact actions ----
  function openArtifact(a: Artifact) { setActiveId(a.id); setShowSource(false); setPreviewKey((k) => k + 1); setTab("preview"); }
  function blobUrl(a: Artifact) { return URL.createObjectURL(new Blob([a.html], { type: "text/html" })); }
  function download(a: Artifact) {
    const url = blobUrl(a); const el = document.createElement("a");
    el.href = url; el.download = (a.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "build") + ".html";
    el.click(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  function openTab(a: Artifact) { const url = blobUrl(a); window.open(url, "_blank"); setTimeout(() => URL.revokeObjectURL(url), 30000); }
  function delArtifact(id: string) {
    setArtifacts((a) => a.filter((x) => x.id !== id));
    if (activeId === id) setActiveId(null);
    syncedRef.current.delete(id);
    // also remove server-side (no-op for browser-only builds) so it doesn't re-sync back
    fetch(`/api/local/builds?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
  }

  const TABS: { id: Tab; label: string; icon: typeof Cpu; badge?: number }[] = [
    { id: "build", label: "Build", icon: MessageSquare },
    { id: "preview", label: "Preview", icon: Eye },
    { id: "workspace", label: "Workspace", icon: FolderOpen, badge: artifacts.length || undefined },
  ];

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* header */}
      <div className="flex items-center gap-3 mb-3 shrink-0">
        <div className="w-8 h-8 rounded-lg grid place-items-center text-[#06201b]" style={{ background: "linear-gradient(135deg,#5eead4,#0f9e88)" }}><Cpu size={17} /></div>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-[var(--cream)] leading-none flex items-center gap-2">Local <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: `${ACCENT}1e`, color: ACCENT, border: `1px solid ${ACCENT}40` }}><WifiOff size={9} /> offline</span></div>
          <div className="text-[10.5px] text-[var(--cream-mute)] mt-1 flex items-center gap-1.5">
            {modelName || "local model"} · 100% on your Mac · free
            {lastTps != null && <span className="inline-flex items-center gap-0.5" style={{ color: ACCENT }}><Zap size={10} /> {lastTps} tok/s</span>}
          </div>
        </div>
        {/* tabs */}
        <div className="ml-auto flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-mid)] border border-[var(--line-soft)]">
          {TABS.map((t) => {
            const on = tab === t.id; const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition"
                style={on ? { background: ACCENT, color: "#06201b" } : { color: "var(--cream-mute)" }}>
                <Icon size={13} /> {t.label}
                {t.badge != null && <span className="text-[9.5px] px-1 rounded-full" style={{ background: on ? "#06201b22" : `${ACCENT}1e`, color: on ? "#06201b" : ACCENT }}>{t.badge}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* ===================== BUILD ===================== */}
      {tab === "build" && (
        <div className="panel flex flex-col min-h-0 flex-1 p-0 overflow-hidden">
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto scroll p-4 space-y-4">
            {msgs.length === 0 && !streaming && (
              <div className="h-full grid place-items-center text-center">
                <div>
                  <Cpu size={24} style={{ color: ACCENT }} className="mx-auto mb-2 opacity-70" />
                  <div className="text-[13.5px] text-[var(--cream)]">Build with your voice — 100% local.</div>
                  <div className="text-[11.5px] text-[var(--cream-mute)] mt-1 max-w-[360px]">Hit the mic and say &ldquo;build me a neon landing page&rdquo; — it writes a full HTML doc and previews it live. Nothing leaves your Mac.</div>
                </div>
              </div>
            )}
            {msgs.map((m, i) => {
              const art = m.artifactId ? artifacts.find((a) => a.id === m.artifactId) : null;
              const prose = m.role === "assistant" ? stripHtml(m.text) : m.text;
              return (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className="max-w-[82%]">
                    {(prose || m.role === "user") && (
                      <div className="rounded-xl px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap"
                        style={m.role === "user"
                          ? { background: `${ACCENT}1a`, border: `1px solid ${ACCENT}40`, color: "var(--cream)" }
                          : { background: "var(--bg-card)", border: "1px solid var(--line-soft)", color: "var(--cream-soft)" }}>
                        {prose || "…"}
                      </div>
                    )}
                    {art && (
                      <button onClick={() => openArtifact(art)} className="mt-1.5 inline-flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-medium transition hover:brightness-110"
                        style={{ background: `${ACCENT}14`, border: `1px solid ${ACCENT}45`, color: ACCENT }}>
                        <Wand2 size={13} /> Built: {art.title} <span className="opacity-60">· open preview →</span>
                      </button>
                    )}
                    {m.role === "assistant" && m.tps != null && (
                      <div className="text-[10px] text-[var(--cream-mute)] mt-1 ml-1 inline-flex items-center gap-1"><Zap size={9} style={{ color: ACCENT }} /> {m.tps} tok/s · local</div>
                    )}
                  </div>
                </div>
              );
            })}
            {streaming && (
              <div className="flex justify-start">
                <div className="max-w-[82%] rounded-xl px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap" style={{ background: "var(--bg-card)", border: "1px solid var(--line-soft)", color: "var(--cream-soft)" }}>
                  {stripHtml(partial) || (partial ? <span className="inline-flex items-center gap-2 text-[var(--cream-mute)]"><Wand2 size={13} className="animate-pulse" style={{ color: ACCENT }} /> writing the build…</span> : <span className="inline-flex items-center gap-2 text-[var(--cream-mute)]"><Loader2 size={13} className="animate-spin" style={{ color: ACCENT }} /> thinking locally…</span>)}
                </div>
              </div>
            )}
            {err && <div className="text-[12px] text-[var(--plum)] bg-[rgba(196,96,126,0.08)] border border-[rgba(196,96,126,0.3)] rounded-lg px-3 py-2">{err}</div>}
          </div>

          {/* composer */}
          <div className="border-t border-[var(--line-soft)] p-3 shrink-0">
            {handsFree && <div className="text-[10.5px] mb-2 inline-flex items-center gap-1.5" style={{ color: ACCENT }}><Radio size={11} className="animate-pulse" /> Hands-free on — speak, and it sends when you pause.</div>}
            <div className="flex items-end gap-2">
              <VoiceButton onTranscript={onTranscript} size={40} className="shrink-0" />
              <button onClick={() => setHandsFree((v) => !v)} title="Hands-free: auto-send when you stop talking"
                className="shrink-0 grid place-items-center rounded-lg border h-10 w-10 transition"
                style={handsFree ? { borderColor: `${ACCENT}80`, background: `${ACCENT}1a`, color: ACCENT } : { borderColor: "var(--line-soft)", color: "var(--cream-mute)" }}>
                <Radio size={16} />
              </button>
              <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send(); }}
                placeholder="Speak or type — &ldquo;build a snake game&rdquo;, &ldquo;make a pricing page&rdquo;…  (⌘+Enter)"
                className="flex-1 resize-none bg-[var(--bg-mid)] border border-[var(--line-soft)] rounded-xl px-3 py-2 text-[13.5px] text-[var(--cream)] placeholder:text-[var(--cream-mute)] focus:outline-none" />
              {streaming
                ? <button onClick={stop} className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-[13px] font-semibold bg-rose-500/20 border border-rose-400/40 text-rose-300"><Square size={14} /> Stop</button>
                : <button onClick={() => send()} disabled={!input.trim()} className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-[13px] font-semibold disabled:opacity-40" style={{ background: ACCENT, color: "#06201b" }}><Send size={14} /> Send</button>}
              {msgs.length > 0 && <button onClick={clearChat} title="Clear chat history" className="p-2.5 rounded-xl text-[var(--cream-mute)] hover:text-[var(--plum)] border border-[var(--line-soft)]"><Trash2 size={14} /></button>}
            </div>
          </div>
        </div>
      )}

      {/* ===================== PREVIEW ===================== */}
      {tab === "preview" && (
        <div className="panel flex flex-col min-h-0 flex-1 p-0 overflow-hidden">
          {active ? (
            <>
              <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--line-soft)] shrink-0">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: ACCENT, boxShadow: `0 0 8px ${ACCENT}` }} />
                <span className="text-[12.5px] text-[var(--cream)] font-medium truncate">{active.title}</span>
                <span className="text-[10px] text-[var(--cream-mute)] shrink-0">{(active.html.length / 1024).toFixed(1)} KB · local</span>
                <div className="ml-auto flex items-center gap-1 shrink-0">
                  <button onClick={() => setShowSource((v) => !v)} title="Toggle source" className="px-2 py-1.5 rounded-lg text-[11px] inline-flex items-center gap-1 border" style={showSource ? { borderColor: `${ACCENT}70`, color: ACCENT, background: `${ACCENT}12` } : { borderColor: "var(--line-soft)", color: "var(--cream-mute)" }}><Code2 size={12} /> Source</button>
                  <button onClick={() => setPreviewKey((k) => k + 1)} title="Reload" className="p-1.5 rounded-lg border border-[var(--line-soft)] text-[var(--cream-mute)] hover:text-[var(--cream)]"><RotateCw size={13} /></button>
                  <button onClick={() => openTab(active)} title="Open in new tab" className="p-1.5 rounded-lg border border-[var(--line-soft)] text-[var(--cream-mute)] hover:text-[var(--cream)]"><ExternalLink size={13} /></button>
                  <button onClick={() => download(active)} title="Download .html" className="p-1.5 rounded-lg border border-[var(--line-soft)] text-[var(--cream-mute)] hover:text-[var(--cream)]"><Download size={13} /></button>
                </div>
              </div>
              {showSource ? (
                <pre className="flex-1 min-h-0 overflow-auto scroll p-4 text-[11.5px] leading-relaxed text-[var(--cream-soft)] mono whitespace-pre-wrap">{active.html}</pre>
              ) : (
                <iframe key={previewKey} title="local-preview" srcDoc={active.html}
                  sandbox="allow-scripts allow-same-origin allow-popups allow-modals allow-forms allow-pointer-lock"
                  className="flex-1 min-h-0 w-full bg-white" />
              )}
            </>
          ) : (
            <div className="h-full grid place-items-center text-center p-6">
              <div>
                <Eye size={24} style={{ color: ACCENT }} className="mx-auto mb-2 opacity-70" />
                <div className="text-[13.5px] text-[var(--cream)]">Nothing built yet.</div>
                <div className="text-[11.5px] text-[var(--cream-mute)] mt-1 max-w-[320px]">Go to Build and ask it to make something — &ldquo;build a glowing countdown timer&rdquo; — and it&rsquo;ll render right here.</div>
                <button onClick={() => setTab("build")} className="mt-3 px-3.5 py-2 rounded-xl text-[12.5px] font-semibold" style={{ background: ACCENT, color: "#06201b" }}>Go build something</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================== WORKSPACE ===================== */}
      {tab === "workspace" && (
        <div className="panel flex flex-col min-h-0 flex-1 p-0 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--line-soft)] shrink-0">
            <FolderOpen size={14} style={{ color: ACCENT }} />
            <span className="text-[12.5px] text-[var(--cream)] font-medium">Workspace</span>
            <span className="text-[10.5px] text-[var(--cream-mute)]">{artifacts.length} build{artifacts.length === 1 ? "" : "s"} · saved on your Mac</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto scroll p-3 space-y-2">
            {artifacts.length === 0 && (
              <div className="h-full grid place-items-center text-center">
                <div className="text-[11.5px] text-[var(--cream-mute)] max-w-[320px]">Every page, game or demo it builds shows up here — open, view source, or download the .html. All on your machine.</div>
              </div>
            )}
            {[...artifacts].reverse().map((a) => (
              <div key={a.id} className={`rounded-xl p-3 border transition ${a.id === activeId ? "" : "hover:border-[var(--line)]"}`}
                style={{ background: "var(--bg-card)", borderColor: a.id === activeId ? `${ACCENT}55` : "var(--line-soft)" }}>
                <div className="flex items-center gap-2">
                  <Wand2 size={13} style={{ color: ACCENT }} className="shrink-0" />
                  <span className="text-[13px] text-[var(--cream)] font-medium truncate">{a.title}</span>
                  <span className="text-[10px] text-[var(--cream-mute)] shrink-0 ml-auto">{(a.html.length / 1024).toFixed(1)} KB</span>
                </div>
                <div className="text-[11px] text-[var(--cream-mute)] mt-1 truncate">{a.prompt}</div>
                <div className="flex items-center gap-1.5 mt-2.5">
                  <button onClick={() => openArtifact(a)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold" style={{ background: ACCENT, color: "#06201b" }}><Eye size={12} /> Open</button>
                  <button onClick={() => openTab(a)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] border border-[var(--line-soft)] text-[var(--cream-mute)] hover:text-[var(--cream)]"><ExternalLink size={12} /> Tab</button>
                  <button onClick={() => download(a)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] border border-[var(--line-soft)] text-[var(--cream-mute)] hover:text-[var(--cream)]"><Download size={12} /> .html</button>
                  <button onClick={() => delArtifact(a.id)} title="Delete" className="ml-auto p-1.5 rounded-lg text-[var(--cream-mute)] hover:text-[var(--plum)] border border-[var(--line-soft)]"><Trash2 size={12} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

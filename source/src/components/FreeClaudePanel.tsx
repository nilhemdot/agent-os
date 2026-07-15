"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, Square, ExternalLink, Trash2, MessageSquare, Layers,
  RefreshCw, FolderOpen, FileText, Copy, Download, X, Eye, FilePlus,
} from "lucide-react";
import Panel from "./Panel";

type Tab = "chat" | "workspace";

interface Msg { role: "user" | "assistant" | "system"; text: string; }
interface FccStatus { enabled: boolean; reachable: boolean; model: string | null; provider: string | null; }
interface FccProject { name: string; root: string; mtime: number; fileCount: number; }
type FccFileKind = "text" | "image" | "video" | "audio" | "pdf" | "binary";
interface FccFile { name: string; relPath: string; bytes: number; mtime: number; kind: FccFileKind; }

const ACCENT = "#10b981";
const STORAGE_KEY = "agentic-os/freeclaude/history/v1";
const ACTIVE_PROJECT_KEY = "agentic-os/freeclaude/active-project/v1";

function fmtAgo(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

// ─────────────────────────────────────────────────────────────────────────
// Free Claude Code — tabbed agent surface (Chat + Workspace).
//
// Chat tab    → existing /api/freeclaude/chat behaviour. Now ALSO sends an
//               `project` field so anything claude writes lands in a known
//               scratch dir we can browse.
// Workspace   → mirrors Antigravity / Codex workspace browsers. HTML pages
//               get the Preview/Source toggle, images / videos / audio /
//               PDFs render inline. Perfect for previewing landing pages
//               you ask FCC to build, plus HyperFrames renders (.mp4/.webm).
// ─────────────────────────────────────────────────────────────────────────
export default function FreeClaudePanel() {
  const [tab, setTab] = useState<Tab>("chat");

  // ───── Chat state ─────
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [partial, setPartial] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [fcc, setFcc] = useState<FccStatus | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Active project — every chat lands here, and the Workspace tab opens to it.
  const [activeProject, setActiveProject] = useState<string>("freeclaude-default");

  // ───── Workspace state ─────
  const [projects, setProjects] = useState<FccProject[]>([]);
  const [selected, setSelected] = useState<FccProject | null>(null);
  const [files, setFiles] = useState<FccFile[]>([]);
  const [open, setOpen] = useState<{ path: string; content: string; bytes: number; truncated: boolean; kind: FccFileKind } | null>(null);
  const [htmlMode, setHtmlMode] = useState<"source" | "preview">("preview");
  const [newProjectName, setNewProjectName] = useState("");

  // ── Restore persisted state on mount ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setMsgs(JSON.parse(raw).slice(-200));
    } catch {}
    try {
      const p = window.localStorage.getItem(ACTIVE_PROJECT_KEY);
      if (p) setActiveProject(p);
    } catch {}
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-200))); } catch {}
  }, [msgs]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(ACTIVE_PROJECT_KEY, activeProject); } catch {}
  }, [activeProject]);

  // ── fcc-server status poll ──
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/fcc", { cache: "no-store" });
        if (!stop && r.ok) setFcc(await r.json());
      } catch {}
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  // ── Auto-scroll chat to bottom ──
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, partial]);

  // ── Elapsed counter while streaming ──
  useEffect(() => {
    if (!streaming) { setElapsed(0); return; }
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 250);
    return () => clearInterval(t);
  }, [streaming]);

  // ── Workspace data loaders ──
  async function refreshProjects() {
    try {
      const r = await fetch("/api/freeclaude/workspace", { cache: "no-store" });
      const j = await r.json();
      setProjects(Array.isArray(j.projects) ? j.projects : []);
    } catch {}
  }
  useEffect(() => { refreshProjects(); }, []);
  // Re-poll while user is on the workspace tab — claude may be writing files mid-task
  useEffect(() => {
    if (tab !== "workspace") return;
    const t = setInterval(refreshProjects, 4000);
    return () => clearInterval(t);
  }, [tab]);

  async function selectProject(p: FccProject) {
    setSelected(p); setOpen(null);
    try {
      const r = await fetch(`/api/freeclaude/workspace?project=${encodeURIComponent(p.name)}`, { cache: "no-store" });
      const j = await r.json();
      setFiles(j.files ?? []);
    } catch { setFiles([]); }
  }
  async function loadFile(f: FccFile) {
    if (!selected) return;
    if (f.kind !== "text") {
      setOpen({ path: f.relPath, content: "", bytes: f.bytes, truncated: false, kind: f.kind });
      return;
    }
    try {
      const r = await fetch(`/api/freeclaude/workspace/file?project=${encodeURIComponent(selected.name)}&path=${encodeURIComponent(f.relPath)}`, { cache: "no-store" });
      const j = await r.json();
      if (j.content !== undefined) setOpen({ path: f.relPath, content: j.content, bytes: j.bytes, truncated: j.truncated, kind: "text" });
    } catch {}
  }
  function rawUrl(relPath: string): string {
    if (!selected) return "";
    const segs = relPath.split("/").map(encodeURIComponent).join("/");
    return `/api/freeclaude/preview/${encodeURIComponent(selected.name)}/${segs}`;
  }

  async function createProject() {
    const name = newProjectName.trim();
    if (!name) return;
    setNewProjectName("");
    try {
      const r = await fetch("/api/freeclaude/workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const j = await r.json();
      if (j.name) {
        setActiveProject(j.name);
        await refreshProjects();
      }
    } catch {}
  }

  async function send() {
    const prompt = input.trim();
    if (!prompt || streaming) return;
    const history = msgs;
    setMsgs((m) => [...m, { role: "user", text: prompt }]);
    setInput("");
    setPartial("");
    setStreaming(true);

    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    let acc = "";
    let sawDeltas = false;

    try {
      const r = await fetch("/api/freeclaude/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, history, project: activeProject }),
        signal: ctrl.signal,
      });
      if (!r.ok && r.status === 503) {
        const errBody = await r.text();
        try { const j = JSON.parse(errBody.trim()); acc = j.message ?? errBody; }
        catch { acc = errBody; }
      } else if (!r.body) {
        throw new Error("no body");
      } else {
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
                sawDeltas = true; acc += evt.event.delta.text; setPartial(acc);
              } else if (evt.type === "assistant" && evt.message?.content && !sawDeltas) {
                let full = "";
                for (const part of evt.message.content) {
                  if (part.type === "text" && typeof part.text === "string") full += part.text;
                }
                if (full) { acc = full; setPartial(acc); }
              } else if (evt.type === "result" && typeof evt.result === "string" && !acc) {
                acc = evt.result; setPartial(acc);
              } else if (evt.type === "error" && evt.message) {
                acc += `\n[error: ${evt.message}]`;
              }
            } catch { /* skip non-JSON */ }
          }
        }
      }
    } catch (e) {
      acc += `\n\n[error: ${String(e)}]`;
    }

    setMsgs((m) => [...m, { role: "assistant", text: acc || "(no output)" }]);
    setPartial("");
    setStreaming(false);
    // Once a turn lands, refresh projects in case claude wrote new files
    refreshProjects();
  }

  function stop() {
    ctrlRef.current?.abort();
    setStreaming(false);
  }
  function clearHistory() {
    if (streaming) return;
    setMsgs([]); setPartial("");
    if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
  }

  // ── Tabs (in same shape as CodexView) ──
  const modelShort = fcc?.model ? fcc.model.split("/").slice(-1)[0] : "—";
  const reachable = fcc?.reachable ?? false;

  const tabs: { key: Tab; label: string; icon: React.ReactNode; count?: number }[] = useMemo(() => [
    { key: "chat",      label: "Chat",      icon: <MessageSquare size={12} /> },
    { key: "workspace", label: "Workspace", icon: <Layers size={12} />, count: projects.length || undefined },
  ], [projects]);

  return (
    <Panel
      title="Free Claude Code — Open-source proxy"
      accent="system"
      icon={
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none">
          <circle cx="9" cy="11" r="3" fill="#10b981" />
          <circle cx="15" cy="11" r="3" fill="#10b981" />
          <circle cx="9" cy="11" r="1" fill="#065f46" />
          <circle cx="15" cy="11" r="1" fill="#065f46" />
        </svg>
      }
      actions={
        <div className="flex items-center gap-2">
          <span className={`pill ${reachable ? "pill-info" : ""}`}
                style={reachable ? { background: "rgba(16,185,129,0.18)", borderColor: "rgba(16,185,129,0.4)", color: "#34d399" } : {}}>
            {reachable ? "live" : "offline"}
          </span>
          {fcc?.model && (
            <span className="pill pill-info">{modelShort} · {fcc.provider}</span>
          )}
          <span className="pill" title="Active scratch project — anything claude writes lands here"
                style={{ background: `${ACCENT}18`, borderColor: `${ACCENT}40`, color: ACCENT }}>
            <FolderOpen size={10} className="inline mr-1" />{activeProject}
          </span>
          {tab === "chat" && msgs.length > 0 && !streaming && (
            <button onClick={clearHistory} title="Clear conversation history"
              className="text-[11px] flex items-center gap-1 px-2 py-1 rounded-md text-[var(--fg-dimmer)] hover:text-[var(--fg-dim)] hover:bg-[rgba(255,255,255,0.04)] transition">
              <Trash2 size={11} /> clear
            </button>
          )}
        </div>
      }
      className="flex-1 min-h-[640px]"
    >
      <div className="flex flex-col h-full min-h-0">
        {/* Tab bar */}
        <div className="flex gap-2 mb-3">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border transition text-[11px] uppercase tracking-[0.18em]"
              style={{
                borderColor: tab === t.key ? ACCENT : "var(--line-soft)",
                background: tab === t.key ? `${ACCENT}1e` : "transparent",
                color: tab === t.key ? ACCENT : "var(--cream-dim)",
                fontFamily: "'Manrope', sans-serif", fontWeight: 600,
              }}>
              {t.icon}{t.label}
              {t.count !== undefined && (
                <span className="hand text-[1.05rem] ml-1" style={{ color: ACCENT }}>{t.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* ─── CHAT TAB ─── */}
        {tab === "chat" && (
          <div className="flex flex-col h-full min-h-0">
            <div ref={scrollRef} className="scroll flex-1 min-h-0 overflow-y-auto space-y-3 pr-2">
              <AnimatePresence initial={false}>
                {msgs.length === 0 && !streaming && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="text-[var(--fg-dim)] text-sm leading-relaxed">
                    <p className="text-base text-[var(--fg)]">Free Claude Code</p>
                    <p className="mt-2">
                      Same Claude Code CLI — every request routed through the local
                      <code className="mx-1 text-[var(--fg)]">fcc-server</code> proxy to a free
                      or cheap upstream. Currently routed to{" "}
                      <span className="text-emerald-300 font-medium">{modelShort}</span>
                      {fcc?.provider && <> on <span className="text-emerald-300">{fcc.provider}</span></>}.
                    </p>
                    <ul className="mt-3 text-xs text-[var(--fg-dimmer)] space-y-1">
                      <li>• Working directory: <code className="text-[var(--fg-dim)]">~/freeclaude-scratch/{activeProject}/</code></li>
                      <li>• Anything claude writes lands there → preview it in the <strong>Workspace</strong> tab</li>
                      <li>• HTML pages render live, images / videos / audio play inline, PDFs embed</li>
                      <li>• HyperFrames renders (.mp4 / .webm) play in the browser</li>
                      <li>• <kbd className="text-[10px] px-1 border border-[var(--panel-border)] rounded">Esc</kbd> aborts an in-flight call</li>
                    </ul>
                    {!reachable && (
                      <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-200">
                        <div className="text-xs font-medium flex items-center gap-1.5"><ExternalLink size={12} /> fcc-server isn&apos;t running</div>
                        <div className="text-[11px] mt-1 text-amber-200/80">
                          Start it from a terminal with <code>fcc-server</code>, then come back.
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}
                {msgs.map((m, i) => (
                  <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                    className={`rounded-xl px-4 py-3 text-sm leading-relaxed border ${
                      m.role === "user"
                        ? "bg-[rgba(16,185,129,0.08)] border-[rgba(16,185,129,0.22)] text-[var(--fg)]"
                        : "bg-[rgba(255,255,255,0.02)] border-[rgba(255,255,255,0.06)] text-[var(--fg)]"
                    }`}>
                    <div className="text-[10px] tracking-widest uppercase mb-1 opacity-60">
                      {m.role === "user" ? "you" : "free claude code"}
                    </div>
                    <div className="whitespace-pre-wrap font-[var(--font-geist-mono)]">{m.text}</div>
                  </motion.div>
                ))}
                {streaming && (
                  <motion.div key="partial" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="rounded-xl px-4 py-3 text-sm leading-relaxed border bg-[rgba(255,255,255,0.02)] border-[rgba(255,255,255,0.06)]">
                    <div className="text-[10px] tracking-widest uppercase mb-1 opacity-60 flex items-center gap-2">
                      free claude code
                      <span className="inline-flex">
                        <span className="tick live" style={{ color: ACCENT }} />
                        <span className="tick live" style={{ color: ACCENT, animationDelay: ".2s" }} />
                        <span className="tick live" style={{ color: ACCENT, animationDelay: ".4s" }} />
                      </span>
                      <span className="text-emerald-400/70 normal-case tracking-normal metric">{elapsed}s</span>
                    </div>
                    <div className="whitespace-pre-wrap font-[var(--font-geist-mono)]">{partial || (elapsed < 5 ? "thinking…" : `thinking… (${modelShort} can take 30-90s)`)}</div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="mt-4 panel border border-[var(--panel-border)] flex items-end gap-2 p-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
                  if (e.key === "Escape" && streaming) stop();
                }}
                rows={2}
                placeholder={reachable ? `Ask via ${modelShort}…  (⌘+Enter to send)` : "fcc-server offline — start it with `fcc-server` first"}
                className="flex-1 bg-transparent outline-none resize-none px-3 py-2 text-sm text-[var(--fg)] placeholder:text-[var(--fg-dimmer)]"
              />
              {streaming ? (
                <button onClick={stop}
                  className="px-3 py-2 rounded-lg bg-[rgba(248,113,113,0.15)] border border-[rgba(248,113,113,0.4)] text-rose-300 text-sm flex items-center gap-1.5 hover:bg-[rgba(248,113,113,0.22)] transition">
                  <Square size={14} /> Stop
                </button>
              ) : (
                <button onClick={send} disabled={!input.trim() || !reachable}
                  className="px-3 py-2 rounded-lg bg-[rgba(16,185,129,0.18)] border border-[rgba(16,185,129,0.4)] text-emerald-300 text-sm flex items-center gap-1.5 hover:bg-[rgba(16,185,129,0.28)] transition disabled:opacity-40 disabled:cursor-not-allowed">
                  <Send size={14} /> Send
                </button>
              )}
            </div>
          </div>
        )}

        {/* ─── WORKSPACE TAB ─── */}
        {tab === "workspace" && (
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-0 h-full min-h-0 border rounded-md overflow-hidden"
               style={{ borderColor: "var(--line-soft)" }}>
            <aside className="border-r p-3 space-y-2 overflow-y-auto scroll" style={{ borderColor: "var(--line-soft)" }}>
              <div className="flex items-center justify-between mb-1">
                <div className="action-tag" style={{ color: ACCENT }}>
                  <FolderOpen size={11} className="inline mr-1" /> Projects · {projects.length}
                </div>
                <button onClick={refreshProjects} className="text-[var(--cream-mute)] hover:text-[var(--cream-dim)]">
                  <RefreshCw size={11} />
                </button>
              </div>
              <div className="text-[10.5px] leading-relaxed mb-2" style={{ color: "var(--cream-mute)" }}>
                Anything claude writes during a chat lands in <code className="mono">~/freeclaude-scratch/&lt;project&gt;/</code>.
                Click a file → preview inline.
              </div>

              {/* New project quick-create */}
              <div className="flex items-center gap-1.5 p-2 rounded-md border" style={{ borderColor: "var(--line-soft)" }}>
                <input
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") createProject(); }}
                  placeholder="new-project-name"
                  className="flex-1 bg-transparent outline-none text-[11px] mono"
                  style={{ color: "var(--cream)" }} />
                <button onClick={createProject} disabled={!newProjectName.trim()}
                  className="px-2 py-1 rounded-md text-[10px] uppercase tracking-widest disabled:opacity-40 transition"
                  style={{ background: `${ACCENT}28`, border: `1px solid ${ACCENT}66`, color: ACCENT }}>
                  <FilePlus size={10} className="inline mr-0.5" /> Add
                </button>
              </div>

              {projects.length === 0 && (
                <div className="text-[11px] text-[var(--cream-mute)] italic p-2">
                  No projects yet. Send a prompt in Chat — claude will write to the active project, then it&apos;ll appear here.
                </div>
              )}
              {projects.map((p) => (
                // div, not button — inner "Set active" button can't be a child
                // of an outer <button> (hydration error).
                <div key={p.name}
                  role="button"
                  tabIndex={0}
                  onClick={() => selectProject(p)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectProject(p); } }}
                  className="block w-full text-left p-3 rounded-md border transition cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--cream-mute)]"
                  style={{
                    borderColor: selected?.name === p.name ? `${ACCENT}66` : "var(--line-soft)",
                    background: selected?.name === p.name ? `${ACCENT}10` : "transparent",
                  }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] text-[var(--cream)] truncate">{p.name}</span>
                    {activeProject === p.name && (
                      <span className="text-[9px] uppercase tracking-widest shrink-0" style={{ color: ACCENT }}>active</span>
                    )}
                  </div>
                  <div className="text-[10px] text-[var(--cream-mute)] mono mt-0.5">
                    {p.fileCount} files · {fmtAgo(p.mtime)}
                  </div>
                  {activeProject !== p.name && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setActiveProject(p.name); }}
                      className="mt-2 text-[10px] uppercase tracking-widest hover:underline"
                      style={{ color: "var(--cream-mute)" }}>
                      Set active →
                    </button>
                  )}
                </div>
              ))}
            </aside>

            <main className="flex flex-col min-h-0 overflow-hidden">
              {!selected ? (
                <div className="p-6 text-[var(--cream-mute)] text-sm">
                  Pick a project on the left, or ask claude in the Chat tab to build something.
                </div>
              ) : (
                <>
                  <div className="px-4 py-2.5 border-b flex items-center justify-between" style={{ borderColor: "var(--line-soft)" }}>
                    <div className="min-w-0">
                      <div className="text-[13px] text-[var(--cream)] truncate">{selected.name}</div>
                      <div className="text-[10.5px] text-[var(--cream-mute)] mono truncate">{selected.root}</div>
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto scroll p-2 space-y-0.5">
                    {files.length === 0 && (
                      <div className="text-[11px] text-[var(--cream-mute)] italic p-3">
                        Empty project. Pick this as active and ask claude to write something here.
                      </div>
                    )}
                    {files.map((f) => (
                      <button key={f.relPath} onClick={() => loadFile(f)}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-md text-left transition hover:bg-[rgba(255,255,255,0.02)]"
                        style={{ background: open?.path === f.relPath ? `${ACCENT}10` : "transparent" }}>
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText size={11} style={{ color: ACCENT }} />
                          <span className="text-[12px] mono truncate" style={{ color: "var(--cream)" }}>{f.relPath}</span>
                          <span className="text-[10px] uppercase tracking-widest ml-1" style={{ color: "var(--cream-mute)" }}>{f.kind}</span>
                        </div>
                        <div className="text-[10px] mono shrink-0 ml-2" style={{ color: "var(--cream-mute)" }}>
                          {(f.bytes / 1024).toFixed(1)}KB · {fmtAgo(f.mtime)}
                        </div>
                      </button>
                    ))}
                  </div>
                  <AnimatePresence>
                    {open && (
                      <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        className="border-t" style={{ borderColor: `${ACCENT}30` }}>
                        <div className="flex items-center justify-between px-3 py-2 border-b"
                          style={{ borderColor: `${ACCENT}30`, background: `${ACCENT}0c` }}>
                          <div className="flex items-center gap-1.5 text-[11px] mono truncate" style={{ color: ACCENT }}>
                            <FileText size={11} /><span className="truncate">{open.path}</span>
                            <span className="ml-2 text-[10px] uppercase tracking-widest text-[var(--cream-mute)]">{open.kind}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {/\.html?$/.test(open.path) && (
                              <>
                                <div className="flex items-center rounded-md overflow-hidden border" style={{ borderColor: `${ACCENT}40` }}>
                                  <button onClick={() => setHtmlMode("preview")}
                                    className="text-[10px] uppercase tracking-widest px-2 py-1 transition"
                                    style={{
                                      background: htmlMode === "preview" ? `${ACCENT}28` : "transparent",
                                      color: htmlMode === "preview" ? ACCENT : "var(--cream-dim)",
                                    }}>
                                    <Eye size={10} className="inline mr-1" />Preview
                                  </button>
                                  <button onClick={() => setHtmlMode("source")}
                                    className="text-[10px] uppercase tracking-widest px-2 py-1 transition"
                                    style={{
                                      background: htmlMode === "source" ? `${ACCENT}28` : "transparent",
                                      color: htmlMode === "source" ? ACCENT : "var(--cream-dim)",
                                    }}>
                                    <FileText size={10} className="inline mr-1" />Source
                                  </button>
                                </div>
                                <a href={rawUrl(open.path)} target="_blank" rel="noopener noreferrer"
                                  className="text-[var(--cream-dim)] hover:text-[var(--cream)] flex items-center gap-1 text-[10px] uppercase tracking-widest">
                                  <ExternalLink size={10} /> New tab
                                </a>
                              </>
                            )}
                            {open.kind === "text" && (
                              <button onClick={() => navigator.clipboard?.writeText(open.content)}
                                className="text-[var(--cream-dim)] hover:text-[var(--cream)] flex items-center gap-1 text-[10px] uppercase tracking-widest">
                                <Copy size={10} /> Copy
                              </button>
                            )}
                            <a href={rawUrl(open.path)} download={open.path.split("/").pop()}
                              className="text-[var(--cream-dim)] hover:text-[var(--cream)] flex items-center gap-1 text-[10px] uppercase tracking-widest">
                              <Download size={10} /> Save
                            </a>
                            <button onClick={() => setOpen(null)} className="text-[var(--cream-dim)] hover:text-[var(--cream)]"><X size={12}/></button>
                          </div>
                        </div>
                        {open.kind === "text" && (() => {
                          const isHtml = /\.html?$/.test(open.path);
                          if (isHtml && htmlMode === "preview") {
                            return <iframe src={rawUrl(open.path)} title={open.path} className="w-full h-[540px] bg-white" sandbox="allow-scripts allow-forms allow-popups allow-modals" />;
                          }
                          return (
                            <pre className="scroll p-3 text-[12px] leading-relaxed text-[var(--cream)] whitespace-pre-wrap font-[var(--font-geist-mono)] max-h-[460px] overflow-auto">
                              {open.content}
                            </pre>
                          );
                        })()}
                        {open.kind === "image" && (
                          <a href={rawUrl(open.path)} target="_blank" rel="noopener noreferrer" className="block bg-[rgba(0,0,0,0.6)]">
                            <img src={rawUrl(open.path)} alt={open.path} className="w-full max-h-[540px] object-contain" />
                          </a>
                        )}
                        {open.kind === "video" && (
                          <video src={rawUrl(open.path)} controls preload="metadata" className="w-full max-h-[540px] bg-black" />
                        )}
                        {open.kind === "audio" && (
                          <div className="p-3 bg-[rgba(0,0,0,0.6)]">
                            <audio src={rawUrl(open.path)} controls className="w-full" />
                          </div>
                        )}
                        {open.kind === "pdf" && (
                          <iframe src={rawUrl(open.path)} title={open.path} className="w-full h-[540px] bg-white" />
                        )}
                        {open.kind === "binary" && (
                          <div className="p-4 text-[12px] text-[var(--cream-soft)]">
                            Binary file — <a href={rawUrl(open.path)} download={open.path.split("/").pop()} style={{ color: ACCENT }} className="hover:underline">download to view</a>.
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              )}
            </main>
          </div>
        )}
      </div>
    </Panel>
  );
}

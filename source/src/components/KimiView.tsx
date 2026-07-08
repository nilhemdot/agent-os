"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MessageSquare, Layers, Send, Square, Trash2, RefreshCw, FolderTree,
  ExternalLink, Loader2, Sparkles, FileCode, Zap,
} from "lucide-react";

const ACCENT = "#00CCFF"; // Kimi cyan
const HISTORY_KEY = "agentic-os/kimi/history/v1";
const MODE_KEY = "agentic-os/kimi/mode/v1";
const CHAT_PROJECT = "kimi-default"; // chat writes here; the Workspace tab browses all projects

// Speed modes → Kimi CLI model aliases (defined in ~/.kimi-code/config.toml).
// Passed to /api/kimi/chat as `model` → `kimi -p … --model <alias>`.
type Mode = "quality" | "fast" | "nothink";
const MODES: { k: Mode; label: string; model: string; hint: string }[] = [
  { k: "quality", label: "Quality",  model: "kimi-code/kimi-for-coding",     hint: "K2.7 Code — best output, full reasoning" },
  { k: "fast",    label: "Fast",     model: "kimi-code/highspeed",           hint: "HighSpeed model — ~1.4× faster, still reasons" },
  { k: "nothink", label: "No-think", model: "kimi-code/highspeed-nothink",   hint: "HighSpeed, reasoning channel off — terse, direct answers" },
];

type Tab = "chat" | "workspace";
interface Msg { role: "user" | "assistant"; text: string; }
interface WsProject { name: string; root: string; mtime: number; fileCount: number; }
interface WsFile { name: string; relPath: string; bytes: number; mtime: number; isText: boolean; kind: string; }

function fmtAgo(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function KimiView() {
  const [tab, setTab] = useState<Tab>("chat");

  // ── chat ──
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("fast");
  const [streaming, setStreaming] = useState(false);
  const [partial, setPartial] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    try { const raw = localStorage.getItem(HISTORY_KEY); if (raw) setMsgs(JSON.parse(raw).slice(-200)); } catch {}
    try { const m = localStorage.getItem(MODE_KEY); if (m === "quality" || m === "fast" || m === "nothink") setMode(m); } catch {}
    hydrated.current = true;
  }, []);
  useEffect(() => { if (hydrated.current) try { localStorage.setItem(HISTORY_KEY, JSON.stringify(msgs.slice(-200))); } catch {} }, [msgs]);
  useEffect(() => { if (hydrated.current) try { localStorage.setItem(MODE_KEY, mode); } catch {} }, [mode]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [msgs, partial]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setErr(null);
    const next = [...msgs, { role: "user" as const, text }];
    setMsgs(next);
    setInput("");
    setStreaming(true);
    setPartial("");
    const ctrl = new AbortController(); ctrlRef.current = ctrl;
    let acc = "", errMsg: string | null = null;
    try {
      const r = await fetch("/api/kimi/chat", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: text, history: next.slice(0, -1).map(m => ({ role: m.role, text: m.text })), project: CHAT_PROJECT, model: MODES.find((x) => x.k === mode)?.model }),
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
              else if (j.t === "error") { errMsg = j.m; }
            } catch {}
          }
        }
      }
    } catch (e) { if ((e as Error).name !== "AbortError") errMsg = String(e); }
    if (acc.trim()) setMsgs((m) => [...m, { role: "assistant", text: acc.trim() }]);
    if (errMsg && !acc.trim()) setErr(errMsg);
    setPartial("");
    setStreaming(false);
  }, [input, streaming, msgs, mode]);

  function stop() { ctrlRef.current?.abort(); setStreaming(false); setPartial(""); }
  function clearChat() { if (confirm("Clear Kimi chat history?")) { setMsgs([]); try { localStorage.removeItem(HISTORY_KEY); } catch {} } }

  // ── workspace ──
  const [projects, setProjects] = useState<WsProject[]>([]);
  const [activeProject, setActiveProject] = useState<string>(CHAT_PROJECT);
  const [files, setFiles] = useState<WsFile[]>([]);
  const [openFile, setOpenFile] = useState<WsFile | null>(null);
  const [fileText, setFileText] = useState("");
  const [previewMode, setPreviewMode] = useState<"preview" | "source">("preview");

  const loadProjects = useCallback(async () => {
    try { const r = await fetch("/api/kimi/workspace", { cache: "no-store" }); const j = await r.json(); setProjects(j.projects ?? []); } catch {}
  }, []);
  const loadFiles = useCallback(async (project: string) => {
    try { const r = await fetch(`/api/kimi/workspace?project=${encodeURIComponent(project)}`, { cache: "no-store" }); const j = await r.json(); setFiles(j.files ?? []); } catch { setFiles([]); }
  }, []);
  useEffect(() => { if (tab === "workspace") loadProjects(); }, [tab, loadProjects]);
  useEffect(() => { if (tab === "workspace" && activeProject) loadFiles(activeProject); }, [tab, activeProject, loadFiles]);

  async function openFileInPane(f: WsFile) {
    setOpenFile(f); setPreviewMode(f.relPath.match(/\.html?$/i) ? "preview" : "source"); setFileText("");
    if (f.isText) {
      try { const r = await fetch(`/api/kimi/workspace/file?project=${encodeURIComponent(activeProject)}&path=${encodeURIComponent(f.relPath)}`, { cache: "no-store" }); const j = await r.json(); setFileText(j.content ?? ""); } catch {}
    }
  }
  const previewUrl = openFile
    ? `/api/kimi/preview/${encodeURIComponent(activeProject)}/${openFile.relPath.split("/").map(encodeURIComponent).join("/")}`
    : null;
  const isHtml = !!openFile && /\.html?$/i.test(openFile.relPath);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* header + tabs */}
      <div className="flex items-center gap-3 mb-3 shrink-0">
        <div className="w-8 h-8 rounded-lg grid place-items-center text-[#06222b] font-bold" style={{ background: `linear-gradient(135deg,#00CCFF,#0066AA)` }}>K</div>
        <div>
          <div className="text-[15px] font-semibold text-[var(--cream)] leading-none">Kimi Code</div>
          <div className="text-[10.5px] text-[var(--cream-mute)] mt-1">K2.7 Code · OAuth · single-shot chat + workspace</div>
        </div>
        <div className="ml-auto flex gap-1.5">
          {([{ k: "chat", label: "Chat", icon: <MessageSquare size={13} /> }, { k: "workspace", label: "Workspace", icon: <Layers size={13} /> }] as const).map((t) => (
            <button key={t.k} onClick={() => setTab(t.k)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border transition"
              style={{ borderColor: tab === t.k ? ACCENT : "var(--line-soft)", background: tab === t.k ? `${ACCENT}1e` : "transparent", color: tab === t.k ? ACCENT : "var(--cream-dim)" }}>
              {t.icon} {t.label}{t.k === "workspace" && projects.length ? ` · ${projects.length}` : ""}
            </button>
          ))}
        </div>
      </div>

      {/* ── CHAT ── */}
      {tab === "chat" && (
        <div className="panel flex flex-col min-h-0 flex-1 p-0 overflow-hidden">
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto scroll p-4 space-y-4">
            {msgs.length === 0 && !streaming && (
              <div className="h-full grid place-items-center text-center">
                <div>
                  <Sparkles size={24} style={{ color: ACCENT }} className="mx-auto mb-2 opacity-70" />
                  <div className="text-[13.5px] text-[var(--cream)]">Chat with Kimi K2.7.</div>
                  <div className="text-[11.5px] text-[var(--cream-mute)] mt-1">Every send runs <code className="mono">kimi -p … --output-format stream-json</code>. Files it writes land in your Workspace.</div>
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className="max-w-[82%] rounded-xl px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap"
                  style={m.role === "user"
                    ? { background: `${ACCENT}1a`, border: `1px solid ${ACCENT}40`, color: "var(--cream)" }
                    : { background: "var(--bg-card)", border: "1px solid var(--line-soft)", color: "var(--cream-soft)" }}>
                  {m.text}
                </div>
              </div>
            ))}
            {streaming && (
              <div className="flex justify-start">
                <div className="max-w-[82%] rounded-xl px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap" style={{ background: "var(--bg-card)", border: "1px solid var(--line-soft)", color: "var(--cream-soft)" }}>
                  {partial || <span className="inline-flex items-center gap-2 text-[var(--cream-mute)]"><Loader2 size={13} className="animate-spin" style={{ color: ACCENT }} /> Kimi is thinking…</span>}
                </div>
              </div>
            )}
            {err && <div className="text-[12px] text-[var(--plum)] bg-[rgba(196,96,126,0.08)] border border-[rgba(196,96,126,0.3)] rounded-lg px-3 py-2">{err}</div>}
          </div>
          <div className="border-t border-[var(--line-soft)] p-3 shrink-0">
            {/* speed-mode toggle — picks the Kimi CLI model alias per send */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[9.5px] uppercase tracking-[0.18em] text-[var(--cream-mute)] font-semibold">Speed</span>
              <div className="inline-flex rounded-lg overflow-hidden border border-[var(--line-soft)]">
                {MODES.map((m) => (
                  <button key={m.k} onClick={() => setMode(m.k)} title={m.hint}
                    className="text-[11px] px-2.5 py-1 transition inline-flex items-center gap-1 border-r border-[var(--line-soft)] last:border-r-0"
                    style={{ background: mode === m.k ? `${ACCENT}1e` : "transparent", color: mode === m.k ? ACCENT : "var(--cream-dim)" }}>
                    {m.k !== "quality" && <Zap size={10} />}{m.label}
                  </button>
                ))}
              </div>
              <span className="text-[10px] text-[var(--cream-mute)] truncate hidden md:inline">{MODES.find((m) => m.k === mode)?.hint}</span>
            </div>
            {/* input row */}
            <div className="flex items-end gap-2">
              <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send(); }}
                placeholder="Ask Kimi to build something, fix code, or answer a question…  (⌘+Enter to send)"
                className="flex-1 resize-none bg-[var(--bg-mid)] border border-[var(--line-soft)] rounded-xl px-3 py-2 text-[13.5px] text-[var(--cream)] placeholder:text-[var(--cream-mute)] focus:outline-none" />
              {streaming
                ? <button onClick={stop} className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-[13px] font-semibold bg-rose-500/20 border border-rose-400/40 text-rose-300"><Square size={14} /> Stop</button>
                : <button onClick={send} disabled={!input.trim()} className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-[13px] font-semibold disabled:opacity-40" style={{ background: ACCENT, color: "#06222b" }}><Send size={14} /> Send</button>}
              {msgs.length > 0 && <button onClick={clearChat} title="Clear history" className="p-2.5 rounded-xl text-[var(--cream-mute)] hover:text-[var(--plum)] border border-[var(--line-soft)]"><Trash2 size={14} /></button>}
            </div>
          </div>
        </div>
      )}

      {/* ── WORKSPACE ── */}
      {tab === "workspace" && (
        <div className="grid grid-cols-1 lg:grid-cols-[230px_250px_1fr] gap-3 flex-1 min-h-0">
          {/* projects */}
          <div className="panel p-2 flex flex-col min-h-0">
            <div className="flex items-center justify-between px-2 py-1.5">
              <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold flex items-center gap-1.5"><FolderTree size={12} /> Projects</div>
              <button onClick={loadProjects} className="text-[var(--cream-mute)] hover:text-[var(--cream)]"><RefreshCw size={12} /></button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto scroll space-y-1">
              {projects.length === 0 && <div className="text-[11px] text-[var(--cream-mute)] px-2.5 py-3">No projects yet. Chat with Kimi and ask it to build something — it lands here.</div>}
              {projects.map((p) => (
                <button key={p.name} onClick={() => { setActiveProject(p.name); setOpenFile(null); }}
                  className="block w-full text-left px-2.5 py-2 rounded-md border transition"
                  style={{ borderColor: activeProject === p.name ? `${ACCENT}66` : "var(--line-soft)", background: activeProject === p.name ? `${ACCENT}12` : "transparent" }}>
                  <div className="text-[12px] text-[var(--cream)] truncate font-medium">{p.name}</div>
                  <div className="text-[10px] text-[var(--cream-mute)] mono mt-0.5">{p.fileCount} files · {fmtAgo(p.mtime)}</div>
                </button>
              ))}
            </div>
          </div>
          {/* files */}
          <div className="panel p-2 flex flex-col min-h-0">
            <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold flex items-center gap-1.5 px-2 py-1.5"><FileCode size={12} /> {activeProject}</div>
            <div className="flex-1 min-h-0 overflow-y-auto scroll space-y-1">
              {files.length === 0 && <div className="text-[11px] text-[var(--cream-mute)] px-2.5 py-3">No files in this project yet.</div>}
              {files.map((f) => (
                <button key={f.relPath} onClick={() => openFileInPane(f)}
                  className="block w-full text-left px-2.5 py-1.5 rounded-md border transition"
                  style={{ borderColor: openFile?.relPath === f.relPath ? `${ACCENT}66` : "var(--line-soft)", background: openFile?.relPath === f.relPath ? `${ACCENT}12` : "transparent" }}>
                  <div className="text-[11.5px] text-[var(--cream)] truncate mono">{f.relPath}</div>
                </button>
              ))}
            </div>
          </div>
          {/* preview */}
          <div className="panel p-0 flex flex-col min-h-0 overflow-hidden">
            {!openFile ? (
              <div className="flex-1 grid place-items-center text-center p-6">
                <div>
                  <FolderTree size={22} style={{ color: ACCENT }} className="mx-auto mb-2 opacity-60" />
                  <div className="text-[12.5px] text-[var(--cream)]">Pick a file to preview</div>
                  <div className="text-[11px] text-[var(--cream-mute)]">HTML renders live · images + video play · code shows source</div>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--line-soft)]">
                  <div className="text-[12px] text-[var(--cream)] truncate mono">{openFile.relPath}</div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isHtml && (
                      <div className="flex rounded-md overflow-hidden border border-[var(--line-soft)]">
                        {(["preview", "source"] as const).map((m) => (
                          <button key={m} onClick={() => setPreviewMode(m)} className="text-[10px] uppercase tracking-widest px-2 py-1"
                            style={{ background: previewMode === m ? `${ACCENT}1a` : "transparent", color: previewMode === m ? ACCENT : "var(--cream-mute)" }}>{m}</button>
                        ))}
                      </div>
                    )}
                    {previewUrl && <a href={previewUrl} target="_blank" rel="noopener noreferrer" title="Open in new tab" className="text-[var(--cream-mute)] hover:text-[var(--cream)]"><ExternalLink size={13} /></a>}
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-auto bg-[#0a070d]">
                  {openFile.kind === "image" && previewUrl && <div className="grid place-items-center h-full p-4"><img src={previewUrl} alt={openFile.name} className="max-w-full max-h-full object-contain" /></div>}
                  {openFile.kind === "video" && previewUrl && <div className="grid place-items-center h-full p-4"><video src={previewUrl} controls className="max-w-full max-h-full" /></div>}
                  {openFile.kind === "audio" && previewUrl && <div className="grid place-items-center h-full p-6"><audio src={previewUrl} controls /></div>}
                  {isHtml && previewMode === "preview" && previewUrl && <iframe src={previewUrl} className="w-full h-full border-0 bg-white" title={openFile.name} sandbox="allow-scripts allow-same-origin allow-popups" />}
                  {(openFile.isText && (!isHtml || previewMode === "source")) && <pre className="text-[11.5px] mono text-[var(--cream)] p-4 whitespace-pre-wrap leading-relaxed">{fileText}</pre>}
                  {openFile.kind === "binary" && <div className="grid place-items-center h-full text-[12px] text-[var(--cream-mute)]">Binary file — <a href={previewUrl ?? "#"} target="_blank" rel="noopener noreferrer" className="underline ml-1" style={{ color: ACCENT }}>download</a></div>}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

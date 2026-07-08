"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Cpu, WifiOff, Zap, Send, Loader2, FolderOpen, Eye, Code2, RotateCw,
  FileText, Image as ImageIcon, Boxes, Trash2,
} from "lucide-react";
import VoiceButton from "./VoiceButton";

const ACCENT = "#38bdf8"; // engine sky-blue
const HKEY = "agentic-os/local-hermes/transcript/v1";

interface Turn { task: string; reply: string; ms: number; at: number; ok: boolean; built?: string[]; claimedButEmpty?: boolean }
interface WFile { name: string; relPath: string; bytes: number; mtime: number; kind: "text" | "image" | "html" | "binary" }

export default function LocalHermesEngine() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [task, setTask] = useState("");
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [files, setFiles] = useState<WFile[]>([]);
  const [sel, setSel] = useState<WFile | null>(null);
  const [selText, setSelText] = useState<string>("");
  const [previewKey, setPreviewKey] = useState(0);
  const voiceBase = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    try { const r = localStorage.getItem(HKEY); if (r) setTurns(JSON.parse(r).slice(-50)); } catch {}
    hydrated.current = true;
    refreshFiles();
  }, []);
  useEffect(() => { if (hydrated.current) try { localStorage.setItem(HKEY, JSON.stringify(turns.slice(-50))); } catch {} }, [turns]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [turns, running]);
  useEffect(() => {
    if (!running) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed((Date.now() - t0) / 1000), 100);
    return () => clearInterval(id);
  }, [running]);

  const refreshFiles = useCallback(async () => {
    try {
      const r = await fetch("/api/local-hermes/workspace", { cache: "no-store" });
      const j = await r.json();
      setFiles(j.files ?? []);
    } catch {}
  }, []);

  const run = useCallback(async (override?: string) => {
    const t = (override ?? task).trim();
    if (!t || running) return;
    setErr(null); setRunning(true); setElapsed(0); voiceBase.current = ""; setTask("");
    const started = Date.now();
    try {
      const r = await fetch("/api/local-hermes/run", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: t }),
      });
      const j = await r.json();
      const ms = Date.now() - started;
      setTurns((prev) => [...prev, { task: t, reply: j.text || "(no response)", ms, at: Date.now(), ok: !!j.ok, built: j.built ?? [], claimedButEmpty: !!j.claimedButEmpty }]);
    } catch (e) {
      setErr(`Couldn't reach the engine: ${String(e).slice(0, 140)}`);
    }
    setRunning(false);
    refreshFiles();
  }, [task, running, refreshFiles]);

  const onTranscript = useCallback((tx: string, opts: { final: boolean }) => {
    if (opts.final) {
      const c = (voiceBase.current ? voiceBase.current + " " : "") + tx;
      voiceBase.current = c; setTask(c);
    } else setTask((voiceBase.current ? voiceBase.current + " " : "") + tx);
  }, []);

  async function openFile(f: WFile) {
    setSel(f); setSelText(""); setPreviewKey((k) => k + 1);
    if (f.kind === "text") {
      try {
        const r = await fetch(`/api/local-hermes/workspace?path=${encodeURIComponent(f.relPath)}`, { cache: "no-store" });
        const j = await r.json(); setSelText(j.content ?? "(empty)");
      } catch { setSelText("(could not read file)"); }
    }
  }

  const fileIcon = (k: WFile["kind"]) => k === "html" ? <Eye size={13} /> : k === "image" ? <ImageIcon size={13} /> : k === "text" ? <FileText size={13} /> : <Boxes size={13} />;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* header */}
      <div className="flex items-center gap-3 mb-3 shrink-0">
        <div className="w-8 h-8 rounded-lg grid place-items-center text-[#04121f]" style={{ background: "linear-gradient(135deg,#7dd3fc,#0ea5e9)" }}><Cpu size={17} /></div>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-[var(--cream)] leading-none flex items-center gap-2">
            The Local Hermes Engine
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: `${ACCENT}1e`, color: ACCENT, border: `1px solid ${ACCENT}40` }}><WifiOff size={9} /> offline</span>
          </div>
          <div className="text-[10.5px] text-[var(--cream-mute)] mt-1">A real agent on your Mac · Gemma-4 12B Coder · runs commands + builds files · free, private</div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_350px] gap-3 flex-1 min-h-0">
        {/* LEFT — the agent */}
        <div className="panel flex flex-col min-h-0 p-0 overflow-hidden">
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto scroll p-4 space-y-4">
            {turns.length === 0 && !running && (
              <div className="h-full grid place-items-center text-center">
                <div>
                  <Cpu size={24} style={{ color: ACCENT }} className="mx-auto mb-2 opacity-70" />
                  <div className="text-[13.5px] text-[var(--cream)]">Give the offline agent a real job.</div>
                  <div className="text-[11.5px] text-[var(--cream-mute)] mt-1 max-w-[380px]">It uses tools — writes files, runs commands, builds things — entirely on your Mac. Try &ldquo;build a neon clock and save it as clock.html&rdquo; or &ldquo;list the files here and summarise them.&rdquo;</div>
                </div>
              </div>
            )}
            {turns.map((tn, i) => (
              <div key={i} className="space-y-2">
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-xl px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap" style={{ background: `${ACCENT}1a`, border: `1px solid ${ACCENT}40`, color: "var(--cream)" }}>{tn.task}</div>
                </div>
                <div className="flex justify-start">
                  <div className="max-w-[88%]">
                    <div className="rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap mono" style={{ background: "var(--bg-card)", border: "1px solid var(--line-soft)", color: "var(--cream-soft)" }}>{tn.reply}</div>
                    <div className="text-[10px] text-[var(--cream-mute)] mt-1 ml-1 inline-flex items-center gap-1.5 flex-wrap">
                      <Zap size={9} style={{ color: ACCENT }} /> ran offline · {(tn.ms / 1000).toFixed(1)}s
                      {tn.built && tn.built.length > 0 && (
                        <button onClick={() => { const f = files.find((x) => x.relPath === tn.built![tn.built!.length - 1]); if (f) openFile(f); else refreshFiles(); }} style={{ color: ACCENT }} className="underline underline-offset-2 hover:opacity-80">· ✓ built {tn.built.join(", ")}</button>
                      )}
                      {tn.claimedButEmpty && <span className="text-[var(--plum)]">· ⚠ no file was actually written (the local model sometimes fakes this)</span>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {running && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-xl px-3.5 py-2.5 text-[13px] inline-flex items-center gap-2 text-[var(--cream-mute)]" style={{ background: "var(--bg-card)", border: "1px solid var(--line-soft)" }}>
                  <Loader2 size={14} className="animate-spin" style={{ color: ACCENT }} /> working locally… {elapsed.toFixed(1)}s
                </div>
              </div>
            )}
            {err && <div className="text-[12px] text-[var(--plum)] bg-[rgba(196,96,126,0.08)] border border-[rgba(196,96,126,0.3)] rounded-lg px-3 py-2">{err}</div>}
          </div>
          <div className="border-t border-[var(--line-soft)] p-3 flex items-end gap-2 shrink-0">
            <VoiceButton onTranscript={onTranscript} size={40} className="shrink-0" />
            <textarea value={task} onChange={(e) => setTask(e.target.value)} rows={2}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run(); }}
              placeholder="Give it a task — build a file, run a command, summarise a folder…  (⌘+Enter)"
              className="flex-1 resize-none bg-[var(--bg-mid)] border border-[var(--line-soft)] rounded-xl px-3 py-2 text-[13.5px] text-[var(--cream)] placeholder:text-[var(--cream-mute)] focus:outline-none" />
            <button onClick={() => run()} disabled={!task.trim() || running} className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-[13px] font-semibold disabled:opacity-40" style={{ background: ACCENT, color: "#04121f" }}>
              {running ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Run
            </button>
            {turns.length > 0 && <button onClick={() => { if (confirm("Clear the engine log?")) { setTurns([]); try { localStorage.removeItem(HKEY); } catch {} } }} title="Clear log" className="p-2.5 rounded-xl text-[var(--cream-mute)] hover:text-[var(--plum)] border border-[var(--line-soft)]"><Trash2 size={14} /></button>}
          </div>
        </div>

        {/* RIGHT — what it built (workspace) */}
        <div className="panel flex flex-col min-h-0 p-0 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--line-soft)] shrink-0">
            <FolderOpen size={14} style={{ color: ACCENT }} />
            <span className="text-[12.5px] text-[var(--cream)] font-medium">What it built</span>
            <span className="text-[10px] text-[var(--cream-mute)]">{files.length}</span>
            <button onClick={refreshFiles} title="Refresh" className="ml-auto p-1.5 rounded-lg border border-[var(--line-soft)] text-[var(--cream-mute)] hover:text-[var(--cream)]"><RotateCw size={12} /></button>
          </div>

          {sel ? (
            <div className="flex flex-col min-h-0 flex-1">
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--line-soft)] shrink-0">
                <button onClick={() => setSel(null)} className="text-[11px] text-[var(--cream-mute)] hover:text-[var(--cream)]">← files</button>
                <span className="text-[11.5px] text-[var(--cream)] truncate">{sel.relPath}</span>
                {sel.kind === "html" && <a href={`/api/local-hermes/preview/${sel.relPath}`} target="_blank" rel="noopener" className="ml-auto text-[10px]" style={{ color: ACCENT }}>open ↗</a>}
              </div>
              {sel.kind === "html" ? (
                <iframe key={previewKey} title="preview" src={`/api/local-hermes/preview/${sel.relPath}`} sandbox="allow-scripts allow-popups allow-modals allow-forms" className="flex-1 min-h-0 w-full bg-white" />
              ) : sel.kind === "image" ? (
                <div className="flex-1 min-h-0 overflow-auto grid place-items-center p-3 bg-[var(--bg-mid)]"><img src={`/api/local-hermes/preview/${sel.relPath}`} alt={sel.name} className="max-w-full" /></div>
              ) : (
                <pre className="flex-1 min-h-0 overflow-auto scroll p-3 text-[11px] leading-relaxed text-[var(--cream-soft)] mono whitespace-pre-wrap">{selText || "…"}</pre>
              )}
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto scroll p-2 space-y-1">
              {files.length === 0 && <div className="h-full grid place-items-center text-center p-4"><div className="text-[11px] text-[var(--cream-mute)] max-w-[240px]">Nothing yet. Ask the agent to build or write something — it shows up here the moment it does.</div></div>}
              {files.map((f) => (
                <button key={f.relPath} onClick={() => openFile(f)} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left hover:bg-[var(--bg-card)] border border-transparent hover:border-[var(--line-soft)]">
                  <span style={{ color: ACCENT }} className="shrink-0">{fileIcon(f.kind)}</span>
                  <span className="text-[12px] text-[var(--cream)] truncate flex-1">{f.relPath}</span>
                  <span className="text-[9.5px] text-[var(--cream-mute)] shrink-0">{f.bytes < 1024 ? `${f.bytes}B` : `${(f.bytes / 1024).toFixed(1)}K`}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MessageSquare, Layers, Send, Square, Trash2, RefreshCw, FileCode,
  ExternalLink, Sparkles, FolderTree, Network, Search, Gavel, Users,
} from "lucide-react";

const ACCENT = "#d4a574"; // Fusion gold
const HISTORY_KEY = "agentic-os/fusion/history/v1";
const BUCKET = "fusion"; // reuse the Hermes "Fusion ✦" workspace bucket
const PANEL = ["Opus 4.8", "Gemini 3", "Grok", "Fable 5", "+ more"];

type Tab = "chat" | "workspace";
interface Msg { role: "user" | "assistant"; text: string; }
interface WsFile { name: string; relPath: string; bytes: number; mtime: number; isText: boolean; kind: string; }

// The workflows that actually pay off — one tap drops a template into the box.
const PRESETS: { name: string; q: string }[] = [
  { name: "Ask the board", q: "" },
  { name: "SEO content council", q: "Act as an SEO content council. For the keyword \"[KEYWORD]\", search the web for what currently ranks, then synthesise: search intent, the angle competitors are all missing, a recommended H2 outline, and 3 questions every article forgets to answer." },
  { name: "Title + thumbnail brain", q: "I'm making a YouTube video about \"[TOPIC]\". Propose 10 titles under 50 characters (brand + dramatic verb), then rank the top 3 and explain why each wins the click. Flag any that overpromise." },
  { name: "Fact-check", q: "Fact-check this claim using live web search. Tell me clearly: true, partly true, or false — and where sources AGREE vs where they contradict. Claim: \"[CLAIM]\"" },
  { name: "Deep research", q: "Do deep research on \"[TOPIC]\". Use web search across multiple sources. Give me what's confirmed, what's contested, the strongest opposing view, and the 3 things most people get wrong. Cite specifics." },
  { name: "Red-team my offer", q: "Red-team this offer before I launch. Find the weakest assumption, the objection that kills the most sales, and the one change that would most lift conversions. Offer: \"[PASTE OFFER]\"" },
];

function fmtAgo(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function clock(s: number): string {
  const m = Math.floor(s / 60), ss = s % 60;
  return `${m}:${String(ss).padStart(2, "0")}`;
}
// staged status text driven by elapsed seconds
function stageFor(s: number): { icon: "users" | "search" | "gavel"; text: string } {
  if (s < 8)  return { icon: "users",  text: "Sending your prompt to the panel…" };
  if (s < 28) return { icon: "users",  text: "The panel is deliberating in parallel…" };
  if (s < 55) return { icon: "search", text: "Running web searches + cross-checking sources…" };
  return { icon: "gavel", text: "The judge is weighing it all + writing the verdict…" };
}

export default function FusionView() {
  const [tab, setTab] = useState<Tab>("chat");

  // ── chat ──
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [partial, setPartial] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const ctrlRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    // fast cache first (instant paint), then reconcile with the server copy
    try { const raw = localStorage.getItem(HISTORY_KEY); if (raw) setMsgs(JSON.parse(raw).slice(-200)); } catch {}
    (async () => {
      try {
        const r = await fetch("/api/fusion/history", { cache: "no-store" });
        const j = await r.json();
        if (Array.isArray(j.msgs) && j.msgs.length) setMsgs(j.msgs.slice(-200));
      } catch {}
      hydrated.current = true;
    })();
  }, []);
  useEffect(() => {
    if (!hydrated.current) return;
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(msgs.slice(-200))); } catch {}
    // persist server-side too (survives refresh / restart / other browsers)
    fetch("/api/fusion/history", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ msgs: msgs.slice(-200) }) }).catch(() => {});
  }, [msgs]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [msgs, partial, elapsed]);
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setErr(null);
    const next = [...msgs, { role: "user" as const, text }];
    setMsgs(next); setInput(""); setStreaming(true); setPartial(""); setElapsed(0);
    const start = Date.now();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 250);
    const ctrl = new AbortController(); ctrlRef.current = ctrl;
    let acc = "", errMsg: string | null = null;
    try {
      const r = await fetch("/api/fusion/chat", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: text, history: next.slice(0, -1).map(m => ({ role: m.role, text: m.text })) }),
        signal: ctrl.signal,
      });
      if (!r.ok) errMsg = `Server error ${r.status}`;
      if (r.body) {
        const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
        while (true) {
          const { value, done } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n"); buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try { const j = JSON.parse(line); if (j.t === "d") { acc += j.c; setPartial(acc); } else if (j.t === "error") { errMsg = j.m; } } catch {}
          }
        }
      }
    } catch (e) { if ((e as Error).name !== "AbortError") errMsg = String(e); }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (acc.trim()) setMsgs((m) => [...m, { role: "assistant", text: acc.trim() }]);
    if (errMsg) setErr(acc.trim() ? `Note: ${errMsg}` : errMsg);
    setPartial(""); setStreaming(false);
  }, [input, streaming, msgs]);

  function stop() { ctrlRef.current?.abort(); if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } setStreaming(false); setPartial(""); }
  function clearChat() { if (confirm("Clear Fusion history?")) { setMsgs([]); try { localStorage.removeItem(HISTORY_KEY); } catch {} fetch("/api/fusion/history", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ msgs: [] }) }).catch(() => {}); } }

  // ── workspace (reuses the Hermes "fusion" bucket) ──
  const [files, setFiles] = useState<WsFile[]>([]);
  const [openFile, setOpenFile] = useState<WsFile | null>(null);
  const [fileText, setFileText] = useState("");
  const [previewMode, setPreviewMode] = useState<"preview" | "source">("preview");

  const loadFiles = useCallback(async () => {
    try { const r = await fetch(`/api/hermes/workspace?bucket=${BUCKET}`, { cache: "no-store" }); const j = await r.json(); setFiles(j.files ?? []); } catch { setFiles([]); }
  }, []);
  useEffect(() => { if (tab === "workspace") loadFiles(); }, [tab, loadFiles]);

  async function openFileInPane(f: WsFile) {
    setOpenFile(f); setPreviewMode(f.relPath.match(/\.html?$/i) ? "preview" : "source"); setFileText("");
    if (f.isText) {
      try { const r = await fetch(`/api/hermes/workspace/file?bucket=${BUCKET}&path=${encodeURIComponent(f.relPath)}`, { cache: "no-store" }); const j = await r.json(); setFileText(j.content ?? ""); } catch {}
    }
  }
  const previewUrl = openFile ? `/api/hermes/preview/${BUCKET}/${openFile.relPath.split("/").map(encodeURIComponent).join("/")}` : null;
  const isHtml = !!openFile && /\.html?$/i.test(openFile.relPath);

  const stg = stageFor(elapsed);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* header + tabs */}
      <div className="flex items-center gap-3 mb-3 shrink-0">
        <div className="w-8 h-8 rounded-lg grid place-items-center text-[#1a130a] font-bold" style={{ background: "linear-gradient(135deg,#e6c69a,#a87f54)" }}><Network size={16} /></div>
        <div>
          <div className="text-[15px] font-semibold text-[var(--cream)] leading-none">Fusion Boardroom</div>
          <div className="text-[10.5px] text-[var(--cream-mute)] mt-1">OpenRouter · a panel of models + a judge · web search on</div>
        </div>
        <div className="ml-auto flex gap-1.5">
          {([{ k: "chat", label: "Boardroom", icon: <MessageSquare size={13} /> }, { k: "workspace", label: "Workspace", icon: <Layers size={13} /> }] as const).map((t) => (
            <button key={t.k} onClick={() => setTab(t.k)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border transition"
              style={{ borderColor: tab === t.k ? ACCENT : "var(--line-soft)", background: tab === t.k ? `${ACCENT}1e` : "transparent", color: tab === t.k ? ACCENT : "var(--cream-dim)" }}>
              {t.icon} {t.label}{t.k === "workspace" && files.length ? ` · ${files.length}` : ""}
            </button>
          ))}
        </div>
      </div>

      {/* ── CHAT / BOARDROOM ── */}
      {tab === "chat" && (
        <div className="panel flex flex-col min-h-0 flex-1 p-0 overflow-hidden">
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto scroll p-4 space-y-4">
            {msgs.length === 0 && !streaming && (
              <div className="h-full grid place-items-center text-center">
                <div>
                  <Sparkles size={24} style={{ color: ACCENT }} className="mx-auto mb-2 opacity-70" />
                  <div className="text-[13.5px] text-[var(--cream)]">Ask the whole board, not one model.</div>
                  <div className="text-[11.5px] text-[var(--cream-mute)] mt-1">A panel deliberates with web search, a judge writes the verdict. Use it for the calls that matter.</div>
                  <div className="text-[11px] text-[var(--cream-mute)] mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--line-soft)]"><Network size={12} style={{ color: ACCENT }} /> Heads up: a full panel takes <b className="mx-1" style={{ color: ACCENT }}>30–90s</b> — that's normal.</div>
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

            {/* ── live "deliberating" / streaming panel ── */}
            {streaming && (
              <div className="flex justify-start">
                <div className="max-w-[88%] w-full rounded-xl px-4 py-3.5" style={{ background: "var(--bg-card)", border: `1px solid ${ACCENT}40` }}>
                  {!partial ? (
                    <div>
                      {/* status row */}
                      <div className="flex items-center gap-2.5 mb-3">
                        <span className="relative grid place-items-center w-6 h-6 shrink-0">
                          <span className="absolute inset-0 rounded-full animate-ping" style={{ background: `${ACCENT}55` }} />
                          {stg.icon === "search" ? <Search size={14} style={{ color: ACCENT }} /> : stg.icon === "gavel" ? <Gavel size={14} style={{ color: ACCENT }} /> : <Users size={14} style={{ color: ACCENT }} />}
                        </span>
                        <span className="text-[13px] font-semibold" style={{ color: "var(--cream)" }}>{stg.text}</span>
                        <span className="ml-auto text-[12px] mono tabular-nums" style={{ color: ACCENT }}>{clock(elapsed)}</span>
                      </div>
                      {/* pulsing panel chips */}
                      <div className="flex flex-wrap gap-1.5 mb-2.5">
                        {PANEL.map((m, idx) => (
                          <span key={m} className="text-[10.5px] font-medium px-2 py-1 rounded-full animate-pulse"
                            style={{ color: "var(--cream-soft)", background: `${ACCENT}14`, border: `1px solid ${ACCENT}33`, animationDelay: `${idx * 0.18}s`, animationDuration: "1.4s" }}>
                            {m}
                          </span>
                        ))}
                      </div>
                      {/* progress shimmer */}
                      <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(243,235,218,0.06)" }}>
                        <div className="h-full rounded-full fusion-shimmer" style={{ background: `linear-gradient(90deg, transparent, ${ACCENT}, transparent)`, width: "40%" }} />
                      </div>
                      <div className="text-[10.5px] text-[var(--cream-mute)] mt-2">Fusion runs every panel model, then a judge — answers stream in once the judge starts writing.</div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Gavel size={13} style={{ color: ACCENT }} />
                        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: ACCENT }}>Judge writing the verdict</span>
                        <span className="ml-auto text-[12px] mono tabular-nums" style={{ color: "var(--cream-mute)" }}>{clock(elapsed)}</span>
                      </div>
                      <div className="text-[13.5px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--cream-soft)" }}>{partial}<span className="fusion-caret">▋</span></div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {err && <div className="text-[12px] text-[var(--plum)] bg-[rgba(196,96,126,0.08)] border border-[rgba(196,96,126,0.3)] rounded-lg px-3 py-2 whitespace-pre-wrap">{err}</div>}
          </div>

          {/* presets */}
          <div className="flex flex-wrap gap-1.5 px-3 pt-3 shrink-0">
            {PRESETS.map((p) => (
              <button key={p.name} onClick={() => { if (p.q) setInput(p.q); }}
                className="text-[11px] font-medium px-2.5 py-1 rounded-full border transition hover:border-[var(--gold)]"
                style={{ borderColor: "var(--line-soft)", color: "var(--cream-dim)", background: "transparent" }}>
                {p.name}
              </button>
            ))}
          </div>

          <div className="p-3 flex items-end gap-2 shrink-0">
            <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ask the board anything where being wrong is expensive…  (Enter to send · Shift+Enter for a new line)"
              className="flex-1 resize-none bg-[var(--bg-mid)] border border-[var(--line-soft)] rounded-xl px-3 py-2 text-[13.5px] text-[var(--cream)] placeholder:text-[var(--cream-mute)] focus:outline-none" />
            {streaming
              ? <button onClick={stop} className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-[13px] font-semibold bg-rose-500/20 border border-rose-400/40 text-rose-300"><Square size={14} /> Stop</button>
              : <button onClick={send} disabled={!input.trim()} className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-[13px] font-semibold disabled:opacity-40" style={{ background: ACCENT, color: "#1a130a" }}><Send size={14} /> Convene</button>}
            {msgs.length > 0 && <button onClick={clearChat} title="Clear history" className="p-2.5 rounded-xl text-[var(--cream-mute)] hover:text-[var(--plum)] border border-[var(--line-soft)]"><Trash2 size={14} /></button>}
          </div>
        </div>
      )}

      {/* ── WORKSPACE ── */}
      {tab === "workspace" && (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3 flex-1 min-h-0">
          {/* files */}
          <div className="panel p-2 flex flex-col min-h-0">
            <div className="flex items-center justify-between px-2 py-1.5">
              <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold flex items-center gap-1.5"><FileCode size={12} /> Fusion builds</div>
              <button onClick={loadFiles} className="text-[var(--cream-mute)] hover:text-[var(--cream)]"><RefreshCw size={12} /></button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto scroll space-y-1">
              {files.length === 0 && <div className="text-[11px] text-[var(--cream-mute)] px-2.5 py-3">No builds yet. The Fusion Boardroom tool + any reports land here.</div>}
              {files.map((f) => (
                <button key={f.relPath} onClick={() => openFileInPane(f)}
                  className="block w-full text-left px-2.5 py-2 rounded-md border transition"
                  style={{ borderColor: openFile?.relPath === f.relPath ? `${ACCENT}66` : "var(--line-soft)", background: openFile?.relPath === f.relPath ? `${ACCENT}12` : "transparent" }}>
                  <div className="text-[12px] text-[var(--cream)] truncate mono">{f.relPath}</div>
                  <div className="text-[10px] text-[var(--cream-mute)] mono mt-0.5">{(f.bytes / 1024).toFixed(0)}KB · {fmtAgo(f.mtime)}</div>
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
                  <div className="text-[12.5px] text-[var(--cream)]">Pick a build to preview</div>
                  <div className="text-[11px] text-[var(--cream-mute)]">HTML plays live · images + video play · code shows source</div>
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
                <div className="flex-1 min-h-0 overflow-auto bg-[#120d17]">
                  {openFile.kind === "image" && previewUrl && <div className="grid place-items-center h-full p-4"><img src={previewUrl} alt={openFile.name} className="max-w-full max-h-full object-contain" /></div>}
                  {openFile.kind === "video" && previewUrl && <div className="grid place-items-center h-full p-4"><video src={previewUrl} controls className="max-w-full max-h-full" /></div>}
                  {openFile.kind === "audio" && previewUrl && <div className="grid place-items-center h-full p-6"><audio src={previewUrl} controls /></div>}
                  {isHtml && previewMode === "preview" && previewUrl && <iframe src={previewUrl} className="w-full h-full border-0 bg-black" title={openFile.name} sandbox="allow-scripts allow-same-origin allow-popups allow-pointer-lock" />}
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

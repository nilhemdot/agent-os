"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ImageIcon, Film, Mic, Search, Sparkles, Loader2, Send, ExternalLink,
  Download, Play, Radio, Wand2, Clock, History, MessageCircle, Square,
} from "lucide-react";

// OpenClaw Studio — Grok 4.3's creative cockpit.
// Four sub-tools all backed by `openclaw infer` against the xAI plugin:
//   Image  →  xai/grok-imagine-image
//   Video  →  xai/grok-imagine-video
//   Voice  →  xai TTS (6 voices: eve/ara/rex/sal/leo/una)
//   Search →  Grok live X-search
//
// Pink (#f472b6) accent matching the rest of the OpenClaw UI. Every output
// auto-saves to ~/.openclaw/studio/{images,videos,audio} so the Workspace tab
// (Studio · Images / Studio · Videos / Studio · Voice buckets) shows it too.

const ACCENT = "#f472b6";
type SubTool = "image" | "search" | "voice" | "video" | "talk";

interface StudioMeta {
  kind: "image" | "video" | "audio" | "search";
  prompt: string;
  model?: string;
  provider?: string;
  createdAt: number;
  durationMs?: number;
  voice?: string;
  aspectRatio?: string;
  resolution?: string;
  audio?: boolean;
  width?: number;
  height?: number;
  bytes?: number;
}

interface StudioItem {
  name: string;
  relPath: string;
  bytes: number;
  mtime: number;
  kind: string;
  url: string;
  meta: StudioMeta | null;
}

interface SavedSearch {
  id: string;
  query: string;
  answer: string;
  citations: string[];
  model?: string;
  provider?: string;
  tookMs?: number;
  createdAt: number;
}

function fmtAgo(ms: number): string {
  if (!ms) return "—";
  const d = Date.now() - ms;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}
function fmtBytes(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / (1024 * 1024)).toFixed(1)}MB`;
}

export default function OpenClawStudio() {
  const [tool, setTool] = useState<SubTool>("image");
  return (
    <div className="space-y-4">
      {/* Studio hero strip — sets the magic-tier tone */}
      <div className="relative overflow-hidden rounded-xl border p-4"
        style={{
          borderColor: `${ACCENT}40`,
          background:
            `radial-gradient(ellipse at 0% 0%, ${ACCENT}18, transparent 55%),` +
            `radial-gradient(ellipse at 100% 100%, rgba(212,165,116,0.10), transparent 55%),` +
            `linear-gradient(180deg, rgba(244,114,182,0.06), transparent)`,
        }}>
        <div className="flex items-center gap-3 mb-1">
          <div className="grid place-items-center w-9 h-9 rounded-lg"
            style={{ background: `${ACCENT}24`, color: ACCENT, boxShadow: `0 0 26px -10px ${ACCENT}` }}>
            <Sparkles size={16} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest" style={{ color: ACCENT }}>OpenClaw · Studio</div>
            <div className="text-[15px] font-medium text-[var(--cream)]">
              Grok 4.3 creative cockpit
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1.5 text-[10px] uppercase tracking-widest" style={{ color: "var(--cream-mute)" }}>
            <Radio size={11} style={{ color: ACCENT }} className="animate-pulse" />
            <span>xAI · live</span>
          </div>
        </div>
        <p className="text-[12px] text-[var(--cream-dim)] max-w-[640px]">
          Generate images, videos, and voice. Live-search X. All powered by your xAI OAuth login.
          Every output auto-saves to your Workspace.
        </p>
      </div>

      {/* Sub-tool tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {([
          { key: "image",  label: "Image",     icon: <ImageIcon size={14} /> },
          { key: "search", label: "X-Search",  icon: <Search size={14} /> },
          { key: "voice",  label: "Voice",     icon: <Mic size={14} /> },
          { key: "video",  label: "Video",     icon: <Film size={14} /> },
          { key: "talk",   label: "Talk",      icon: <MessageCircle size={14} /> },
        ] as { key: SubTool; label: string; icon: React.ReactNode }[]).map((t) => {
          const active = tool === t.key;
          return (
            <button key={t.key} onClick={() => setTool(t.key)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-[12.5px] transition"
              style={{
                background: active ? `${ACCENT}1f` : "transparent",
                borderColor: active ? ACCENT : "var(--panel-border)",
                color: active ? "var(--cream)" : "var(--cream-dim)",
                boxShadow: active ? `0 0 22px -10px ${ACCENT}` : undefined,
              }}>
              {t.icon}{t.label}
            </button>
          );
        })}
      </div>

      {tool === "image" && <StudioImage />}
      {tool === "search" && <StudioXSearch />}
      {tool === "voice" && <StudioVoice />}
      {tool === "video" && <StudioVideo />}
      {tool === "talk" && <StudioTalk />}
    </div>
  );
}

// ─── IMAGE ──────────────────────────────────────────────────────────────────
function StudioImage() {
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState("16:9");
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<{ url: string; width?: number; height?: number; bytes?: number; prompt?: string; aspectRatio?: string; createdAt?: number } | null>(null);
  const [recent, setRecent] = useState<StudioItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function loadRecent() {
    try {
      const r = await fetch("/api/openclaw/studio/list?kind=images", { cache: "no-store" });
      const j = await r.json();
      setRecent(j.items ?? []);
    } catch {}
  }
  useEffect(() => { loadRecent(); }, []);

  async function generate() {
    if (!prompt.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/openclaw/studio/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, aspectRatio: aspect }),
      });
      const j = await r.json();
      if (j.ok && j.outputs?.[0]) {
        const o = j.outputs[0];
        setCurrent({ url: o.url, width: o.width, height: o.height, bytes: o.size, prompt, aspectRatio: aspect, createdAt: Date.now() });
        loadRecent();
      } else {
        setError(j.stderr || "Generation failed");
      }
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  }

  function restore(it: StudioItem) {
    setCurrent({
      url: it.url,
      bytes: it.bytes,
      width: it.meta?.width,
      height: it.meta?.height,
      prompt: it.meta?.prompt,
      aspectRatio: it.meta?.aspectRatio,
      createdAt: it.meta?.createdAt ?? it.mtime,
    });
    // Restore prompt + settings to the form so user can riff
    if (it.meta?.prompt) setPrompt(it.meta.prompt);
    if (it.meta?.aspectRatio) setAspect(it.meta.aspectRatio);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
      <PromptCard title="Image · grok-imagine-image" accent={ACCENT}>
        <label className="text-[10px] uppercase tracking-widest text-[var(--cream-mute)]">Prompt</label>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
          placeholder="A cinematic shot of a golden lobster in a midnight aubergine void, volumetric light, 35mm film"
          rows={4}
          className="w-full p-2.5 rounded-md text-[12.5px] resize-none"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--panel-border)", color: "var(--cream)" }} />
        <div className="grid grid-cols-2 gap-2 mt-2">
          <div>
            <label className="text-[10px] uppercase tracking-widest text-[var(--cream-mute)]">Aspect</label>
            <select value={aspect} onChange={(e) => setAspect(e.target.value)}
              className="w-full p-1.5 rounded-md text-[12px]"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--panel-border)", color: "var(--cream)" }}>
              <option value="1:1">1:1 (square)</option>
              <option value="16:9">16:9 (wide)</option>
              <option value="9:16">9:16 (vertical / story)</option>
              <option value="4:3">4:3</option>
              <option value="3:4">3:4</option>
            </select>
          </div>
          <div className="grid place-items-end">
            <GenerateButton onClick={generate} busy={busy} label={busy ? "Generating…" : "Generate"} />
          </div>
        </div>
        {error && <div className="mt-2 text-[11px] text-[var(--plum)] truncate" title={error}>{error.slice(0, 200)}</div>}
      </PromptCard>

      <PreviewCard title={current ? "Latest image" : "Preview"} accent={ACCENT}>
        {current ? (
          <div className="flex-1 min-h-0 flex flex-col">
            <img src={current.url} alt="generated" className="flex-1 min-h-0 w-full object-contain bg-black/40 rounded-md max-h-[440px]" />
            {current.prompt && (
              <div className="mt-2 p-2 rounded-md text-[11.5px] text-[var(--cream-soft)] leading-relaxed"
                style={{ background: `${ACCENT}08`, border: `1px solid ${ACCENT}25` }}>
                <span className="text-[10px] uppercase tracking-widest mr-2" style={{ color: ACCENT }}>prompt</span>
                {current.prompt}
              </div>
            )}
            <div className="flex items-center justify-between mt-2 text-[10.5px] mono" style={{ color: "var(--cream-mute)" }}>
              <span>
                {current.width && current.height ? `${current.width}×${current.height}` : ""}
                {current.bytes ? ` · ${fmtBytes(current.bytes)}` : ""}
                {current.aspectRatio ? ` · ${current.aspectRatio}` : ""}
                {current.createdAt ? ` · ${fmtAgo(current.createdAt)}` : ""}
              </span>
              <div className="flex items-center gap-3">
                <a href={current.url} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--cream)] flex items-center gap-1">
                  <ExternalLink size={11} /> New tab
                </a>
                <a href={current.url} download className="hover:text-[var(--cream)] flex items-center gap-1">
                  <Download size={11} /> Save
                </a>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState icon={<Wand2 size={28} style={{ color: ACCENT }} />} title="Generate your first image"
            hint="Type a prompt on the left and hit Generate. Output renders here in ~5 seconds." />
        )}
      </PreviewCard>

      {/* Full history grid spanning both columns */}
      <div className="lg:col-span-2">
        <HistoryGrid items={recent} onClick={restore} title="Your image history" />
      </div>
    </div>
  );
}

// ─── X-SEARCH ───────────────────────────────────────────────────────────────
function StudioXSearch() {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [citations, setCitations] = useState<string[]>([]);
  const [tookMs, setTookMs] = useState<number | null>(null);
  const [lastQuery, setLastQuery] = useState<string | null>(null);
  const [lastCreatedAt, setLastCreatedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [history, setHistory] = useState<SavedSearch[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function loadHistory() {
    try {
      const r = await fetch("/api/openclaw/studio/searches", { cache: "no-store" });
      const j = await r.json();
      setHistory(j.items ?? []);
    } catch {}
  }
  useEffect(() => { loadHistory(); }, []);

  async function search() {
    if (!query.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/openclaw/studio/xsearch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit: 20 }),
      });
      const j = await r.json();
      if (j.ok) {
        setAnswer(j.answer ?? null);
        setCitations(j.citations ?? []);
        setTookMs(j.tookMs ?? null);
        setLastQuery(j.query ?? query);
        setLastCreatedAt(Date.now());
        loadHistory();
      } else {
        setError(j.stderr || "Search failed");
      }
    } catch (e) { setError(String(e)); }
    setBusy(false);
  }

  function openHistory(rec: SavedSearch) {
    setAnswer(rec.answer);
    setCitations(rec.citations);
    setTookMs(rec.tookMs ?? null);
    setLastQuery(rec.query);
    setLastCreatedAt(rec.createdAt);
    setQuery(rec.query);
  }

  async function deleteHistory(id: string) {
    if (!confirm("Delete this saved search?")) return;
    await fetch(`/api/openclaw/studio/searches?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    loadHistory();
  }

  // Auto-refresh ticker — turns the panel into a live Bloomberg-terminal vibe.
  useEffect(() => {
    if (autoRefresh && lastQuery) {
      timer.current = setInterval(() => { search(); }, 30_000);
    }
    return () => { if (timer.current) clearInterval(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, lastQuery]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
      <PromptCard title="Live X-Search · Grok" accent={ACCENT}>
        <label className="text-[10px] uppercase tracking-widest text-[var(--cream-mute)]">Query</label>
        <textarea value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="What are people saying about OpenClaw on X today?"
          rows={3}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) search(); }}
          className="w-full p-2.5 rounded-md text-[12.5px] resize-none"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--panel-border)", color: "var(--cream)" }} />
        <div className="flex items-center justify-between mt-2">
          <label className="flex items-center gap-2 text-[11px] text-[var(--cream-dim)] cursor-pointer">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Auto-refresh (30s)
          </label>
          <GenerateButton onClick={search} busy={busy} label={busy ? "Searching…" : "Search X"} />
        </div>
        {error && <div className="mt-2 text-[11px] text-[var(--plum)] truncate" title={error}>{error.slice(0, 200)}</div>}
        {lastQuery && (
          <div className="mt-3 p-2 rounded-md text-[10.5px]" style={{ background: `${ACCENT}10`, color: "var(--cream-dim)" }}>
            <Radio size={10} className="inline mr-1" style={{ color: ACCENT }} />
            Live results for &ldquo;<span className="text-[var(--cream)]">{lastQuery}</span>&rdquo;
            {autoRefresh && <span className="ml-1">· auto-refreshing every 30s</span>}
          </div>
        )}
      </PromptCard>

      <PreviewCard title={lastQuery ? `${lastCreatedAt && (Date.now() - lastCreatedAt > 60_000) ? "From history" : "Live"}${tookMs ? ` · ${(tookMs / 1000).toFixed(1)}s` : ''}` : "Results"} accent={ACCENT}>
        {!lastQuery ? (
          <EmptyState icon={<Search size={28} style={{ color: ACCENT }} />} title="Search X live"
            hint="Type a query, hit Search X. Grok pulls live X posts, articles, and replies — synthesizes a real-time answer with citations. Flick Auto-refresh on for a Bloomberg-terminal feel." />
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto scroll">
            {answer ? (
              <div className="space-y-3">
                <div className="p-4 rounded-md grok-md" style={{ background: `${ACCENT}0a`, border: `1px solid ${ACCENT}30` }}>
                  <div className="flex items-center gap-2 mb-2">
                    <Radio size={11} style={{ color: ACCENT }} className="animate-pulse" />
                    <span className="text-[10px] uppercase tracking-widest" style={{ color: ACCENT }}>Grok · live answer</span>
                  </div>
                  <div className="text-[12.5px] text-[var(--cream)] leading-relaxed">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        // Headings — keep tight tracking, gold accents
                        h1: ({ children }) => <h1 className="text-[16px] font-medium mt-3 mb-2" style={{ color: "var(--cream)" }}>{children}</h1>,
                        h2: ({ children }) => <h2 className="text-[15px] font-medium mt-3 mb-1.5" style={{ color: "var(--cream)" }}>{children}</h2>,
                        h3: ({ children }) => <h3 className="text-[13.5px] font-medium mt-2.5 mb-1" style={{ color: "var(--cream)" }}>{children}</h3>,
                        p: ({ children }) => <p className="mb-2 last:mb-0" style={{ color: "var(--cream)" }}>{children}</p>,
                        strong: ({ children }) => <strong style={{ color: "var(--cream)", fontWeight: 600 }}>{children}</strong>,
                        em: ({ children }) => <em style={{ color: "var(--cream-soft)" }}>{children}</em>,
                        ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-1 marker:text-[var(--cream-mute)]">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-1 marker:text-[var(--cream-mute)]">{children}</ol>,
                        li: ({ children }) => <li style={{ color: "var(--cream)" }}>{children}</li>,
                        // Inline citations come through as anchor tags with the
                        // [[N]](url) shape — render them as the numbered badge
                        // we used before, not as default blue links.
                        a: ({ href, children }) => {
                          const text = typeof children === "string" ? children : Array.isArray(children) ? children.join("") : String(children);
                          const isCitation = /^\d+$/.test(text.trim());
                          if (isCitation) {
                            return (
                              <a href={href} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center justify-center w-4 h-4 rounded text-[9px] mono align-middle mx-0.5 hover:scale-110 transition no-underline"
                                style={{ background: `${ACCENT}28`, color: ACCENT, textDecoration: "none" }}
                                title={href}>{text}</a>
                            );
                          }
                          return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: ACCENT, textDecoration: "underline", textUnderlineOffset: "2px" }}>{children}</a>;
                        },
                        code: ({ children }) => <code className="px-1 py-0.5 rounded text-[11.5px]"
                          style={{ background: "rgba(255,255,255,0.06)", color: "var(--gold-soft)" }}>{children}</code>,
                        blockquote: ({ children }) => <blockquote className="border-l-2 pl-3 my-2 italic"
                          style={{ borderColor: `${ACCENT}66`, color: "var(--cream-soft)" }}>{children}</blockquote>,
                        hr: () => <hr className="my-3" style={{ borderColor: "var(--line-soft)" }} />,
                      }}>
                      {answer}
                    </ReactMarkdown>
                  </div>
                </div>
                {citations.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--cream-mute)" }}>
                      {citations.length} source{citations.length === 1 ? "" : "s"}
                    </div>
                    {citations.map((url, i) => {
                      let host = url;
                      try { host = new URL(url).hostname.replace("www.", ""); } catch {}
                      return (
                        <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-2 p-2 rounded-md border transition hover:bg-[rgba(255,255,255,0.03)]"
                          style={{ borderColor: "var(--line-soft)" }}>
                          <span className="grid place-items-center w-5 h-5 rounded text-[10px] mono"
                            style={{ background: `${ACCENT}18`, color: ACCENT, flexShrink: 0 }}>{i + 1}</span>
                          <span className="text-[11.5px] mono uppercase tracking-wide" style={{ color: ACCENT, flexShrink: 0 }}>{host}</span>
                          <span className="text-[11px] text-[var(--cream-dim)] truncate">{url}</span>
                          <ExternalLink size={11} className="ml-auto text-[var(--cream-mute)]" />
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-[11px] text-[var(--cream-mute)] italic p-3">No answer.</div>
            )}
          </div>
        )}
      </PreviewCard>

      {/* Saved searches — full history spanning both columns */}
      <div className="lg:col-span-2">
        <SearchHistory items={history} onClick={openHistory} onDelete={deleteHistory} />
      </div>
    </div>
  );
}

// ─── VOICE / TTS ────────────────────────────────────────────────────────────
const XAI_VOICES = ["eve", "ara", "rex", "sal", "leo", "una"];

// Voices available for the Talk loop. "browser" is instant — uses window.speechSynthesis,
// no server round-trip. The xAI voices sound better but add 3-5s per turn.
const TALK_VOICES = [
  { id: "browser", label: "Browser (instant)" },
  { id: "eve", label: "eve · xAI" },
  { id: "ara", label: "ara · xAI" },
  { id: "rex", label: "rex · xAI" },
  { id: "sal", label: "sal · xAI" },
  { id: "leo", label: "leo · xAI" },
  { id: "una", label: "una · xAI" },
];
function StudioVoice() {
  const [text, setText] = useState("");
  const [voice, setVoice] = useState("eve");
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<{ url: string; bytes?: number; voice: string; text?: string; createdAt?: number } | null>(null);
  const [recent, setRecent] = useState<StudioItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function loadRecent() {
    try {
      const r = await fetch("/api/openclaw/studio/list?kind=audio", { cache: "no-store" });
      const j = await r.json();
      setRecent(j.items ?? []);
    } catch {}
  }
  useEffect(() => { loadRecent(); }, []);

  async function speak() {
    if (!text.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/openclaw/studio/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice }),
      });
      const j = await r.json();
      if (j.ok && j.outputs?.[0]) {
        setCurrent({ url: j.outputs[0].url, bytes: j.outputs[0].size, voice: j.voice, text, createdAt: Date.now() });
        loadRecent();
      } else {
        setError(j.stderr || "TTS failed");
      }
    } catch (e) { setError(String(e)); }
    setBusy(false);
  }

  function restore(it: StudioItem) {
    setCurrent({
      url: it.url,
      bytes: it.bytes,
      voice: it.meta?.voice ?? "eve",
      text: it.meta?.prompt,
      createdAt: it.meta?.createdAt ?? it.mtime,
    });
    if (it.meta?.prompt) setText(it.meta.prompt);
    if (it.meta?.voice) setVoice(it.meta.voice);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
      <PromptCard title="Voice · xAI TTS" accent={ACCENT}>
        <label className="text-[10px] uppercase tracking-widest text-[var(--cream-mute)]">Say this</label>
        <textarea value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Welcome to the OpenClaw OS. The lobster is now your AI overlord."
          rows={4}
          className="w-full p-2.5 rounded-md text-[12.5px] resize-none"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--panel-border)", color: "var(--cream)" }} />
        <div className="grid grid-cols-2 gap-2 mt-2">
          <div>
            <label className="text-[10px] uppercase tracking-widest text-[var(--cream-mute)]">Voice</label>
            <select value={voice} onChange={(e) => setVoice(e.target.value)}
              className="w-full p-1.5 rounded-md text-[12px] capitalize"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--panel-border)", color: "var(--cream)" }}>
              {XAI_VOICES.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="grid place-items-end">
            <GenerateButton onClick={speak} busy={busy} label={busy ? "Speaking…" : "Speak"} />
          </div>
        </div>
        {error && <div className="mt-2 text-[11px] text-[var(--plum)] truncate" title={error}>{error.slice(0, 200)}</div>}
      </PromptCard>

      <PreviewCard title={current ? `Playback · ${current.voice}` : "Playback"} accent={ACCENT}>
        {current ? (
          <div className="flex-1 min-h-0 grid place-items-center p-6">
            <div className="w-full max-w-[480px] space-y-3">
              <div className="text-[10.5px] uppercase tracking-widest text-center" style={{ color: "var(--cream-mute)" }}>
                {current.voice} · {current.bytes ? fmtBytes(current.bytes) : ""}
                {current.createdAt ? ` · ${fmtAgo(current.createdAt)}` : ""}
              </div>
              {current.text && (
                <div className="p-2 rounded-md text-[11.5px] text-[var(--cream-soft)] leading-relaxed text-center"
                  style={{ background: `${ACCENT}08`, border: `1px solid ${ACCENT}25` }}>
                  &ldquo;{current.text}&rdquo;
                </div>
              )}
              <audio src={current.url} controls autoPlay className="w-full" />
              <div className="flex items-center justify-center gap-3 text-[10.5px] mono" style={{ color: "var(--cream-mute)" }}>
                <a href={current.url} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--cream)] flex items-center gap-1">
                  <ExternalLink size={11} /> New tab
                </a>
                <a href={current.url} download className="hover:text-[var(--cream)] flex items-center gap-1">
                  <Download size={11} /> Save
                </a>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState icon={<Mic size={28} style={{ color: ACCENT }} />} title="Hear Grok speak"
            hint="Type something and pick a voice. xAI ships six voices — eve, ara, rex, sal, leo, una. Each one's different. Try them all." />
        )}
      </PreviewCard>

      {/* Full history grid spanning both columns */}
      <div className="lg:col-span-2">
        <HistoryGrid items={recent} onClick={restore} title="Your voice history" />
      </div>
    </div>
  );
}

// ─── VIDEO ──────────────────────────────────────────────────────────────────
function StudioVideo() {
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState("16:9");
  const [resolution, setResolution] = useState<"480P"|"720P"|"768P"|"1080P">("720P");
  const [audio, setAudio] = useState(true);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<{ url: string; bytes?: number; width?: number; height?: number; prompt?: string; createdAt?: number } | null>(null);
  const [recent, setRecent] = useState<StudioItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function loadRecent() {
    try {
      const r = await fetch("/api/openclaw/studio/list?kind=videos", { cache: "no-store" });
      const j = await r.json();
      setRecent(j.items ?? []);
    } catch {}
  }
  useEffect(() => { loadRecent(); }, []);

  async function generate() {
    if (!prompt.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/openclaw/studio/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, aspectRatio: aspect, resolution, audio }),
      });
      const j = await r.json();
      if (j.ok && j.outputs?.[0]) {
        setCurrent({ url: j.outputs[0].url, bytes: j.outputs[0].size, width: j.outputs[0].width, height: j.outputs[0].height, prompt, createdAt: Date.now() });
        loadRecent();
      } else {
        setError(j.stderr || "Video gen failed");
      }
    } catch (e) { setError(String(e)); }
    setBusy(false);
  }

  function restore(it: StudioItem) {
    setCurrent({
      url: it.url,
      bytes: it.bytes,
      width: it.meta?.width,
      height: it.meta?.height,
      prompt: it.meta?.prompt,
      createdAt: it.meta?.createdAt ?? it.mtime,
    });
    if (it.meta?.prompt) setPrompt(it.meta.prompt);
    if (it.meta?.aspectRatio) setAspect(it.meta.aspectRatio);
    if (it.meta?.resolution && /^(480P|720P|768P|1080P)$/.test(it.meta.resolution)) {
      setResolution(it.meta.resolution as "480P"|"720P"|"768P"|"1080P");
    }
    if (typeof it.meta?.audio === "boolean") setAudio(it.meta.audio);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
      <PromptCard title="Video · grok-imagine-video" accent={ACCENT}>
        <label className="text-[10px] uppercase tracking-widest text-[var(--cream-mute)]">Prompt</label>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
          placeholder="A golden lobster swimming through clouds at sunset, cinematic 4K"
          rows={4}
          className="w-full p-2.5 rounded-md text-[12.5px] resize-none"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--panel-border)", color: "var(--cream)" }} />
        <div className="grid grid-cols-3 gap-2 mt-2">
          <div>
            <label className="text-[10px] uppercase tracking-widest text-[var(--cream-mute)]">Aspect</label>
            <select value={aspect} onChange={(e) => setAspect(e.target.value)}
              className="w-full p-1.5 rounded-md text-[12px]"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--panel-border)", color: "var(--cream)" }}>
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="1:1">1:1</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest text-[var(--cream-mute)]">Res</label>
            <select value={resolution} onChange={(e) => setResolution(e.target.value as "480P"|"720P"|"768P"|"1080P")}
              className="w-full p-1.5 rounded-md text-[12px]"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--panel-border)", color: "var(--cream)" }}>
              <option value="480P">480P</option>
              <option value="720P">720P</option>
              <option value="1080P">1080P</option>
            </select>
          </div>
          <label className="grid place-items-center text-[10px] uppercase tracking-widest cursor-pointer rounded-md border"
            style={{ borderColor: audio ? ACCENT : "var(--panel-border)", color: audio ? ACCENT : "var(--cream-dim)", background: audio ? `${ACCENT}10` : "transparent" }}>
            <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} className="hidden" />
            Audio
          </label>
        </div>
        <div className="mt-3"><GenerateButton onClick={generate} busy={busy} label={busy ? "Rendering…" : "Generate video"} fullWidth /></div>
        <div className="mt-2 text-[10.5px] text-[var(--cream-mute)]">Video gen takes ~30–90s. Don&apos;t close the tab.</div>
        {error && <div className="mt-2 text-[11px] text-[var(--plum)] truncate" title={error}>{error.slice(0, 200)}</div>}
      </PromptCard>

      <PreviewCard title={current ? "Latest video" : "Preview"} accent={ACCENT}>
        {current ? (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex-1 min-h-0 grid place-items-center bg-black/40 rounded-md p-2 max-h-[440px]">
              <video src={current.url} controls autoPlay className="max-w-full max-h-full" />
            </div>
            {current.prompt && (
              <div className="mt-2 p-2 rounded-md text-[11.5px] text-[var(--cream-soft)] leading-relaxed"
                style={{ background: `${ACCENT}08`, border: `1px solid ${ACCENT}25` }}>
                <span className="text-[10px] uppercase tracking-widest mr-2" style={{ color: ACCENT }}>prompt</span>
                {current.prompt}
              </div>
            )}
            <div className="flex items-center justify-between mt-2 text-[10.5px] mono" style={{ color: "var(--cream-mute)" }}>
              <span>
                {current.width && current.height ? `${current.width}×${current.height}` : ""}
                {current.bytes ? ` · ${fmtBytes(current.bytes)}` : ""}
                {current.createdAt ? ` · ${fmtAgo(current.createdAt)}` : ""}
              </span>
              <div className="flex items-center gap-3">
                <a href={current.url} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--cream)] flex items-center gap-1">
                  <ExternalLink size={11} /> New tab
                </a>
                <a href={current.url} download className="hover:text-[var(--cream)] flex items-center gap-1">
                  <Download size={11} /> Save
                </a>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState icon={<Film size={28} style={{ color: ACCENT }} />} title="Make a video"
            hint="Type a scene, hit Generate video. Grok Imagine renders a short cinematic clip. ~30 seconds to first frame." />
        )}
      </PreviewCard>

      {/* Full history grid spanning both columns */}
      <div className="lg:col-span-2">
        <HistoryGrid items={recent} onClick={restore} title="Your video history" />
      </div>
    </div>
  );
}

// ─── TALK v2 (live continuous voice chat with Grok) ─────────────────────────
// Phone-call style. ONE "start conversation" button → flips into a continuous
// listen/speak/listen loop. No per-turn button clicks.
//
// Architecture:
//   - STT: browser-native Web Speech API (zero upload, ~0ms latency)
//   - VAD: triggered by Web Speech's `isFinal` + a 1.2s silence timer
//   - Chat: /api/openclaw/studio/chat-quick (one-shot Grok with "be brief" prompt)
//   - TTS: existing /api/openclaw/studio/tts
//   - Loop: after Grok's audio ends, listening auto-restarts.

type TalkStage = "idle" | "listening" | "thinking" | "speaking";

// Loose Web Speech API types — lib.dom doesn't ship first-class types.
type SR = {
  start: () => void; stop: () => void; abort: () => void;
  continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string; isFinal?: boolean }>> & { length: number } }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

interface Turn { role: "you" | "grok"; text: string; audioUrl?: string; ts: number; }

interface SavedTalk { id: string; title: string; voice: string; turns: Turn[]; startedAt: number; updatedAt: number; endedAt?: number; }

// ─── 🦀 CRAZY CRAB AI ROBOT ─────────────────────────────────────────────────
// Animated SVG character for the Talk button. Reacts to conversation stage:
//   idle      → gentle bob
//   listening → claws RAISE + LED eyes pulse cyan + pulse rings emit
//   thinking  → gears spin overhead + LEDs cycle through colors
//   speaking  → mouth opens/closes rapidly + claws wave in rhythm
// Inline keyframes injected once via a <style> tag — Tailwind's `animate-*` doesn't
// know about our custom motions.

const CRAB_KEYFRAMES = `
@keyframes crab-bob { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-3px)} }
@keyframes crab-bob-fast { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
@keyframes claw-raise-l { 0%,100%{transform:rotate(-8deg)} 50%{transform:rotate(-28deg)} }
@keyframes claw-raise-r { 0%,100%{transform:rotate(8deg)} 50%{transform:rotate(28deg)} }
@keyframes claw-wave-l { 0%,100%{transform:rotate(-15deg)} 25%{transform:rotate(-45deg)} 75%{transform:rotate(-5deg)} }
@keyframes claw-wave-r { 0%,100%{transform:rotate(15deg)} 25%{transform:rotate(45deg)} 75%{transform:rotate(5deg)} }
@keyframes mouth-talk { 0%,100%{transform:scaleY(0.3)} 30%{transform:scaleY(1)} 60%{transform:scaleY(0.5)} 80%{transform:scaleY(1)} }
@keyframes eye-blink { 0%,90%,100%{opacity:1} 95%{opacity:0.2} }
@keyframes eye-cycle { 0%{fill:#5ab896} 33%{fill:#60a5fa} 66%{fill:#f472b6} 100%{fill:#5ab896} }
@keyframes antenna-spin { 0%{transform:rotate(0)} 100%{transform:rotate(360deg)} }
@keyframes antenna-pulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.4);opacity:0.6} }
@keyframes pulse-ring { 0%{transform:scale(0.7);opacity:0.7} 100%{transform:scale(1.6);opacity:0} }
@keyframes gear-spin { 0%{transform:rotate(0)} 100%{transform:rotate(360deg)} }
`;

function CrazyCrabRobot({ stage, size = 100 }: { stage: TalkStage; size?: number }) {
  // Per-stage animation strings
  const bodyAnim = stage === "speaking" ? "crab-bob-fast 0.45s ease-in-out infinite"
                  : "crab-bob 2.2s ease-in-out infinite";
  const clawLAnim = stage === "listening" ? "claw-raise-l 1s ease-in-out infinite"
                   : stage === "speaking" ? "claw-wave-l 0.5s ease-in-out infinite"
                   : "claw-raise-l 4s ease-in-out infinite";
  const clawRAnim = stage === "listening" ? "claw-raise-r 1s ease-in-out infinite"
                   : stage === "speaking" ? "claw-wave-r 0.5s ease-in-out infinite"
                   : "claw-raise-r 4s ease-in-out infinite";
  const mouthAnim = stage === "speaking" ? "mouth-talk 0.28s ease-in-out infinite" : "none";
  const eyeAnim = stage === "thinking" ? "eye-cycle 1.4s linear infinite"
                  : stage === "listening" ? "eye-blink 1.6s ease-in-out infinite"
                  : "eye-blink 4s ease-in-out infinite";
  const antennaAnim = stage === "thinking" ? "antenna-spin 1.2s linear infinite"
                     : stage === "listening" ? "antenna-pulse 0.8s ease-in-out infinite"
                     : "antenna-pulse 2.4s ease-in-out infinite";
  const gearAnim = stage === "thinking" ? "gear-spin 1.5s linear infinite" : "none";

  return (
    <>
      <style>{CRAB_KEYFRAMES}</style>
      <svg viewBox="0 0 120 120" width={size} height={size} style={{ overflow: "visible" }}>
        {/* Pulse rings when listening */}
        {stage === "listening" && (
          <>
            <circle cx="60" cy="65" r="40" fill="none" stroke="#f472b6" strokeWidth="2"
              style={{ animation: "pulse-ring 1.4s ease-out infinite", transformOrigin: "60px 65px" }} />
            <circle cx="60" cy="65" r="40" fill="none" stroke="#f472b6" strokeWidth="2"
              style={{ animation: "pulse-ring 1.4s ease-out infinite", animationDelay: "0.5s", transformOrigin: "60px 65px" }} />
          </>
        )}

        <g style={{ animation: bodyAnim, transformOrigin: "60px 65px" }}>
          {/* Antenna stalk + bulb */}
          <line x1="60" y1="32" x2="60" y2="20" stroke="#d4a574" strokeWidth="2" strokeLinecap="round" />
          <circle cx="60" cy="18" r="4" fill="#f472b6"
            style={{ animation: antennaAnim, transformOrigin: "60px 18px",
                     filter: "drop-shadow(0 0 6px #f472b6)" }} />

          {/* Thinking gears — appear only when thinking */}
          {stage === "thinking" && (
            <g style={{ animation: gearAnim, transformOrigin: "60px 12px" }}>
              <circle cx="60" cy="12" r="3" fill="none" stroke="#d4a574" strokeWidth="1" />
              {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
                <rect key={a} x="59" y="6" width="2" height="3" fill="#d4a574"
                  transform={`rotate(${a} 60 12)`} />
              ))}
            </g>
          )}

          {/* Left claw — animated arm + pincer */}
          <g style={{ animation: clawLAnim, transformOrigin: "30px 60px" }}>
            <rect x="14" y="56" width="22" height="6" rx="3" fill="#c97c5e" />
            <path d="M 8 54 L 18 54 L 18 50 L 22 50 L 22 56 L 18 56 L 18 62 L 22 62 L 22 68 L 18 68 L 18 64 L 8 64 Z"
                  fill="#f472b6" stroke="#d4a574" strokeWidth="1" />
          </g>
          {/* Right claw */}
          <g style={{ animation: clawRAnim, transformOrigin: "90px 60px" }}>
            <rect x="84" y="56" width="22" height="6" rx="3" fill="#c97c5e" />
            <path d="M 112 54 L 102 54 L 102 50 L 98 50 L 98 56 L 102 56 L 102 62 L 98 62 L 98 68 L 102 68 L 102 64 L 112 64 Z"
                  fill="#f472b6" stroke="#d4a574" strokeWidth="1" />
          </g>

          {/* Body — chrome-pink rounded shell */}
          <ellipse cx="60" cy="65" rx="28" ry="22" fill="url(#crab-body-grad)" stroke="#d4a574" strokeWidth="1.5" />
          {/* Body highlight */}
          <ellipse cx="55" cy="58" rx="14" ry="6" fill="rgba(255,255,255,0.18)" />
          {/* Bolts */}
          <circle cx="42" cy="58" r="1.5" fill="#d4a574" />
          <circle cx="78" cy="58" r="1.5" fill="#d4a574" />
          <circle cx="42" cy="74" r="1.5" fill="#d4a574" />
          <circle cx="78" cy="74" r="1.5" fill="#d4a574" />

          {/* LED EYES */}
          <g style={{ animation: eyeAnim }}>
            <circle cx="50" cy="63" r="3.5" fill="#5ab896" />
            <circle cx="70" cy="63" r="3.5" fill="#5ab896" />
            <circle cx="50" cy="63" r="1" fill="#fff" />
            <circle cx="70" cy="63" r="1" fill="#fff" />
          </g>

          {/* Mouth — speaker grille that opens/closes when talking */}
          <g style={{ animation: mouthAnim, transformOrigin: "60px 74px" }}>
            <rect x="52" y="71" width="16" height="6" rx="2" fill="#1a0f20" stroke="#d4a574" strokeWidth="0.8" />
            <line x1="55" y1="74" x2="65" y2="74" stroke="#f472b6" strokeWidth="1" />
            <line x1="57" y1="72" x2="63" y2="72" stroke="#f472b6" strokeWidth="0.6" opacity="0.6" />
            <line x1="57" y1="76" x2="63" y2="76" stroke="#f472b6" strokeWidth="0.6" opacity="0.6" />
          </g>

          {/* Six legs */}
          {[-1, 0, 1].map((i) => (
            <line key={`l-${i}`} x1={36 + i * 2} y1={80 + Math.abs(i) * 2} x2={28 + i * 4} y2={96 + i * 2}
              stroke="#c97c5e" strokeWidth="2" strokeLinecap="round" />
          ))}
          {[-1, 0, 1].map((i) => (
            <line key={`r-${i}`} x1={84 + i * 2} y1={80 + Math.abs(i) * 2} x2={92 + i * 4} y2={96 + i * 2}
              stroke="#c97c5e" strokeWidth="2" strokeLinecap="round" />
          ))}
        </g>

        <defs>
          <linearGradient id="crab-body-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f472b6" />
            <stop offset="60%" stopColor="#c4607e" />
            <stop offset="100%" stopColor="#7a3b53" />
          </linearGradient>
        </defs>
      </svg>
    </>
  );
}

function StudioTalk() {
  const [active, setActive] = useState(false);
  const [stage, setStage] = useState<TalkStage>("idle");
  // Default to BROWSER voice for near-real-time conversation (0ms TTS).
  // User can switch to an xAI voice for premium sound (adds 3-5s/turn).
  const [voice, setVoice] = useState("browser");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  // Conversation persistence — every conversation gets a stable id from "Start",
  // we save to disk on every turn so closing the tab can't lose it.
  const [talkId, setTalkId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number>(0);
  const [history, setHistory] = useState<SavedTalk[]>([]);

  const recRef = useRef<SR | null>(null);
  const pendingTextRef = useRef<string>("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const turnsRef = useRef<Turn[]>([]);
  const activeRef = useRef(false);
  const voiceRef = useRef(voice);
  const stageRef = useRef<TalkStage>("idle");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // CRITICAL: when stopping recognition intentionally (mid-turn or end), set
  // this flag so rec.onend's auto-restart logic skips. Without this, rec.abort
  // fires onend → onend sees stageRef.current === "listening" (stale, because
  // setStage("thinking") hasn't propagated yet) → re-creates the recognition
  // mid-turn → catches Grok's TTS audio as user input → submits another turn.
  // That's the "2 minute reply" bug — turns stacking up.
  const suppressRestartRef = useRef(false);
  // Token to invalidate stale silence-timer fires when a new turn starts.
  const turnGenRef = useRef(0);

  useEffect(() => { turnsRef.current = turns; }, [turns]);
  useEffect(() => { voiceRef.current = voice; }, [voice]);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { stageRef.current = stage; }, [stage]);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  // Pre-warm — fire a tiny request to the chat endpoint on tab mount.
  // The first call has a 45s cold-start cost (CLI spawn + plugin discovery).
  // Doing this in the background means the user's FIRST real turn is warm.
  // Best-effort, silent on failure.
  useEffect(() => {
    fetch("/api/openclaw/studio/chat-quick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "ping" }),
      keepalive: true,
    }).catch(() => undefined);

    // Also pre-load browser voices — speechSynthesis voices load async on some browsers.
    try {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.addEventListener?.("voiceschanged", () => {
        // no-op, just trigger the cache
      });
    } catch { /* not supported */ }
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [turns, interim]);

  // Load past conversations on mount + after each save
  async function loadHistory() {
    try {
      const r = await fetch("/api/openclaw/studio/talks", { cache: "no-store" });
      const j = await r.json();
      setHistory(j.items ?? []);
    } catch { /* non-fatal */ }
  }
  useEffect(() => { loadHistory(); }, []);

  // Auto-save the conversation on every turn change. Debounce so rapid changes
  // don't hammer the disk — 500ms gives the user time to talk + reply naturally.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!talkId || turns.length === 0) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await fetch("/api/openclaw/studio/talks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: talkId, voice, turns, startedAt }),
        });
        loadHistory();
      } catch { /* offline-safe */ }
    }, 500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns, talkId]);

  function loadPastTalk(rec: SavedTalk) {
    // Don't trash an active live conversation
    if (active) return;
    setTalkId(rec.id);
    setStartedAt(rec.startedAt);
    setTurns(rec.turns);
    setVoice(rec.voice);
    setError(null);
    setStage("idle");
  }

  async function deletePastTalk(id: string) {
    if (!confirm("Delete this saved conversation?")) return;
    try {
      await fetch(`/api/openclaw/studio/talks?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      // If currently showing the one we're deleting, clear
      if (talkId === id) { setTalkId(null); setTurns([]); }
      loadHistory();
    } catch { /* ignore */ }
  }

  function clearSilenceTimer() {
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
  }

  function buildRecognition(): SR | null {
    const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const C = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!C) return null;
    const rec: SR = new C();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-GB";
    return rec;
  }

  function startListening() {
    if (!activeRef.current) return;
    clearSilenceTimer();
    suppressRestartRef.current = false;
    setInterim("");
    pendingTextRef.current = "";
    stageRef.current = "listening";   // sync — must be set before setState
    setStage("listening");
    const turnGen = turnGenRef.current;     // capture for the closure
    const rec = buildRecognition();
    if (!rec) { setError("Web Speech API not available — use Chrome or Safari."); setActive(false); return; }
    recRef.current = rec;
    rec.onresult = (e) => {
      // Stale callback from a previous turn — ignore
      if (turnGen !== turnGenRef.current) return;
      if (stageRef.current !== "listening") return;
      let finalText = "";
      let interimText = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i][0];
        if ((e.results[i] as unknown as { isFinal?: boolean }).isFinal) finalText += r.transcript;
        else interimText += r.transcript;
      }
      if (finalText) {
        pendingTextRef.current = (pendingTextRef.current + " " + finalText).trim();
        setInterim(pendingTextRef.current);
      } else if (interimText) {
        setInterim((pendingTextRef.current + " " + interimText).trim());
      }
      // VAD: silence after any activity → submit. Tightened to 0.9s to feel snappier.
      clearSilenceTimer();
      silenceTimerRef.current = setTimeout(() => {
        if (turnGen !== turnGenRef.current) return; // stale fire
        if (stageRef.current !== "listening") return;
        if (pendingTextRef.current.trim()) submitTurn(pendingTextRef.current.trim());
      }, 900);
    };
    rec.onerror = (e) => {
      if (e.error && e.error !== "no-speech" && e.error !== "aborted") {
        setError(`Mic error: ${e.error}`);
      }
    };
    rec.onend = () => {
      // ANY of these conditions → don't restart. The "suppressRestart" flag is
      // the critical one — it's set true any time we intentionally end mid-turn.
      if (suppressRestartRef.current) return;
      if (!activeRef.current) return;
      if (stageRef.current !== "listening") return;
      // Chrome auto-stops continuous recognition after ~60s of silence.
      // Restart it ONLY if we're still in listening stage with no pending submit.
      try { rec.start(); } catch { /* already started */ }
    };
    try { rec.start(); } catch { /* already running */ }
  }

  function stopListening() {
    clearSilenceTimer();
    suppressRestartRef.current = true;    // critical — block onend's auto-restart
    if (recRef.current) {
      const rec = recRef.current;
      recRef.current = null;
      // Detach handlers BEFORE abort so any synchronous onend that fires can't
      // resurrect the recognizer through a stale closure.
      rec.onresult = null;
      rec.onend = null;
      rec.onerror = null;
      try { rec.abort(); } catch { /* ignore */ }
    }
  }

  async function submitTurn(text: string) {
    if (!activeRef.current) return;
    if (stageRef.current !== "listening") return;  // already mid-turn — drop
    // Bump generation FIRST — invalidates any stale callbacks/timers from the
    // recognition we're about to abort.
    turnGenRef.current += 1;
    stageRef.current = "thinking";                  // sync — must be set before stopListening
    clearSilenceTimer();
    stopListening();
    pendingTextRef.current = "";
    setInterim("");

    const userTurn: Turn = { role: "you", text, ts: Date.now() };
    setTurns((prev) => [...prev, userTurn]);

    setStage("thinking");
    let reply = "";
    try {
      const r = await fetch("/api/openclaw/studio/chat-quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: turnsRef.current.map((t) => ({ role: t.role, text: t.text })),
        }),
      });
      const j = await r.json();
      reply = (j.text || "").trim();
      if (!reply) {
        setError(j.error || "Grok returned no reply.");
        if (activeRef.current) startListening(); else setStage("idle");
        return;
      }
    } catch (e) {
      setError(String(e));
      if (activeRef.current) startListening(); else setStage("idle");
      return;
    }

    stageRef.current = "speaking";
    setStage("speaking");

    const useBrowserTTS = voiceRef.current === "browser";

    if (useBrowserTTS) {
      // ─── Browser-native TTS — ~0ms latency, real-time conversation ──────
      setTurns((prev) => [...prev, { role: "grok", text: reply, ts: Date.now() }]);
      try {
        const utter = new SpeechSynthesisUtterance(reply);
        utter.rate = 1.05;
        utter.pitch = 1.0;
        // Try to pick a decent default voice
        const voices = window.speechSynthesis.getVoices();
        const preferred = voices.find((v) => /samantha|google.*us|microsoft.*aria/i.test(v.name))
                       ?? voices.find((v) => /en-us/i.test(v.lang))
                       ?? voices[0];
        if (preferred) utter.voice = preferred;
        const resume = () => {
          if (activeRef.current) startListening(); else setStage("idle");
        };
        utter.onend = resume;
        utter.onerror = resume;
        window.speechSynthesis.cancel();   // clear any pending speech
        window.speechSynthesis.speak(utter);
      } catch {
        if (activeRef.current) startListening(); else setStage("idle");
      }
      return;
    }

    // ─── xAI TTS path (premium voice, adds 3-5s per turn) ─────────────────
    let audioUrl: string | undefined;
    try {
      const r = await fetch("/api/openclaw/studio/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: reply, voice: voiceRef.current }),
      });
      const j = await r.json();
      audioUrl = j.outputs?.[0]?.url;
    } catch { /* text-only reply is fine */ }

    setTurns((prev) => [...prev, { role: "grok", text: reply, audioUrl, ts: Date.now() }]);

    if (audioUrl) {
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      const resume = () => {
        audioRef.current = null;
        if (activeRef.current) startListening(); else setStage("idle");
      };
      audio.onended = resume;
      audio.onerror = resume;
      try { await audio.play(); } catch { resume(); }
    } else {
      if (activeRef.current) startListening(); else setStage("idle");
    }
  }

  function startConversation() {
    setError(null);
    // Continue current talkId if we're resuming (turns already present), else mint a fresh one.
    if (turns.length === 0 || !talkId) {
      const id = `talk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setTalkId(id);
      setStartedAt(Date.now());
    }
    activeRef.current = true;
    setActive(true);
    navigator.mediaDevices?.getUserMedia({ audio: true }).then((stream) => {
      stream.getTracks().forEach((t) => t.stop());
      startListening();
    }).catch(() => {
      setError("Mic access denied. Allow microphone in browser settings.");
      activeRef.current = false;
      setActive(false);
    });
  }

  function endConversation() {
    activeRef.current = false;
    setActive(false);
    turnGenRef.current += 1;          // invalidate any in-flight callbacks
    stageRef.current = "idle";
    stopListening();
    if (audioRef.current) { try { audioRef.current.pause(); } catch {} audioRef.current = null; }
    setStage("idle");
    setInterim("");
  }

  function clearConversation() {
    // Starts a fresh new conversation slot. Past one is still in history.
    setTurns([]);
    turnsRef.current = [];
    setError(null);
    setTalkId(null);
    setStartedAt(0);
  }

  const stageLabel: Record<TalkStage, string> = {
    idle: "Tap Start to begin a conversation",
    listening: "Listening…",
    thinking: "Grok is thinking…",
    speaking: "Grok is speaking…",
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
      <PromptCard title="Talk · live phone-call with Grok" accent={ACCENT}>
        <div className="flex flex-col items-center justify-center flex-1 gap-4 py-2">
          <button
            onClick={active ? endConversation : startConversation}
            disabled={supported === false}
            className="grid place-items-center w-32 h-32 rounded-full transition relative"
            style={{
              background: active
                ? `radial-gradient(circle, ${ACCENT}66, ${ACCENT}28)`
                : `radial-gradient(circle, ${ACCENT}40, ${ACCENT}10)`,
              border: `2px solid ${ACCENT}`,
              boxShadow: active
                ? `0 0 40px -5px ${ACCENT}, 0 0 80px -20px ${ACCENT}`
                : `0 0 28px -8px ${ACCENT}`,
              opacity: supported === false ? 0.4 : 1,
              cursor: supported === false ? "not-allowed" : "pointer",
            }}>
            {/* The crab IS the icon. Reacts to stage. End button shows Square on hover only. */}
            <CrazyCrabRobot stage={stage} size={110} />
            {active && (
              <div className="absolute -top-1 -right-1 grid place-items-center w-7 h-7 rounded-full"
                style={{ background: "rgba(196,96,126,0.95)", border: "1px solid rgba(255,255,255,0.3)" }}
                title="End conversation">
                <Square size={11} style={{ color: "#fff" }} />
              </div>
            )}
          </button>

          <div className="text-center">
            <div className="text-[12.5px] font-medium" style={{ color: stage === "idle" ? "var(--cream-dim)" : ACCENT }}>
              {(stage === "thinking" || stage === "speaking") && (
                <Loader2 size={12} className="inline mr-1.5 animate-spin" />
              )}
              {stageLabel[stage]}
            </div>
            <div className="text-[10.5px] mt-1 text-[var(--cream-mute)]">
              {active ? "Speak whenever — Grok replies on each pause." : supported === false ? "Browser not supported (use Chrome or Safari)" : "Browser-native STT · auto turn-taking"}
            </div>
          </div>

          <div className="w-full mt-1">
            <label className="text-[10px] uppercase tracking-widest text-[var(--cream-mute)]">Grok&apos;s voice</label>
            <select value={voice} onChange={(e) => setVoice(e.target.value)} disabled={active && stage !== "idle"}
              className="w-full p-1.5 rounded-md text-[12px] mt-1"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--panel-border)", color: "var(--cream)" }}>
              {TALK_VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
            <div className="text-[10px] text-[var(--cream-mute)] mt-1">
              {voice === "browser"
                ? "Real-time (instant) · browser voice — best for live chat"
                : "Premium xAI voice · adds 3–5s per turn"}
            </div>
          </div>
        </div>

        {error && <div className="text-[11px] text-[var(--plum)]" title={error}>{error.slice(0, 200)}</div>}
        {turns.length > 0 && (
          <button onClick={clearConversation}
            className="text-[10px] uppercase tracking-widest text-[var(--cream-mute)] hover:text-[var(--plum)] mt-2 text-center">
            Clear conversation
          </button>
        )}
      </PromptCard>

      <PreviewCard title={turns.length > 0 ? `Conversation · ${turns.length} turns` : "Conversation"} accent={ACCENT}>
        {turns.length === 0 && !interim ? (
          <EmptyState icon={<MessageCircle size={28} style={{ color: ACCENT }} />} title="Talk to Grok — like a phone call"
            hint="One button. Tap Start, then just speak. Grok replies on each natural pause. No clicking between turns. Best in Chrome or Safari with mic permission granted." />
        ) : (
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto scroll space-y-3 pr-1">
            {turns.map((t, i) => (
              <div key={i} className={`flex flex-col gap-1.5 ${t.role === "you" ? "items-end" : "items-start"}`}>
                <div className="text-[9.5px] uppercase tracking-widest" style={{ color: t.role === "you" ? "var(--cream-mute)" : ACCENT }}>
                  {t.role === "you" ? "You said" : "Grok"}
                </div>
                <div className="max-w-[88%] px-3.5 py-2.5 rounded-2xl text-[13px] leading-relaxed"
                  style={{
                    background: t.role === "you" ? "rgba(255,255,255,0.04)" : `${ACCENT}14`,
                    border: `1px solid ${t.role === "you" ? "var(--line-soft)" : `${ACCENT}3a`}`,
                    color: "var(--cream)",
                    borderTopRightRadius: t.role === "you" ? 4 : undefined,
                    borderTopLeftRadius: t.role === "grok" ? 4 : undefined,
                  }}>
                  {t.text}
                </div>
                {t.role === "grok" && t.audioUrl && (
                  <audio src={t.audioUrl} controls className="max-w-[88%]" style={{ height: 28 }} />
                )}
              </div>
            ))}
            {interim && stage === "listening" && (
              <div className="flex flex-col gap-1.5 items-end">
                <div className="text-[9.5px] uppercase tracking-widest" style={{ color: "var(--cream-mute)" }}>You — speaking</div>
                <div className="max-w-[88%] px-3.5 py-2.5 rounded-2xl text-[13px] leading-relaxed italic"
                  style={{ background: "rgba(255,255,255,0.02)", border: `1px dashed ${ACCENT}55`, color: "var(--cream-soft)" }}>
                  {interim}
                </div>
              </div>
            )}
          </div>
        )}
      </PreviewCard>

      {/* Saved conversations — span both columns. Click any to restore. */}
      <div className="lg:col-span-2">
        <TalkHistoryList items={history} activeId={talkId} onLoad={loadPastTalk} onDelete={deletePastTalk} disabled={active} />
      </div>
    </div>
  );
}

// History strip — past Talk conversations. Restore on click. Hover → delete.
function TalkHistoryList({ items, activeId, onLoad, onDelete, disabled }: {
  items: SavedTalk[]; activeId: string | null;
  onLoad: (rec: SavedTalk) => void; onDelete: (id: string) => void;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, 8);
  return (
    <div className="panel p-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <History size={13} style={{ color: ACCENT }} />
          <div className="action-tag" style={{ color: ACCENT }}>Past conversations</div>
          <span className="text-[10.5px] mono" style={{ color: "var(--cream-mute)" }}>· {items.length} saved</span>
        </div>
        {items.length > 8 && (
          <button onClick={() => setExpanded(!expanded)}
            className="text-[10.5px] uppercase tracking-widest hover:text-[var(--cream)] transition"
            style={{ color: "var(--cream-mute)" }}>
            {expanded ? "Show less" : `Show all ${items.length}`}
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <div className="py-8 text-center text-[12px] text-[var(--cream-mute)] italic">
          Talk to Grok — every conversation auto-saves here so you can revisit it any time.
        </div>
      ) : (
        <div className="space-y-1.5">
          {visible.map((rec) => {
            const isActive = rec.id === activeId;
            const lastGrokTurn = [...rec.turns].reverse().find((t) => t.role === "grok");
            return (
              <div key={rec.id}
                className="group flex items-start gap-2 p-2.5 rounded-md border transition hover:bg-[rgba(255,255,255,0.02)]"
                style={{
                  borderColor: isActive ? `${ACCENT}66` : "var(--line-soft)",
                  background: isActive ? `${ACCENT}10` : "transparent",
                }}>
                <button onClick={() => !disabled && onLoad(rec)}
                  disabled={disabled}
                  className="flex-1 text-left min-w-0"
                  style={{ cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1 }}
                  title={disabled ? "End the current conversation first" : "Click to restore this conversation"}>
                  <div className="flex items-center gap-2 mb-0.5">
                    <MessageCircle size={11} style={{ color: ACCENT }} />
                    <span className="text-[12px] text-[var(--cream)] font-medium truncate">{rec.title}</span>
                  </div>
                  {lastGrokTurn && (
                    <div className="text-[10.5px] text-[var(--cream-dim)] leading-snug line-clamp-1">
                      <span style={{ color: ACCENT }}>Grok:</span> &ldquo;{lastGrokTurn.text.slice(0, 80)}&rdquo;
                    </div>
                  )}
                  <div className="flex items-center gap-3 mt-1 text-[10px] mono" style={{ color: "var(--cream-mute)" }}>
                    <span className="flex items-center gap-1"><Clock size={9} />{fmtAgo(rec.updatedAt ?? rec.startedAt)}</span>
                    <span>· {rec.turns.length} turns</span>
                    <span>· {rec.voice}</span>
                  </div>
                </button>
                <button onClick={() => onDelete(rec.id)}
                  className="opacity-0 group-hover:opacity-100 transition text-[14px] hover:text-[var(--plum)] px-2"
                  style={{ color: "var(--cream-mute)" }}
                  title="Delete this conversation">×</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Shared bits ────────────────────────────────────────────────────────────
function PromptCard({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <div className="panel p-4 space-y-2 min-h-[420px] flex flex-col">
      <div className="action-tag mb-1" style={{ color: accent }}>{title}</div>
      {children}
    </div>
  );
}

function PreviewCard({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <div className="panel p-3 flex flex-col min-h-[420px]">
      <div className="action-tag mb-2 px-1" style={{ color: accent }}>{title}</div>
      {children}
    </div>
  );
}

function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div className="flex-1 min-h-0 grid place-items-center text-center p-6">
      <div className="max-w-[360px]">
        <div className="mb-3 grid place-items-center">{icon}</div>
        <div className="text-[14px] text-[var(--cream)] font-medium mb-1">{title}</div>
        <div className="text-[11.5px] text-[var(--cream-mute)] leading-relaxed">{hint}</div>
      </div>
    </div>
  );
}

function GenerateButton({ onClick, busy, label, fullWidth }: { onClick: () => void; busy: boolean; label: string; fullWidth?: boolean }) {
  return (
    <button onClick={onClick} disabled={busy}
      className={`flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-medium transition ${fullWidth ? "w-full" : ""}`}
      style={{
        background: busy ? "rgba(244,114,182,0.15)" : ACCENT,
        color: busy ? ACCENT : "#1a0f20",
        border: `1px solid ${ACCENT}`,
        opacity: busy ? 0.85 : 1,
        boxShadow: busy ? undefined : `0 6px 22px -8px ${ACCENT}`,
      }}>
      {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
      {label}
    </button>
  );
}

// HistoryGrid — the persistent record of everything you've ever generated.
// Replaces the small 6-thumbnail strip with a full scrollable grid that shows
// the original prompt under each item. Click → restores prompt + result.
function HistoryGrid({ items, onClick, title }: { items: StudioItem[]; onClick: (it: StudioItem) => void; title: string }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, 12);

  return (
    <div className="panel p-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <History size={13} style={{ color: ACCENT }} />
          <div className="action-tag" style={{ color: ACCENT }}>{title}</div>
          <span className="text-[10.5px] mono" style={{ color: "var(--cream-mute)" }}>· {items.length} saved</span>
        </div>
        {items.length > 12 && (
          <button onClick={() => setExpanded(!expanded)}
            className="text-[10.5px] uppercase tracking-widest hover:text-[var(--cream)] transition"
            style={{ color: "var(--cream-mute)" }}>
            {expanded ? "Show less" : `Show all ${items.length}`}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="py-8 text-center text-[12px] text-[var(--cream-mute)] italic">
          Nothing yet — your generations save here automatically. Come back any time.
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2.5">
          {visible.map((it) => (
            <button key={it.relPath} onClick={() => onClick(it)}
              className="group text-left rounded-md overflow-hidden border transition hover:scale-[1.03]"
              style={{ borderColor: "var(--line-soft)", background: "rgba(255,255,255,0.02)" }}
              title={it.meta?.prompt ?? it.name}>
              <div className="aspect-square overflow-hidden bg-black/40">
                {it.kind === "image" ? (
                  <img src={it.url} alt={it.meta?.prompt ?? it.name} className="w-full h-full object-cover group-hover:scale-110 transition" />
                ) : it.kind === "video" ? (
                  <div className="w-full h-full grid place-items-center relative">
                    <video src={it.url} className="absolute inset-0 w-full h-full object-cover opacity-70" />
                    <div className="relative z-10 w-10 h-10 rounded-full grid place-items-center"
                      style={{ background: "rgba(0,0,0,0.55)", border: `1px solid ${ACCENT}` }}>
                      <Play size={18} style={{ color: ACCENT }} />
                    </div>
                  </div>
                ) : (
                  <div className="w-full h-full grid place-items-center"
                    style={{ background: `linear-gradient(135deg, ${ACCENT}18, transparent)` }}>
                    <Mic size={26} style={{ color: ACCENT }} />
                  </div>
                )}
              </div>
              <div className="px-2 py-1.5 space-y-0.5">
                <div className="text-[10.5px] text-[var(--cream-soft)] leading-snug line-clamp-2"
                  title={it.meta?.prompt}>
                  {it.meta?.prompt || it.name}
                </div>
                <div className="flex items-center justify-between text-[9.5px] mono" style={{ color: "var(--cream-mute)" }}>
                  <span className="flex items-center gap-1">
                    <Clock size={9} />
                    {fmtAgo(it.meta?.createdAt ?? it.mtime)}
                  </span>
                  {it.meta?.voice && <span>· {it.meta.voice}</span>}
                  {it.meta?.aspectRatio && <span>· {it.meta.aspectRatio}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// SearchHistory — same shape but for saved X-Searches (rows, not a grid, since
// each one is a wall of text).
function SearchHistory({ items, onClick, onDelete }: { items: SavedSearch[]; onClick: (rec: SavedSearch) => void; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, 8);
  return (
    <div className="panel p-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <History size={13} style={{ color: ACCENT }} />
          <div className="action-tag" style={{ color: ACCENT }}>Saved searches</div>
          <span className="text-[10.5px] mono" style={{ color: "var(--cream-mute)" }}>· {items.length} saved</span>
        </div>
        {items.length > 8 && (
          <button onClick={() => setExpanded(!expanded)}
            className="text-[10.5px] uppercase tracking-widest hover:text-[var(--cream)] transition"
            style={{ color: "var(--cream-mute)" }}>
            {expanded ? "Show less" : `Show all ${items.length}`}
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <div className="py-8 text-center text-[12px] text-[var(--cream-mute)] italic">
          Run a search — every query you run saves here so you can revisit answers any time.
        </div>
      ) : (
        <div className="space-y-1.5">
          {visible.map((rec) => (
            <div key={rec.id}
              className="group flex items-start gap-2 p-2.5 rounded-md border transition hover:bg-[rgba(255,255,255,0.02)]"
              style={{ borderColor: "var(--line-soft)" }}>
              <button onClick={() => onClick(rec)} className="flex-1 text-left min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <Search size={11} style={{ color: ACCENT }} />
                  <span className="text-[12px] text-[var(--cream)] font-medium truncate">{rec.query}</span>
                </div>
                <div className="text-[10.5px] text-[var(--cream-dim)] leading-snug line-clamp-2">
                  {rec.answer.slice(0, 240).replace(/\n+/g, " ")}
                </div>
                <div className="flex items-center gap-3 mt-1 text-[10px] mono" style={{ color: "var(--cream-mute)" }}>
                  <span className="flex items-center gap-1"><Clock size={9} />{fmtAgo(rec.createdAt)}</span>
                  <span>· {rec.citations.length} cites</span>
                  {rec.tookMs && <span>· {(rec.tookMs / 1000).toFixed(1)}s</span>}
                </div>
              </button>
              <button onClick={() => onDelete(rec.id)}
                className="opacity-0 group-hover:opacity-100 transition text-[10px] uppercase tracking-widest hover:text-[var(--plum)]"
                style={{ color: "var(--cream-mute)" }}
                title="Delete this saved search">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

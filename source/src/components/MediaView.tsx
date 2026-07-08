"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Image as ImageIcon, Video as VideoIcon, Mic2, Sparkles, Square, Play,
  Download, Clock, AlertCircle, Trash2,
} from "lucide-react";
import VoiceButton from "./VoiceButton";

type MediaKind = "image" | "video" | "speech";

interface MediaResult {
  id: string;
  kind: MediaKind;
  prompt: string;
  paths: string[];
  text: string;
  ok: boolean;
  createdAt: number;
  durationMs: number;
}

const KIND_META: Record<MediaKind, { label: string; icon: React.ReactNode; accent: string; placeholder: string; warn: string }> = {
  image: {
    label: "Images",
    icon: <ImageIcon size={14} />,
    accent: "#ec4899",
    placeholder: "A glowing futuristic dashboard floating in deep space, neon accents, cinematic lighting…",
    warn: "image_gen via Hermes · usually 8–25s depending on provider",
  },
  video: {
    label: "Videos",
    icon: <VideoIcon size={14} />,
    accent: "#a855f7",
    placeholder: "Slow zoom into a neon-lit cyberpunk city street at night, rain reflections, 4 seconds…",
    warn: "video_gen via Hermes · slow, can take 30s–2min",
  },
  speech: {
    label: "Speech",
    icon: <Mic2 size={14} />,
    accent: "#22d3ee",
    placeholder: "Welcome to Agentic OS. Your AI command centre is online and ready.",
    warn: "tts via Hermes · usually 4–10s",
  },
};

const STORAGE_KEY = "agentic-os-media-history";

export default function MediaView() {
  const [kind, setKind] = useState<MediaKind>("image");
  const [prompt, setPrompt] = useState("");
  const [results, setResults] = useState<MediaResult[]>([]);
  // `loaded` guards the persist effect so it doesn't write [] before the load effect
  // has hydrated state from localStorage (which clobbered history on every mount in dev strict-mode).
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  // Per-result file-existence checks (path → true/false). False = the file is gone from disk.
  const [pathExists, setPathExists] = useState<Record<string, boolean>>({});
  const startMsRef = useRef<number>(0);
  const abortRef = useRef<AbortController | null>(null);

  // Load persisted history on mount + repair any old results that have text but no paths
  // (these were stored before the path allowlist was widened — re-extract from text now).
  useEffect(() => {
    let stored: MediaResult[] = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) stored = JSON.parse(raw);
    } catch {}
    // Prune stale AbortError cards (user clicked Stop — these aren't real history).
    stored = stored.filter((r) => !/^\[error\] AbortError/.test(r.text ?? ""));
    setResults(stored);
    queueMicrotask(() => setLoaded(true));

    // Background: try to rehydrate paths for results that have text but empty paths.
    const repairable = stored.filter((r) => r.paths.length === 0 && r.text && !/^\[error\]/.test(r.text));
    if (repairable.length > 0) {
      (async () => {
        const updates = await Promise.all(repairable.map(async (r) => {
          try {
            const resp = await fetch("/api/media/rehydrate", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ kind: r.kind, text: r.text }),
            });
            if (!resp.ok) return null;
            const j = await resp.json();
            if (!j.paths || j.paths.length === 0) return null;
            return { id: r.id, paths: j.paths as string[] };
          } catch { return null; }
        }));
        const byId = new Map(updates.filter(Boolean).map((u) => [u!.id, u!.paths]));
        if (byId.size > 0) {
          setResults((arr) => arr.map((r) => byId.has(r.id) ? { ...r, paths: byId.get(r.id)! } : r));
        }
      })();
    }
  }, []);
  // Persist (only after load has completed).
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(results.slice(0, 40))); } catch {}
  }, [results, loaded]);

  // Check that every stored result's files still exist on disk — so deleted files render as "missing"
  // instead of silently disappearing.
  useEffect(() => {
    if (!loaded) return;
    const allPaths = Array.from(new Set(results.flatMap((r) => r.paths)));
    if (allPaths.length === 0) return;
    (async () => {
      const map: Record<string, boolean> = {};
      await Promise.all(allPaths.map(async (p) => {
        try {
          const r = await fetch(`/api/media/file?path=${encodeURIComponent(p)}`, { method: "HEAD" });
          map[p] = r.ok;
        } catch { map[p] = false; }
      }));
      setPathExists(map);
    })();
  }, [loaded, results.length]);

  // Tick elapsed seconds while generating
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setElapsed(Date.now() - startMsRef.current), 250);
    return () => clearInterval(t);
  }, [busy]);

  async function generate() {
    const p = prompt.trim();
    if (!p || busy) return;
    setBusy(true);
    setElapsed(0);
    startMsRef.current = Date.now();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const r = await fetch("/api/hermes/media", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, prompt: p }),
        signal: ctrl.signal,
      });
      const j = await r.json();
      const result: MediaResult = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind,
        prompt: p,
        paths: j.paths ?? [],
        text: j.text ?? "",
        ok: !!j.ok,
        createdAt: Date.now(),
        durationMs: j.durationMs ?? Date.now() - startMsRef.current,
      };
      setResults((arr) => [result, ...arr].slice(0, 40));

      // Log to Obsidian memory
      fetch("/api/memory/log", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent: "hermes",
          kind: "chat",
          user: `[${kind} gen] ${p}`,
          reply: result.paths.length > 0 ? result.paths.join("\n") : (j.text || "(no media returned)"),
        }),
      }).catch(() => {});

      if (result.ok && result.paths.length > 0) setPrompt("");
    } catch (e) {
      // Don't pollute history with cards from user-aborted requests (Stop button).
      const isAbort = e instanceof DOMException && e.name === "AbortError";
      if (!isAbort) {
        setResults((arr) => [{
          id: `${Date.now()}-err`,
          kind,
          prompt: p,
          paths: [],
          text: `[error] ${String(e)}`,
          ok: false,
          createdAt: Date.now(),
          durationMs: Date.now() - startMsRef.current,
        }, ...arr]);
      }
    }
    setBusy(false);
  }

  function stop() {
    abortRef.current?.abort();
    setBusy(false);
  }

  function clearHistory() {
    if (!confirm("Clear all media history? (local only — generated files stay on disk)")) return;
    setResults([]);
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }

  function removeOne(id: string) {
    setResults((arr) => arr.filter((r) => r.id !== id));
  }

  const meta = KIND_META[kind];
  const visible = results.filter((r) => r.kind === kind);

  return (
    <div className="space-y-5">
      {/* Tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {(Object.keys(KIND_META) as MediaKind[]).map((k) => {
          const m = KIND_META[k];
          const active = kind === k;
          const count = results.filter((r) => r.kind === k).length;
          return (
            <button
              key={k}
              onClick={() => { if (!busy) setKind(k); }}
              disabled={busy}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-[12.5px] transition disabled:opacity-50"
              style={{
                background: active ? `${m.accent}26` : "transparent",
                borderColor: active ? m.accent : "var(--panel-border)",
                color: active ? "var(--fg)" : "var(--fg-dim)",
              }}
            >
              {m.icon}{m.label}
              {count > 0 && (
                <span className="text-[10px] metric px-1.5 py-0.5 rounded-full bg-[rgba(255,255,255,0.06)] text-[var(--fg-dim)]">
                  {count}
                </span>
              )}
            </button>
          );
        })}
        {results.length > 0 && (
          <button
            onClick={clearHistory}
            className="ml-auto text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] hover:text-rose-300 flex items-center gap-1"
          >
            <Trash2 size={11} /> Clear all
          </button>
        )}
      </div>

      {/* Composer */}
      <div className="panel p-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={16} style={{ color: meta.accent }} />
          <h3 className="text-sm font-medium">Generate {meta.label.toLowerCase().slice(0, -1)}</h3>
        </div>
        <div className="flex items-start gap-2">
          <VoiceButton
            onTranscript={(t, o) => { if (o.final) setPrompt((v) => (v ? v + " " : "") + t); }}
            size={42}
          />
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); generate(); }
              if (e.key === "Escape" && busy) stop();
            }}
            rows={3}
            placeholder={meta.placeholder}
            className="flex-1 bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--panel-border-hot)] text-[var(--fg)] resize-y"
          />
          {busy ? (
            <button
              onClick={stop}
              className="px-3 h-[42px] rounded-lg bg-[rgba(248,113,113,0.15)] border border-[rgba(248,113,113,0.45)] text-rose-300 text-sm flex items-center gap-1.5"
            >
              <Square size={14} /> Stop
            </button>
          ) : (
            <button
              onClick={generate}
              disabled={!prompt.trim()}
              className="px-3 h-[42px] rounded-lg flex items-center gap-1.5 text-sm transition disabled:opacity-40"
              style={{ background: `${meta.accent}26`, border: `1px solid ${meta.accent}66`, color: meta.accent }}
            >
              <Play size={14} /> Generate
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--fg-dimmer)] uppercase tracking-widest">
          <span>{meta.warn}</span>
          {busy && (
            <span className="text-[var(--fg-dim)]">
              <span className="inline-flex mr-2">
                <span className="tick live" style={{ color: meta.accent }} />
                <span className="tick live" style={{ color: meta.accent, animationDelay: ".15s" }} />
                <span className="tick live" style={{ color: meta.accent, animationDelay: ".3s" }} />
              </span>
              generating · {Math.floor(elapsed / 1000)}s
            </span>
          )}
        </div>
      </div>

      {/* Results gallery */}
      {visible.length === 0 ? (
        <div className="panel p-8 text-center">
          <div className="grid place-items-center mb-3 mx-auto w-14 h-14 rounded-2xl" style={{ background: `${meta.accent}1a`, color: meta.accent, boxShadow: `0 0 24px -8px ${meta.accent}` }}>
            {meta.icon}
          </div>
          <div className="text-sm font-medium text-[var(--fg)]">No {meta.label.toLowerCase()} yet</div>
          <div className="mt-1 text-[12.5px] text-[var(--fg-dim)] max-w-md mx-auto">
            Type a prompt above (or speak it) and Hermes will use its <code>{kind === "image" ? "image_gen" : kind === "video" ? "video_gen" : "tts"}</code> tool.
          </div>
        </div>
      ) : (
        <div className={kind === "speech"
          ? "space-y-2"
          : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
        }>
          <AnimatePresence initial={false}>
            {visible.map((r) => <MediaCard key={r.id} result={r} pathExists={pathExists} onRemove={() => removeOne(r.id)} />)}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function MediaCard({ result, pathExists, onRemove }: { result: MediaResult; pathExists: Record<string, boolean>; onRemove: () => void }) {
  const accent = KIND_META[result.kind].accent;
  const hasMedia = result.paths.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ duration: 0.25 }}
      className="panel relative overflow-hidden"
    >
      <button
        onClick={onRemove}
        className="absolute top-2 right-2 z-10 grid place-items-center w-6 h-6 rounded-full bg-[rgba(0,0,0,0.5)] text-[var(--fg-dim)] hover:text-rose-300 opacity-0 hover:opacity-100 transition"
        title="Remove from history"
      >
        <Trash2 size={12} />
      </button>

      {/* Media preview */}
      {hasMedia ? (
        <div className="bg-[rgba(0,0,0,0.5)]">
          {result.paths.map((p, i) => {
            const src = `/api/media/file?path=${encodeURIComponent(p)}`;
            const gone = pathExists[p] === false;
            if (gone) {
              return (
                <div key={i} className="p-4 border-b border-amber-400/30 bg-[rgba(245,158,11,0.06)] text-[12px] text-amber-200 flex items-start gap-2">
                  <AlertCircle size={13} className="shrink-0 mt-0.5 text-amber-300" />
                  <div className="min-w-0">
                    <div className="font-medium">File no longer on disk</div>
                    <div className="text-[11px] text-amber-200/70 font-[var(--font-geist-mono)] break-all mt-0.5">{p}</div>
                  </div>
                </div>
              );
            }
            if (result.kind === "image") {
              return (
                <a key={i} href={src} target="_blank" rel="noopener noreferrer" className="block group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt={result.prompt}
                    className="w-full max-h-[420px] object-cover transition group-hover:scale-[1.02]"
                  />
                </a>
              );
            }
            if (result.kind === "video") {
              return (
                <video key={i} src={src} controls playsInline className="w-full max-h-[420px] bg-black" preload="metadata" />
              );
            }
            return (
              <div key={i} className="p-3">
                <audio src={src} controls preload="metadata" className="w-full" />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-[rgba(248,113,113,0.06)] border-b border-rose-400/30 p-4 text-[12px] text-rose-100 flex items-start gap-2">
          <AlertCircle size={13} className="shrink-0 mt-0.5 text-rose-300" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-rose-200">No media file returned</div>
            <div className="text-[11px] text-rose-100/60 mt-0.5">
              The dashboard couldn't read a saved file from Hermes's reply.
            </div>
            {result.text && (
              <details className="mt-2" open={result.text.length < 240}>
                <summary className="text-[10.5px] uppercase tracking-widest text-rose-300 cursor-pointer hover:text-rose-200">Hermes reply ({result.text.length} chars)</summary>
                <div className="mt-1 text-[10.5px] text-rose-100/80 font-[var(--font-geist-mono)] bg-black/30 rounded p-2 break-all whitespace-pre-wrap">
                  {result.text}
                </div>
              </details>
            )}
          </div>
        </div>
      )}

      {/* Metadata */}
      <div className="p-3">
        <div className="text-[12.5px] text-[var(--fg)] line-clamp-2 leading-snug" style={{ color: "var(--fg)" }}>
          {result.prompt}
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">
          <span className="flex items-center gap-1.5">
            <Clock size={9} />
            {new Date(result.createdAt).toLocaleTimeString("en-GB", { hour12: false })} · {(result.durationMs / 1000).toFixed(1)}s
          </span>
          {hasMedia && (
            <a
              href={`/api/media/file?path=${encodeURIComponent(result.paths[0])}`}
              download
              className="flex items-center gap-1 hover:text-[var(--fg-dim)] transition"
              style={{ color: accent }}
            >
              <Download size={11} /> Save
            </a>
          )}
        </div>
      </div>
    </motion.div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ExternalLink, X, Play } from "lucide-react";

const ACCENT = "#22d3ee";
const PROJECT = "free-claude-code";

interface Build { relPath: string; mtime: number; }

// Live thumbnail that only mounts its iframe while scrolled into view (and
// unmounts when out of view) — so at most ~a dozen render at once, not all 52.
// Rendered at 4× then scaled to 0.25 so the build sees a desktop-ish viewport.
function BuildThumb({ url }: { url: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => setVis(e.isIntersecting), { rootMargin: "150px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className="aspect-video rounded overflow-hidden relative mb-1.5"
      style={{ background: "rgba(0,0,0,0.4)", border: `1px solid ${ACCENT}22` }}>
      {vis ? (
        <iframe src={url} title="" scrolling="no" tabIndex={-1}
          sandbox="allow-scripts allow-same-origin"
          style={{ width: "400%", height: "400%", border: 0, transform: "scale(0.25)", transformOrigin: "0 0", pointerEvents: "none" }} />
      ) : (
        <div className="absolute inset-0 grid place-items-center"><Play size={16} style={{ color: ACCENT }} /></div>
      )}
    </div>
  );
}

function fmtAgo(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); return `${d}d ago`;
}
function niceName(rel: string): string {
  return rel.replace(/\.html$/, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function previewUrl(rel: string): string {
  return `/api/freeclaude/preview/${PROJECT}/${rel}`;
}

// Gallery of everything built via Hermes-Jarvis ("build me a galaxy" → a real app).
// Previews load on-demand only — no auto-playing iframe thumbnails to pin the CPU.
export default function JarvisBuilds({ initial = 6 }: { initial?: number }) {
  const [builds, setBuilds] = useState<Build[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(initial);

  useEffect(() => {
    fetch(`/api/freeclaude/workspace?project=${PROJECT}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { files?: { relPath: string; mtime: number }[] }) =>
        setBuilds((j.files || []).filter((f) => f.relPath.endsWith(".html")).sort((a, b) => b.mtime - a.mtime)))
      .catch(() => {});
  }, []);

  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Sparkles size={14} style={{ color: ACCENT }} />
        <span className="text-[13px] font-medium" style={{ color: "var(--fg)" }}>Built with Hermes-Jarvis</span>
        <span className="text-[11px]" style={{ color: "var(--fg-dimmer)" }}>· {builds.length} creations</span>
        <span className="ml-auto text-[11px]" style={{ color: "var(--fg-dimmer)" }}>say &ldquo;build me…&rdquo; in Hermes-Jarvis</span>
      </div>

      {builds.length === 0 ? (
        <div className="text-[12px] py-6 text-center" style={{ color: "var(--fg-dimmer)" }}>
          Nothing built yet — open Hermes-Jarvis and say &ldquo;build me a galaxy.&rdquo;
        </div>
      ) : (
        <>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
          {builds.slice(0, shown).map((b, i) => (
            <motion.button
              key={b.relPath}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.4) }}
              onClick={() => setOpen(b.relPath)}
              className="text-left rounded-lg border p-2.5 transition hover:brightness-125"
              style={{ borderColor: `${ACCENT}33`, background: `${ACCENT}0a` }}
            >
              <BuildThumb url={previewUrl(b.relPath)} />
              <div className="text-[11.5px] font-medium truncate" style={{ color: "var(--fg)" }}>{niceName(b.relPath)}</div>
              <div className="text-[10px]" style={{ color: "var(--fg-dimmer)" }}>{fmtAgo(b.mtime)}</div>
            </motion.button>
          ))}
        </div>
        {shown < builds.length && (
          <button
            onClick={() => setShown((s) => s + initial)}
            className="mt-3 w-full rounded-lg border py-2 text-[12px] font-medium transition hover:brightness-125"
            style={{ borderColor: `${ACCENT}33`, background: `${ACCENT}0a`, color: ACCENT }}
          >
            See more · {builds.length - shown} more
          </button>
        )}
        </>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 grid place-items-center p-6" style={{ background: "rgba(0,0,0,0.72)" }}
            onClick={() => setOpen(null)}
          >
            <motion.div
              initial={{ scale: 0.96 }} animate={{ scale: 1 }} exit={{ scale: 0.96 }}
              className="w-full max-w-5xl rounded-xl overflow-hidden border" style={{ borderColor: `${ACCENT}44`, background: "var(--bg-mid)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 px-4 py-2.5 border-b" style={{ borderColor: "var(--line-soft)" }}>
                <Play size={13} style={{ color: ACCENT }} />
                <span className="text-[12.5px] font-medium truncate" style={{ color: "var(--fg)" }}>{niceName(open)}</span>
                <a href={previewUrl(open)} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 text-[11px] shrink-0" style={{ color: ACCENT }}>
                  <ExternalLink size={12} /> Open full
                </a>
                <button onClick={() => setOpen(null)} className="ml-1 shrink-0" aria-label="Close"><X size={15} style={{ color: "var(--fg-dim)" }} /></button>
              </div>
              <iframe src={previewUrl(open)} className="w-full h-[60vh] bg-black" title={open}
                sandbox="allow-scripts allow-same-origin allow-pointer-lock" allow="autoplay; fullscreen; gamepad" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

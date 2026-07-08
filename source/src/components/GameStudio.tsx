"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Gamepad2, Send, ExternalLink, X, Play, Loader2, CircleDot } from "lucide-react";

const ACCENT = "#39ff8e";
const PROJECT = "games";
const BOARD = "game-studio";

interface GameFile { relPath: string; mtime: number; }
interface BoardTask { id: string; title: string; status: string; assignee?: string; }

function ago(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function nice(rel: string): string {
  return rel.replace(/\.html$/, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
const playUrl = (rel: string) => `/api/freeclaude/preview/${PROJECT}/${rel}`;

// Live thumbnail — mounts its iframe only while in view (same pattern as the
// Jarvis gallery) so a long shelf of games doesn't pin the CPU.
function GameThumb({ url }: { url: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => setVis(e.isIntersecting), { rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className="aspect-video rounded-lg overflow-hidden relative"
      style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${ACCENT}22` }}>
      {vis ? (
        <iframe src={url} title="" scrolling="no" tabIndex={-1}
          sandbox="allow-scripts allow-same-origin"
          style={{ width: "400%", height: "400%", border: 0, transform: "scale(0.25)", transformOrigin: "0 0", pointerEvents: "none" }} />
      ) : (
        <div className="absolute inset-0 grid place-items-center"><Play size={18} style={{ color: ACCENT }} /></div>
      )}
    </div>
  );
}

export default function GameStudio() {
  const [games, setGames] = useState<GameFile[]>([]);
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const g = await (await fetch(`/api/freeclaude/workspace?project=${PROJECT}`, { cache: "no-store" })).json();
      setGames(((g.files ?? []) as GameFile[]).filter((f) => f.relPath.endsWith(".html")).sort((a, b) => b.mtime - a.mtime));
    } catch { /* */ }
    try {
      const b = await (await fetch(`/api/hermes/kanban/board?board=${BOARD}`, { cache: "no-store" })).json();
      const all = (b.columns ? Object.values(b.columns).flat() : b.tasks ?? []) as BoardTask[];
      setTasks(all.filter((t) => t && t.status && !["done", "archived"].includes(t.status)));
    } catch { /* */ }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 12000);
    return () => clearInterval(t);
  }, [refresh]);

  async function commission() {
    const p = prompt.trim();
    if (!p || sending) return;
    setSending(true); setNotice("");
    try {
      const r = await (await fetch("/api/games/commission", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: p }),
      })).json();
      if (r.ok) { setNotice(`Commissioned — the agent is on it (${r.file}). It appears below when it ships.`); setPrompt(""); }
      else setNotice(r.error ?? "Something went wrong.");
    } catch (e) { setNotice("Could not reach the studio: " + String(e)); }
    setSending(false);
    setTimeout(refresh, 1500);
  }

  return (
    <div className="space-y-5">
      {/* commission box */}
      <div className="panel p-5">
        <div className="flex items-center gap-2 mb-3">
          <Gamepad2 size={16} style={{ color: ACCENT }} />
          <span className="text-[14px] font-medium" style={{ color: "var(--fg)" }}>Commission the Game Agent</span>
          <span className="text-[11px]" style={{ color: "var(--fg-dimmer)" }}>· Claude 5 brain · single-file games · no libraries</span>
        </div>
        <div className="flex gap-2">
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commission(); }}
            placeholder='Describe a game… e.g. "a neon snake that grows through a 3D grid" — press Enter'
            className="flex-1 rounded-lg px-4 py-3 text-[14px] outline-none"
            style={{ background: "var(--bg-deep, rgba(0,0,0,0.35))", border: "1px solid var(--panel-border)", color: "var(--fg)" }}
          />
          <button onClick={commission} disabled={sending}
            className="flex items-center gap-2 rounded-lg px-5 font-semibold text-[13px]"
            style={{ background: `${ACCENT}22`, border: `1.5px solid ${ACCENT}`, color: ACCENT, opacity: sending ? 0.6 : 1 }}>
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Build it
          </button>
        </div>
        {notice && <div className="text-[12px] mt-2.5" style={{ color: ACCENT }}>{notice}</div>}
      </div>

      {/* in-flight commissions */}
      {tasks.length > 0 && (
        <div className="panel p-4">
          <div className="text-[11px] font-mono tracking-[0.22em] mb-2.5" style={{ color: "var(--fg-dimmer)" }}>▌IN THE WORKSHOP</div>
          <div className="space-y-2">
            {tasks.map((t) => (
              <div key={t.id} className="flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5"
                style={{ borderColor: t.status === "running" ? `${ACCENT}55` : "var(--panel-border)", background: t.status === "running" ? `${ACCENT}0a` : "transparent" }}>
                <CircleDot size={12} className={t.status === "running" ? "animate-pulse" : ""} style={{ color: t.status === "running" ? ACCENT : "var(--fg-dimmer)" }} />
                <span className="text-[12.5px] truncate" style={{ color: "var(--fg)" }}>{t.title}</span>
                <span className="ml-auto text-[10px] font-mono uppercase tracking-widest shrink-0" style={{ color: t.status === "running" ? ACCENT : "var(--fg-dimmer)" }}>{t.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* the shelf */}
      <div className="panel p-5">
        <div className="flex items-center gap-2 mb-3">
          <Play size={14} style={{ color: ACCENT }} />
          <span className="text-[13px] font-medium" style={{ color: "var(--fg)" }}>The Shelf</span>
          <span className="text-[11px]" style={{ color: "var(--fg-dimmer)" }}>· {games.length} game{games.length === 1 ? "" : "s"} · click to play</span>
        </div>
        {games.length === 0 ? (
          <div className="text-center text-[12.5px] py-8" style={{ color: "var(--fg-dimmer)" }}>
            No games yet — commission one above.
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {games.map((g, i) => (
              <motion.button key={g.relPath}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.05, 0.4) }}
                onClick={() => setOpen(g.relPath)}
                className="text-left rounded-xl border p-2.5 transition hover:brightness-125"
                style={{ borderColor: `${ACCENT}30`, background: `${ACCENT}08` }}>
                <GameThumb url={playUrl(g.relPath)} />
                <div className="text-[12.5px] font-semibold mt-2 truncate" style={{ color: "var(--fg)" }}>{nice(g.relPath)}</div>
                <div className="text-[10.5px]" style={{ color: "var(--fg-dimmer)" }}>{ago(g.mtime)}</div>
              </motion.button>
            ))}
          </div>
        )}
      </div>

      {/* play modal */}
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 grid place-items-center p-5" style={{ background: "rgba(0,0,0,0.78)" }}
            onClick={() => setOpen(null)}>
            <motion.div initial={{ scale: 0.96 }} animate={{ scale: 1 }} exit={{ scale: 0.96 }}
              className="w-full max-w-6xl rounded-xl overflow-hidden border" style={{ borderColor: `${ACCENT}45`, background: "var(--bg-mid)" }}
              onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2 px-4 py-2.5 border-b" style={{ borderColor: "var(--panel-border)" }}>
                <Gamepad2 size={13} style={{ color: ACCENT }} />
                <span className="text-[12.5px] font-medium truncate" style={{ color: "var(--fg)" }}>{nice(open)}</span>
                <a href={playUrl(open)} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 text-[11px] shrink-0" style={{ color: ACCENT }}>
                  <ExternalLink size={12} /> Open full
                </a>
                <button onClick={() => setOpen(null)} className="ml-1 shrink-0" aria-label="Close"><X size={15} style={{ color: "var(--fg-dim)" }} /></button>
              </div>
              <iframe src={playUrl(open)} className="w-full h-[70vh] bg-black" title={open}
                sandbox="allow-scripts allow-same-origin allow-pointer-lock" allow="autoplay; fullscreen; gamepad" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, Send, Zap, Cpu, Radio, Maximize2, X, Newspaper, Target, ListChecks, Trophy, CheckCircle2, TrendingUp, Sparkles, FileText, Brain, Circle, Globe, History } from "lucide-react";
import JarvisBuilds from "./JarvisBuilds";
import JarvisRealtime from "./JarvisRealtime";

const CYAN = "#22d3ee";
const TEAL = "#34d399";
const AMBER = "#fbbf24";

interface Turn { id: number; who: "you" | "hermes"; text: string; working?: boolean }
type Phase = "idle" | "listening" | "thinking" | "speaking";

// OpenAI gpt-4o-mini-tts voices, steered to an English butler via server instructions.
const VOICES = [
  { id: "ash", label: "Ash (JARVIS · butler)" },
  { id: "onyx", label: "Onyx (deep)" },
  { id: "ballad", label: "Ballad (warm)" },
  { id: "echo", label: "Echo (crisp)" },
];

type SR = {
  start: () => void; stop: () => void; abort: () => void;
  continuous: boolean; interimResults: boolean; lang: string; maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onstart: (() => void) | null; onend: (() => void) | null;
};
function getSR(): { new (): SR } | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: { new (): SR }; webkitSpeechRecognition?: { new (): SR } };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

const phaseColor = (p: Phase) => (p === "thinking" ? AMBER : p === "listening" ? CYAN : p === "speaking" ? TEAL : CYAN);

// ── Synthesized sound design (no audio files — pure Web Audio oscillators) ──
// Sound effects disabled — Jarvis runs silent (no boot sound, no blips or chimes).
function makeSfx() {
  return {
    ensure() {},
    boot() {},
    listen() {},
    stop() {},
    wake() {},
    chime() {},
  };
}

// Heuristic: is this a "build me something" request → route to the local Agent
// Factory (builds a single HTML app on-device) and preview it in the HUD.
function looksLikeBuild(p: string): boolean {
  const s = p.toLowerCase();
  return /\b(build|make|create|generate|whip up|code(?:\s+me)?|design)\b/.test(s)
    && /\b(game|app|animation|animate|visual|visualis|visualiz|tool|toy|simulator|simulation|demo|website|web ?page|landing|canvas|clock|particles?|fractal|galaxy|snake|pong|tetris|breakout|effect|art|scene|starfield|fireworks|matrix|globe|3d)\b/.test(s);
}
const BUILD_PROJECT = "free-claude-code"; // shared with the Agent Factory gallery
function jPreviewUrl(file: string): string {
  return `/api/freeclaude/preview/${encodeURIComponent(BUILD_PROJECT)}/${file.split("/").map(encodeURIComponent).join("/")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ARC REACTOR — a self-contained, audio-reactive canvas core. Reads live phase
// + level from refs so it never forces React re-renders (smooth 60fps).
// ─────────────────────────────────────────────────────────────────────────────
function ArcReactor({ phaseRef, levelRef, size }: { phaseRef: React.MutableRefObject<Phase>; levelRef: React.MutableRefObject<number>; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    cv.width = size * dpr; cv.height = size * dpr; ctx.scale(dpr, dpr);
    let raf = 0; let t = 0;

    const hexToRgb = (h: string) => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };

    const draw = () => {
      t += 0.016;
      const phase = phaseRef.current;
      const lvl = levelRef.current;
      const c = phaseColor(phase);
      const [r, g, b] = hexToRgb(c);
      const rgba = (a: number) => `rgba(${r},${g},${b},${a})`;
      const cx = size / 2, cy = size / 2;
      const R = size * 0.34;

      ctx.clearRect(0, 0, size, size);

      // ambient radial glow
      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.5);
      bg.addColorStop(0, rgba(0.10 + lvl * 0.10));
      bg.addColorStop(0.6, rgba(0.03));
      bg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, size, size);

      // outer tick ring (slow rotate)
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * 0.15);
      ctx.strokeStyle = rgba(0.5); ctx.lineWidth = 1;
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        const long = i % 6 === 0;
        const r0 = R * 1.32, r1 = R * (long ? 1.42 : 1.37);
        ctx.globalAlpha = long ? 0.7 : 0.3;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); ctx.stroke();
      }
      ctx.restore(); ctx.globalAlpha = 1;

      // two HUD arcs counter-rotating
      ctx.lineWidth = 2;
      for (let k = 0; k < 2; k++) {
        const dir = k === 0 ? 1 : -1;
        const rr = R * (1.12 + k * 0.1);
        const start = t * (0.6 + k * 0.5) * dir;
        ctx.strokeStyle = rgba(0.55 - k * 0.2);
        ctx.beginPath(); ctx.arc(cx, cy, rr, start, start + Math.PI * (0.6 - k * 0.15)); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, rr, start + Math.PI, start + Math.PI + Math.PI * (0.6 - k * 0.15)); ctx.stroke();
      }

      // reactive corona — spikes driven by level
      const spikes = 96;
      ctx.save(); ctx.translate(cx, cy);
      ctx.shadowBlur = 12; ctx.shadowColor = rgba(0.6);
      for (let i = 0; i < spikes; i++) {
        const a = (i / spikes) * Math.PI * 2;
        const n = 0.5 + 0.5 * Math.sin(i * 1.7 + t * 4);
        const len = R * (0.06 + (lvl * 0.5 + 0.08) * n);
        ctx.strokeStyle = rgba(0.25 + n * 0.5 * (0.3 + lvl));
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * R, Math.sin(a) * R); ctx.lineTo(Math.cos(a) * (R + len), Math.sin(a) * (R + len)); ctx.stroke();
      }
      ctx.restore();

      // core ring
      ctx.shadowBlur = 18; ctx.shadowColor = rgba(0.7);
      ctx.strokeStyle = rgba(0.85); ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.62, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;

      // pulsing core
      const coreR = R * (0.30 + lvl * 0.22 + 0.03 * Math.sin(t * 3));
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      cg.addColorStop(0, "rgba(255,255,255,0.95)");
      cg.addColorStop(0.4, rgba(0.85));
      cg.addColorStop(1, rgba(0));
      ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, coreR, 0, Math.PI * 2); ctx.fill();

      // triangular reactor vanes inside the core ring
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-t * 0.4);
      ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1.5;
      for (let i = 0; i < 6; i++) {
        ctx.rotate(Math.PI / 3);
        ctx.beginPath(); ctx.moveTo(0, -R * 0.34); ctx.lineTo(R * 0.10, -R * 0.50); ctx.lineTo(-R * 0.10, -R * 0.50); ctx.closePath(); ctx.stroke();
      }
      ctx.restore();

      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [size, phaseRef, levelRef]);

  return <canvas ref={ref} style={{ width: size, height: size }} />;
}

// Animated wall backdrop — drifting particle field, perspective floor grid, and a
// slow radar sweep. Pure ambience behind the reactor.
function WallBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return; const ctx = cv.getContext("2d"); if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = 0, h = 0;
    const resize = () => { w = cv.clientWidth; h = cv.clientHeight; cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize(); window.addEventListener("resize", resize);
    const ps = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random() * 0.8 + 0.2, s: Math.random() * 1.6 + 0.3 }));
    let raf = 0, t = 0;
    const draw = () => {
      t += 0.016; ctx.clearRect(0, 0, w, h);
      for (const p of ps) {
        p.y -= 0.0007 * p.z; if (p.y < 0) { p.y = 1; p.x = Math.random(); }
        ctx.fillStyle = `rgba(34,211,238,${0.05 + p.z * 0.16})`;
        ctx.beginPath(); ctx.arc(p.x * w, p.y * h, p.s * p.z, 0, Math.PI * 2); ctx.fill();
      }
      // perspective floor grid
      ctx.strokeStyle = "rgba(34,211,238,0.07)"; ctx.lineWidth = 1;
      const horizon = h * 0.66, cxg = w / 2;
      for (let i = 1; i <= 9; i++) { const yy = horizon + (h - horizon) * (i / 9) ** 1.8; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(w, yy); ctx.stroke(); }
      for (let i = -12; i <= 12; i++) { ctx.beginPath(); ctx.moveTo(cxg + i * (w * 0.018), horizon); ctx.lineTo(cxg + i * (w * 0.16), h); ctx.stroke(); }
      // radar sweep behind the reactor
      const cx = w / 2, cy = h * 0.42, R = Math.min(w, h) * 0.55;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * 0.45);
      const g = ctx.createLinearGradient(0, 0, R, 0);
      g.addColorStop(0, "rgba(34,211,238,0.14)"); g.addColorStop(1, "rgba(34,211,238,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, -0.28, 0); ctx.closePath(); ctx.fill();
      ctx.restore();
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={ref} className="absolute inset-0 w-full h-full pointer-events-none" />;
}

// Audio-reactive waveform strip for the bottom of wall mode.
function Waveform({ levelRef }: { levelRef: React.MutableRefObject<number> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return; const ctx = cv.getContext("2d"); if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = 0, h = 0;
    const resize = () => { w = cv.clientWidth; h = cv.clientHeight; cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize(); window.addEventListener("resize", resize);
    let raf = 0, t = 0;
    const draw = () => {
      t += 0.06; ctx.clearRect(0, 0, w, h);
      const lvl = levelRef.current, cy = h / 2, gap = 7;
      for (let x = 3; x < w; x += gap) {
        const n = 0.5 + 0.5 * Math.sin(x * 0.045 + t) * Math.sin(x * 0.011 - t * 0.6);
        const bh = 3 + (lvl * 0.9 + 0.04) * h * n;
        ctx.fillStyle = `rgba(34,211,238,${0.22 + n * 0.5 * (0.4 + lvl)})`;
        ctx.fillRect(x, cy - bh / 2, 3, bh);
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, [levelRef]);
  return <canvas ref={ref} className="w-full" style={{ height: 56 }} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// ── "Show me …" — Jarvis paints a live HUD panel when you ask ──
type ShowKind = "gallery" | "chart" | "agents" | "system";
// Web Speech mishears a lot. Fix the common ones BEFORE we decide intent.
// (It hears "show me the builds" as "bill me", "my builds" as "my bills", etc.)
function normalizeHeard(p: string): string {
  let s = p;
  s = s.replace(/\bbill me(?: the)?(?: builds?)?\b/gi, "show me the builds");
  s = s.replace(/\bshow me the bills?\b/gi, "show me the builds");
  s = s.replace(/\b(my|the) bills?\b/gi, "$1 builds");
  return s;
}
function detectShow(p: string): ShowKind | null {
  const s = p.toLowerCase();
  const show = /\b(show|pull up|display|bring up|open up|let me see|let'?s see|see my|gimme|give me|what'?s in|what have|everything (i'?ve|i have))\b/.test(s);
  const gallery = /\b(builds?|built|creations?|created|gallery|made|making|workshop|apps?|games?|projects?|everything i)\b/.test(s);
  const chart = /\b(chart|graph|traffic|stats?|numbers?|analytics|growth|metrics|revenue|sales|progress|activity)\b/.test(s);
  const agents = /\b(agents?|team|company|paperclip|org|roster|employees?|crew)\b/.test(s);
  const system = /\b(system|status|diagnostics?|health|vitals|telemetry|readouts?)\b/.test(s);
  if (show && gallery) return "gallery";
  if (show && chart) return "chart";
  if (show && agents) return "agents";
  if (show && system) return "system";
  // bare references — catches dropped "show me the…"
  if (system) return "system";
  if (gallery && !/\b(game|app|website|web ?page|landing|tool|animation|clock|fractal|galaxy|snake|pong|fireworks|simulator|demo|scene|starfield)\b/.test(s)) return "gallery";
  return null;
}
function showLine(k: ShowKind): string {
  return k === "gallery" ? "Here's everything we've built, sir."
    : k === "chart" ? "Pulling up the numbers, sir."
    : k === "agents" ? "Here's the team, sir."
    : "Running a full diagnostic, sir.";
}

// "Jarvis, remember …" (save to vault) and "what do you remember about X" (recall from vault).
function detectMemory(p: string): { action: "save"; text: string } | { action: "recall"; query: string } | null {
  const s = p.toLowerCase();
  const recallRe = /\b(what (do you|did i (tell|ask) you to|have i told you to) remember|what'?s in (your|my) (memory|vault|notes)|do you remember|what do (you|i) know about|search (your|my) (memory|vault|notes))\b/;
  if (recallRe.test(s)) {
    const am = p.match(/\b(?:about|regarding|on|to do with|know about|remember)\s+(.+)/i);
    const query = am ? am[1].replace(/[?.!]+$/, "").replace(/^(about|regarding|on)\s+/i, "").trim() : "";
    return { action: "recall", query };
  }
  const m = p.match(/\b(?:remember(?:\s+that)?|note(?:\s+that|\s+to)?|don'?t forget(?:\s+that)?|make a note(?:\s+(?:that|of))?|take a note(?:\s+of)?|jot down)\b[:,]?\s+(.+)/i);
  if (m && m[1].trim().length > 2) return { action: "save", text: m[1].trim() };
  return null;
}

const SHOW_AGENTS = [
  { n: "Claude", c: "#d97757" }, { n: "OpenClaw", c: "#f472b6" }, { n: "Hermes", c: "#60a5fa" },
  { n: "Antigravity", c: "#7c3aed" }, { n: "Codex", c: "#22c55e" },
  { n: "Free Claude", c: "#10b981" }, { n: "Jarvis", c: "#22d3ee" },
];
function ShowPanel({ kind, onPlay }: { kind: ShowKind; onPlay: (f: string) => void }) {
  const [files, setFiles] = useState<{ relPath: string; mtime: number }[]>([]);
  useEffect(() => {
    fetch("/api/freeclaude/workspace?project=free-claude-code", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { files?: { relPath: string; mtime: number }[] }) =>
        setFiles((j.files || []).filter((f) => f.relPath.endsWith(".html"))))
      .catch(() => {});
  }, []);

  if (kind === "gallery") {
    const sorted = files.slice().sort((a, b) => b.mtime - a.mtime);
    return (
      <div className="w-full">
        <div className="text-[10px] font-mono tracking-[0.3em] mb-3" style={{ color: CYAN }}>» BUILD ARCHIVE · {files.length}</div>
        <div className="grid grid-cols-3 gap-2.5 max-h-[300px] overflow-y-auto pr-1">
          {sorted.map((f, i) => (
            <motion.button key={f.relPath} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              onClick={() => onPlay(f.relPath)} className="text-left rounded-lg border p-2.5 transition group"
              style={{ borderColor: `${CYAN}33`, background: "rgba(34,211,238,0.05)" }}>
              <div className="aspect-video rounded grid place-items-center mb-1.5" style={{ background: "rgba(0,0,0,0.4)", border: `1px solid ${CYAN}22` }}>
                <span className="text-[18px]" style={{ color: TEAL }}>▶</span>
              </div>
              <div className="text-[10.5px] font-mono truncate" style={{ color: "var(--fg-dim)" }}>{f.relPath.replace(/\.html$/, "").replace(/-/g, " ").slice(0, 24)}</div>
            </motion.button>
          ))}
          {files.length === 0 && <div className="col-span-3 text-center text-[12px] py-6" style={{ color: "var(--fg-dimmer)" }}>Nothing built yet — say &ldquo;build me a game&rdquo;.</div>}
        </div>
      </div>
    );
  }

  if (kind === "chart") {
    // REAL build activity — how many you actually built each of the last 7 days
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const buckets = [6, 5, 4, 3, 2, 1, 0].map((back) => {
      const start = today.getTime() - back * 86400000; const end = start + 86400000;
      return { count: files.filter((f) => f.mtime >= start && f.mtime < end).length, label: ["S", "M", "T", "W", "T", "F", "S"][new Date(start).getDay()] };
    });
    const max = Math.max(1, ...buckets.map((b) => b.count));
    const week = buckets.reduce((s, b) => s + b.count, 0);
    return (
      <div className="w-full text-center">
        <div className="text-[10px] font-mono tracking-[0.3em] mb-1" style={{ color: CYAN }}>» BUILD ACTIVITY · LAST 7 DAYS</div>
        <div className="text-[40px] font-bold leading-none" style={{ color: TEAL, fontFamily: "'Bricolage Grotesque',sans-serif" }}>{week}<span className="text-[15px] font-normal" style={{ color: "var(--fg-dim)" }}> this week</span></div>
        <div className="flex items-end justify-center gap-2.5 h-[150px] mt-3">
          {buckets.map((b, i) => (
            <div key={i} className="flex flex-col items-center justify-end h-full">
              <span className="text-[10px] font-mono mb-1" style={{ color: b.count ? TEAL : "var(--fg-dimmer)" }}>{b.count || ""}</span>
              <motion.div initial={{ height: 0 }} animate={{ height: `${Math.max(4, (b.count / max) * 100)}%` }} transition={{ delay: i * 0.08, type: "spring", stiffness: 120, damping: 14 }}
                className="w-7 rounded-t" style={{ background: b.count ? `linear-gradient(180deg, ${TEAL}, ${CYAN}55)` : "rgba(255,255,255,0.06)", boxShadow: b.count ? `0 0 14px ${CYAN}66` : "none" }} />
            </div>
          ))}
        </div>
        <div className="flex justify-center gap-2.5 mt-2 text-[9px] font-mono" style={{ color: "var(--fg-dimmer)" }}>
          {buckets.map((b, i) => <span key={i} className="w-7 text-center">{b.label}</span>)}
        </div>
        <div className="text-[11px] mt-3" style={{ color: "var(--fg-dim)" }}>{files.length} builds in your workshop, all-time.</div>
      </div>
    );
  }

  if (kind === "agents") return (
    <div className="w-full">
      <div className="text-[10px] font-mono tracking-[0.3em] mb-3" style={{ color: CYAN }}>» AGENT MESH · {SHOW_AGENTS.length} WIRED IN</div>
      <div className="grid grid-cols-2 gap-2.5">
        {SHOW_AGENTS.map((a, i) => (
          <motion.div key={a.n} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
            className="flex items-center gap-2.5 rounded-lg border px-3 py-2" style={{ borderColor: `${a.c}40`, background: `${a.c}10` }}>
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: a.c, boxShadow: `0 0 8px ${a.c}` }} />
            <span className="text-[12.5px]" style={{ color: "var(--fg)" }}>{a.n}</span>
            <span className="ml-auto text-[9px] font-mono tracking-widest" style={{ color: a.c }}>READY</span>
          </motion.div>
        ))}
      </div>
    </div>
  );

  // system — REAL readouts, not invented gauges
  const stats: [string, string][] = [
    ["Builds made", String(files.length)],
    ["Agents wired", `${SHOW_AGENTS.length} ready`],
    ["Build engine", "local · on-device"],
    ["Voice", "online"],
    ["Local time", new Date().toLocaleTimeString("en-GB", { hour12: false })],
  ];
  return (
    <div className="w-full">
      <div className="text-[10px] font-mono tracking-[0.3em] mb-3" style={{ color: TEAL }}>» SYSTEM · ALL NOMINAL</div>
      <div className="space-y-2.5">
        {stats.map(([label, val], i) => (
          <motion.div key={label} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}
            className="flex items-center justify-between rounded-lg border px-3.5 py-2.5 font-mono" style={{ borderColor: `${CYAN}33`, background: "rgba(34,211,238,0.05)" }}>
            <span className="text-[12px]" style={{ color: "var(--fg-dim)" }}>{label}</span>
            <span className="text-[13px]" style={{ color: CYAN }}>{val}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ── BRIEFING — a vault-grounded daily/weekly briefing, rendered as a HUD panel ──
// ─────────────────────────────────────────────────────────────────────────────
interface BriefingTask { text: string; note: string; path: string }
interface BriefingNote { title: string; path: string }
interface Briefing {
  ok: boolean; id?: string; range: "daily" | "weekly"; generatedAt: number; dateLabel: string;
  vault: string;
  greeting: string; headline: string; spoken: string;
  stats: { label: string; value: string }[];
  focus: string[]; tasks: BriefingTask[]; themes: string[];
  worked: BriefingNote[]; captures: string[]; wins: string[];
  news: { title: string; url: string }[];
  activity: { label: string; count: number }[]; error?: string;
}

// Deep-link into Obsidian to open a note at its vault-relative path.
function obsidianUrl(vault: string, file: string): string {
  return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(file)}`;
}

// "Jarvis, brief me" / "give me my weekly briefing" / "what's on my plate today".
function detectBriefing(p: string): "daily" | "weekly" | null {
  const s = p.toLowerCase();
  const trigger = /\b(brief(?:ing)?(?:\s+me)?|debrief|rundown|run me through (?:my|the) (?:day|week)|catch me up|morning report|daily report|stand[\s-]?up|game ?plan|what'?s on (?:my plate|the agenda|my agenda|for (?:today|the week))|what should i (?:focus on|do|prioriti[sz]e)(?: today| this week)?|my (?:agenda|priorities|plan)(?: (?:for )?(?:today|this week))?)\b/.test(s);
  if (!trigger) return null;
  return /\bweek(?:ly|'?s)?\b/.test(s) ? "weekly" : "daily";
}

function BriefSection({ icon, title, color, children }: { icon: React.ReactNode; title: string; color: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: "var(--panel-border)", background: "rgba(0,0,0,0.22)" }}>
      <div className="flex items-center gap-1.5 text-[10px] font-mono tracking-[0.2em] uppercase mb-2.5" style={{ color }}>{icon}{title}</div>
      {children}
    </div>
  );
}

function BriefingPanel({ briefing, loading, range, history, showHistory, historyLoading, onRange, onToggleHistory, onPickHistory, onClose }: {
  briefing: Briefing | null; loading: boolean; range: "daily" | "weekly";
  history: Briefing[]; showHistory: boolean; historyLoading: boolean;
  onRange: (r: "daily" | "weekly") => void; onToggleHistory: () => void;
  onPickHistory: (b: Briefing) => void; onClose: () => void;
}) {
  const b = briefing;
  const fmtWhen = (ts: number) => new Date(ts).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <div className="rounded-2xl border overflow-hidden" style={{ borderColor: `${CYAN}55`, background: "linear-gradient(180deg, rgba(34,211,238,0.06), rgba(0,0,0,0.45))" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: `${CYAN}33`, background: "rgba(34,211,238,0.06)" }}>
        <div className="flex items-center gap-2.5">
          <Newspaper size={16} style={{ color: CYAN }} />
          <div>
            <div className="text-[12px] font-mono tracking-[0.25em]" style={{ color: CYAN }}>{showHistory ? "BRIEFING HISTORY" : range === "weekly" ? "WEEKLY BRIEFING" : "DAILY BRIEFING"}</div>
            <div className="text-[11px]" style={{ color: "var(--fg-dim)" }}>{showHistory ? "Past briefings — tap to reopen" : (b?.dateLabel || "…")}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {!showHistory && (
            <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: `${CYAN}33` }}>
              {(["daily", "weekly"] as const).map((r) => (
                <button key={r} onClick={() => onRange(r)} className="px-2.5 h-7 text-[11px] capitalize transition"
                  style={{ background: range === r ? "rgba(34,211,238,0.18)" : "transparent", color: range === r ? CYAN : "var(--fg-dim)" }}>{r}</button>
              ))}
            </div>
          )}
          <button onClick={onToggleHistory} title="Past briefings"
            className="p-1.5 rounded-lg border transition"
            style={{ borderColor: showHistory ? CYAN : `${CYAN}33`, color: showHistory ? CYAN : "var(--fg-dim)", background: showHistory ? "rgba(34,211,238,0.14)" : "transparent" }}>
            <History size={14} />
          </button>
          <button onClick={onClose} title="Dismiss" className="p-1.5 rounded-lg hover:bg-rose-500/15 text-rose-300/80"><X size={14} /></button>
        </div>
      </div>

      {showHistory ? (
        <div className="p-4 max-h-[460px] overflow-y-auto">
          {historyLoading && <div className="text-center text-[12.5px] font-mono py-6" style={{ color: CYAN }}><span className="animate-pulse">» Loading history…</span></div>}
          {!historyLoading && history.length === 0 && (
            <div className="text-center text-[12.5px] py-8" style={{ color: "var(--fg-dimmer)" }}>No saved briefings yet — generate one and it&rsquo;ll appear here.</div>
          )}
          {!historyLoading && history.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-mono tracking-[0.2em] uppercase mb-1" style={{ color: CYAN }}>» {history.length} saved</div>
              {history.map((h) => (
                <button key={h.id || h.generatedAt} onClick={() => onPickHistory(h)}
                  className="w-full text-left rounded-lg border p-2.5 transition hover:border-[var(--panel-border-hot)]"
                  style={{ borderColor: "var(--panel-border)", background: "rgba(0,0,0,0.22)" }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[8.5px] font-mono px-1.5 py-0.5 rounded tracking-wider"
                      style={{ background: h.range === "weekly" ? "rgba(167,139,250,0.15)" : "rgba(34,211,238,0.15)", color: h.range === "weekly" ? "#c4b5fd" : CYAN }}>
                      {h.range === "weekly" ? "WEEKLY" : "DAILY"}
                    </span>
                    <span className="text-[10.5px] font-mono" style={{ color: "var(--fg-dimmer)" }}>{fmtWhen(h.generatedAt)}</span>
                  </div>
                  <div className="text-[12.5px] leading-snug" style={{ color: "var(--fg)" }}>{h.headline}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
      <>
      {loading && (
        <div className="p-8 text-center text-[12.5px] font-mono" style={{ color: CYAN }}>
          <span className="inline-block animate-pulse">» Reading your vault, sir…</span>
        </div>
      )}

      {!loading && b && (
        <div className="p-4 space-y-3.5 max-h-[460px] overflow-y-auto">
          <div>
            <div className="text-[11px] font-mono mb-1" style={{ color: TEAL }}>{b.greeting}</div>
            <div className="text-[16px] leading-snug" style={{ color: "var(--fg)", fontFamily: "'Bricolage Grotesque',sans-serif" }}>{b.headline}</div>
          </div>

          {b.stats?.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {b.stats.map((s) => (
                <div key={s.label} className="rounded-lg border p-2.5 text-center" style={{ borderColor: `${CYAN}26`, background: "rgba(34,211,238,0.05)" }}>
                  <div className="text-[22px] font-bold leading-none" style={{ color: TEAL, fontFamily: "'Bricolage Grotesque',sans-serif" }}>{s.value}</div>
                  <div className="text-[9.5px] mt-1" style={{ color: "var(--fg-dim)" }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {b.focus?.length > 0 && (
            <BriefSection icon={<Target size={13} />} title="Suggested focus" color={AMBER}>
              <ol className="space-y-1.5">
                {b.focus.map((f, i) => (
                  <li key={i} className="flex gap-2 text-[13px]" style={{ color: "var(--fg)" }}>
                    <span className="font-mono shrink-0" style={{ color: AMBER }}>{i + 1}.</span><span>{f}</span>
                  </li>
                ))}
              </ol>
            </BriefSection>
          )}

          {b.tasks?.length > 0 && (
            <BriefSection icon={<ListChecks size={13} />} title={`Open action items · ${b.tasks.length}`} color={CYAN}>
              <div className="space-y-1.5">
                {b.tasks.map((t, i) => {
                  const href = b.vault && t.path ? obsidianUrl(b.vault, t.path) : null;
                  const inner = (
                    <>
                      <Circle size={13} className="mt-0.5 shrink-0" style={{ color: CYAN }} />
                      <span>{t.text} <span className="text-[10.5px] font-mono" style={{ color: "var(--fg-dimmer)" }}>· {t.note}</span></span>
                    </>
                  );
                  return href ? (
                    <a key={i} href={href} title={`Open "${t.note}" in Obsidian`} className="flex items-start gap-2 text-[13px] group" style={{ color: "var(--fg)" }}>
                      <Circle size={13} className="mt-0.5 shrink-0 transition-transform group-hover:scale-125" style={{ color: CYAN }} />
                      <span className="group-hover:underline">{t.text} <span className="text-[10.5px] font-mono no-underline" style={{ color: "var(--fg-dimmer)" }}>· {t.note}</span></span>
                    </a>
                  ) : (
                    <div key={i} className="flex items-start gap-2 text-[13px]" style={{ color: "var(--fg)" }}>{inner}</div>
                  );
                })}
              </div>
            </BriefSection>
          )}

          {b.wins?.length > 0 && (
            <BriefSection icon={<Trophy size={13} />} title={`Done this week · ${b.wins.length}`} color={TEAL}>
              <div className="space-y-1">
                {b.wins.slice(0, 8).map((w, i) => (
                  <div key={i} className="flex items-start gap-2 text-[12.5px]" style={{ color: "var(--fg-dim)" }}>
                    <CheckCircle2 size={13} className="mt-0.5 shrink-0" style={{ color: TEAL }} /><span>{w}</span>
                  </div>
                ))}
              </div>
            </BriefSection>
          )}

          {b.activity?.length > 0 && (
            <BriefSection icon={<TrendingUp size={13} />} title="Activity · last 7 days" color={CYAN}>
              <div className="flex items-end gap-2 h-[64px]">
                {(() => {
                  const max = Math.max(1, ...b.activity.map((a) => a.count));
                  return b.activity.map((a, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
                      <span className="text-[9px] font-mono mb-1" style={{ color: a.count ? TEAL : "var(--fg-dimmer)" }}>{a.count || ""}</span>
                      <div className="w-full rounded-t" style={{ height: `${Math.max(4, (a.count / max) * 100)}%`, background: a.count ? `linear-gradient(180deg, ${TEAL}, ${CYAN}55)` : "rgba(255,255,255,0.06)" }} />
                      <span className="text-[9px] font-mono mt-1" style={{ color: "var(--fg-dimmer)" }}>{a.label}</span>
                    </div>
                  ));
                })()}
              </div>
            </BriefSection>
          )}

          {b.themes?.length > 0 && (
            <BriefSection icon={<Sparkles size={13} />} title="Themes" color="#a78bfa">
              <div className="flex flex-wrap gap-1.5">
                {b.themes.map((t, i) => (
                  <span key={i} className="px-2.5 py-1 rounded-full text-[11px] border" style={{ borderColor: "rgba(167,139,250,0.35)", background: "rgba(167,139,250,0.1)", color: "#c4b5fd" }}>{t}</span>
                ))}
              </div>
            </BriefSection>
          )}

          {b.worked?.length > 0 && (
            <BriefSection icon={<FileText size={13} />} title="Worked on" color="var(--fg-dim)">
              <div className="flex flex-wrap gap-1.5">
                {b.worked.map((w, i) => {
                  const href = b.vault && w.path ? obsidianUrl(b.vault, w.path) : null;
                  const cls = "px-2 py-1 rounded-md text-[11.5px] border transition";
                  const st = { borderColor: "var(--panel-border)", background: "rgba(255,255,255,0.03)", color: "var(--fg-dim)" };
                  return href ? (
                    <a key={i} href={href} title={`Open "${w.title}" in Obsidian`} className={`${cls} hover:text-[var(--fg)]`} style={st}>{w.title}</a>
                  ) : (
                    <span key={i} className={cls} style={st}>{w.title}</span>
                  );
                })}
              </div>
            </BriefSection>
          )}

          {b.captures?.length > 0 && (
            <BriefSection icon={<Brain size={13} />} title="On your mind" color={TEAL}>
              <div className="space-y-1">
                {b.captures.slice(0, 6).map((c, i) => (
                  <div key={i} className="text-[12px] flex gap-2" style={{ color: "var(--fg-dim)" }}><span style={{ color: TEAL }}>›</span><span>{c}</span></div>
                ))}
              </div>
            </BriefSection>
          )}

          {b.news?.length > 0 && (
            <BriefSection icon={<Globe size={13} />} title="Headlines" color="#60a5fa">
              <div className="space-y-1.5">
                {b.news.slice(0, 5).map((n, i) => (
                  <a key={i} href={n.url} target="_blank" rel="noopener noreferrer"
                    className="text-[12.5px] flex gap-2 group" style={{ color: "var(--fg-dim)" }}>
                    <span style={{ color: "#60a5fa" }}>›</span>
                    <span className="group-hover:underline" style={{ color: "var(--fg)" }}>{n.title}</span>
                  </a>
                ))}
              </div>
            </BriefSection>
          )}

          {!b.ok && <div className="text-[12px] text-rose-300/80">{b.error || "Briefing unavailable."}</div>}
        </div>
      )}
      </>
      )}
    </div>
  );
}

export default function JarvisView() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [live, setLive] = useState(false);   // hands-free continuous conversation
  const [realtime, setRealtime] = useState(true);   // OpenAI Realtime speech-to-speech mode — default ON (auto-connects)
  const [wake, setWake] = useState(false);
  const [wall, setWall] = useState(false);
  const [status, setStatus] = useState("Tap the core and speak — or enable the wake word.");
  const [voice, setVoice] = useState("ash");
  const [mode, setMode] = useState<"auto" | "agent">("auto");
  const [input, setInput] = useState("");
  const [supported, setSupported] = useState<boolean | null>(null);
  const [clock, setClock] = useState("");
  const [phaseState, setPhaseState] = useState<Phase>("idle");
  const [building, setBuilding] = useState(false);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [showKind, setShowKind] = useState<ShowKind | null>(null);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [briefingRange, setBriefingRange] = useState<"daily" | "weekly">("daily");
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefHistory, setBriefHistory] = useState<Briefing[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [telem, setTelem] = useState({ throughput: 87, latency: 0.4, load: 32, signal: 98 });

  const audioRef = useRef<HTMLAudioElement>(null);
  const recRef = useRef<SR | null>(null);
  const wakeRef = useRef<SR | null>(null);
  const idRef = useRef(0);
  const busyRef = useRef(false);
  const armedRef = useRef(false);
  const wakeOnRef = useRef(false);
  const wakeRunningRef = useRef(false);   // is the wake recognizer currently live?
  const wakeBackoffRef = useRef(0);        // backoff counter to stop error-loops
  const listeningRef = useRef(false);      // push-to-talk active? (so wake won't collide)
  const liveRef = useRef(false);           // live hands-free loop active?
  const typingRef = useRef(false);         // user is typing → pause the mic so it doesn't transcribe over them
  const phaseRef = useRef<Phase>("idle");
  const levelRef = useRef(0.12);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const lvlRafRef = useRef(0);
  const sfxRef = useRef<ReturnType<typeof makeSfx> | null>(null);
  if (!sfxRef.current && typeof window !== "undefined") sfxRef.current = makeSfx();

  const setPhase = useCallback((p: Phase) => { phaseRef.current = p; setPhaseState(p); }, []);

  useEffect(() => { setSupported(!!getSR()); }, []);

  // Log every turn to disk + the Obsidian vault (fire-and-forget — never block).
  function logTurn(you: string, jarvis: string, kind: string) {
    fetch("/api/hermes/jarvis-log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ you, jarvis, kind }) }).catch(() => {});
  }

  // Load the saved transcript on open, so history survives reloads + tab switches.
  useEffect(() => {
    fetch("/api/hermes/jarvis-log", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { turns?: { you: string; jarvis: string }[] }) => {
        const loaded: Turn[] = [];
        for (const t of (j.turns || [])) {
          if (t.jarvis) loaded.push({ id: ++idRef.current, who: "hermes", text: t.jarvis });
          if (t.you) loaded.push({ id: ++idRef.current, who: "you", text: t.you });
        }
        if (loaded.length) setTurns((cur) => (cur.length ? cur : loaded));
      })
      .catch(() => {});
  }, []);

  // live clock (HUD)
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("en-GB", { hour12: false }));
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id);
  }, []);

  // drive levelRef: real audio analysis while speaking, procedural otherwise
  useEffect(() => {
    const loop = () => {
      const phase = phaseRef.current;
      let target = 0.12;
      if (phase === "speaking" && analyserRef.current) {
        const an = analyserRef.current; const arr = new Uint8Array(an.frequencyBinCount);
        an.getByteFrequencyData(arr); let s = 0; for (const v of arr) s += v;
        target = Math.min(1, (s / arr.length) / 130);
      } else if (phase === "listening") {
        target = 0.45 + 0.22 * Math.abs(Math.sin(performance.now() / 130));
      } else if (phase === "thinking") {
        target = 0.32 + 0.18 * Math.abs(Math.sin(performance.now() / 90));
      }
      levelRef.current += (target - levelRef.current) * 0.18;
      lvlRafRef.current = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(lvlRafRef.current);
  }, []);

  // ── Boot-up sequence on mount (visual + sound only — no spoken briefing) ──
  useEffect(() => {
    const t = setTimeout(() => { setBooting(false); sfxRef.current?.boot(); }, 2600);
    return () => clearTimeout(t);
  }, []);

  // Unlock the sound effects on the first user interaction (browser autoplay policy).
  useEffect(() => {
    const unlock = () => { sfxRef.current?.ensure(); };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => { window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
  }, []);

  function ensureAnalyser() {
    if (analyserRef.current || !audioRef.current) return;
    try {
      const AC = (window as unknown as { AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext });
      const Ctor = AC.AudioContext || AC.webkitAudioContext!;
      const ctx = new Ctor(); audioCtxRef.current = ctx;
      const src = ctx.createMediaElementSource(audioRef.current);
      const an = ctx.createAnalyser(); an.fftSize = 128; an.smoothingTimeConstant = 0.7;
      src.connect(an); an.connect(ctx.destination); analyserRef.current = an;
    } catch { /* analysis optional */ }
  }

  async function speak(text: string) {
    try {
      const r = await fetch("/api/hermes/tts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.slice(0, 600), voiceId: voice, provider: "openai" }),
      });
      const j = await r.json();
      if (j.audio && audioRef.current) {
        ensureAnalyser(); audioCtxRef.current?.resume().catch(() => {});
        audioRef.current.src = j.audio;
        audioRef.current.onended = () => { setPhase("idle"); resumeAfterReply(); };
        setPhase("speaking");
        audioRef.current.play().catch(() => {});
      } else { setPhase("idle"); resumeAfterReply(); }
    } catch { setPhase("idle"); resumeAfterReply(); }
  }

  // After Jarvis finishes a reply: in LIVE mode, reopen the mic automatically (a
  // short delay so it doesn't hear its own audio tail); else fall back to the wake loop.
  function resumeAfterReply() {
    if (liveRef.current) { setTimeout(() => { if (liveRef.current && !busyRef.current && !listeningRef.current && !typingRef.current) startListening(); }, 250); }
    else if (wakeOnRef.current) restartWake();
  }

  // BUILD → preview: route a "build me a …" request to the local Agent Factory,
  // then show the running app live in the Jarvis HUD.
  async function buildAndPreview(prompt: string) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setBuilding(true); setPhase("thinking");
    try { wakeRef.current?.stop(); } catch {}
    const youId = ++idRef.current; const hermesId = ++idRef.current;
    setTurns((t) => [{ id: hermesId, who: "hermes", text: "Building it on your Mac, sir…", working: true }, { id: youId, who: "you", text: prompt }, ...t]);
    setStatus("Building it on your Mac, sir…");
    let file: string | null = null, err: string | null = null;
    try {
      const r = await fetch("/api/freeclaude/build", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, project: BUILD_PROJECT }) });
      if (r.body) {
        const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
        while (true) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n"); buf = lines.pop() ?? "";
          for (const line of lines) { if (!line.trim()) continue; try { const j = JSON.parse(line); if (j.t === "done") file = j.file; else if (j.t === "error") err = j.m; } catch {} } }
      }
    } catch (e) { err = String(e); }
    if (file) {
      setPreviewFile(file);
      const reply = "Built and running, sir — have a look.";
      setTurns((t) => t.map((x) => x.id === hermesId ? { ...x, text: reply, working: false } : x));
      setStatus("Built · previewing →"); speak(reply); logTurn(prompt, reply, "build");
    } else {
      const reply = err ? `I hit a snag building that, sir — ${err}` : "I couldn't build that, sir — try rephrasing.";
      setTurns((t) => t.map((x) => x.id === hermesId ? { ...x, text: reply, working: false } : x));
      setStatus(reply); setPhase("idle"); if (wakeOnRef.current) restartWake();
    }
    busyRef.current = false; setBusy(false); setBuilding(false);
  }

  // BRIEFING → fetch a vault-grounded daily/weekly briefing, render the HUD panel,
  // and speak the summary aloud. Switching range re-runs against the same endpoint.
  // Load the saved briefing history (newest first).
  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const r = await fetch("/api/hermes/briefing?history=1&limit=60", { cache: "no-store" });
      const j = await r.json();
      setBriefHistory(Array.isArray(j.briefings) ? j.briefings : []);
    } catch { setBriefHistory([]); }
    setHistoryLoading(false);
  }

  async function runBriefing(range: "daily" | "weekly", prompt?: string) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setPhase("thinking");
    try { wakeRef.current?.stop(); } catch {}
    setShowHistory(false);
    setBriefingRange(range); setBriefing(null); setBriefingLoading(true);
    const label = range === "weekly" ? "weekly briefing" : "daily briefing";
    const yId = ++idRef.current, hId = ++idRef.current;
    const asked = prompt || `Give me my ${label}.`;
    setTurns((t) => [{ id: hId, who: "hermes", text: `Pulling your ${label} from the vault, sir…`, working: true }, { id: yId, who: "you", text: asked }, ...t]);
    setStatus(`Preparing your ${label}, sir…`);
    try {
      const r = await fetch(`/api/hermes/briefing?range=${range}`, { cache: "no-store" });
      const b: Briefing = await r.json();
      setBriefing(b); setBriefingLoading(false);
      const reply = b.spoken || b.headline || "Your briefing is ready, sir.";
      setTurns((t) => t.map((x) => x.id === hId ? { ...x, text: reply, working: false } : x));
      setStatus(b.ok ? "Briefing ready, sir." : (b.error || "Briefing unavailable."));
      sfxRef.current?.chime();
      if (b.ok) speak(reply); else { setPhase("idle"); if (wakeOnRef.current) restartWake(); }
      logTurn(asked, reply, "briefing");
    } catch (e) {
      setBriefingLoading(false);
      const reply = "I couldn't prepare your briefing, sir — " + String(e);
      setTurns((t) => t.map((x) => x.id === hId ? { ...x, text: reply, working: false } : x));
      setStatus("Briefing failed."); setPhase("idle"); if (wakeOnRef.current) restartWake();
    }
    busyRef.current = false; setBusy(false);
  }

  const ask = useCallback(async (prompt: string) => {
    const p = normalizeHeard((prompt || "").trim());
    if (!p || busyRef.current) return;

    // ── Voice memory: "remember …" / "what do you remember" ──
    const mem = detectMemory(p);
    if (mem) {
      if (mem.action === "save") {
        fetch("/api/hermes/jarvis-memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: mem.text }) }).catch(() => {});
        const line = "Noted, sir — I'll remember that.";
        setTurns((t) => [{ id: ++idRef.current, who: "hermes", text: line }, { id: ++idRef.current, who: "you", text: p }, ...t]);
        setStatus(line); sfxRef.current?.chime(); speak(line); logTurn(p, line, "memory"); return;
      }
      busyRef.current = true; setBusy(true); setPhase("thinking");
      const ep = mem.query ? `/api/memory/search?q=${encodeURIComponent(mem.query)}` : "/api/memory/omi?limit=8";
      const r = await fetch(ep, { cache: "no-store" }).then((x) => x.json()).catch(() => ({}));
      const omi = (r.omi || r.items || []) as string[];
      const notes = (r.notes || []) as { title: string; preview: string }[];
      const bits = [...omi.slice(0, 5), ...notes.slice(0, 2).map((n) => `${n.title} — ${n.preview}`)];
      const line = bits.length
        ? (mem.query ? `From your vault on "${mem.query}", sir: ` : "From your memory, sir: ") + bits.join(" · ")
        : (mem.query ? `Nothing in your vault about "${mem.query}", sir.` : "Your memory vault looks empty, sir.");
      setTurns((t) => [{ id: ++idRef.current, who: "hermes", text: line }, { id: ++idRef.current, who: "you", text: p }, ...t]);
      setStatus("Recalled from your vault."); sfxRef.current?.chime(); speak(line); logTurn(p, line, "memory");
      busyRef.current = false; setBusy(false); return;
    }

    // ── Briefing: "brief me" / "weekly briefing" / "what's on my plate today" ──
    const brf = detectBriefing(p);
    if (brf) { runBriefing(brf, p); return; }

    // Recap questions ("what happened yesterday") flow to the normal chat below —
    // it's vault-grounded server-side (reads your Omi memory + that day's notes).

    if (looksLikeBuild(p)) { buildAndPreview(p); return; }
    const sk = detectShow(p);
    if (sk) {
      setShowKind(sk); const line = showLine(sk);
      const yId = ++idRef.current, hId = ++idRef.current;
      setTurns((t) => [{ id: hId, who: "hermes", text: line }, { id: yId, who: "you", text: p }, ...t]);
      setStatus(line); sfxRef.current?.chime(); speak(line); logTurn(p, line, "show"); return;
    }
    busyRef.current = true; setBusy(true);
    setPhase("thinking");                       // INSTANT feedback — zero dead air
    try { wakeRef.current?.stop(); } catch {}    // don't let Jarvis hear itself
    const youId = ++idRef.current; const hermesId = ++idRef.current;
    setTurns((t) => [{ id: hermesId, who: "hermes", text: mode === "agent" ? "On it, sir…" : "…", working: true }, { id: youId, who: "you", text: p }, ...t]);
    setStatus(mode === "agent" ? "JARVIS is acting…" : "JARVIS is thinking…");
    try {
      const history = [...turns].reverse().slice(-6).map((x) => ({ role: (x.who === "you" ? "user" : "assistant") as "user" | "assistant", content: x.text }));
      const r = await fetch("/api/hermes/jarvis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: p, mode, history }) });
      const j = await r.json();
      const reply = String(j.text || j.error || "(no response)").trim();
      setTurns((t) => t.map((x) => x.id === hermesId ? { ...x, text: reply, working: false } : x));
      setStatus(j.ms ? `Replied in ${(j.ms / 1000).toFixed(1)}s` : "Done.");
      logTurn(p, reply, mode === "agent" ? "agent" : "chat");
      if (j.ok !== false) speak(reply); else { setPhase("idle"); if (wakeOnRef.current) restartWake(); }
    } catch (e) {
      setTurns((t) => t.map((x) => x.id === hermesId ? { ...x, text: "Error reaching Hermes: " + String(e), working: false } : x));
      setStatus("Something went wrong reaching the agent."); setPhase("idle");
    }
    busyRef.current = false; setBusy(false);
  }, [mode, turns, voice]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restart the wake recognizer (uses ONLY refs → no stale closures). A short
  // gap minimizes the mic flicker; backoff stops genuine error-loops.
  function safeStartWake() {
    if (!wakeOnRef.current || wakeRunningRef.current || busyRef.current || listeningRef.current) return;
    try { wakeRef.current?.start(); } catch { /* already running */ }
  }
  function scheduleWakeRestart() {
    if (!wakeOnRef.current) return;
    wakeBackoffRef.current = Math.min(wakeBackoffRef.current + 1, 12);
    const delay = wakeBackoffRef.current > 5 ? 1500 : 180;   // back off if it keeps dying
    window.setTimeout(safeStartWake, delay);
  }

  // ── manual push-to-talk ──
  function startListening() {
    if (busyRef.current || listening) return;
    const C = getSR(); if (!C) { setStatus("Voice needs Chrome or Safari — type instead."); return; }
    if (wakeOnRef.current) { try { wakeRef.current?.stop(); } catch {} }   // never two recognizers at once
    let rec = recRef.current;
    if (!rec) {
      rec = new C(); rec.continuous = false; rec.interimResults = false; rec.maxAlternatives = 1;
      rec.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";
      rec.onstart = () => { listeningRef.current = true; setListening(true); setPhase("listening"); setStatus("Listening… speak now."); sfxRef.current?.listen(); };
      rec.onerror = (e) => { listeningRef.current = false; setListening(false); if (phaseRef.current === "listening") setPhase("idle"); const err = e?.error || "unknown";
        setStatus(err === "not-allowed" || err === "service-not-allowed" ? "Mic blocked — allow Microphone in the address bar, then reload." : err === "no-speech" ? "Didn't catch that — tap and try again." : err === "aborted" ? "Tap the core to speak." : "Mic error: " + err);
        if (wakeOnRef.current && !busyRef.current) scheduleWakeRestart(); };
      rec.onend = () => { listeningRef.current = false; setListening(false); if (phaseRef.current === "listening") setPhase("idle");
        if (liveRef.current && !busyRef.current && !typingRef.current) { setTimeout(() => { if (liveRef.current && !busyRef.current && !listeningRef.current && !typingRef.current) startListening(); }, 350); }
        else if (wakeOnRef.current && !busyRef.current) scheduleWakeRestart(); };
      rec.onresult = (e) => { const t = e?.results?.[0]?.[0]?.transcript || ""; if (t.trim()) { setStatus("Heard: " + t); ask(t); } };
      recRef.current = rec;
    }
    try { rec.start(); } catch {}
  }
  function stopListening() { try { recRef.current?.stop(); } catch {} listeningRef.current = false; setListening(false); sfxRef.current?.stop(); if (phaseRef.current === "listening") setPhase("idle"); }

  // ── wake word — one continuous recognizer that self-heals, armed-state capture.
  // Wake aliases cover how browsers mis-hear "Jarvis" (jervis/harvis) + "Hermes".
  function startWake() {
    const C = getSR(); if (!C) { setStatus("Wake word needs Chrome or Safari."); return; }
    wakeOnRef.current = true; setWake(true); wakeBackoffRef.current = 0;
    let rec = wakeRef.current;
    if (!rec) {
      rec = new C(); rec.continuous = true; rec.interimResults = false; rec.maxAlternatives = 1;
      rec.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";
      rec.onstart = () => { wakeRunningRef.current = true; if (phaseRef.current === "idle" && !busyRef.current) setStatus('Standing by — say "Jarvis" or "Hermes".'); };
      rec.onerror = (e) => {
        const err = e?.error || "";
        if (err === "not-allowed" || err === "service-not-allowed") {
          wakeOnRef.current = false; setWake(false);
          setStatus("Mic blocked — allow Microphone in the address bar, then turn the wake word on again.");
        }
        // no-speech / aborted / network → let onend reschedule
      };
      rec.onend = () => { wakeRunningRef.current = false; if (wakeOnRef.current && !busyRef.current && !listening) scheduleWakeRestart(); };
      rec.onresult = (e) => {
        if (busyRef.current) return;
        const res = e.results[e.results.length - 1];
        if (!res || !res.isFinal) return;
        const raw = (res[0]?.transcript || "").trim();
        if (!raw) return;
        wakeBackoffRef.current = 0;                 // it's working — clear backoff
        const low = raw.toLowerCase();
        const m = low.match(/\b(jarvis|jervis|jarviss|harvis|hermes|hey jarvis|ok jarvis)\b/);
        if (m) {
          const after = raw.slice((m.index ?? 0) + m[0].length).replace(/^[\s,.:!?]+/, "").trim();
          if (after.length > 1) { try { rec!.stop(); } catch {} setStatus("Heard: " + after); ask(after); }
          else { armedRef.current = true; setPhase("listening"); setStatus("Yes, sir? I'm listening…"); sfxRef.current?.wake(); }
        } else if (armedRef.current) {
          armedRef.current = false; try { rec!.stop(); } catch {} setStatus("Heard: " + raw); ask(raw);
        }
      };
      wakeRef.current = rec;
    }
    safeStartWake();
  }
  function stopWake() { wakeOnRef.current = false; setWake(false); armedRef.current = false; wakeRunningRef.current = false; try { wakeRef.current?.stop(); } catch {} if (phaseRef.current === "listening") setPhase("idle"); setStatus("Wake word off — tap the core to talk."); }
  function toggleWake() { if (wake) stopWake(); else startWake(); }
  // LIVE — hands-free continuous conversation: no wake word, no clicks. It listens,
  // you talk, it answers, then it's listening again. Turns off the wake recognizer
  // so there's never two mics at once.
  function toggleLive() {
    if (liveRef.current) { liveRef.current = false; setLive(false); stopListening(); setStatus("Live mode off — tap the core or type."); }
    else { if (wakeOnRef.current) stopWake(); liveRef.current = true; setLive(true); setStatus("Live — just talk, I'm listening (no clicks)."); startListening(); }
  }
  const restartWake = safeStartWake;   // speak()/build resume the wake loop after Jarvis finishes

  // On unmount (navigate away in the app) kill every listener AND clear the flags
  // the onend handlers check — otherwise a recognizer auto-restarts after we've left
  // and the mic keeps listening. abort() releases the mic IMMEDIATELY (stop() can
  // linger and keep the browser's recording dot lit).
  useEffect(() => () => {
    liveRef.current = false; wakeOnRef.current = false; armedRef.current = false; wakeRunningRef.current = false; listeningRef.current = false;
    try { wakeRef.current?.abort(); } catch {}
    try { recRef.current?.abort(); } catch {}
  }, []);

  // 🔒 PRIVACY — never listen while this browser tab is in the background.
  // The moment you switch tabs/apps, drop the mic on EVERY mode (wake word, live
  // loop, push-to-talk) so Jarvis isn't recording your conversations or burning
  // the API behind your back. Remember what was on and resume it only when you
  // come back to this tab. (The Realtime child stops itself via its own handler.)
  useEffect(() => {
    let resumeWake = false, resumeLive = false;
    const onVis = () => {
      if (document.hidden) {
        resumeWake = wakeOnRef.current; resumeLive = liveRef.current;
        wakeOnRef.current = false; liveRef.current = false; armedRef.current = false; wakeRunningRef.current = false; listeningRef.current = false;
        try { wakeRef.current?.abort(); } catch {}
        try { recRef.current?.abort(); } catch {}
        setWake(false); setLive(false); setListening(false);
        if (phaseRef.current === "listening") setPhase("idle");
        if (resumeWake || resumeLive) setStatus("Paused — Jarvis stops listening while this tab is in the background.");
      } else {
        if (resumeWake) { resumeWake = false; startWake(); }
        else if (resumeLive) { resumeLive = false; liveRef.current = true; setLive(true); startListening(); }
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc exits wall mode
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && wall) setWall(false); };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [wall]);

  // Live-looking telemetry (random-walk) — only ticks while wall mode is open.
  useEffect(() => {
    if (!wall) return;
    const cl = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
    const id = setInterval(() => setTelem((t) => ({
      throughput: cl(t.throughput + (Math.random() * 6 - 3), 72, 99),
      latency: cl(t.latency + (Math.random() * 0.12 - 0.06), 0.2, 0.9),
      load: cl(t.load + (Math.random() * 10 - 5), 8, 74),
      signal: cl(t.signal + (Math.random() * 3 - 1.5), 90, 100),
    })), 1500);
    return () => clearInterval(id);
  }, [wall]);

  const phaseLabel = building ? "BUILDING" : busy ? (mode === "agent" ? "ACTING" : "THINKING") : listening || armedRef.current ? "LISTENING" : phaseState === "speaking" ? "SPEAKING" : "ONLINE";
  const coreTap = () => { if (busy || realtime) return; if (listening) stopListening(); else startListening(); };

  // shared controls row
  const controls = (
    <div className="flex items-center gap-2 flex-wrap justify-center">
      <button onClick={() => { const n = !realtime; if (n) { if (wakeOnRef.current) stopWake(); if (liveRef.current) toggleLive(); } setRealtime(n); }}
        title="Realtime — OpenAI speech-to-speech, fastest. Talk + type with no clicking."
        className="px-3 h-9 rounded-lg border text-[12px] flex items-center gap-1.5 transition"
        style={{ borderColor: realtime ? CYAN : "var(--panel-border)", color: realtime ? CYAN : "var(--fg-dim)", background: realtime ? "rgba(34,211,238,0.16)" : "transparent" }}>
        <Zap size={13} className={realtime ? "animate-pulse" : ""} /> Realtime {realtime ? "ON" : "OFF"}
      </button>
      <button onClick={toggleLive} disabled={realtime} title={realtime ? "Turn Realtime off to use Live" : "Live — hands-free, just talk (no clicks, no wake word)"}
        className="px-3 h-9 rounded-lg border text-[12px] flex items-center gap-1.5 transition disabled:opacity-30"
        style={{ borderColor: live ? TEAL : "var(--panel-border)", color: live ? TEAL : "var(--fg-dim)", background: live ? "rgba(52,211,153,0.14)" : "transparent" }}>
        <Mic size={13} className={live ? "animate-pulse" : ""} /> Live {live ? "ON" : "OFF"}
      </button>
      <button onClick={toggleWake} disabled={realtime} title={realtime ? "Turn Realtime off to use the wake word" : 'Wake word — say "Jarvis" hands-free'}
        className="px-3 h-9 rounded-lg border text-[12px] flex items-center gap-1.5 transition disabled:opacity-30"
        style={{ borderColor: wake ? CYAN : "var(--panel-border)", color: wake ? CYAN : "var(--fg-dim)", background: wake ? "rgba(34,211,238,0.12)" : "transparent" }}>
        <Radio size={13} className={wake ? "animate-pulse" : ""} /> Wake word {wake ? "ON" : "OFF"}
      </button>
      <button onClick={() => setMode((m) => (m === "auto" ? "agent" : "auto"))}
        title={mode === "auto" ? "Auto: instant answers, opens apps/sites, escalates big tasks. Click for Agent." : "Agent: full Hermes agent with tools (~28s). Click for Auto."}
        className="px-3 h-9 rounded-lg border text-[12px] flex items-center gap-1.5 transition"
        style={{ borderColor: mode === "auto" ? TEAL : "#60a5fa", color: mode === "auto" ? TEAL : "#60a5fa", background: mode === "auto" ? "rgba(52,211,153,0.10)" : "rgba(96,165,250,0.10)" }}>
        {mode === "auto" ? <><Zap size={13} /> Auto</> : <><Cpu size={13} /> Agent</>}
      </button>
      <button onClick={() => runBriefing(briefingRange)} disabled={busy}
        title="Briefing — a vault-grounded rundown: open action items, suggested focus, what's on your mind. Daily by default; say 'weekly briefing' for the week."
        className="px-3 h-9 rounded-lg border text-[12px] flex items-center gap-1.5 transition disabled:opacity-40"
        style={{ borderColor: (briefing || briefingLoading) ? CYAN : "var(--panel-border)", color: (briefing || briefingLoading) ? CYAN : "var(--fg-dim)", background: (briefing || briefingLoading) ? "rgba(34,211,238,0.12)" : "transparent" }}>
        <Newspaper size={13} /> Briefing
      </button>
      <select value={voice} onChange={(e) => setVoice(e.target.value)} title="Reply voice"
        className="bg-[rgba(0,0,0,0.3)] border border-[var(--panel-border)] rounded-lg px-2 h-9 text-[12px] text-[var(--fg-dim)] outline-none">
        {VOICES.map((v) => <option key={v.id} value={v.id}>🔊 {v.label}</option>)}
      </select>
    </div>
  );

  const previewPanel = previewFile ? (
    <div className="rounded-2xl border overflow-hidden" style={{ borderColor: `${CYAN}55` }}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: `${CYAN}33`, background: "rgba(34,211,238,0.06)" }}>
        <span className="text-[12px] font-mono flex items-center gap-2" style={{ color: CYAN }}>
          <span className="w-2 h-2 rounded-full" style={{ background: TEAL }} /> PREVIEW · {previewFile}
        </span>
        <div className="flex items-center gap-1.5">
          <a href={jPreviewUrl(previewFile)} target="_blank" rel="noopener noreferrer" title="Open in new tab" className="p-1.5 rounded-lg hover:bg-[var(--bg-mid)] text-[var(--fg-dim)]"><Maximize2 size={13} /></a>
          <button onClick={() => setPreviewFile(null)} title="Close preview" className="p-1.5 rounded-lg hover:bg-rose-500/15 text-rose-300/80"><X size={14} /></button>
        </div>
      </div>
      <iframe key={previewFile} src={jPreviewUrl(previewFile)} title="jarvis build" className="w-full border-0 bg-black" style={{ height: 360 }} sandbox="allow-scripts allow-pointer-lock allow-same-origin" />
    </div>
  ) : null;

  return (
    <div className="max-w-[920px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="grid place-items-center w-10 h-10 rounded-xl border" style={{ borderColor: `${CYAN}55`, background: `${CYAN}14`, color: CYAN }}>
            <Mic size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-medium tracking-tight">Hermes-<span style={{ color: CYAN }}>Jarvis</span></h1>
            <div className="text-[12px] text-[var(--fg-dim)] font-mono">NEURAL LINK · {phaseLabel} · {clock}</div>
          </div>
        </div>
        <button onClick={() => setWall(true)} title="Wall mode — fullscreen HUD"
          className="px-3 h-9 rounded-lg border border-[var(--panel-border)] hover:border-[var(--panel-border-hot)] text-[12px] text-[var(--fg-dim)] flex items-center gap-1.5 transition">
          <Maximize2 size={13} /> Wall mode
        </button>
      </div>

      {/* Reactor */}
      <div className="relative rounded-2xl border border-[var(--panel-border)] overflow-hidden mb-5"
        style={{ background: "radial-gradient(120% 100% at 50% 0%, rgba(34,211,238,0.06), rgba(0,0,0,0.5) 60%)" }}>
        <div className="hud-grid absolute inset-0 opacity-[0.18] pointer-events-none" />
        <div className="hud-scan absolute inset-0 pointer-events-none" />
        {/* corner brackets */}
        {["tl", "tr", "bl", "br"].map((p) => (
          <span key={p} className={`hud-bracket hud-${p}`} style={{ borderColor: `${CYAN}66` }} />
        ))}
        <div className="relative flex flex-col items-center py-8">
          <button onClick={coreTap} disabled={supported === false} className="relative grid place-items-center disabled:opacity-50" title="Tap to talk" style={{ width: 300, height: 300 }}>
            <ArcReactor phaseRef={phaseRef} levelRef={levelRef} size={300} />
            <span className="absolute text-[10px] font-mono tracking-[0.3em]" style={{ color: phaseColor(phaseState), bottom: 26 }}>{phaseLabel}</span>
          </button>
          <div className="text-[12.5px] font-mono text-center px-4 mt-1" style={{ color: CYAN }}>{realtime ? "Realtime voice is live below — just talk." : status}</div>
        </div>

        {/* ── Boot-up sequence overlay ── */}
        <AnimatePresence>
          {booting && (
            <motion.div initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}
              className="absolute inset-0 z-10 grid place-items-center" style={{ background: "rgba(4,7,10,0.92)" }}>
              <div className="text-center font-mono">
                <motion.div initial={{ letterSpacing: "0.1em", opacity: 0 }} animate={{ letterSpacing: "0.55em", opacity: 1 }} transition={{ duration: 1.1 }}
                  className="text-[20px] font-semibold mb-5" style={{ color: CYAN }}>J A R V I S</motion.div>
                {[
                  "NEURAL LINK", "VOICE CORE", "AGENT MESH", "REACTOR", "ONLINE",
                ].map((line, i) => (
                  <motion.div key={line} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 + i * 0.42 }}
                    className="text-[11px] tracking-[0.18em] flex items-center justify-center gap-2 mb-1.5"
                    style={{ color: i === 4 ? TEAL : "var(--fg-dim)" }}>
                    <span>{line === "ONLINE" ? "» SYSTEM ONLINE" : line + " …"}</span>
                    {line !== "ONLINE" && <span style={{ color: TEAL }}>✓</span>}
                  </motion.div>
                ))}
                <motion.div initial={{ width: 0 }} animate={{ width: "180px" }} transition={{ duration: 2.4 }}
                  className="h-[2px] mt-4 mx-auto rounded-full" style={{ background: `linear-gradient(90deg, transparent, ${CYAN}, ${TEAL})` }} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── "Show me …" holographic panel ── */}
        <AnimatePresence>
          {showKind && (
            <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}
              className="absolute inset-0 z-20 grid place-items-center px-6 py-8" style={{ background: "rgba(4,7,10,0.95)" }}>
              <button onClick={() => setShowKind(null)} title="Dismiss" className="absolute top-3 right-3 grid place-items-center w-8 h-8 rounded-lg border z-10" style={{ borderColor: `${CYAN}55`, color: CYAN }}><X size={15} /></button>
              <div className="w-full max-w-[440px]">
                <ShowPanel kind={showKind} onPlay={(f) => { setPreviewFile(f); setShowKind(null); }} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {controls}

      {realtime && (
        <div className="mt-4">
          <JarvisRealtime voice={voice} onClose={() => setRealtime(false)} />
        </div>
      )}

      {(briefing || briefingLoading || showHistory) && (
        <div className="mt-4">
          <BriefingPanel briefing={briefing} loading={briefingLoading} range={briefingRange}
            history={briefHistory} showHistory={showHistory} historyLoading={historyLoading}
            onRange={(r) => runBriefing(r)}
            onToggleHistory={() => { const n = !showHistory; setShowHistory(n); if (n) loadHistory(); }}
            onPickHistory={(h) => { setBriefing(h); setBriefingRange(h.range); setShowHistory(false); }}
            onClose={() => { setBriefing(null); setBriefingLoading(false); setShowHistory(false); }} />
        </div>
      )}

      {previewPanel && <div className="mt-4">{previewPanel}</div>}

      {/* Text input (legacy path — Realtime mode uses its own input in the panel above) */}
      {!realtime && (
      <div className="flex gap-2 my-5">
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onFocus={() => { typingRef.current = true; if (liveRef.current) stopListening(); }}
          onBlur={() => { typingRef.current = false; if (liveRef.current && !busyRef.current && !listeningRef.current) startListening(); }}
          onKeyDown={(e) => { if (e.key === "Enter") { const v = input; setInput(""); ask(v); } }}
          placeholder="…or type any time — even mid-conversation — and press Enter"
          className="flex-1 bg-[rgba(0,0,0,0.3)] border border-[var(--panel-border)] rounded-lg px-3.5 h-11 text-sm outline-none focus:border-[var(--panel-border-hot)] text-[var(--fg)]" />
        <button onClick={() => { const v = input; setInput(""); ask(v); }} disabled={busy || !input.trim()}
          className="px-4 h-11 rounded-lg border border-[var(--panel-border)] hover:border-[var(--panel-border-hot)] text-[13px] text-[var(--fg-dim)] transition disabled:opacity-30 flex items-center gap-1.5">
          <Send size={14} /> Send
        </button>
      </div>
      )}

      {/* Conversation */}
      <div className="space-y-2.5 pb-10">
        <AnimatePresence initial={false}>
          {turns.map((t) => (
            <motion.div key={t.id} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="panel p-3.5">
              <div className="text-[10px] uppercase tracking-widest mb-1.5 flex items-center gap-1.5" style={{ color: t.who === "you" ? "var(--gold)" : CYAN }}>
                {t.who === "you" ? "You" : <><Zap size={10} /> JARVIS</>}
              </div>
              <div className={`text-[14.5px] leading-relaxed whitespace-pre-wrap ${t.working ? "italic text-[var(--fg-dimmer)]" : "text-[var(--fg)]"}`}>{t.text}</div>
            </motion.div>
          ))}
        </AnimatePresence>
        {turns.length === 0 && (
          <div className="text-center text-[12.5px] text-[var(--fg-dimmer)] leading-relaxed pt-3">
            Try: <span className="text-[var(--fg-dim)]">&ldquo;Jarvis, brief me.&rdquo;</span> · <span className="text-[var(--fg-dim)]">&ldquo;Give me my weekly briefing.&rdquo;</span><br />
            <span className="text-[var(--fg-dim)]">&ldquo;Jarvis, open YouTube.&rdquo;</span> · <span className="text-[var(--fg-dim)]">&ldquo;Build a snake game in my workspace.&rdquo;</span>
          </div>
        )}
      </div>

      {/* Built with Jarvis — preview gallery (a few, with "See more") */}
      <JarvisBuilds initial={6} />

      {/* ── WALL MODE — fullscreen ambient HUD ── */}
      <AnimatePresence>
        {wall && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex flex-col" style={{ backgroundColor: "#04070a", backgroundImage: "radial-gradient(130% 90% at 50% 12%, rgba(34,211,238,0.12), rgba(4,7,10,0.86) 58%)" }}>
            <WallBackdrop />
            <div className="hud-grid absolute inset-0 opacity-[0.10] pointer-events-none" />
            <div className="hud-scan absolute inset-0 pointer-events-none" />
            {["tl", "tr", "bl", "br"].map((p) => (<span key={p} className={`hud-bracket hud-${p}`} style={{ borderColor: `${CYAN}88` }} />))}

            {/* top bar */}
            <div className="relative flex items-start justify-between p-7 font-mono text-[12px]" style={{ color: CYAN }}>
              <div>
                <div className="text-[16px] tracking-[0.3em] mb-1" style={{ color: "var(--fg)" }}>HERMES-<span style={{ color: CYAN }}>JARVIS</span></div>
                <div className="text-[var(--fg-dim)]">NEURAL INTERFACE · ONLINE</div>
              </div>
              <div className="text-right">
                <div className="text-[34px] leading-none tabular-nums" style={{ color: "var(--fg)" }}>{clock}</div>
                <div className="text-[var(--fg-dim)] mt-1">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</div>
              </div>
              <button onClick={() => setWall(false)} title="Exit (Esc)" className="absolute top-6 right-6 hidden" />
            </div>
            <button onClick={() => setWall(false)} title="Exit wall mode (Esc)"
              className="absolute top-6 right-6 grid place-items-center w-9 h-9 rounded-lg border z-10" style={{ borderColor: `${CYAN}55`, color: CYAN }}>
              <X size={16} />
            </button>

            {/* center reactor + side readouts */}
            <div className="relative flex-1 grid grid-cols-[1fr_auto_1fr] items-center px-8 min-h-0">
              {/* left readouts — live status + animated telemetry bars */}
              <div className="font-mono text-[11.5px] space-y-2.5 justify-self-start max-w-[280px] w-full">
                {([["STATUS", phaseLabel], ["MODE", mode.toUpperCase()], ["WAKE WORD", wake ? "ARMED" : "OFF"], ["VOICE", "DANIEL · EN-GB"]] as [string, string][]).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-6 border-b border-[var(--line-soft)] pb-1.5" style={{ color: "var(--fg-dim)" }}>
                    <span className="tracking-widest">{k}</span><span style={{ color: CYAN }}>{v}</span>
                  </div>
                ))}
                {([["NEURAL THROUGHPUT", telem.throughput, 99], ["CORE LOAD", telem.load, 100], ["SIGNAL", telem.signal, 100]] as [string, number, number][]).map(([k, v, max]) => (
                  <div key={k}>
                    <div className="flex justify-between mb-1" style={{ color: "var(--fg-dim)" }}><span className="tracking-widest">{k}</span><span style={{ color: CYAN }}>{v.toFixed(1)}%</span></div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--line-soft)" }}>
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(v / max) * 100}%`, background: `linear-gradient(90deg, ${TEAL}, ${CYAN})` }} />
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-6 pt-1" style={{ color: "var(--fg-dim)" }}><span className="tracking-widest">LATENCY</span><span style={{ color: CYAN }}>{telem.latency.toFixed(2)}s</span></div>
              </div>
              {/* reactor */}
              <button onClick={coreTap} className="relative grid place-items-center justify-self-center" title="Tap to talk" style={{ width: 460, height: 460 }}>
                <ArcReactor phaseRef={phaseRef} levelRef={levelRef} size={460} />
                <span className="absolute text-[12px] font-mono tracking-[0.4em]" style={{ color: phaseColor(phaseState), bottom: 56 }}>{phaseLabel}</span>
              </button>
              {/* right: live preview when there's a build, else transcript */}
              <div className="justify-self-end w-full max-w-[440px]">
                {(briefing || briefingLoading || showHistory) ? (
                  <BriefingPanel briefing={briefing} loading={briefingLoading} range={briefingRange}
                    history={briefHistory} showHistory={showHistory} historyLoading={historyLoading}
                    onRange={(r) => runBriefing(r)}
                    onToggleHistory={() => { const n = !showHistory; setShowHistory(n); if (n) loadHistory(); }}
                    onPickHistory={(h) => { setBriefing(h); setBriefingRange(h.range); setShowHistory(false); }}
                    onClose={() => { setBriefing(null); setBriefingLoading(false); setShowHistory(false); }} />
                ) : showKind ? (
                  <div className="relative">
                    <button onClick={() => setShowKind(null)} title="Dismiss" className="absolute -top-2 -right-2 grid place-items-center w-7 h-7 rounded-lg border z-10" style={{ borderColor: `${CYAN}55`, color: CYAN }}><X size={13} /></button>
                    <ShowPanel kind={showKind} onPlay={(f) => { setPreviewFile(f); setShowKind(null); }} />
                  </div>
                ) : previewFile ? previewPanel : (
                  <div className="font-mono text-[12px] space-y-2" style={{ color: "var(--fg-dim)" }}>
                    <div className="tracking-widest mb-1" style={{ color: CYAN }}>TRANSCRIPT</div>
                    <div className="space-y-2 max-h-[44vh] overflow-hidden">
                      {turns.slice(0, 6).map((t) => (
                        <div key={t.id}><span style={{ color: t.who === "you" ? "var(--gold)" : TEAL }}>{t.who === "you" ? "» YOU  " : "» JARVIS  "}</span><span style={{ color: "var(--fg)" }}>{t.text}</span></div>
                      ))}
                      {turns.length === 0 && <div className="opacity-60">Awaiting command, sir…</div>}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* audio waveform */}
            <div className="relative px-7 opacity-90"><Waveform levelRef={levelRef} /></div>

            {/* bottom status + controls */}
            <div className="relative px-7 pb-7 pt-1 flex items-center justify-between">
              <div className="font-mono text-[13px]" style={{ color: CYAN }}>{status}</div>
              {controls}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <audio ref={audioRef} className="hidden" />

      <style jsx global>{`
        .hud-grid { background-image: linear-gradient(${CYAN}22 1px, transparent 1px), linear-gradient(90deg, ${CYAN}22 1px, transparent 1px); background-size: 42px 42px; }
        .hud-scan { background: repeating-linear-gradient(0deg, rgba(34,211,238,0.04) 0px, rgba(34,211,238,0.04) 1px, transparent 2px, transparent 4px); animation: hudscan 8s linear infinite; }
        @keyframes hudscan { from { background-position-y: 0; } to { background-position-y: 100px; } }
        .hud-bracket { position: absolute; width: 22px; height: 22px; border-style: solid; }
        .hud-tl { top: 12px; left: 12px; border-width: 2px 0 0 2px; }
        .hud-tr { top: 12px; right: 12px; border-width: 2px 2px 0 0; }
        .hud-bl { bottom: 12px; left: 12px; border-width: 0 0 2px 2px; }
        .hud-br { bottom: 12px; right: 12px; border-width: 0 2px 2px 0; }
      `}</style>
    </div>
  );
}

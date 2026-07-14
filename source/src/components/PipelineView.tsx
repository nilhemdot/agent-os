"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Inbox, Sparkles, ShieldCheck, Cpu, CheckCircle2, Send, Loader2, X, Check, Ban, ArrowRight, FileText, Play, ExternalLink, Square, Star, LayoutGrid, Columns3, Trash2 } from "lucide-react";

type Stage = "inbox" | "review" | "building" | "shipped" | "rejected";
type RouteKind = "project" | "action" | "idea" | "reference" | "escalate";
interface Item {
  slug: string; title: string; stage: Stage; route?: RouteKind; confidence?: number; tags?: string[];
  created: string; idea: string; classification?: string; plan?: string; tasks?: string; buildFile?: string; pinned?: boolean; vaultPath?: string;
}

const buildPreviewUrl = (file: string) => `/api/freeclaude/preview/free-claude-code/${file.split("/").map(encodeURIComponent).join("/")}`;

const ROUTE_COLOR: Record<RouteKind, string> = {
  project: "#fb923c", action: "#60a5fa", idea: "#a855f7", reference: "#22d3ee", escalate: "#f43f5e",
};
const COLS: { key: Stage; n: string; label: string; blurb: string; icon: React.ReactNode; accent: string }[] = [
  { key: "inbox",    n: "01", label: "Capture",        blurb: "Raw input — no structure",        icon: <Inbox size={14} />,       accent: "#22d3ee" },
  { key: "review",   n: "03", label: "Human Gate",     blurb: "The one checkpoint",              icon: <ShieldCheck size={14} />, accent: "#fbbf24" },
  { key: "building", n: "04", label: "Execute",        blurb: "PM + subagents build it",         icon: <Cpu size={14} />,         accent: "#34d399" },
  { key: "shipped",  n: "05", label: "Shipped & Filed", blurb: "Done",                            icon: <CheckCircle2 size={14} />, accent: "#a3e635" },
];

// Obsidian-style knowledge-graph backdrop — drifting nodes, proximity links, and
// glowing pulses that travel the edges. Pure ambience behind the pipeline.
function GraphBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return; const ctx = cv.getContext("2d"); if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = 0, h = 0;
    const resize = () => { w = cv.clientWidth; h = cv.clientHeight; cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize(); window.addEventListener("resize", resize);
    const COLORS = ["#22d3ee", "#34d399", "#a855f7", "#fbbf24", "#60a5fa"];
    const N = 58;
    const nodes = Array.from({ length: N }, () => ({
      x: Math.random(), y: Math.random(), vx: (Math.random() - 0.5) * 0.00016, vy: (Math.random() - 0.5) * 0.00016,
      r: Math.random() * 2.4 + 1, c: COLORS[Math.floor(Math.random() * COLORS.length)],
    }));
    const pulses = Array.from({ length: 5 }, () => ({ a: Math.floor(Math.random() * N), b: Math.floor(Math.random() * N), t: Math.random() }));
    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const n of nodes) { n.x += n.vx; n.y += n.vy; if (n.x < 0 || n.x > 1) n.vx *= -1; if (n.y < 0 || n.y > 1) n.vy *= -1; }
      // edges
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
        const a = nodes[i], b = nodes[j]; const dx = (a.x - b.x) * w, dy = (a.y - b.y) * h; const d = Math.hypot(dx, dy);
        if (d < 150) { ctx.strokeStyle = `rgba(120,180,220,${0.07 * (1 - d / 150)})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x * w, a.y * h); ctx.lineTo(b.x * w, b.y * h); ctx.stroke(); }
      }
      // pulses travelling edges
      for (const p of pulses) {
        p.t += 0.006; if (p.t > 1) { p.t = 0; p.a = Math.floor(Math.random() * N); p.b = Math.floor(Math.random() * N); }
        const a = nodes[p.a], b = nodes[p.b]; const x = (a.x + (b.x - a.x) * p.t) * w, y = (a.y + (b.y - a.y) * p.t) * h;
        ctx.fillStyle = "rgba(52,211,153,0.9)"; ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
      }
      // nodes + glow
      for (const n of nodes) {
        ctx.globalAlpha = 0.55; ctx.fillStyle = n.c; ctx.beginPath(); ctx.arc(n.x * w, n.y * h, n.r, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.10; ctx.beginPath(); ctx.arc(n.x * w, n.y * h, n.r * 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={ref} className="fixed inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0, opacity: 0.55, maskImage: "radial-gradient(120% 90% at 60% 30%, #000 40%, transparent 95%)", WebkitMaskImage: "radial-gradient(120% 90% at 60% 30%, #000 40%, transparent 95%)" }} />;
}

export default function PipelineView() {
  const [items, setItems] = useState<Item[]>([]);
  const [available, setAvailable] = useState(true);
  const [capture, setCapture] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [busy, setBusy] = useState<Record<string, "shape" | "decide" | "build" | undefined>>({});
  const [selected, setSelected] = useState<Item | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<"board" | "gallery">("board");
  const ctrlRef = useRef<Record<string, AbortController>>({});

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/pipeline", { cache: "no-store" });
      const j = await r.json();
      setAvailable(j.available !== false);
      setItems(Array.isArray(j.items) ? j.items : []);
      if (selected) { const u = (j.items as Item[]).find((x) => x.slug === selected.slug); if (u) setSelected(u); }
    } catch {}
  }, [selected]);

  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function doCapture() {
    const idea = capture.trim(); if (!idea || capturing) return;
    setCapturing(true);
    try { await fetch("/api/pipeline/capture", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idea }) }); setCapture(""); await refresh(); } catch {}
    setCapturing(false);
  }
  async function shape(slug: string) {
    setBusy((b) => ({ ...b, [slug]: "shape" })); setErr(null);
    const c = new AbortController(); ctrlRef.current[slug] = c;
    try {
      const r = await fetch("/api/pipeline/shape", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug }), signal: c.signal });
      const j = await r.json().catch(() => ({}));
      if (!j.ok && !c.signal.aborted) setErr(j.error || "Couldn't shape that idea — is Ollama running?");
    } catch { if (!c.signal.aborted) setErr("Couldn't reach the agents. Is the local model (Ollama) running?"); }
    delete ctrlRef.current[slug]; await refresh(); setBusy((b) => ({ ...b, [slug]: undefined }));
  }
  async function build(slug: string) {
    setBusy((b) => ({ ...b, [slug]: "build" })); setErr(null);
    const c = new AbortController(); ctrlRef.current[slug] = c;
    try {
      const r = await fetch("/api/pipeline/build", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug }), signal: c.signal });
      const j = await r.json().catch(() => ({}));
      if (!j.ok && !c.signal.aborted) setErr(j.error || "Build failed — try again.");
    } catch { if (!c.signal.aborted) setErr("Couldn't reach the build agent. Is the local model (Ollama) running?"); }
    delete ctrlRef.current[slug]; await refresh(); setBusy((b) => ({ ...b, [slug]: undefined }));
  }
  async function decide(slug: string, approve: boolean) {
    setBusy((b) => ({ ...b, [slug]: "decide" }));
    const c = new AbortController(); ctrlRef.current[slug] = c;
    let item: Item | undefined;
    try {
      const r = await fetch("/api/pipeline/decide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, approve }), signal: c.signal });
      const j = await r.json(); item = j.item;
    } catch {}
    delete ctrlRef.current[slug]; await refresh(); setBusy((b) => ({ ...b, [slug]: undefined }));
    if (approve && item?.route === "project" && !c.signal.aborted) build(slug);   // approved → build the deliverable now
  }
  function stop(slug: string) {
    try { ctrlRef.current[slug]?.abort(); } catch {}
    delete ctrlRef.current[slug];
    setBusy((b) => ({ ...b, [slug]: undefined }));
  }

  const byStage = (s: Stage) => items.filter((i) => i.stage === s).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  async function pin(slug: string, pinned: boolean) {
    setItems((xs) => xs.map((x) => x.slug === slug ? { ...x, pinned } : x)); // optimistic
    try { await fetch("/api/pipeline/pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, pinned }) }); } catch {}
    refresh();
  }

  async function del(slug: string, title: string) {
    if (!window.confirm(`Delete "${title}"? This removes it from the pipeline and your vault. This can't be undone.`)) return;
    setSelected((s) => (s?.slug === slug ? null : s));
    setItems((xs) => xs.filter((x) => x.slug !== slug)); // optimistic
    try { await fetch("/api/pipeline/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug }) }); } catch {}
    refresh();
  }
  const shaping = Object.entries(busy).filter(([, v]) => v === "shape").map(([k]) => k);

  if (!available) return (
    <div className="panel p-6 text-center text-[var(--fg-dim)]">
      Pipeline needs your Obsidian vault configured. Set <code>vaultRoot</code> in your Agent OS config, then reload.
    </div>
  );

  return (
    <div className="relative">
      <GraphBackdrop />
      <div className="relative z-10">
      {/* Header */}
      <div className="mb-1 flex items-end gap-3 flex-wrap">
        <h1 className="text-2xl font-medium tracking-tight">From Inbox to <span style={{ color: "#34d399" }}>Shipped</span></h1>
        <span className="text-[12.5px] text-[var(--fg-dim)] font-mono pb-1">one human checkpoint · everything else is agents</span>
        <div className="ml-auto flex items-center gap-0.5 rounded-lg border p-0.5" style={{ borderColor: "var(--panel-border)" }}>
          {([["board", "Pipeline", <Columns3 size={13} key="b" />], ["gallery", "Gallery", <LayoutGrid size={13} key="g" />]] as const).map(([k, label, icon]) => (
            <button key={k} onClick={() => setView(k)} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium transition"
              style={{ background: view === k ? "rgba(52,211,153,0.15)" : "transparent", color: view === k ? "#34d399" : "var(--fg-dim)" }}>
              {icon}{label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[12.5px] text-[var(--fg-dimmer)] mb-4">Drop an idea → agents classify it, route it, and draft a plan → you approve once → a PM + subagents build it. It all lives in your Obsidian vault under <span className="font-mono">Agentic OS/Pipeline/</span>.</p>

      {/* Capture bar */}
      <div className="panel p-3 mb-5 flex gap-2 items-center" style={{ borderColor: "rgba(34,211,238,0.35)", background: "rgba(34,211,238,0.05)" }}>
        <Sparkles size={16} style={{ color: "#22d3ee" }} className="shrink-0" />
        <input value={capture} onChange={(e) => setCapture(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") doCapture(); }}
          placeholder="Drop an idea — a project, a thought, a link, anything. Agents take it from here…"
          className="flex-1 bg-transparent text-[14px] outline-none text-[var(--fg)] placeholder:text-[var(--fg-dimmer)]" />
        <button onClick={doCapture} disabled={!capture.trim() || capturing}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold disabled:opacity-40" style={{ background: "#22d3ee", color: "#04181c" }}>
          {capturing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Capture
        </button>
      </div>

      {/* Error banner */}
      {err && (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl px-4 py-3" style={{ border: "1px solid rgba(244,63,94,0.4)", background: "rgba(244,63,94,0.08)" }}>
          <span className="text-[13px] flex-1" style={{ color: "#fca5b4" }}>{err}</span>
          <button onClick={() => setErr(null)} className="text-[var(--fg-dim)] hover:text-[var(--fg)]"><X size={15} /></button>
        </div>
      )}

      {/* Gallery — recent builds in a previewable grid */}
      {view === "gallery" && <BuildsGallery items={items} onOpen={setSelected} onPin={(slug, p) => pin(slug, p)} />}

      {/* Pipeline */}
      {view === "board" && (
      <div className="relative overflow-x-auto pb-4">
        <div className="flex gap-0 min-w-[920px]">
          {COLS.map((col, ci) => {
            const list = byStage(col.key);
            return (
              <div key={col.key} className="flex-1 min-w-[230px] relative">
                {/* connector line */}
                {ci < COLS.length - 1 && <div className="absolute top-[18px] right-0 w-1/2 h-px" style={{ background: `linear-gradient(90deg, ${col.accent}66, transparent)` }} />}
                <div className="px-2">
                  {/* stage head */}
                  <div className="flex items-center gap-2 mb-1">
                    <span className="grid place-items-center w-7 h-7 rounded-lg border" style={{ borderColor: `${col.accent}55`, color: col.accent, background: `${col.accent}12` }}>{col.icon}</span>
                    <div>
                      <div className="text-[9px] font-mono tracking-[0.2em]" style={{ color: "var(--fg-dimmer)" }}>STAGE {col.n}</div>
                      <div className="text-[13.5px] font-semibold leading-none" style={{ color: "var(--fg)" }}>{col.label}</div>
                    </div>
                  </div>
                  <div className="text-[10.5px] text-[var(--fg-dimmer)] mb-3 pl-9">{col.blurb}</div>

                  {/* the classifier engine note between Capture and Human Gate */}
                  {col.key === "inbox" && (
                    <div className="rounded-xl border border-dashed p-2.5 mb-2.5 text-[10.5px] font-mono leading-relaxed" style={{ borderColor: "rgba(34,211,238,0.3)", color: "var(--fg-dim)" }}>
                      <div style={{ color: "#22d3ee" }}>◴ inbox-classifier · on demand</div>
                      <div className="text-[var(--fg-dimmer)] mt-1">5-way fork → project · action · idea · reference · escalate</div>
                    </div>
                  )}

                  {/* cards */}
                  <div className="space-y-2.5">
                    {list.length === 0 && shaping.length === 0 && <div className="text-[11px] text-[var(--fg-dimmer)] py-2 pl-1">—</div>}
                    {/* show items actively shaping under Capture as 'in flight' */}
                    {col.key === "inbox" && shaping.map((slug) => {
                      const it = items.find((x) => x.slug === slug); if (!it) return null;
                      return (
                        <div key={`fly-${slug}`} className="rounded-xl border p-3 text-[12px]" style={{ borderColor: "rgba(251,191,36,0.4)", background: "rgba(251,191,36,0.06)" }}>
                          <div className="flex items-center gap-1.5" style={{ color: "#fbbf24" }}><Loader2 size={12} className="animate-spin" /> classifying + planning…</div>
                          <div className="text-[var(--fg-dim)] mt-1 truncate">{it.title}</div>
                        </div>
                      );
                    })}
                    {list.map((it) => (
                      <Card key={it.slug} it={it} busy={busy[it.slug]} onOpen={() => setSelected(it)} onShape={() => shape(it.slug)} onDecide={(a) => decide(it.slug, a)} onBuild={() => build(it.slug)} onStop={() => stop(it.slug)} onPin={() => pin(it.slug, !it.pinned)} onDelete={() => del(it.slug, it.title)} />
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* Detail drawer */}
      <AnimatePresence>
        {selected && <Drawer it={selected} busy={busy[selected.slug]} onClose={() => setSelected(null)} onShape={() => shape(selected.slug)} onDecide={(a) => decide(selected.slug, a)} onBuild={() => build(selected.slug)} onStop={() => stop(selected.slug)} onDelete={() => del(selected.slug, selected.title)} />}
      </AnimatePresence>
      </div>
    </div>
  );
}

function RouteBadge({ route, confidence }: { route?: RouteKind; confidence?: number }) {
  if (!route) return null;
  const c = ROUTE_COLOR[route];
  return <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded-full border" style={{ borderColor: `${c}66`, color: c, background: `${c}14` }}>{route}{confidence != null ? ` ${(confidence * 100).toFixed(0)}%` : ""}</span>;
}

// Gallery of recent builds — a grid of click-to-play live previews (lag-safe: each
// iframe loads only when you click it).
function BuildsGallery({ items, onOpen, onPin }: { items: Item[]; onOpen: (it: Item) => void; onPin: (slug: string, pinned: boolean) => void }) {
  const builds = items.filter((i) => i.buildFile).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  if (builds.length === 0) return (
    <div className="panel p-12 text-center text-[13px] text-[var(--fg-dimmer)]">No builds yet — approve an idea and a PM + subagents will build it. Your shipped builds appear here, ready to preview.</div>
  );
  return (
    <div className="grid gap-4 pb-6" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))" }}>
      {builds.map((it) => <BuildTile key={it.slug} it={it} onOpen={() => onOpen(it)} onPin={() => onPin(it.slug, !it.pinned)} />)}
    </div>
  );
}

function BuildTile({ it, onOpen, onPin }: { it: Item; onOpen: () => void; onPin: () => void }) {
  const [live, setLive] = useState(false);
  const accent = it.route ? ROUTE_COLOR[it.route] : "#34d399";
  const url = it.buildFile ? buildPreviewUrl(it.buildFile) : "";
  return (
    <div className="rounded-2xl border overflow-hidden flex flex-col transition hover:border-[var(--panel-border-hot)]" style={{ borderColor: it.pinned ? "rgba(251,191,36,0.5)" : "var(--panel-border)", background: "rgba(255,255,255,0.015)" }}>
      <div className="relative" style={{ aspectRatio: "16 / 10", background: `radial-gradient(130% 100% at 50% 0%, ${accent}26, #0a0612)` }}>
        {live ? (
          <iframe src={url} title={it.title} className="absolute inset-0 w-full h-full border-0 bg-black" sandbox="allow-scripts allow-pointer-lock allow-same-origin" />
        ) : (
          <button onClick={() => setLive(true)} className="absolute inset-0 grid place-items-center group">
            <span className="text-[12px] font-semibold px-4 py-2 rounded-full transition group-hover:scale-105" style={{ background: accent, color: "#04120e", boxShadow: `0 8px 24px -6px ${accent}` }}><Play size={12} className="inline -mt-0.5 mr-1" />Preview live</span>
          </button>
        )}
      </div>
      <div className="p-3 flex items-start gap-2">
        <div className="flex-1 min-w-0 cursor-pointer" onClick={onOpen}>
          <div className="text-[13px] font-medium text-[var(--fg)] truncate">{it.title}</div>
          <div className="mt-1.5"><RouteBadge route={it.route} confidence={it.confidence} /></div>
        </div>
        <button onClick={onPin} title={it.pinned ? "Unpin" : "Pin to top"} className="shrink-0 p-1 rounded-md hover:bg-[var(--bg-mid)]"><Star size={13} style={{ color: it.pinned ? "#fbbf24" : "var(--fg-dimmer)", fill: it.pinned ? "#fbbf24" : "none" }} /></button>
        <a href={url} target="_blank" rel="noopener noreferrer" title="Open full-screen" className="shrink-0 p-1 rounded-md hover:bg-[var(--bg-mid)] text-[var(--fg-dim)] hover:text-[var(--fg)]"><ExternalLink size={13} /></a>
      </div>
    </div>
  );
}

function Card({ it, busy, onOpen, onShape, onDecide, onBuild, onStop, onPin, onDelete }: { it: Item; busy?: string; onOpen: () => void; onShape: () => void; onDecide: (a: boolean) => void; onBuild: () => void; onStop: () => void; onPin: () => void; onDelete: () => void }) {
  const accent = it.route ? ROUTE_COLOR[it.route] : "#22d3ee";
  return (
    <motion.div layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
      className="group rounded-xl border p-3 cursor-pointer transition hover:border-[var(--panel-border-hot)]" style={{ borderColor: it.pinned ? "rgba(251,191,36,0.5)" : "var(--panel-border)", background: "rgba(255,255,255,0.015)", borderLeft: `2px solid ${accent}` }}
      onClick={onOpen}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[12.5px] font-medium text-[var(--fg)] leading-snug">{it.title}</div>
        <div className="flex items-center gap-0.5 shrink-0 -mt-0.5 -mr-0.5">
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete this item" className="p-1 rounded-md opacity-40 group-hover:opacity-100 transition hover:bg-[rgba(244,63,94,0.14)] hover:text-[#f43f5e] text-[var(--fg-dimmer)]">
            <Trash2 size={13} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onPin(); }} title={it.pinned ? "Unpin — remove from top" : "Pin to top — show this first"} className="p-1 rounded-md hover:bg-[var(--bg-mid)]">
            <Star size={13} style={{ color: it.pinned ? "#fbbf24" : "var(--fg-dimmer)", fill: it.pinned ? "#fbbf24" : "none" }} />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
        <RouteBadge route={it.route} confidence={it.confidence} />
        {it.tags?.slice(0, 2).map((t) => <span key={t} className="text-[9.5px] font-mono text-[var(--fg-dimmer)]">#{t}</span>)}
      </div>

      {/* actions — a Stop button while a task runs, otherwise the stage action */}
      {busy ? (
        <button onClick={(e) => { e.stopPropagation(); onStop(); }}
          className="mt-2.5 w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11.5px] font-semibold" style={{ background: "rgba(244,63,94,0.12)", color: "#f43f5e", border: "1px solid rgba(244,63,94,0.4)" }}>
          <Loader2 size={12} className="animate-spin" /> {busy === "build" ? "building" : busy === "shape" ? "shaping" : "working"}… <Square size={10} className="ml-1" /> Stop
        </button>
      ) : (<>
        {it.stage === "inbox" && (
          <button onClick={(e) => { e.stopPropagation(); onShape(); }} className="mt-2.5 w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11.5px] font-semibold" style={{ background: "rgba(34,211,238,0.14)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.4)" }}>Shape it <ArrowRight size={12} /></button>
        )}
        {it.stage === "review" && (
          <div className="mt-2.5 flex gap-1.5">
            <button onClick={(e) => { e.stopPropagation(); onDecide(true); }} className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11.5px] font-semibold" style={{ background: "rgba(52,211,153,0.15)", color: "#34d399", border: "1px solid rgba(52,211,153,0.4)" }}><Check size={12} /> Approve</button>
            <button onClick={(e) => { e.stopPropagation(); onDecide(false); }} className="px-2 py-1.5 rounded-lg text-[11.5px]" style={{ color: "#f43f5e", border: "1px solid rgba(244,63,94,0.35)" }}><Ban size={12} /></button>
          </div>
        )}
        {it.stage === "building" && (
          <button onClick={(e) => { e.stopPropagation(); onBuild(); }} className="mt-2.5 w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11.5px] font-semibold" style={{ background: "rgba(52,211,153,0.14)", color: "#34d399", border: "1px solid rgba(52,211,153,0.4)" }}><Cpu size={12} /> Build the deliverable</button>
        )}
        {it.stage === "shipped" && it.buildFile && (
          <button onClick={(e) => { e.stopPropagation(); onOpen(); }} className="mt-2.5 w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11.5px] font-semibold" style={{ background: "rgba(163,230,53,0.14)", color: "#a3e635", border: "1px solid rgba(163,230,53,0.4)" }}><Play size={11} /> View what was built</button>
        )}
      </>)}
    </motion.div>
  );
}

function Drawer({ it, busy, onClose, onShape, onDecide, onBuild, onStop, onDelete }: { it: Item; busy?: string; onClose: () => void; onShape: () => void; onDecide: (a: boolean) => void; onBuild: () => void; onStop: () => void; onDelete: () => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <motion.div initial={{ x: 40 }} animate={{ x: 0 }} exit={{ x: 40 }} onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[520px] h-full overflow-y-auto p-6" style={{ background: "var(--bg-panel, #14101a)", borderLeft: "1px solid var(--panel-border)" }}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2"><RouteBadge route={it.route} confidence={it.confidence} /><span className="text-[10px] font-mono text-[var(--fg-dimmer)]">{it.stage}</span></div>
            <h2 className="text-[19px] font-semibold mt-1 text-[var(--fg)]">{it.title}</h2>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onDelete} title="Delete this item" className="p-1.5 rounded-lg hover:bg-[rgba(244,63,94,0.14)] text-[var(--fg-dim)] hover:text-[#f43f5e]"><Trash2 size={15} /></button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg-mid)] text-[var(--fg-dim)]"><X size={16} /></button>
          </div>
        </div>

        {it.vaultPath && <div className="text-[10.5px] font-mono text-[var(--fg-dimmer)] mb-4 flex items-center gap-1.5"><FileText size={11} /> {it.vaultPath}</div>}

        {/* What was built — live preview of the deliverable */}
        {it.buildFile && (
          <div className="mb-5 rounded-xl border overflow-hidden" style={{ borderColor: "rgba(163,230,53,0.4)" }}>
            <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "rgba(163,230,53,0.25)", background: "rgba(163,230,53,0.06)" }}>
              <span className="text-[11px] font-mono flex items-center gap-1.5" style={{ color: "#a3e635" }}><Play size={11} /> What the agents built</span>
              <a href={buildPreviewUrl(it.buildFile)} target="_blank" rel="noopener noreferrer" className="text-[var(--fg-dim)] hover:text-[var(--fg)]" title="Open full-screen"><ExternalLink size={13} /></a>
            </div>
            <iframe key={it.buildFile} src={buildPreviewUrl(it.buildFile)} title="deliverable" className="w-full border-0 bg-black" style={{ height: 300 }} sandbox="allow-scripts allow-pointer-lock allow-same-origin" />
          </div>
        )}

        <Section title="Idea" body={it.idea} />
        {it.classification && <Section title="Classification" body={it.classification} />}
        {it.plan && <Section title="Proposed Plan" body={it.plan} mono />}
        {it.tasks && <Section title="Execution Tasks" body={it.tasks} mono />}

        {busy && (
          <button onClick={onStop} className="mt-4 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-[13px] font-semibold" style={{ background: "rgba(244,63,94,0.12)", color: "#f43f5e", border: "1px solid rgba(244,63,94,0.4)" }}>
            <Loader2 size={14} className="animate-spin" /> {busy === "build" ? "Subagents building" : busy === "shape" ? "Agents shaping" : "Working"}… <Square size={12} className="ml-1" /> Stop
          </button>
        )}
        {!busy && it.stage === "inbox" && (
          <button onClick={onShape} disabled={busy === "shape"} className="mt-4 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-[13px] font-semibold disabled:opacity-50" style={{ background: "rgba(34,211,238,0.14)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.4)" }}>
            {busy === "shape" ? <><Loader2 size={14} className="animate-spin" /> agents classifying + planning…</> : <>Let the agents shape it <ArrowRight size={13} /></>}
          </button>
        )}
        {!busy && it.stage === "review" && (
          <div className="mt-4 flex gap-2">
            <button onClick={() => onDecide(true)} className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-[13px] font-semibold" style={{ background: "rgba(52,211,153,0.15)", color: "#34d399", border: "1px solid rgba(52,211,153,0.4)" }}>
              <Check size={14} /> Approve &amp; build
            </button>
            <button onClick={() => onDecide(false)} className="px-3.5 py-2.5 rounded-lg text-[13px]" style={{ color: "#f43f5e", border: "1px solid rgba(244,63,94,0.35)" }}><Ban size={14} /></button>
          </div>
        )}
        {!busy && it.stage === "building" && !it.buildFile && (
          <button onClick={onBuild} className="mt-4 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-[13px] font-semibold" style={{ background: "rgba(52,211,153,0.15)", color: "#34d399", border: "1px solid rgba(52,211,153,0.4)" }}>
            <Cpu size={14} /> Build the deliverable
          </button>
        )}
        {!busy && it.buildFile && (
          <button onClick={onBuild} className="mt-2 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px]" style={{ color: "var(--fg-dim)", border: "1px solid var(--panel-border)" }}>↻ Rebuild</button>
        )}
      </motion.div>
    </motion.div>
  );
}

function Section({ title, body, mono }: { title: string; body: string; mono?: boolean }) {
  return (
    <div className="mb-4">
      <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-1.5">{title}</div>
      <div className={`text-[13px] leading-relaxed whitespace-pre-wrap text-[var(--fg-dim)] ${mono ? "font-mono text-[12px]" : ""}`}>{body}</div>
    </div>
  );
}

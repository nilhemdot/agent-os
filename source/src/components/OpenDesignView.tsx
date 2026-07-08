"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Palette, ExternalLink, Loader2, Play, Square, RotateCw, Layout, LayoutDashboard, Presentation, Image as ImageIcon, Clapperboard, Boxes, FolderOpen, Trash2 } from "lucide-react";

const ACCENT = "#e879f9"; // fuchsia — design

interface ODProject { id: string; name: string; kind: string; example: boolean; rendered: boolean; updatedAt: number }
const kindIcon = (k: string) => {
  const m: Record<string, typeof Layout> = { deck: Presentation, prototype: Layout, dashboard: LayoutDashboard, image: ImageIcon, video: Clapperboard, hyperframe: Clapperboard };
  return m[k] ?? Palette;
};
const BASE = "http://127.0.0.1:7456";

const MAKES = [
  { icon: Layout, label: "Prototypes", d: "web · mobile · desktop" },
  { icon: LayoutDashboard, label: "Dashboards", d: "live, data-driven" },
  { icon: Presentation, label: "Decks", d: "pitch + slides" },
  { icon: ImageIcon, label: "Images", d: "art + assets" },
  { icon: Clapperboard, label: "HyperFrames", d: "HTML → MP4 motion" },
  { icon: Boxes, label: "150 design systems", d: "Linear · Stripe · Apple…" },
];

export default function OpenDesignView() {
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<"start" | "stop" | null>(null);
  const [log, setLog] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [tab, setTab] = useState<"studio" | "workspace">("studio");
  const [projects, setProjects] = useState<ODProject[]>([]);
  const [projLoading, setProjLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const failStreak = useRef(0);

  const check = useCallback(async () => {
    let ok = false;
    try { const r = await fetch("/api/opendesign/status", { cache: "no-store" }); const j = await r.json(); ok = !!j.healthy; } catch {}
    if (ok) { failStreak.current = 0; setHealthy(true); }
    else {
      // STICKY: once it's been up, require several consecutive misses before flipping to
      // offline — so one slow health ping (OD busy generating) never tears down the studio.
      failStreak.current += 1;
      setHealthy((prev) => (prev === true && failStreak.current < 4) ? true : false);
    }
  }, []);
  useEffect(() => { check(); timer.current = setInterval(check, 6000); return () => { if (timer.current) clearInterval(timer.current); }; }, [check]);

  const loadProjects = useCallback(async () => {
    setProjLoading(true);
    try { const r = await fetch("/api/opendesign/projects", { cache: "no-store" }); const j = await r.json(); setProjects(j.projects ?? []); } catch {}
    setProjLoading(false);
  }, []);
  useEffect(() => { if (healthy === true && tab === "workspace") loadProjects(); }, [healthy, tab, loadProjects]);

  const deleteProject = useCallback(async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"?\n\nThis removes it from your Open Design workspace for good.`)) return;
    setDeleting(id);
    try {
      const r = await fetch(`/api/opendesign/projects?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      if (j.ok) setProjects((ps) => ps.filter((p) => p.id !== id));
      else window.alert("Couldn't delete that one — Open Design may be busy. Try again in a moment.");
    } catch { window.alert("Couldn't reach Open Design to delete that."); }
    setDeleting(null);
  }, []);

  async function control(action: "start" | "stop") {
    setBusy(action); setLog(null);
    try {
      const r = await fetch("/api/opendesign/control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      const j = await r.json();
      if (!j.ok) setLog(j.error || j.log || "something went wrong");
      if (j.ok && action === "stop") { failStreak.current = 99; setHealthy(false); } // stop = offline now, not after the sticky delay
      setTimeout(check, action === "start" ? 4000 : 1000);
    } catch (e) { setLog(String(e).slice(0, 160)); }
    setBusy(null);
  }

  const online = healthy === true;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* slim toolbar */}
      <div className="flex items-center gap-3 mb-3 shrink-0">
        <div className="w-8 h-8 rounded-lg grid place-items-center text-[#1a0a1d]" style={{ background: "linear-gradient(135deg,#f0abfc,#c026d3)" }}><Palette size={17} /></div>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-[var(--cream)] leading-none flex items-center gap-2">
            Open Design
            <span className="inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full"
              style={online ? { background: "rgba(90,184,150,0.14)", color: "var(--emerald)", border: "1px solid rgba(90,184,150,0.4)" }
                : { background: "rgba(110,99,83,0.12)", color: "var(--cream-mute)", border: "1px solid var(--line-soft)" }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: online ? "var(--emerald)" : "var(--cream-mute)", boxShadow: online ? "0 0 8px var(--emerald)" : "none" }} />
              {healthy === null ? "checking…" : online ? "running · 127.0.0.1:7456" : "offline"}
            </span>
          </div>
          <div className="text-[10.5px] text-[var(--cream-mute)] mt-1">Local-first, open-source Claude Design alternative · drives your own agents (Hermes, the local model, Claude)</div>
        </div>
        {online && (
          <div className="ml-auto flex items-center gap-1.5">
            <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-mid)] border border-[var(--line-soft)] mr-1">
              {([["studio", "Studio"], ["workspace", "Workspace"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setTab(k)} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11.5px] font-medium transition"
                  style={tab === k ? { background: ACCENT, color: "#1a0a1d" } : { color: "var(--cream-mute)" }}>
                  {k === "workspace" ? <FolderOpen size={12} /> : <Palette size={12} />} {label}
                  {k === "workspace" && projects.length > 0 && <span className="text-[9px] px-1 rounded-full" style={{ background: tab === k ? "#1a0a1d22" : `${ACCENT}1e`, color: tab === k ? "#1a0a1d" : ACCENT }}>{projects.length}</span>}
                </button>
              ))}
            </div>
            {tab === "studio" && <button onClick={() => setFrameKey((k) => k + 1)} title="Reload" className="p-1.5 rounded-lg border border-[var(--line-soft)] text-[var(--cream-mute)] hover:text-[var(--cream)]"><RotateCw size={13} /></button>}
            <button onClick={() => window.open(BASE, "_blank", "noopener")} title="Pop out to its own window" className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px] border border-[var(--line-soft)] text-[var(--cream-mute)] hover:text-[var(--cream)]"><ExternalLink size={12} /> Pop out</button>
            <button onClick={() => control("stop")} disabled={busy !== null} title="Stop Open Design" className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px] border border-[var(--line-soft)] text-[var(--cream-mute)] hover:text-[var(--plum)] disabled:opacity-50">{busy === "stop" ? <Loader2 size={12} className="animate-spin" /> : <Square size={12} />} Stop</button>
          </div>
        )}
      </div>

      {/* The studio iframe stays MOUNTED whenever OD is up — only HIDDEN on the Workspace
          tab, never unmounted — so a tab switch or a health blip never reloads your session. */}
      {online && (
        <iframe key={frameKey} src={BASE} title="Open Design" className="flex-1 min-h-0 w-full rounded-xl border border-[var(--line-soft)] bg-white"
          allow="clipboard-read; clipboard-write; fullscreen" style={{ display: tab === "studio" ? undefined : "none" }} />
      )}
      {online && tab === "workspace" ? (
        // WORKSPACE — every design Open Design has made, browsable from the dashboard
        <div className="panel flex flex-col min-h-0 flex-1 p-0 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--line-soft)] shrink-0">
            <FolderOpen size={14} style={{ color: ACCENT }} />
            <span className="text-[12.5px] text-[var(--cream)] font-medium">Your designs</span>
            <span className="text-[10.5px] text-[var(--cream-mute)]">{projects.length} project{projects.length === 1 ? "" : "s"}</span>
            <button onClick={loadProjects} title="Refresh" className="ml-auto p-1.5 rounded-lg border border-[var(--line-soft)] text-[var(--cream-mute)] hover:text-[var(--cream)]"><RotateCw size={12} className={projLoading ? "animate-spin" : ""} /></button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto scroll p-3">
            {projects.length === 0 ? (
              <div className="h-full grid place-items-center text-center p-6">
                <div>
                  <Palette size={24} style={{ color: ACCENT }} className="mx-auto mb-2 opacity-70" />
                  <div className="text-[13.5px] text-[var(--cream)]">No designs yet.</div>
                  <div className="text-[11.5px] text-[var(--cream-mute)] mt-1 max-w-[320px]">Go to the <b className="text-[var(--cream)]">Studio</b> tab, type a sentence, and every prototype, deck or dashboard you make shows up here.</div>
                  <button onClick={() => setTab("studio")} className="mt-3 px-3.5 py-2 rounded-xl text-[12.5px] font-semibold" style={{ background: ACCENT, color: "#1a0a1d" }}>Open the Studio →</button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {projects.map((p) => {
                  const Icon = kindIcon(p.kind);
                  const onOpen = () => p.rendered ? window.open(`/api/opendesign/preview/${p.id}`, "_blank", "noopener") : setTab("studio");
                  return (
                    <div key={p.id} onClick={onOpen} role="button" tabIndex={0} title={p.rendered ? "Open the full design" : "Open it in the Studio"}
                      className="relative text-left rounded-xl border border-[var(--line-soft)] bg-[var(--bg-card)] overflow-hidden hover:border-[#e879f988] transition group cursor-pointer">
                      {/* delete this design (removes it from the Open Design workspace) */}
                      <button onClick={(e) => { e.stopPropagation(); deleteProject(p.id, p.name); }} disabled={deleting === p.id} title="Delete this design"
                        className="absolute top-2 right-2 z-10 w-7 h-7 rounded-lg grid place-items-center backdrop-blur border border-[var(--line-soft)] text-[var(--cream-mute)] opacity-0 group-hover:opacity-100 hover:text-red-400 hover:border-red-400/60 transition disabled:opacity-100"
                        style={{ background: "rgba(20,12,22,0.72)" }}>
                        {deleting === p.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      </button>
                      {/* live preview of the actual rendered design */}
                      <div className="relative w-full bg-white overflow-hidden" style={{ aspectRatio: "16/10" }}>
                        {p.rendered ? (
                          <iframe src={`/api/opendesign/preview/${p.id}`} title={p.name} loading="lazy" tabIndex={-1}
                            sandbox="allow-scripts allow-same-origin"
                            className="border-0 pointer-events-none origin-top-left"
                            style={{ width: "200%", height: "200%", transform: "scale(0.5)" }} />
                        ) : (
                          <div className="absolute inset-0 grid place-items-center text-center" style={{ background: "var(--bg-mid)" }}>
                            <div className="text-[10.5px] text-[var(--cream-mute)] px-3"><Loader2 size={13} className="animate-spin mx-auto mb-1" style={{ color: ACCENT }} /> not rendered yet — open in the Studio</div>
                          </div>
                        )}
                        <div className="absolute top-2 left-2 inline-flex items-center gap-1.5 text-[9px] px-1.5 py-0.5 rounded-full backdrop-blur" style={{ background: "rgba(20,12,22,0.7)", color: ACCENT, border: `1px solid ${ACCENT}40` }}><Icon size={9} /> {p.kind}{p.example ? " · example" : ""}</div>
                      </div>
                      <div className="p-2.5">
                        <div className="text-[12.5px] font-medium text-[var(--cream)] leading-snug line-clamp-1">{p.name}</div>
                        <div className="text-[9.5px] mt-1 inline-flex items-center gap-1" style={{ color: p.rendered ? ACCENT : "var(--cream-mute)" }}>{p.rendered ? <><ExternalLink size={9} /> open full design</> : "→ open in the Studio"}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : !online ? (
        // OFFLINE — launcher + what it makes
        <div className="flex-1 min-h-0 overflow-y-auto scroll">
          <div className="panel p-5 mb-4" style={{ background: "linear-gradient(160deg, rgba(232,121,249,0.08), var(--bg-card))", borderColor: "var(--line-soft)" }}>
            <div className="text-[15px] font-semibold text-[var(--cream)]">Design anything from a sentence — on your own machine</div>
            <p className="text-[12.5px] text-[var(--cream-mute)] mt-1.5 leading-relaxed max-w-[560px]">
              Open Design generates prototypes, dashboards, decks, images and motion graphics using brand-grade design systems and 100+ skills — all local, driving the agents you already run. It&rsquo;s currently stopped.
            </p>
            <div className="flex items-center gap-2 mt-4 flex-wrap">
              <button onClick={() => control("start")} disabled={busy !== null}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[14px] font-bold disabled:opacity-50" style={{ background: ACCENT, color: "#1a0a1d" }}>
                {busy === "start" ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} {busy === "start" ? "starting the container…" : "Start Open Design"}
              </button>
              <button onClick={check} className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-[12.5px] border border-[var(--line-soft)] text-[var(--cream-mute)] hover:text-[var(--cream)]"><RotateCw size={13} /> Re-check</button>
            </div>
            {log && <div className="mt-3 text-[11px] text-[var(--plum)] bg-[rgba(196,96,126,0.08)] border border-[rgba(196,96,126,0.3)] rounded-lg px-3 py-2 mono whitespace-pre-wrap">{log}</div>}
            <div className="mt-3 text-[10.5px] text-[var(--cream-mute)]">Runs on your Mac (Node 24, no Docker, no API keys). In <span style={{ color: ACCENT }}>Settings → Execution</span> it already sees your <b className="text-[var(--cream)]">Claude Code, Hermes, Codex</b> and more — pick one and it drives your real CLI.</div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
            {MAKES.map((m) => {
              const Icon = m.icon;
              return (
                <div key={m.label} className="rounded-xl p-3 border border-[var(--line-soft)] bg-[var(--bg-card)]">
                  <Icon size={16} style={{ color: ACCENT }} />
                  <div className="text-[12.5px] font-medium text-[var(--cream)] mt-1.5">{m.label}</div>
                  <div className="text-[10.5px] text-[var(--cream-mute)] mt-0.5">{m.d}</div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

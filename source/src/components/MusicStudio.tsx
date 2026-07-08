"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Music2, Wand2, Loader2, Star, Download, Trash2, Disc3, Sparkles, Mic, MicOff, X, Pencil, Check,
} from "lucide-react";

const ACCENT = "#c084fc"; // violet — sits next to Video's red in the sidebar

type Model = "V5" | "V4_5PLUS" | "V4_5" | "V4" | "V3_5";
const MODELS: { id: Model; label: string }[] = [
  { id: "V5", label: "Suno v5 · newest" },
  { id: "V4_5PLUS", label: "v4.5+" },
  { id: "V4_5", label: "v4.5 · stable" },
  { id: "V4", label: "v4" },
];

// Starter vibes — a futuristic / motivational / flow-state lane to start from.
const PRESETS: { label: string; text: string }[] = [
  { label: "Build the future", text: "Futuristic cinematic electronic, driving synth arpeggios, deep bass pulse, uplifting chord progressions, sounds like building a city on Mars, 120 BPM, instrumental, motivational" },
  { label: "Flow state", text: "Progressive trance for productivity, long evolving builds, shimmering arps, weightless and futuristic, endless forward motion, no drops too aggressive, instrumental, 130 BPM" },
  { label: "Relentless grind", text: "Dark progressive trance, grinding low-end pulse, crystalline arpeggios, rising tension that never breaks, unstoppable forward motion, the future being built one rep at a time, instrumental, 128 BPM" },
  { label: "Chill to work", text: "Deep progressive house, slow shimmering arps, warm analog pads, soft rounded bassline, weightless and futuristic, gentle endless motion, no drops, instrumental, 118 BPM" },
  { label: "Deep focus", text: "Ambient techno for deep work, hypnotic synth layers, steady minimal beat, spacey pads, Blade Runner meets lo-fi, no vocals, 100 BPM, futuristic and calm but forward-moving" },
  { label: "Hustle / 2am", text: "High-energy synthwave, punchy drums, soaring lead melodies, neon cyberpunk vibes, feels like launching a startup at 2am, triumphant build-ups, instrumental, 128 BPM" },
  { label: "Morning momentum", text: "Bright melodic house with futuristic sound design, glassy synths, rising energy, optimistic and clean, sounds like the first day of the future, instrumental, 122 BPM" },
  { label: "Boss level", text: "Dark hybrid electronic orchestral, heavy bass, ticking percussion, tension and release, Hans Zimmer meets techno, feels like solving an impossible problem, instrumental" },
];

interface Track {
  id: string; taskId: string; title: string; prompt: string; style: string; tags: string;
  duration: number; model: string; instrumental: boolean; createdAt: number; saved: boolean;
  audioUrl: string; coverUrl: string | null;
}
interface Preview { id: string; title: string; streamUrl?: string; coverUrl?: string | null; }

function ago(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function dur(sec: number): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60); const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function MusicStudio() {
  const [desc, setDesc] = useState("");
  const [title, setTitle] = useState("");
  const [instrumental, setInstrumental] = useState(true);
  const [model, setModel] = useState<Model>("V4_5");

  const [tracks, setTracks] = useState<Track[]>([]);
  const [savedOnly, setSavedOnly] = useState(false);

  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const j = await (await fetch(`/api/music/list${savedOnly ? "?saved=1" : ""}`, { cache: "no-store" })).json();
      setTracks((j.tracks ?? []) as Track[]);
    } catch { /* */ }
  }, [savedOnly]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); if (clockRef.current) clearInterval(clockRef.current); }, []);

  function stopTimers() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (clockRef.current) { clearInterval(clockRef.current); clockRef.current = null; }
  }

  async function generate() {
    const d = desc.trim();
    if (!d || busy) return;
    setBusy(true); setNotice(""); setPreviews([]); setPhase("Sending to Suno…"); setElapsed(0);

    let taskId = "";
    try {
      const r = await (await fetch("/api/music/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: d, title: title.trim() || undefined, instrumental, model }),
      })).json();
      if (!r.ok) { setNotice(r.error ?? "Generation failed."); setBusy(false); setPhase(""); return; }
      taskId = r.taskId;
    } catch (e) { setNotice("Could not reach the studio: " + String(e)); setBusy(false); setPhase(""); return; }

    setPhase("Composing… Suno usually takes 30–90s for two takes.");
    const started = Date.now();
    clockRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);

    const qs = new URLSearchParams({ taskId, prompt: d, style: d, model, instrumental: String(instrumental) });
    let polls = 0;
    pollRef.current = setInterval(async () => {
      polls++;
      try {
        const s = await (await fetch(`/api/music/status?${qs.toString()}`, { cache: "no-store" })).json();
        if (s.status === "done") {
          stopTimers(); setBusy(false); setPhase(""); setPreviews([]);
          setNotice(`✓ ${s.tracks.length} track${s.tracks.length === 1 ? "" : "s"} ready.`);
          setDesc(""); setTitle("");
          setTracks((prev) => {
            const ids = new Set(prev.map((t) => t.id));
            return [...(s.tracks as Track[]).filter((t) => !ids.has(t.id)), ...prev];
          });
          setTimeout(() => setNotice(""), 4000);
        } else if (s.status === "failed") {
          stopTimers(); setBusy(false); setPhase(""); setPreviews([]);
          setNotice(s.error ?? "Suno couldn't generate that — try rewording the style.");
        } else {
          if (Array.isArray(s.previews) && s.previews.length) setPreviews(s.previews as Preview[]);
          setPhase(s.status === "first" ? "First take is in — finishing the second…" : "Composing…");
          if (polls > 90) { // ~7.5 min safety valve
            stopTimers(); setBusy(false);
            setNotice("Still cooking on Suno's side. It'll appear in History once it lands — hit Refresh in a minute.");
            setPhase("");
          }
        }
      } catch { /* keep polling through transient errors */ }
    }, 5000);
  }

  async function act(id: string, action: string, extra?: Record<string, unknown>) {
    try {
      const r = await (await fetch("/api/music/save", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, ...extra }),
      })).json();
      if (r.ok) {
        if (action === "delete") setTracks((p) => p.filter((t) => t.id !== id));
        else if (action === "rename") setTracks((p) => p.map((t) => t.id === id ? { ...t, title: String(extra?.title ?? t.title) } : t));
        else setTracks((p) => p.map((t) => t.id === id ? { ...t, saved: r.saved } : t).filter((t) => savedOnly ? t.saved : true));
      }
    } catch { /* */ }
  }

  const shown = savedOnly ? tracks.filter((t) => t.saved) : tracks;

  return (
    <div className="space-y-5">
      {/* ── compose box ── */}
      <div className="panel p-5">
        <div className="flex items-center gap-2 mb-3">
          <Music2 size={16} style={{ color: ACCENT }} />
          <span className="text-[14px] font-medium" style={{ color: "var(--fg)" }}>Hermes Music</span>
          <span className="text-[11px]" style={{ color: "var(--fg-dimmer)" }}>· describe a vibe · Suno composes it · two takes per run</span>
        </div>

        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate(); }}
          rows={3}
          placeholder='Describe the style… e.g. "Futuristic progressive trance, relentless driving bassline, shimmering arps, weightless, endless forward motion, instrumental, 130 BPM"  (⌘↵ to generate)'
          className="w-full rounded-lg px-4 py-3 text-[13.5px] outline-none resize-none leading-relaxed"
          style={{ background: "var(--bg-deep, rgba(0,0,0,0.35))", border: "1px solid var(--panel-border)", color: "var(--fg)" }}
        />

        {/* preset vibe chips */}
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          <span className="text-[10px] font-mono tracking-widest mt-1.5 mr-1" style={{ color: "var(--fg-dimmer)" }}>VIBES</span>
          {PRESETS.map((p) => (
            <button key={p.label} onClick={() => setDesc(p.text)}
              className="text-[11px] rounded-full px-2.5 py-1 transition hover:brightness-125"
              style={{ background: `${ACCENT}14`, border: `1px solid ${ACCENT}33`, color: ACCENT }}>
              {p.label}
            </button>
          ))}
        </div>

        {/* controls row */}
        <div className="flex flex-wrap items-center gap-2.5 mt-3.5">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional)"
            className="rounded-lg px-3 py-2 text-[12.5px] outline-none w-44"
            style={{ background: "var(--bg-deep, rgba(0,0,0,0.35))", border: "1px solid var(--panel-border)", color: "var(--fg)" }}
          />
          <button onClick={() => setInstrumental((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] transition"
            style={{ background: instrumental ? `${ACCENT}1a` : "var(--bg-deep, rgba(0,0,0,0.35))", border: `1px solid ${instrumental ? ACCENT : "var(--panel-border)"}`, color: instrumental ? ACCENT : "var(--fg-dim)" }}>
            {instrumental ? <MicOff size={13} /> : <Mic size={13} />} {instrumental ? "Instrumental" : "With vocals"}
          </button>
          <select value={model} onChange={(e) => setModel(e.target.value as Model)}
            className="rounded-lg px-3 py-2 text-[12px] outline-none"
            style={{ background: "var(--bg-deep, rgba(0,0,0,0.35))", border: "1px solid var(--panel-border)", color: "var(--fg-dim)" }}>
            {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>

          <button onClick={generate} disabled={busy || !desc.trim()}
            className="ml-auto flex items-center gap-2 rounded-lg px-5 py-2.5 font-semibold text-[13px] transition"
            style={{ background: `${ACCENT}22`, border: `1.5px solid ${ACCENT}`, color: ACCENT, opacity: busy || !desc.trim() ? 0.55 : 1 }}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} {busy ? "Composing…" : "Generate"}
          </button>
        </div>

        {notice && <div className="text-[12px] mt-3" style={{ color: notice.startsWith("✓") ? ACCENT : "var(--fg-dim)" }}>{notice}</div>}
      </div>

      {/* ── in-flight ── */}
      <AnimatePresence>
        {busy && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="panel p-4 flex items-center gap-3" style={{ borderColor: `${ACCENT}44`, background: `${ACCENT}08` }}>
            <Disc3 size={20} className="animate-spin" style={{ color: ACCENT, animationDuration: "2.4s" }} />
            <div className="min-w-0">
              <div className="text-[12.5px]" style={{ color: "var(--fg)" }}>{phase}</div>
              <div className="text-[10.5px] font-mono mt-0.5" style={{ color: "var(--fg-dimmer)" }}>{elapsed}s elapsed</div>
            </div>
            {previews.length > 0 && (
              <div className="ml-auto flex gap-3">
                {previews.filter((p) => p.streamUrl).map((p) => (
                  <audio key={p.id} src={p.streamUrl} controls preload="none" className="h-8" style={{ maxWidth: 220 }} />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── history ── */}
      <div className="panel p-5">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles size={14} style={{ color: ACCENT }} />
          <span className="text-[13px] font-medium" style={{ color: "var(--fg)" }}>History</span>
          <span className="text-[11px]" style={{ color: "var(--fg-dimmer)" }}>· {shown.length} track{shown.length === 1 ? "" : "s"}</span>
          <div className="ml-auto flex items-center gap-1.5">
            {(["All", "Saved"] as const).map((f) => {
              const on = (f === "Saved") === savedOnly;
              return (
                <button key={f} onClick={() => setSavedOnly(f === "Saved")}
                  className="text-[11px] rounded-md px-2.5 py-1 transition"
                  style={{ background: on ? `${ACCENT}1e` : "transparent", border: `1px solid ${on ? ACCENT : "var(--panel-border)"}`, color: on ? ACCENT : "var(--fg-dimmer)" }}>
                  {f === "Saved" ? <span className="inline-flex items-center gap-1"><Star size={10} /> Saved</span> : f}
                </button>
              );
            })}
          </div>
        </div>

        {shown.length === 0 ? (
          <div className="text-center text-[12.5px] py-10" style={{ color: "var(--fg-dimmer)" }}>
            {savedOnly ? "No saved tracks yet — tap the ★ on one you like." : "No tracks yet — describe a vibe above and hit Generate."}
          </div>
        ) : (
          <div className="space-y-2.5">
            {shown.map((t, i) => (
              <motion.div key={t.id}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.3) }}
                className="rounded-xl border p-3 flex gap-3.5 items-center"
                style={{ borderColor: t.saved ? `${ACCENT}55` : "var(--panel-border)", background: t.saved ? `${ACCENT}0a` : "var(--bg-deep, rgba(0,0,0,0.25))" }}>
                {/* cover */}
                <div className="shrink-0 w-14 h-14 rounded-lg overflow-hidden grid place-items-center"
                  style={{ background: `${ACCENT}14`, border: `1px solid ${ACCENT}22` }}>
                  {t.coverUrl ? <img src={t.coverUrl} alt="" className="w-full h-full object-cover" /> : <Disc3 size={22} style={{ color: ACCENT }} />}
                </div>

                {/* meta + player */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {editing === t.id ? (
                      <div className="flex items-center gap-1.5">
                        <input autoFocus value={editVal} onChange={(e) => setEditVal(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { act(t.id, "rename", { title: editVal }); setEditing(null); } if (e.key === "Escape") setEditing(null); }}
                          className="rounded-md px-2 py-0.5 text-[13px] outline-none"
                          style={{ background: "var(--bg-deep, rgba(0,0,0,0.4))", border: `1px solid ${ACCENT}`, color: "var(--fg)" }} />
                        <button onClick={() => { act(t.id, "rename", { title: editVal }); setEditing(null); }} title="Save name"><Check size={13} style={{ color: ACCENT }} /></button>
                        <button onClick={() => setEditing(null)} title="Cancel"><X size={13} style={{ color: "var(--fg-dim)" }} /></button>
                      </div>
                    ) : (
                      <>
                        <span className="text-[13px] font-semibold truncate" style={{ color: "var(--fg)" }}>{t.title}</span>
                        <button onClick={() => { setEditing(t.id); setEditVal(t.title); }} title="Rename" className="shrink-0 opacity-50 hover:opacity-100"><Pencil size={11} style={{ color: "var(--fg-dim)" }} /></button>
                      </>
                    )}
                    {t.duration > 0 && <span className="text-[10.5px] font-mono shrink-0" style={{ color: "var(--fg-dimmer)" }}>{dur(t.duration)}</span>}
                  </div>
                  <div className="text-[10.5px] mt-0.5 truncate" style={{ color: "var(--fg-dimmer)" }}>
                    {(t.tags || t.style || t.prompt).slice(0, 90)}{!t.tags && t.instrumental ? " · instrumental" : ""} · {ago(t.createdAt)}
                  </div>
                  <audio src={t.audioUrl} controls preload="none" className="w-full mt-2 h-9" />
                </div>

                {/* actions */}
                <div className="shrink-0 flex flex-col gap-1.5">
                  <button onClick={() => act(t.id, "toggle")} title={t.saved ? "Unsave" : "Save"}
                    className="grid place-items-center w-8 h-8 rounded-lg transition"
                    style={{ background: t.saved ? `${ACCENT}22` : "transparent", border: `1px solid ${t.saved ? ACCENT : "var(--panel-border)"}` }}>
                    <Star size={14} style={{ color: t.saved ? ACCENT : "var(--fg-dim)", fill: t.saved ? ACCENT : "none" }} />
                  </button>
                  <a href={t.audioUrl} download={`${t.title}.mp3`} title="Download"
                    className="grid place-items-center w-8 h-8 rounded-lg transition" style={{ border: "1px solid var(--panel-border)" }}>
                    <Download size={14} style={{ color: "var(--fg-dim)" }} />
                  </a>
                  <button onClick={() => act(t.id, "delete")} title="Delete"
                    className="grid place-items-center w-8 h-8 rounded-lg transition hover:brightness-125"
                    style={{ border: "1px solid var(--panel-border)" }}>
                    <Trash2 size={14} style={{ color: "#f87171" }} />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { Clapperboard, Film, Sparkles, Star, FolderOpen, Terminal, Wand2, Loader2 } from "lucide-react";
import { useState, useRef, useEffect } from "react";

const ACCENT = "#f0a868";

type Job = { status: string; progress: number; message?: string; title?: string; videoUrl?: string };
type Gen = { url: string; title: string; prompt: string };

const IDEAS = [
  "a lone astronaut finds an ancient glowing forest on a distant moon",
  "neon-soaked Tokyo street in the rain, cyberpunk, slow drift",
  "a dragon wakes inside a frozen mountain cathedral",
  "sunrise over an endless ocean of golden clouds, serene",
];

const STATS = [
  { n: "gpt-image-2", l: "cinematic frames" },
  { n: "CinematicRenderer", l: "title cards + grade + score" },
  { n: "12", l: "pipelines · 52 tools" },
  { n: "~5 min", l: "per film trailer" },
];

const MOVIES = [
  { src: "/openmontage/movies/movie-dragon.mp4", poster: "/openmontage/movies/movie-dragon-poster.jpg", title: "Dragon's Shadow", note: "Veo 3.1 motion + sound · Remotion storyline over the top." },
  { src: "/openmontage/movies/movie-space.mp4", poster: "/openmontage/movies/movie-space-poster.jpg", title: "Abandoned Odyssey", note: "Veo 3.1 motion + sound · Remotion storyline over the top." },
  { src: "/openmontage/movies/movie-samurai.mp4", poster: "/openmontage/movies/movie-samurai-poster.jpg", title: "Blossom's Edge", note: "Veo 3.1 motion + sound · Remotion storyline over the top." },
  { src: "/openmontage/movies/movie-ocean.mp4", poster: "/openmontage/movies/movie-ocean-poster.jpg", title: "Abyssal Reverie", note: "Veo 3.1 motion + sound · Remotion storyline over the top." },
];

const VIDEOS = [
  { src: "/openmontage/cinematic/cine-samurai.mp4", poster: "/openmontage/cinematic/cine-samurai-poster.jpg", title: "Burning Bamboo", note: "Cinematic trailer — gpt-image-2 + OpenMontage CinematicRenderer." },
  { src: "/openmontage/cinematic/cine-spaceship.mp4", poster: "/openmontage/cinematic/cine-spaceship-poster.jpg", title: "Derelict", note: "Sci-fi trailer — film-grade stills, title cards, score." },
  { src: "/openmontage/cinematic/cine-dragon.mp4", poster: "/openmontage/cinematic/cine-dragon-poster.jpg", title: "Frostfire", note: "Dark-fantasy trailer — cohesive world, cinematic grade." },
  { src: "/openmontage/cinematic/cine-cyberpunk.mp4", poster: "/openmontage/cinematic/cine-cyberpunk-poster.jpg", title: "Neon Rain", note: "Cyberpunk trailer — neon Tokyo, rain, reflections." },
  { src: "/openmontage/cinematic/cine-leviathan.mp4", poster: "/openmontage/cinematic/cine-leviathan-poster.jpg", title: "The Abyss", note: "Cinematic trailer — bioluminescent leviathan, god rays." },
  { src: "/openmontage/signal-from-tomorrow.mp4", poster: "", title: "Signal From Tomorrow", note: "OpenMontage flagship — Veo motion clips + soundtrack." },
];

const PIPELINES = [
  ["Animated Explainer", "research → narration → visuals → music"],
  ["Documentary Montage", "real footage from Archive.org / NASA"],
  ["Cinematic", "trailers, teasers, mood-driven edits"],
  ["Clip Factory", "one long source → ranked short clips"],
  ["Talking Head", "footage-led speaker videos"],
  ["Localization & Dub", "subtitle, dub, translate any video"],
];

export default function OpenMontageView() {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"movie" | "cinematic">("movie");
  const [shots, setShots] = useState(2);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [gens, setGens] = useState<Gen[]>([]);
  const [err, setErr] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function generate() {
    if (busy || prompt.trim().length < 4) return;
    setErr(""); setBusy(true);
    setJob({ status: "starting", progress: 0, message: "Starting…" });
    const thisPrompt = prompt.trim();
    try {
      const r = await fetch("/api/openmontage/generate", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: thisPrompt, shots, mode }),
      });
      const d = await r.json();
      if (!r.ok || !d.jobId) throw new Error(d.error || "Could not start");
      const id = d.jobId;
      const started = Date.now();
      pollRef.current = setInterval(async () => {
        if (Date.now() - started > 12 * 60 * 1000) { stop("Timed out — try fewer shots."); return; }
        try {
          const s = await fetch(`/api/openmontage/status?id=${id}`, { cache: "no-store" });
          const j: Job = await s.json();
          setJob(j);
          if (j.status === "done" && j.videoUrl) {
            setGens((g) => [{ url: j.videoUrl!, title: j.title || thisPrompt, prompt: thisPrompt }, ...g]);
            finish();
          } else if (j.status === "error") {
            stop(j.message || "Generation failed");
          }
        } catch { /* keep polling */ }
      }, 1500);
    } catch (e) {
      stop(e instanceof Error ? e.message : "Failed to start");
    }
  }
  function finish() { if (pollRef.current) clearInterval(pollRef.current); setBusy(false); setJob(null); }
  function stop(message: string) { if (pollRef.current) clearInterval(pollRef.current); setBusy(false); setJob(null); setErr(message); }

  return (
    <div className="h-full overflow-y-auto sidebar-scroll pr-1">
      {/* header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="shrink-0 grid place-items-center w-14 h-14 rounded-2xl"
             style={{ background: "rgba(240,168,104,0.14)", border: `1px solid ${ACCENT}33` }}>
          <Clapperboard size={26} style={{ color: ACCENT }} />
        </div>
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-[0.25em] mb-1" style={{ color: "var(--cream-mute)" }}>
            Agent · OpenMontage · Studio
          </div>
          <h1 className="text-2xl tracking-tight mb-1" style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 500, color: "var(--cream)" }}>
            OpenMontage
          </h1>
          <p className="text-sm" style={{ color: "var(--cream-dim)" }}>
            Type a prompt → get a cinematic video. Open-source agentic video, wired into your OS.
          </p>
        </div>
      </div>

      {/* ===== GENERATE ON THE SPOT ===== */}
      <div className="rounded-2xl p-5 mb-7"
           style={{ background: "linear-gradient(135deg, rgba(240,168,104,0.10), rgba(196,96,126,0.06))", border: `1px solid ${ACCENT}44` }}>
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Wand2 size={16} style={{ color: ACCENT }} />
            <span className="text-sm" style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 600, color: "var(--cream)" }}>
              Generate a video — on the spot
            </span>
          </div>
          <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid var(--line-soft)" }}>
            {([["movie", "🎬 Movie · Veo"], ["cinematic", "✦ Cinematic · stills"]] as const).map(([m, label]) => (
              <button key={m} disabled={busy} onClick={() => { setMode(m); setShots(m === "movie" ? 2 : 5); }}
                className="px-3 py-1.5 text-[12px] font-semibold transition"
                style={{ background: mode === m ? ACCENT : "transparent", color: mode === m ? "#1a1320" : "var(--cream-dim)" }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate(); }}
          placeholder="Describe the video you want… e.g. a lone astronaut finds a glowing alien forest on a distant moon"
          rows={2}
          disabled={busy}
          className="w-full resize-none rounded-xl px-4 py-3 text-sm outline-none"
          style={{ background: "var(--bg-deep)", border: "1px solid var(--line-soft)", color: "var(--cream)" }}
        />
        <div className="flex flex-wrap items-center gap-2 mt-2">
          {IDEAS.map((idea) => (
            <button key={idea} disabled={busy} onClick={() => setPrompt(idea)}
              className="pill text-[11px]" style={{ color: "var(--cream-dim)", opacity: busy ? 0.5 : 1 }}>
              {idea.length > 38 ? idea.slice(0, 38) + "…" : idea}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 mt-3">
          <label className="flex items-center gap-2 text-[12px]" style={{ color: "var(--cream-dim)" }}>
            Length
            <select value={shots} disabled={busy} onChange={(e) => setShots(Number(e.target.value))}
              className="rounded-md px-2 py-1 text-[12px]" style={{ background: "var(--bg-deep)", border: "1px solid var(--line-soft)", color: "var(--cream)" }}>
              {mode === "movie" ? (
                <>
                  <option value={2}>~16s · 2 shots</option>
                  <option value={3}>~24s · 3 shots</option>
                  <option value={4}>~32s · 4 shots</option>
                </>
              ) : (
                <>
                  <option value={4}>~20s · 4 shots</option>
                  <option value={5}>~26s · 5 shots</option>
                  <option value={6}>~32s · 6 shots</option>
                </>
              )}
            </select>
            <span className="text-[11px]" style={{ color: "var(--cream-mute)" }}>
              {mode === "movie" ? "· Veo film ~8 min, ~$2–3" : "· trailer ~5 min, ~$0.30"}
            </span>
          </label>
          <button onClick={generate} disabled={busy || prompt.trim().length < 4}
            className="inline-flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-bold transition"
            style={{ background: busy ? "var(--bg-elev)" : `linear-gradient(135deg, ${ACCENT}, #e6c69a)`, color: busy ? "var(--cream-dim)" : "#1a1320", cursor: busy ? "default" : "pointer" }}>
            {busy ? <><Loader2 size={15} className="animate-spin" /> Generating…</> : <><Sparkles size={15} /> Generate</>}
          </button>
        </div>

        {/* live progress */}
        {busy && job && (
          <div className="mt-4">
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--bg-deep)" }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${job.progress || 4}%`, background: `linear-gradient(90deg, ${ACCENT}, #e6c69a)` }} />
            </div>
            <div className="text-[12px] mt-2 mono" style={{ color: "var(--cream-dim)" }}>
              {job.message || job.status} · {job.progress || 0}%
            </div>
          </div>
        )}
        {err && <div className="text-[12px] mt-3" style={{ color: "var(--plum)" }}>⚠ {err}</div>}
      </div>

      {/* your generations */}
      {gens.length > 0 && (
        <>
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={15} style={{ color: ACCENT }} />
            <span className="sidebar-section-label">Your generations · saved to the workspace</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
            {gens.map((g) => (
              <div key={g.url} className="panel overflow-hidden">
                <video src={g.url} controls autoPlay muted loop playsInline className="block w-full bg-black" style={{ aspectRatio: "16/9" }} />
                <div className="px-4 py-3">
                  <div className="text-sm" style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 600, color: "var(--cream)" }}>{g.title}</div>
                  <div className="text-[11px] mt-1 leading-snug truncate" style={{ color: "var(--cream-dim)" }}>“{g.prompt}”</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* stat strip */}
      <div className="grid grid-cols-4 gap-2 mb-7">
        {STATS.map((s) => (
          <div key={s.l} className="panel px-3 py-3 text-center">
            <div className="text-xl" style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 600, color: ACCENT }}>{s.n}</div>
            <div className="text-[10px] mt-0.5" style={{ color: "var(--cream-dim)" }}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* real movies — Veo motion */}
      <div className="flex items-center gap-2 mb-3">
        <Film size={15} style={{ color: ACCENT }} />
        <span className="sidebar-section-label">Real movies · Veo 3.1 motion + sound · Remotion storyline</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        {MOVIES.map((v) => (
          <div key={v.src} className="panel overflow-hidden">
            <video src={v.src} poster={v.poster || undefined} controls loop playsInline preload="metadata" className="block w-full bg-black" style={{ aspectRatio: "16/9", objectFit: "cover" }} />
            <div className="px-4 py-3">
              <div className="text-sm" style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 600, color: "var(--cream)" }}>{v.title}</div>
              <div className="text-[11px] mt-1 leading-snug" style={{ color: "var(--cream-dim)" }}>{v.note}</div>
            </div>
          </div>
        ))}
      </div>

      {/* cinematic trailers — image-based */}
      <div className="flex items-center gap-2 mb-3">
        <Film size={15} style={{ color: ACCENT }} />
        <span className="sidebar-section-label">Cinematic trailers · gpt-image-2 stills (no video key needed)</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        {VIDEOS.map((v) => (
          <div key={v.src} className="panel overflow-hidden">
            <video src={v.src} poster={v.poster || undefined} controls muted loop playsInline preload="metadata" className="block w-full bg-black" style={{ aspectRatio: "16/9", objectFit: "cover" }} />
            <div className="px-4 py-3">
              <div className="text-sm" style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 600, color: "var(--cream)" }}>{v.title}</div>
              <div className="text-[11px] mt-1 leading-snug" style={{ color: "var(--cream-dim)" }}>{v.note}</div>
            </div>
          </div>
        ))}
      </div>

      {/* pipelines */}
      <div className="flex items-center gap-2 mb-3">
        <Wand2 size={15} style={{ color: ACCENT }} />
        <span className="sidebar-section-label">12 production pipelines</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-8">
        {PIPELINES.map(([name, desc]) => (
          <div key={name} className="panel px-4 py-3 flex items-start gap-3">
            <Sparkles size={14} className="mt-0.5 shrink-0" style={{ color: ACCENT }} />
            <div>
              <div className="text-[13px]" style={{ color: "var(--cream)", fontWeight: 600 }}>{name}</div>
              <div className="text-[11px] mono" style={{ color: "var(--cream-dim)" }}>{desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* links */}
      <div className="flex flex-wrap gap-2 mb-8">
        <a href="https://github.com/calesthio/OpenMontage" target="_blank" rel="noopener"
           className="pill inline-flex items-center gap-1.5 text-[12px]" style={{ color: "var(--cream-soft)" }}>
          <Star size={13} /> calesthio/OpenMontage · 23.8k ★
        </a>
        <a href="https://agentos.guide/openmontage-video-studio" target="_blank" rel="noopener"
           className="pill inline-flex items-center gap-1.5 text-[12px]" style={{ color: ACCENT }}>
          <Film size={13} /> The full guide
        </a>
        <span className="pill inline-flex items-center gap-1.5 text-[12px]" style={{ color: "var(--cream-dim)" }}>
          <FolderOpen size={13} /> ~/.hermes/profiles/openmontage/workspace
        </span>
        <span className="pill inline-flex items-center gap-1.5 text-[12px]" style={{ color: "var(--cream-dim)" }}>
          <Terminal size={13} /> OpenRouter · Gemini Flash Image
        </span>
      </div>
    </div>
  );
}

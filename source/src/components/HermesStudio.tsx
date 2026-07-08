"use client";

import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Film, Mic, Sparkles, Loader2, AlertTriangle } from "lucide-react";

type Kind = "image" | "video" | "voice";
interface Item { name: string; url: string; mtime?: number; prompt?: string; }

const ACCENT = "#60a5fa";

const PRESETS: Record<Kind, string[]> = {
  image: [
    "A neon cyberpunk city at night, rain-slicked streets, holograms, cinematic",
    "A glowing bioluminescent whale in a star-filled nebula, ethereal",
    "A towering samurai mech in a cherry-blossom forest at dawn, mist",
    "Abstract swirling liquid gold and obsidian, macro, luxurious, 8k",
  ],
  video: [
    "Cinematic aerial flyover of a glowing futuristic city at night, neon, volumetric fog",
    "A bioluminescent jellyfish drifting through the deep ocean, slow cinematic motion",
    "Time-lapse of a galaxy swirling into existence, cosmic, ultra detailed",
  ],
  voice: [
    "Welcome to Agent OS. Seven AI agents, one mission control — powered by MiniMax.",
    "This is the future of building. Local, fast, and entirely yours.",
    "Generated entirely with MiniMax — images, video, and voice from a single prompt.",
  ],
};

type Provider = "minimax" | "grok";
const MM_VOICES = [
  { id: "male-qn-qingse", label: "Male · Qingse" },
  { id: "female-shaonv", label: "Female · Shaonv" },
  { id: "male-qn-jingying", label: "Male · Jingying" },
  { id: "female-yujie", label: "Female · Yujie" },
  { id: "presenter_male", label: "Presenter · M" },
  { id: "presenter_female", label: "Presenter · F" },
];
const GROK_VOICES = [
  { id: "eve", label: "Eve" }, { id: "ara", label: "Ara" }, { id: "rex", label: "Rex" },
  { id: "sal", label: "Sal" }, { id: "leo", label: "Leo" }, { id: "una", label: "Una" },
];
const PROVIDERS: { id: Provider; label: string; models: Record<Kind, string> }[] = [
  { id: "minimax", label: "MiniMax", models: { image: "image-01", video: "Hailuo", voice: "speech-02-hd" } },
  { id: "grok", label: "Grok", models: { image: "grok-imagine", video: "grok-imagine", voice: "grok voices" } },
];

export default function HermesStudio() {
  const [provider, setProvider] = useState<Provider>("minimax");
  const [kind, setKind] = useState<Kind>("image");
  const [prompt, setPrompt] = useState("");
  const voiceList = provider === "grok" ? GROK_VOICES : MM_VOICES;
  const [voiceId, setVoiceId] = useState(MM_VOICES[0].id);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [connected, setConnected] = useState(true);
  const [items, setItems] = useState<Record<Kind, Item[]>>({ image: [], video: [], voice: [] });
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function refresh() {
    try {
      const r = await fetch("/api/hermes/studio/list", { cache: "no-store" });
      const j = await r.json();
      setConnected(!!j.connected);
      setItems({ image: j.image ?? [], video: j.video ?? [], voice: j.voice ?? [] });
    } catch { /* ignore */ }
  }
  useEffect(() => { refresh(); return () => { if (pollRef.current) clearTimeout(pollRef.current); }; }, []);

  async function pollVideo(taskId: string, slug: string, started: number) {
    try {
      const r = await fetch(`/api/hermes/studio/video-status?taskId=${taskId}&slug=${encodeURIComponent(slug)}`, { cache: "no-store" });
      const j = await r.json();
      if (j.status === "done") {
        setItems((s) => ({ ...s, video: [{ name: j.name, url: j.url, prompt }, ...s.video] }));
        setBusy(false); setStatus(""); return;
      }
      if (j.status === "failed") { setBusy(false); setStatus("⚠ Video generation failed — try a different prompt."); return; }
      const secs = Math.round((Date.now() - started) / 1000);
      setStatus(`🎬 Rendering video with MiniMax Hailuo… ${secs}s (usually 60–90s)`);
      pollRef.current = setTimeout(() => pollVideo(taskId, slug, started), 6000);
    } catch {
      pollRef.current = setTimeout(() => pollVideo(taskId, slug, started), 6000);
    }
  }

  async function generate() {
    const p = prompt.trim();
    if (!p || busy) return;
    setBusy(true);
    setStatus(kind === "image" ? "🎨 Generating image…" : kind === "voice" ? "🎙️ Synthesising voice…" : "🎬 Submitting video task…");
    try {
      const r = await fetch("/api/hermes/studio/generate", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, prompt: p, voiceId, provider }),
      });
      const j = await r.json();
      if (!r.ok || j.error) { setBusy(false); setStatus(`⚠ ${j.error ?? "generation failed"}`); return; }
      // MiniMax video is async (taskId → poll); Grok video is synchronous (returns url).
      if (kind === "video" && j.taskId) { pollVideo(j.taskId, j.slug, Date.now()); return; }
      setItems((s) => ({ ...s, [kind]: [{ name: j.name, url: j.url, prompt: p }, ...s[kind]] }));
      setBusy(false); setStatus("");
    } catch (e) {
      setBusy(false); setStatus(`⚠ ${String(e)}`);
    }
  }

  const models = PROVIDERS.find((p) => p.id === provider)!.models;
  const tabs: { k: Kind; label: string; icon: React.ReactNode; hint: string }[] = [
    { k: "image", label: "Image", icon: <ImageIcon size={14} />, hint: models.image },
    { k: "video", label: "Video", icon: <Film size={14} />, hint: models.video },
    { k: "voice", label: "Voice", icon: <Mic size={14} />, hint: models.voice },
  ];
  const gallery = items[kind];

  return (
    <div className="panel p-5 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="grid place-items-center w-9 h-9 rounded-xl" style={{ background: "rgba(96,165,250,0.18)", color: ACCENT }}>
            <Sparkles size={17} />
          </div>
          <div>
            <div className="text-sm font-medium" style={{ color: ACCENT }}>Studio</div>
            <div className="text-[11px] text-[var(--fg-dimmer)]">Type a prompt → generate image · video · voice, live</div>
          </div>
          {/* provider toggle */}
          <div className="flex items-center gap-1 ml-2 p-0.5 rounded-full border" style={{ borderColor: "var(--panel-border)" }}>
            {PROVIDERS.map((p) => {
              const on = provider === p.id;
              return (
                <button key={p.id}
                  onClick={() => { setProvider(p.id); setVoiceId((p.id === "grok" ? GROK_VOICES : MM_VOICES)[0].id); }}
                  className="px-2.5 py-1 rounded-full text-[11.5px] font-medium transition"
                  style={{ background: on ? (p.id === "grok" ? "rgba(244,114,182,0.18)" : "rgba(96,165,250,0.18)") : "transparent", color: on ? "var(--fg)" : "var(--fg-dim)" }}>
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {tabs.map((t) => {
            const on = kind === t.k;
            return (
              <button key={t.k} onClick={() => setKind(t.k)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[12.5px] transition"
                style={{ background: on ? "rgba(96,165,250,0.16)" : "transparent", borderColor: on ? ACCENT : "var(--panel-border)", color: on ? "var(--fg)" : "var(--fg-dim)" }}>
                {t.icon}{t.label}<span className="text-[10px] opacity-60">{t.hint}</span>
              </button>
            );
          })}
        </div>
      </div>

      {provider === "minimax" && !connected && (
        <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-[12px] border" style={{ borderColor: "rgba(251,191,36,.35)", background: "rgba(251,191,36,.08)" }}>
          <AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-300" />
          <span>MiniMax isn’t connected. Run <code>hermes auth add minimax-oauth</code> in a terminal, then refresh — or switch to <b>Grok</b> above.</span>
        </div>
      )}

      {/* composer */}
      <div className="space-y-2.5">
        <div className="flex gap-2 items-end">
          <textarea
            value={prompt} onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); generate(); } }}
            rows={2}
            placeholder={kind === "voice" ? "Text to speak…  (⌘+Enter)" : "Describe what to generate…  (⌘+Enter)"}
            className="flex-1 bg-[rgba(0,0,0,0.25)] border rounded-xl px-3 py-2.5 text-[13.5px] outline-none resize-none focus:border-[var(--panel-border-hot)]"
            style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }}
          />
          <button onClick={generate} disabled={busy || !prompt.trim()}
            className="px-4 h-[46px] rounded-xl flex items-center gap-2 text-sm font-medium transition disabled:opacity-40"
            style={{ background: `${ACCENT}24`, border: `1px solid ${ACCENT}55`, color: ACCENT }}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {busy ? "Working" : "Generate"}
          </button>
        </div>

        {kind === "voice" && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] uppercase tracking-widest text-[var(--fg-dimmer)]">Voice</span>
            {voiceList.map((v) => (
              <button key={v.id} onClick={() => setVoiceId(v.id)}
                className="px-2.5 py-1 rounded-full border text-[11.5px] transition"
                style={{ borderColor: voiceId === v.id ? ACCENT : "var(--panel-border)", color: voiceId === v.id ? "var(--fg)" : "var(--fg-dim)", background: voiceId === v.id ? "rgba(96,165,250,0.14)" : "transparent" }}>
                {v.label}
              </button>
            ))}
          </div>
        )}

        {/* preset chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] uppercase tracking-widest text-[var(--fg-dimmer)]">Try</span>
          {PRESETS[kind].map((p, i) => (
            <button key={i} onClick={() => setPrompt(p)}
              className="px-2.5 py-1 rounded-full border text-[11.5px] text-[var(--fg-dim)] hover:text-[var(--fg)] hover:border-[var(--panel-border-hot)] transition truncate max-w-[280px]"
              style={{ borderColor: "var(--panel-border)" }} title={p}>
              {p.length > 42 ? p.slice(0, 42) + "…" : p}
            </button>
          ))}
        </div>

        {status && <div className="text-[12.5px]" style={{ color: ACCENT }}>{status}</div>}
      </div>

      {/* gallery */}
      <div className="pt-1">
        <div className="text-[11px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-2">
          {kind} · {gallery.length} generated
        </div>
        {gallery.length === 0 ? (
          <div className="text-[13px] text-[var(--fg-dim)] py-8 text-center border border-dashed rounded-xl" style={{ borderColor: "var(--panel-border)" }}>
            Nothing yet — generate something above, or tap a “Try” chip.
          </div>
        ) : kind === "voice" ? (
          <div className="space-y-2">
            {gallery.map((it) => (
              <div key={it.name} className="rounded-xl border px-3.5 py-3" style={{ borderColor: "var(--panel-border)", background: "rgba(96,165,250,0.05)" }}>
                {it.prompt && <div className="text-[12.5px] text-[var(--fg-dim)] mb-2 line-clamp-1">🎙️ {it.prompt}</div>}
                <audio src={it.url} controls className="w-full" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {gallery.map((it) => (
              <div key={it.name} className="rounded-xl border overflow-hidden group" style={{ borderColor: "var(--panel-border)" }}>
                {kind === "image"
                  ? <img src={it.url} loading="lazy" className="w-full aspect-video object-cover bg-black" />
                  : <video src={it.url} controls loop muted playsInline className="w-full aspect-video object-cover bg-black" />}
                {it.prompt && <div className="px-3 py-2 text-[11.5px] text-[var(--fg-dim)] line-clamp-2">{it.prompt}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

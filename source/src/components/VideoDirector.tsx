"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Clapperboard, Loader2, Sparkles, FileText, Film, Wand2, Play, Download,
  CheckCircle2, AlertCircle, RefreshCw, ChevronRight, User, Mic2, Clock, Eye,
} from "lucide-react";
import VoiceButton from "./VoiceButton";

const ACCENT = "#ef4444";
const RUN_KEY = "agentic-os/video/director/run/v1";

// ─── types ──────────────────────────────────────────────────────────────────
interface Scene { caption: string; narration_line: string; broll_prompt: string }
interface Script { title: string; hook: string; narration: string; description: string; cta: string; research_notes: string[]; scenes: Scene[] }
type Stage = "brief" | "script" | "assets" | "render" | "done";
type GenStatus = "idle" | "processing" | "done" | "failed";
interface BrollState { status: GenStatus; url?: string; taskId?: string; slug?: string; err?: string }
interface AvatarState { status: GenStatus; videoId?: string; url?: string; err?: string }
interface DirectorRun {
  id: string; topic: string; durationSec: number; mode: "avatar" | "voiceover"; engine: "minimax" | "grok";
  voiceEngine: "elevenlabs" | "minimax"; elevenVoiceId?: string; elevenVoiceName?: string;
  brand: string; avatarId?: string; avatarName?: string; voiceId?: string; voiceName?: string;
  stage: Stage; script?: Script; scriptEngine?: "claude" | "local";
  broll: Record<number, BrollState>; avatar: AvatarState; voiceover: BrollState;
  slug?: string; indexUrl?: string; jobId?: string; renderStatus?: string; finalUrl?: string;
  createdAt: number;
}

const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // generic ElevenLabs voice ("Rachel"); the dropdown loads the user's own voices
const fmtLen = (s: number) => s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ""}`;
let _s = 0; const uid = () => `d${Date.now().toString(36)}${(_s++).toString(36)}`;

function freshRun(): DirectorRun {
  return {
    id: uid(), topic: "", durationSec: 40, mode: "avatar", engine: "minimax", brand: "Agent OS",
    voiceEngine: "elevenlabs", elevenVoiceId: DEFAULT_VOICE_ID, elevenVoiceName: "Default voice",
    stage: "brief", broll: {}, avatar: { status: "idle" }, voiceover: { status: "idle" }, createdAt: Date.now(),
  };
}

export default function VideoDirector() {
  const [run, setRun] = useState<DirectorRun>(freshRun);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [avatars, setAvatars] = useState<{ avatar_id: string; avatar_name: string; preview_image_url?: string }[]>([]);
  const [elevenVoices, setElevenVoices] = useState<{ voice_id: string; name: string; category?: string }[]>([]);
  const [example, setExample] = useState<{ title?: string; description?: string; finalUrl?: string; indexUrl?: string; slug?: string } | null>(null);
  const hydrated = useRef(false);
  const update = useCallback((patch: Partial<DirectorRun>) => setRun((r) => ({ ...r, ...patch })), []);

  // persistence
  useEffect(() => { try { const raw = localStorage.getItem(RUN_KEY); if (raw) setRun(JSON.parse(raw)); } catch {} hydrated.current = true; }, []);
  useEffect(() => { if (hydrated.current) try { localStorage.setItem(RUN_KEY, JSON.stringify(run)); } catch {} }, [run]);

  // worked example pointer (a real video the Director built end-to-end)
  useEffect(() => { fetch("/api/video/auto/example").then((r) => r.json()).then((j) => { if (j.ok && j.example?.finalUrl) setExample(j.example); }).catch(() => {}); }, []);

  // ElevenLabs voices for the dropdown (your clone first)
  useEffect(() => {
    fetch("/api/video/voices").then((r) => r.json()).then((j) => {
      if (j.ok && Array.isArray(j.voices)) {
        setElevenVoices(j.voices);
        setRun((r) => (r.elevenVoiceId ? r : { ...r, elevenVoiceId: j.defaultVoiceId, elevenVoiceName: j.voices[0]?.name }));
      }
    }).catch(() => {});
  }, []);
  function loadExample() {
    if (!example) return;
    setRun({
      ...freshRun(), stage: "done", finalUrl: example.finalUrl, slug: example.slug, indexUrl: example.indexUrl,
      renderStatus: "completed",
      script: { title: example.title ?? "Example video", description: example.description ?? "A video the Director built end-to-end — research → script → voiceover → b-roll → edit.", hook: "", narration: "", cta: "", research_notes: [], scenes: [] },
    });
  }

  // load the user's own HeyGen avatars (default-picked) for avatar mode. The voice is
  // ElevenLabs (loaded separately) — HeyGen just lip-syncs the face to it.
  useEffect(() => {
    if (run.mode !== "avatar") return;
    (async () => {
      try {
        const a = await fetch("/api/video/heygen/avatars?limit=12").then((r) => r.json());
        const av = a.avatars ?? [];
        setAvatars(av);
        setRun((r) => ({ ...r, avatarId: r.avatarId ?? av[0]?.avatar_id, avatarName: r.avatarName ?? av[0]?.avatar_name }));
      } catch {}
    })();
  }, [run.mode]);

  // ─── central poller — advances any in-flight async work ─────────────────────
  useEffect(() => {
    if (run.stage !== "assets" && run.stage !== "render") return;
    const tick = async () => {
      // avatar (HeyGen)
      if (run.stage === "assets" && run.mode === "avatar" && run.avatar.status === "processing" && run.avatar.videoId) {
        try {
          const j = await fetch(`/api/video/heygen/status?id=${encodeURIComponent(run.avatar.videoId)}`).then((r) => r.json());
          if (j.ok && j.status === "completed") setRun((r) => ({ ...r, avatar: { ...r.avatar, status: "done", url: j.video_url } }));
          else if (j.ok && j.status === "failed") setRun((r) => ({ ...r, avatar: { ...r.avatar, status: "failed", err: "avatar failed" } }));
        } catch {}
      }
      // minimax b-roll polls
      if (run.stage === "assets") {
        for (const [k, st] of Object.entries(run.broll)) {
          if (st.status === "processing" && st.taskId) {
            try {
              const j = await fetch(`/api/hermes/studio/video-status?taskId=${st.taskId}&slug=${encodeURIComponent(st.slug ?? "broll")}`).then((r) => r.json());
              if (j.status === "done") setRun((r) => ({ ...r, broll: { ...r.broll, [+k]: { status: "done", url: j.url } } }));
              else if (j.status === "failed") setRun((r) => ({ ...r, broll: { ...r.broll, [+k]: { status: "failed", err: "broll failed" } } }));
            } catch {}
          }
        }
      }
      // render poll
      if (run.stage === "render" && run.jobId) {
        try {
          const j = await fetch(`/api/video/hyperframes/render/status?id=${encodeURIComponent(run.jobId)}`).then((r) => r.json());
          if (j.job) {
            if (j.job.status === "completed" && j.outputUrl) setRun((r) => ({ ...r, renderStatus: "completed", finalUrl: j.outputUrl, stage: "done" }));
            else if (j.job.status === "failed") setRun((r) => ({ ...r, renderStatus: "failed" }));
            else setRun((r) => ({ ...r, renderStatus: j.job.status }));
          }
        } catch {}
      }
    };
    const i = setInterval(tick, 3500); tick();
    return () => clearInterval(i);
  }, [run.stage, run.mode, run.avatar, run.broll, run.jobId]);

  // ─── actions ────────────────────────────────────────────────────────────────
  async function writeScript() {
    if (!run.topic.trim()) { setErr("Type a topic first."); return; }
    setBusy("Researching + writing the script…"); setErr(null);
    try {
      const j = await fetch("/api/video/auto/script", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: run.topic, durationSec: run.durationSec }),
      }).then((r) => r.json());
      if (!j.ok) { setErr((j.error || "Script failed") + (j.detail ? `: ${j.detail}` : "")); setBusy(null); return; }
      update({ script: j.script, scriptEngine: j.engine, stage: "script" });
    } catch (e) { setErr(String(e)); }
    setBusy(null);
  }

  async function generateAssets() {
    if (!run.script) return;
    setErr(null);
    const sc = run.script;
    // reset states
    const broll: Record<number, BrollState> = {};
    sc.scenes.forEach((_, i) => (broll[i] = { status: "processing" }));
    update({ stage: "assets", broll, avatar: { status: run.mode === "avatar" ? "processing" : "idle" }, voiceover: { status: run.mode === "voiceover" ? "processing" : "idle" } });

    // narration audio
    if (run.mode === "avatar") {
      if (!run.avatarId) { setRun((r) => ({ ...r, avatar: { status: "failed", err: "no avatar selected" } })); }
      else {
        // ElevenLabs voice → HeyGen lip-syncs the avatar to it. (If the voice
        // engine is HeyGen's own, fall back to text TTS with a HeyGen voice.)
        (async () => {
          try {
            let heyBody: Record<string, unknown> = { avatarId: run.avatarId };
            if (run.voiceEngine === "elevenlabs") {
              const a = await fetch("/api/hermes/studio/generate", {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ kind: "voice", provider: "elevenlabs", prompt: sc.narration.slice(0, 10000), voiceId: run.elevenVoiceId }),
              }).then((r) => r.json());
              if (!a.ok || !a.url) { setRun((r) => ({ ...r, avatar: { status: "failed", err: a.error || "ElevenLabs voice failed" } })); return; }
              heyBody = { avatarId: run.avatarId, audioUrl: a.url };
            } else {
              heyBody = { avatarId: run.avatarId, voiceId: run.voiceId, text: sc.narration.slice(0, 8000) };
            }
            const j = await fetch("/api/video/heygen/generate", {
              method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(heyBody),
            }).then((r) => r.json());
            if (j.ok && j.videoId) setRun((r) => ({ ...r, avatar: { status: "processing", videoId: j.videoId } }));
            else setRun((r) => ({ ...r, avatar: { status: "failed", err: j.error || "avatar failed" } }));
          } catch (e) { setRun((r) => ({ ...r, avatar: { status: "failed", err: String(e) } })); }
        })();
      }
    } else {
      // voiceover-only — ElevenLabs (default) or MiniMax TTS
      fetch("/api/hermes/studio/generate", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "voice", provider: run.voiceEngine, prompt: sc.narration.slice(0, 10000), voiceId: run.voiceEngine === "elevenlabs" ? run.elevenVoiceId : undefined }),
      }).then((r) => r.json()).then((j) => {
        if (j.ok && j.url) setRun((r) => ({ ...r, voiceover: { status: "done", url: j.url } }));
        else setRun((r) => ({ ...r, voiceover: { status: "failed", err: j.error || "voiceover failed" } }));
      }).catch((e) => setRun((r) => ({ ...r, voiceover: { status: "failed", err: String(e) } })));
    }

    // b-roll per scene
    sc.scenes.forEach((scene, i) => genBroll(i, scene.broll_prompt));
  }

  function genBroll(i: number, prompt: string, provider?: DirectorRun["engine"]) {
    const eng = provider ?? run.engine;
    setRun((r) => ({ ...r, broll: { ...r.broll, [i]: { status: "processing" } } }));
    fetch("/api/hermes/studio/generate", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "video", prompt, provider: eng }),
    }).then((r) => r.json()).then((j) => {
      if (j.ok && j.status === "done" && j.url) setRun((r) => ({ ...r, broll: { ...r.broll, [i]: { status: "done", url: j.url } } }));
      else if (j.ok && j.taskId) setRun((r) => ({ ...r, broll: { ...r.broll, [i]: { status: "processing", taskId: j.taskId, slug: j.slug } } }));
      // Grok needs OpenClaw on the server PATH (often missing) → auto-fall back to MiniMax so b-roll never dead-ends.
      else if (eng !== "minimax") genBroll(i, prompt, "minimax");
      else setRun((r) => ({ ...r, broll: { ...r.broll, [i]: { status: "failed", err: j.error || "broll failed" } } }));
    }).catch((e) => { if (eng !== "minimax") genBroll(i, prompt, "minimax"); else setRun((r) => ({ ...r, broll: { ...r.broll, [i]: { status: "failed", err: String(e) } } })); });
  }

  async function assembleAndRender() {
    if (!run.script) return;
    setBusy("Assembling the edit…"); setErr(null);
    try {
      const narrationUrl = run.mode === "avatar" ? (run.avatar.url ?? "") : (run.voiceover.url ?? "");
      const scenes = run.script.scenes.map((s, i) => ({ caption: s.caption, narration_line: s.narration_line, brollUrl: run.broll[i]?.url }));
      const a = await fetch("/api/video/auto/assemble", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: run.script.title, brand: run.brand, mode: run.mode, narrationUrl, avatarUrl: run.avatar.url, scenes }),
      }).then((r) => r.json());
      if (!a.ok) { setErr(a.error || "assemble failed"); setBusy(null); return; }
      const rr = await fetch("/api/video/hyperframes/render", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: a.slug }),
      }).then((r) => r.json());
      if (!rr.ok) { setErr(rr.error || "render failed"); setBusy(null); return; }
      update({ slug: a.slug, indexUrl: a.indexUrl, jobId: rr.job.id, renderStatus: "rendering", stage: "render" });
    } catch (e) { setErr(String(e)); }
    setBusy(null);
  }

  function reset() { setRun(freshRun()); setErr(null); }

  // asset progress
  const brollDone = Object.values(run.broll).filter((b) => b.status === "done").length;
  const brollTotal = run.script?.scenes.length ?? 0;
  const audioReady = run.mode === "avatar" ? run.avatar.status === "done" : run.voiceover.status === "done";
  const audioSettled = run.mode === "avatar" ? run.avatar.status !== "processing" && run.avatar.status !== "idle" : run.voiceover.status !== "processing" && run.voiceover.status !== "idle";
  const brollSettled = brollTotal > 0 && Object.values(run.broll).every((b) => b.status === "done" || b.status === "failed");
  const canAssemble = brollSettled && audioSettled && (brollDone > 0 || audioReady);

  // ─── render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <Stepper stage={run.stage} />
      {err && <div className="text-[12px] text-[var(--plum)] bg-[rgba(196,96,126,0.08)] border border-[rgba(196,96,126,0.3)] rounded-lg px-3 py-2">{err}</div>}

      {run.stage === "brief" && (
        <BriefStage run={run} update={update} busy={busy} onWrite={writeScript} avatars={avatars} elevenVoices={elevenVoices} hasExample={!!example} onExample={loadExample} />
      )}
      {run.stage === "script" && run.script && (
        <ScriptStage run={run} setRun={setRun} busy={busy} onBack={() => update({ stage: "brief" })} onRegen={writeScript} onGo={generateAssets} />
      )}
      {run.stage === "assets" && run.script && (
        <AssetsStage run={run} brollDone={brollDone} brollTotal={brollTotal} canAssemble={canAssemble} busy={busy} onRetryBroll={(i) => genBroll(i, run.script!.scenes[i].broll_prompt)} onAssemble={assembleAndRender} />
      )}
      {(run.stage === "render" || run.stage === "done") && (
        <OutputStage run={run} onReset={reset} />
      )}
    </div>
  );
}

// ─── stepper ──────────────────────────────────────────────────────────────────
function Stepper({ stage }: { stage: Stage }) {
  const steps: { key: Stage; label: string; icon: React.ReactNode }[] = [
    { key: "brief", label: "Brief", icon: <Wand2 size={13} /> },
    { key: "script", label: "Research + Script", icon: <FileText size={13} /> },
    { key: "assets", label: "Avatar + B-roll", icon: <Film size={13} /> },
    { key: "render", label: "Edit + Render", icon: <Clapperboard size={13} /> },
    { key: "done", label: "Output", icon: <Play size={13} /> },
  ];
  const order: Stage[] = ["brief", "script", "assets", "render", "done"];
  const cur = order.indexOf(stage);
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {steps.map((s, i) => {
        const done = i < cur, active = i === cur;
        return (
          <div key={s.key} className="flex items-center gap-1.5">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[11.5px]"
              style={{
                background: active ? `${ACCENT}1f` : done ? "rgba(52,211,153,0.12)" : "transparent",
                borderColor: active ? ACCENT : done ? "rgba(52,211,153,0.4)" : "var(--line-soft)",
                color: active ? "var(--cream)" : done ? "var(--emerald)" : "var(--cream-mute)",
              }}>
              {done ? <CheckCircle2 size={13} /> : s.icon}{s.label}
            </div>
            {i < steps.length - 1 && <ChevronRight size={12} className="text-[var(--cream-mute)]" />}
          </div>
        );
      })}
    </div>
  );
}

// ─── brief ────────────────────────────────────────────────────────────────────
function BriefStage({ run, update, busy, onWrite, avatars, elevenVoices, hasExample, onExample }: {
  run: DirectorRun; update: (p: Partial<DirectorRun>) => void; busy: string | null; onWrite: () => void;
  avatars: { avatar_id: string; avatar_name: string; preview_image_url?: string }[];
  elevenVoices: { voice_id: string; name: string; category?: string }[];
  hasExample: boolean; onExample: () => void;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
      <div className="panel p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="action-tag" style={{ color: ACCENT }}>What's the video about?</div>
          {hasExample && (
            <button onClick={onExample} className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border transition hover:bg-[rgba(255,255,255,0.03)]" style={{ borderColor: `${ACCENT}55`, color: ACCENT }}>
              <Play size={11} /> See an example
            </button>
          )}
        </div>
        <div className="relative">
          <textarea value={run.topic} onChange={(e) => update({ topic: e.target.value })} rows={5}
            placeholder="e.g. Why Claude Opus 4.8 changes everything for AI agents — the 3 things that matter and how to use it today"
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onWrite(); }}
            className="w-full p-3 rounded-lg text-[13px] resize-none"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--panel-border)", color: "var(--cream)" }} />
          <div className="absolute right-2 bottom-2"><VoiceButton size={32} onTranscript={(t, o) => { if (o.final) update({ topic: (run.topic ? run.topic + " " : "") + t }); }} /></div>
        </div>
        <div className="flex items-center justify-between">
          <div className="text-[10.5px] text-[var(--cream-mute)]">⌘+Enter · the agent researches the topic, then writes a script you can edit</div>
          <button onClick={onWrite} disabled={!!busy || !run.topic.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[12.5px] font-medium transition"
            style={{ background: busy ? "rgba(239,68,68,0.15)" : ACCENT, color: busy ? ACCENT : "#1a0f20", border: `1px solid ${ACCENT}`, opacity: busy || !run.topic.trim() ? 0.6 : 1, boxShadow: busy ? undefined : `0 6px 22px -8px ${ACCENT}` }}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}{busy ? busy : "Write the script"}
          </button>
        </div>
      </div>

      <div className="panel p-4 space-y-3.5">
        <div className="action-tag" style={{ color: ACCENT }}>Settings</div>
        <Field label={`Length · ${fmtLen(run.durationSec)}`}>
          <input type="range" min={15} max={600} step={15} value={run.durationSec} onChange={(e) => update({ durationSec: +e.target.value })} className="w-full accent-[#ef4444]" />
          {run.durationSec >= 240 && <div className="text-[10px] text-[var(--cream-mute)] mt-1">Long videos take longer to render + cost more credits (avatar + b-roll scale with length).</div>}
        </Field>
        <Field label="Narrator">
          <Toggle options={[{ v: "avatar", l: "Presenter", icon: <User size={11} /> }, { v: "voiceover", l: "Voiceover", icon: <Mic2 size={11} /> }]} value={run.mode} onChange={(v) => update({ mode: v as DirectorRun["mode"] })} />
        </Field>
        <Field label="B-roll engine">
          <Toggle options={[{ v: "grok", l: "Grok" }, { v: "minimax", l: "MiniMax" }]} value={run.engine} onChange={(v) => update({ engine: v as DirectorRun["engine"] })} />
        </Field>
        {run.mode === "avatar" && (
          <Field label="Avatar (lip-synced to the voice)">
            <select value={run.avatarId ?? ""} onChange={(e) => { const a = avatars.find((x) => x.avatar_id === e.target.value); update({ avatarId: a?.avatar_id, avatarName: a?.avatar_name }); }}
              className="w-full p-2 rounded-md text-[12px]" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--panel-border)", color: "var(--cream)" }}>
              {avatars.length === 0 && <option value="">Loading…</option>}
              {avatars.map((a) => <option key={a.avatar_id} value={a.avatar_id}>{a.avatar_name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Voice · ElevenLabs">
          <select value={run.elevenVoiceId ?? ""} onChange={(e) => { const v = elevenVoices.find((x) => x.voice_id === e.target.value); update({ elevenVoiceId: v?.voice_id, elevenVoiceName: v?.name }); }}
            className="w-full p-2 rounded-md text-[12px]" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--panel-border)", color: "var(--cream)" }}>
            {elevenVoices.length === 0 && <option value="">Loading…</option>}
            {elevenVoices.map((v) => <option key={v.voice_id} value={v.voice_id}>{v.name}</option>)}
          </select>
        </Field>
        <Field label="Brand / outro">
          <input value={run.brand} onChange={(e) => update({ brand: e.target.value })} className="w-full p-2 rounded-md text-[12px]" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--panel-border)", color: "var(--cream)" }} />
        </Field>
      </div>
    </div>
  );
}

// ─── script ───────────────────────────────────────────────────────────────────
function ScriptStage({ run, setRun, busy, onBack, onRegen, onGo }: {
  run: DirectorRun; setRun: React.Dispatch<React.SetStateAction<DirectorRun>>; busy: string | null;
  onBack: () => void; onRegen: () => void; onGo: () => void;
}) {
  const sc = run.script!;
  function editScene(i: number, patch: Partial<Scene>) {
    setRun((r) => { const scenes = [...r.script!.scenes]; scenes[i] = { ...scenes[i], ...patch }; return { ...r, script: { ...r.script!, scenes } }; });
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
      <div className="panel p-4 space-y-3">
        <input value={sc.title} onChange={(e) => setRun((r) => ({ ...r, script: { ...r.script!, title: e.target.value } }))}
          className="w-full bg-transparent text-[18px] font-semibold text-[var(--cream)] outline-none border-b border-transparent focus:border-[var(--line-soft)] pb-1" />
        <div className="text-[12px] text-[var(--cream-dim)] italic">“{sc.hook}”</div>
        <div className="space-y-2 max-h-[440px] overflow-y-auto scroll pr-1">
          {sc.scenes.map((s, i) => (
            <div key={i} className="rounded-lg border p-2.5 space-y-1.5" style={{ borderColor: "var(--line-soft)", background: "rgba(255,255,255,0.02)" }}>
              <div className="flex items-center gap-2">
                <span className="text-[10px] mono px-1.5 py-0.5 rounded shrink-0" style={{ background: `${ACCENT}18`, color: ACCENT }}>scene {i + 1}</span>
                <input value={s.caption} onChange={(e) => editScene(i, { caption: e.target.value })} placeholder="ON-SCREEN CAPTION"
                  className="flex-1 bg-transparent text-[12px] font-semibold uppercase tracking-wide text-[var(--cream)] outline-none" />
              </div>
              <textarea value={s.narration_line} onChange={(e) => editScene(i, { narration_line: e.target.value })} rows={2}
                className="w-full bg-transparent text-[12px] text-[var(--cream-soft)] outline-none resize-none" />
              <div className="flex items-start gap-1.5">
                <Film size={11} className="mt-1 shrink-0" style={{ color: "var(--cream-mute)" }} />
                <textarea value={s.broll_prompt} onChange={(e) => editScene(i, { broll_prompt: e.target.value })} rows={2}
                  placeholder="b-roll prompt" className="w-full bg-transparent text-[11px] text-[var(--cream-mute)] italic outline-none resize-none" />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel p-4 space-y-3 flex flex-col">
        <div className="flex items-center justify-between">
          <div className="action-tag" style={{ color: ACCENT }}>Research notes</div>
          {run.scriptEngine && (
            <span className="text-[9.5px] uppercase tracking-widest px-1.5 py-0.5 rounded" style={{ background: run.scriptEngine === "claude" ? `${ACCENT}18` : "rgba(94,234,212,0.14)", color: run.scriptEngine === "claude" ? ACCENT : "#5eead4" }}>
              {run.scriptEngine === "claude" ? "researched · claude" : "drafted · local"}
            </span>
          )}
        </div>
        <ul className="space-y-1.5 text-[11.5px] text-[var(--cream-dim)] max-h-[180px] overflow-y-auto scroll">
          {sc.research_notes.length === 0 && <li className="italic text-[var(--cream-mute)]">—</li>}
          {sc.research_notes.map((n, i) => <li key={i} className="flex gap-1.5"><span style={{ color: ACCENT }}>•</span><span>{n}</span></li>)}
        </ul>
        <div className="text-[10.5px] text-[var(--cream-mute)] leading-relaxed border-t pt-2" style={{ borderColor: "var(--line-soft)" }}>
          {sc.scenes.length} scenes · {run.mode === "avatar" ? `presenter: ${run.avatarName ?? "—"}` : "voiceover"} · voice: {run.elevenVoiceName ?? "ElevenLabs"} · b-roll: {run.engine}
        </div>
        <div className="mt-auto space-y-2">
          <button onClick={onGo} disabled={!!busy}
            className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full text-[12.5px] font-medium"
            style={{ background: ACCENT, color: "#1a0f20", border: `1px solid ${ACCENT}`, boxShadow: `0 6px 22px -8px ${ACCENT}` }}>
            <Film size={13} /> Generate avatar + b-roll
          </button>
          <div className="flex gap-2">
            <button onClick={onBack} className="flex-1 px-3 py-2 rounded-full text-[11.5px] border" style={{ borderColor: "var(--line-soft)", color: "var(--cream-dim)" }}>← Brief</button>
            <button onClick={onRegen} disabled={!!busy} className="flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-full text-[11.5px] border" style={{ borderColor: "var(--line-soft)", color: "var(--cream-dim)" }}>
              {busy ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Rewrite
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── assets ───────────────────────────────────────────────────────────────────
function AssetsStage({ run, brollDone, brollTotal, canAssemble, busy, onRetryBroll, onAssemble }: {
  run: DirectorRun; brollDone: number; brollTotal: number; canAssemble: boolean; busy: string | null;
  onRetryBroll: (i: number) => void; onAssemble: () => void;
}) {
  const audio = run.mode === "avatar" ? run.avatar : run.voiceover;
  const audioLabel = run.mode === "avatar"
    ? { processing: "Filming your avatar…", done: "Avatar ready", failed: "Avatar failed", idle: "Avatar" }[audio.status]
    : { processing: "Recording your voiceover…", done: "Voiceover ready", failed: "Voiceover failed", idle: "Voiceover" }[audio.status];
  const audioHint = audio.status === "processing"
    ? (run.mode === "avatar" ? "Lip-syncing your AI avatar to your ElevenLabs voice · usually 1–3 min" : "Generating your ElevenLabs narration…")
    : audio.status === "failed" ? (audio.err || "failed — try the Voiceover narrator, or re-run")
    : audio.status === "done" ? "done" : "";
  const aColor = audio.status === "done" ? "var(--emerald)" : audio.status === "failed" ? "var(--plum)" : ACCENT;
  return (
    <div className="space-y-3">
      <style>{`@keyframes dzslide{0%{transform:translateX(-130%)}100%{transform:translateX(430%)}}`}</style>
      <div className="panel p-3.5 space-y-3">
        {/* avatar / voiceover — its own labelled progress bar */}
        <div>
          <div className="flex items-center gap-2 text-[12.5px] mb-1.5" style={{ color: aColor }}>
            {audio.status === "processing" ? <Loader2 size={13} className="animate-spin" /> : audio.status === "done" ? <CheckCircle2 size={13} /> : audio.status === "failed" ? <AlertCircle size={13} /> : <User size={13} />}
            <span className="font-medium">{audioLabel}</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden relative" style={{ background: "rgba(255,255,255,0.08)" }}>
            {audio.status === "processing" ? (
              <div className="h-full absolute top-0 left-0" style={{ width: "32%", borderRadius: 999, background: `linear-gradient(90deg, transparent, ${ACCENT}, transparent)`, animation: "dzslide 1.4s ease-in-out infinite" }} />
            ) : (
              <div className="h-full rounded-full transition-all" style={{ width: audio.status === "done" ? "100%" : "0%", background: aColor }} />
            )}
          </div>
          {audioHint && <div className="text-[10.5px] text-[var(--cream-mute)] mt-1">{audioHint}</div>}
        </div>
        {/* b-roll — determinate count bar */}
        <div className="flex items-center gap-3 pt-0.5">
          <div className="text-[12px] text-[var(--cream-dim)] shrink-0" style={{ minWidth: 86 }}>B-roll {brollDone}/{brollTotal}</div>
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${brollTotal ? (brollDone / brollTotal) * 100 : 0}%`, background: ACCENT }} />
          </div>
          <button onClick={onAssemble} disabled={!canAssemble || !!busy}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[12.5px] font-medium transition shrink-0"
            style={{ background: canAssemble ? ACCENT : "rgba(239,68,68,0.15)", color: canAssemble ? "#1a0f20" : ACCENT, border: `1px solid ${ACCENT}`, opacity: canAssemble && !busy ? 1 : 0.55 }}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Clapperboard size={13} />}{busy ? busy : "Assemble + render"}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
        {run.script!.scenes.map((s, i) => {
          const b = run.broll[i] ?? { status: "idle" as GenStatus };
          return (
            <div key={i} className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--line-soft)" }}>
              <div className="aspect-video bg-black/50 relative grid place-items-center">
                {b.status === "done" && b.url ? (
                  <video src={b.url} muted loop autoPlay playsInline className="w-full h-full object-cover" />
                ) : b.status === "failed" ? (
                  <button onClick={() => onRetryBroll(i)} className="text-center"><AlertCircle size={20} className="mx-auto mb-1" style={{ color: "var(--plum)" }} /><div className="text-[10px]" style={{ color: ACCENT }}>retry</div></button>
                ) : (
                  <Loader2 size={20} className="animate-spin" style={{ color: ACCENT }} />
                )}
                <span className="absolute top-1 left-1 text-[9px] mono px-1.5 py-0.5 rounded" style={{ background: "rgba(0,0,0,0.6)", color: "var(--cream)" }}>{i + 1}</span>
              </div>
              <div className="p-2 text-[10.5px] text-[var(--cream-soft)] line-clamp-2" style={{ minHeight: 38 }}>{s.caption}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── output ───────────────────────────────────────────────────────────────────
function OutputStage({ run, onReset }: { run: DirectorRun; onReset: () => void }) {
  const rendering = run.stage === "render" || (run.renderStatus && run.renderStatus !== "completed" && run.renderStatus !== "failed");
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
      <div className="panel p-3 flex flex-col min-h-[460px]">
        <div className="action-tag mb-2" style={{ color: ACCENT }}>{run.finalUrl ? "Final video" : `Render · ${run.renderStatus ?? "starting"}`}</div>
        {run.finalUrl ? (
          <video src={run.finalUrl} controls autoPlay className="flex-1 min-h-0 w-full object-contain bg-black/40 rounded-md max-h-[520px]" />
        ) : run.renderStatus === "failed" ? (
          <div className="flex-1 grid place-items-center text-center"><div><AlertCircle size={30} className="mx-auto mb-2" style={{ color: "var(--plum)" }} /><div className="text-[13px] text-[var(--cream)]">Render failed</div></div></div>
        ) : (
          <div className="flex-1 grid place-items-center text-center p-6">
            <div>
              <Loader2 size={30} className="animate-spin mx-auto mb-3" style={{ color: ACCENT }} />
              <div className="text-[14px] text-[var(--cream)] font-medium mb-1">Cutting the edit together…</div>
              <div className="text-[11.5px] text-[var(--cream-mute)] max-w-[360px]">B-roll, captions, presenter + narration are being rendered to a single MP4. Usually 30–120s.</div>
              {run.indexUrl && <a href={run.indexUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 mt-3 text-[11px]" style={{ color: ACCENT }}><Eye size={11} /> Preview the live composition</a>}
            </div>
          </div>
        )}
      </div>
      <div className="panel p-4 space-y-3 flex flex-col">
        <div className="action-tag" style={{ color: ACCENT }}>{run.script?.title}</div>
        <div className="text-[11.5px] text-[var(--cream-dim)] leading-relaxed">{run.script?.description}</div>
        {run.script?.cta && <div className="text-[11px] text-[var(--cream-mute)] italic border-l-2 pl-2" style={{ borderColor: ACCENT }}>{run.script.cta}</div>}
        <div className="mt-auto space-y-2">
          {run.finalUrl && (
            <a href={run.finalUrl} download className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full text-[12.5px] font-medium" style={{ background: ACCENT, color: "#1a0f20" }}><Download size={13} /> Download MP4</a>
          )}
          <button onClick={onReset} className="w-full flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-[11.5px] border" style={{ borderColor: "var(--line-soft)", color: "var(--cream-dim)" }}>
            <Clapperboard size={12} /> New video
          </button>
          {rendering && <div className="text-[10px] text-[var(--cream-mute)] text-center flex items-center justify-center gap-1"><Clock size={10} /> you can leave — it keeps rendering</div>}
        </div>
      </div>
    </div>
  );
}

// ─── small shared bits ──────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><label className="text-[10px] uppercase tracking-widest text-[var(--cream-mute)]">{label}</label>{children}</div>;
}
function Toggle({ options, value, onChange }: { options: { v: string; l: string; icon?: React.ReactNode }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex rounded-md overflow-hidden border" style={{ borderColor: "var(--panel-border)" }}>
      {options.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)} className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[11.5px] transition"
          style={{ background: value === o.v ? `${ACCENT}22` : "transparent", color: value === o.v ? "var(--cream)" : "var(--cream-mute)" }}>
          {o.icon}{o.l}
        </button>
      ))}
    </div>
  );
}

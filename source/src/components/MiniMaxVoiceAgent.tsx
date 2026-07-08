"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, PhoneOff, Send, Loader2 } from "lucide-react";

// MiniMax voice agent — a fully server-side voice loop that does NOT use the
// browser's flaky webkitSpeechRecognition. Pipeline per turn:
//   1. record mic audio (MediaRecorder) with silence-based auto turn-taking
//   2. POST the clip to /api/openclaw/studio/stt  → transcript (server STT)
//   3. POST transcript to /api/hermes/talk        → MiniMax M3 reply + MiniMax voice
//   4. play the voice, then listen again
// Works in any browser that supports getUserMedia + MediaRecorder (all modern ones).

type Turn = { role: "user" | "assistant"; text: string };
type Stage = "idle" | "listening" | "hearing" | "transcribing" | "thinking" | "speaking";

const VOICES = [
  { id: "female-shaonv", label: "Female" },
  { id: "male-qn-qingse", label: "Male" },
  { id: "male-qn-jingying", label: "Deep" },
  { id: "presenter_female", label: "Presenter" },
];

export default function MiniMaxVoiceAgent({ accent = "#60a5fa" }: { accent?: string }) {
  const [active, setActive] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [voiceId, setVoiceId] = useState(VOICES[0].id);
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState("");

  const activeRef = useRef(false);
  const stageRef = useRef<Stage>("idle");
  const turnsRef = useRef<Turn[]>([]); turnsRef.current = turns;
  const voiceRef = useRef(voiceId); voiceRef.current = voiceId;
  const streamRef = useRef<MediaStream | null>(null);
  const acRef = useRef<AudioContext | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  function setStageS(s: Stage) { stageRef.current = s; setStage(s); }

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [turns, stage]);
  useEffect(() => () => { endCall(); }, []); // cleanup on unmount
  // 🔒 Privacy: end the call (release the mic) the moment this tab goes to the
  // background — never keep recording while you've switched away. Restart is deliberate.
  useEffect(() => {
    const onVis = () => { if (document.hidden && activeRef.current) endCall(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function pickMime(): string {
    const cands = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
    for (const c of cands) { try { if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c; } catch { /* */ } }
    return "";
  }

  async function startCall() {
    setErr("");
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { setErr("Microphone blocked — click the 🎤 in your browser's address bar to Allow, or type below."); return; }
    streamRef.current = stream;
    activeRef.current = true; setActive(true);
    beginListen();
  }

  function endCall() {
    activeRef.current = false; setActive(false);
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    try { if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop(); } catch { /* */ }
    try { audioElRef.current?.pause(); } catch { /* */ }
    audioElRef.current = null;
    try { acRef.current?.close(); } catch { /* */ } acRef.current = null;
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* */ }
    streamRef.current = null;
    setStageS("idle");
  }

  // Record one utterance, auto-stopping ~1.1s after speech ends (silence VAD).
  function beginListen() {
    if (!activeRef.current || !streamRef.current) return;
    setErr("");
    setStageS("listening");
    const stream = streamRef.current;
    const mime = pickMime();
    let mr: MediaRecorder;
    try { mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); }
    catch { setErr("Recording not supported in this browser."); endCall(); return; }
    recRef.current = mr;
    chunksRef.current = [];
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
    mr.onstop = () => { void handleRecording(); };
    try { mr.start(); } catch { setErr("Couldn't start recording."); endCall(); return; }

    // Silence detection via Web Audio.
    let ac: AudioContext;
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ac = new AC();
    } catch { return; }
    acRef.current = ac;
    const srcNode = ac.createMediaStreamSource(stream);
    const analyser = ac.createAnalyser();
    analyser.fftSize = 2048;
    srcNode.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    let speechStarted = false;
    let silenceStart = 0;
    const SPEECH_RMS = 0.012;
    const SILENCE_MS = 1100;
    const startedAt = performance.now();

    const tick = () => {
      if (!activeRef.current || stageRef.current === "idle") return;
      if (stageRef.current !== "listening" && stageRef.current !== "hearing") return;
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();
      if (rms > SPEECH_RMS) {
        if (!speechStarted) { speechStarted = true; setStageS("hearing"); }
        silenceStart = 0;
      } else if (speechStarted) {
        if (!silenceStart) silenceStart = now;
        else if (now - silenceStart > SILENCE_MS) { finishUtterance(false); return; }
      }
      // No speech at all for 15s → quietly re-arm so it never hangs.
      if (!speechStarted && now - startedAt > 15000) { finishUtterance(true); return; }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  function finishUtterance(noSpeech: boolean) {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    try { acRef.current?.close(); } catch { /* */ } acRef.current = null;
    if (noSpeech) {
      try { if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop(); } catch { /* */ }
      chunksRef.current = [];
      if (activeRef.current) setTimeout(beginListen, 120);
      return;
    }
    try { if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop(); } catch { /* */ }
    // mr.onstop → handleRecording()
  }

  async function handleRecording() {
    const type = recRef.current?.mimeType || "audio/webm";
    const blob = new Blob(chunksRef.current, { type });
    chunksRef.current = [];
    if (blob.size < 1400) { if (activeRef.current) beginListen(); else setStageS("idle"); return; }
    setStageS("transcribing");
    let text = "";
    try {
      const fd = new FormData();
      const ext = type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : "webm";
      fd.append("audio", blob, `rec.${ext}`);
      const r = await fetch("/api/openclaw/studio/stt", { method: "POST", body: fd });
      const j = await r.json();
      text = (j.text || "").trim();
      if (!text) {
        // No transcript — just keep listening (don't nag on a quiet clip).
        if (j.error && !/too short/i.test(j.error)) setErr(j.error);
        if (activeRef.current) beginListen(); else setStageS("idle");
        return;
      }
    } catch (e) { setErr(String(e)); if (activeRef.current) beginListen(); else setStageS("idle"); return; }
    await respond(text);
  }

  // Shared by voice + typed input: MiniMax M3 reply + MiniMax voice.
  async function respond(text: string) {
    setErr("");
    setTurns((p) => [...p, { role: "user", text }]);
    setStageS("thinking");
    try {
      const r = await fetch("/api/hermes/talk", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, voiceId: voiceRef.current, history: turnsRef.current.map((t) => ({ role: t.role, text: t.text })) }),
      });
      const j = await r.json();
      const reply = (j.reply || "").trim();
      if (!reply) { setErr(j.error || "MiniMax returned no reply — try again."); if (activeRef.current) beginListen(); else setStageS("idle"); return; }
      setTurns((p) => [...p, { role: "assistant", text: reply }]);
      if (j.audio) {
        setStageS("speaking");
        const a = new Audio(j.audio); audioElRef.current = a;
        const done = () => { audioElRef.current = null; if (activeRef.current) beginListen(); else setStageS("idle"); };
        a.onended = done; a.onerror = done;
        try { await a.play(); } catch { done(); }
      } else { if (activeRef.current) beginListen(); else setStageS("idle"); }
    } catch (e) { setErr(String(e)); if (activeRef.current) beginListen(); else setStageS("idle"); }
  }

  function sendTyped() {
    const t = typed.trim();
    if (!t || stageRef.current === "thinking" || stageRef.current === "speaking" || stageRef.current === "transcribing") return;
    setTyped("");
    respond(t);
  }

  const statusText =
    !active ? "Tap to start — then just talk (no Chrome speech needed)"
    : stage === "listening" ? "Listening… start speaking"
    : stage === "hearing" ? "Hearing you… (pause when done)"
    : stage === "transcribing" ? "Transcribing…"
    : stage === "thinking" ? "MiniMax is thinking…"
    : stage === "speaking" ? "MiniMax is speaking…"
    : "Your turn…";

  const busy = stage === "transcribing" || stage === "thinking" || stage === "speaking";

  return (
    <div className="panel p-6 flex flex-col" style={{ height: "min(72vh, 760px)" }}>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="grid place-items-center w-9 h-9 rounded-xl" style={{ background: `${accent}2e`, color: accent }}><Mic size={17} /></div>
          <div>
            <div className="text-sm font-medium" style={{ color: accent }}>MiniMax Voice Agent</div>
            <div className="text-[11px] text-[var(--fg-dimmer)]">Your mic → MiniMax transcribes → M3 replies → MiniMax voice</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {VOICES.map((v) => (
            <button key={v.id} onClick={() => setVoiceId(v.id)}
              className="px-2.5 py-1 rounded-full border text-[11.5px] transition"
              style={{ borderColor: voiceId === v.id ? accent : "var(--panel-border)", color: voiceId === v.id ? "var(--fg)" : "var(--fg-dim)", background: voiceId === v.id ? `${accent}24` : "transparent" }}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={scrollRef} className="scroll flex-1 min-h-0 overflow-y-auto py-3 space-y-3">
        {turns.length === 0 && (
          <div className="h-full grid place-items-center text-center text-[var(--fg-dim)]">
            <div>
              <div className="mx-auto mb-4 mm-orb" data-on={active ? "1" : "0"} style={{ ["--a" as string]: accent }} />
              <p className="text-sm">Tap the orb, allow the mic, and just talk.</p>
              <p className="text-[12px] text-[var(--fg-dimmer)] mt-1">It records, MiniMax transcribes &amp; replies out loud. Pause when you finish a sentence.</p>
            </div>
          </div>
        )}
        {turns.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "flex-row-reverse" : ""} gap-2.5`}>
            <div className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed ${m.role === "user" ? "rounded-tr-md bg-[rgba(255,255,255,0.05)] border border-[var(--panel-border)]" : "rounded-tl-md border"}`}
              style={m.role === "assistant" ? { background: `linear-gradient(135deg, ${accent}1f, transparent 60%)`, borderColor: `${accent}66` } : undefined}>
              {m.text}
            </div>
          </div>
        ))}
        {busy && <div className="flex gap-2 items-center text-[13px] text-[var(--fg-dim)]"><Loader2 size={14} className="animate-spin" /> {statusText}</div>}
      </div>

      <div className="pt-3 border-t border-[var(--panel-border)]">
        <div className="flex items-center justify-center mb-2.5">
          <button onClick={active ? endCall : startCall}
            className="mm-orb-btn" data-on={active ? "1" : "0"} data-s={stage} style={{ ["--a" as string]: accent }}
            title={active ? "Tap to end" : "Tap to start — then just talk"}>
            {active ? <PhoneOff size={22} /> : <Mic size={24} />}
          </button>
        </div>
        <div className="text-center text-[12.5px] mb-1" style={{ color: active ? "#34d399" : accent }}>
          {active && <span style={{ color: "#34d399" }}>● </span>}{statusText}
        </div>
        {err && <div className="text-center text-[11.5px] mb-2" style={{ color: "#f0a3b4" }}>{err}</div>}
        <div className="flex gap-2 items-end">
          <input value={typed} onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendTyped(); } }}
            placeholder="…or type to talk (works without a mic)"
            className="flex-1 bg-[rgba(0,0,0,0.25)] border rounded-xl px-3.5 py-2.5 text-[14px] outline-none"
            style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
          <button onClick={sendTyped} disabled={!typed.trim()}
            className="px-3.5 h-[44px] rounded-xl flex items-center gap-1.5 text-sm transition disabled:opacity-40"
            style={{ background: `${accent}24`, border: `1px solid ${accent}55`, color: accent }}><Send size={15} /></button>
        </div>
      </div>

      <style jsx>{`
        .mm-orb, .mm-orb-btn { width: 84px; height: 84px; border-radius: 50%;
          background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--a) 60%, white), var(--a) 75%);
          box-shadow: 0 0 50px -8px var(--a); display: grid; place-items: center; color: #fff; border: none; cursor: pointer; transition: transform .15s; }
        .mm-orb { width: 64px; height: 64px; }
        .mm-orb-btn:hover { transform: scale(1.06); }
        .mm-orb-btn[data-s="listening"], .mm-orb[data-on="1"] { animation: mm-ring 1.6s infinite; }
        .mm-orb-btn[data-s="hearing"] { animation: mm-ring 0.8s infinite; }
        .mm-orb-btn[data-s="speaking"] { animation: mm-ring 0.7s infinite; }
        .mm-orb-btn[data-s="thinking"], .mm-orb-btn[data-s="transcribing"] { animation: mm-spin 1s linear infinite; }
        @keyframes mm-ring { 0%{box-shadow:0 0 0 0 color-mix(in srgb, var(--a) 50%, transparent)} 70%{box-shadow:0 0 0 22px transparent} 100%{box-shadow:0 0 0 0 transparent} }
        @keyframes mm-spin { to { transform: rotate(360deg) } }
      `}</style>
    </div>
  );
}

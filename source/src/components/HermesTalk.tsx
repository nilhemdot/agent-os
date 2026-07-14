"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Send, Volume2, Loader2, PhoneOff } from "lucide-react";

type Turn = { role: "user" | "assistant"; text: string };
const ACCENT = "#60a5fa";
const VOICES = [
  { id: "male-qn-qingse", label: "Male" },
  { id: "female-shaonv", label: "Female" },
  { id: "male-qn-jingying", label: "Deep M" },
  { id: "presenter_female", label: "Presenter" },
];

type SR = { lang: string; interimResults: boolean; continuous: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error?: string }) => void) | null; start: () => void; stop: () => void };

export default function HermesTalk() {
  const [msgs, setMsgs] = useState<Turn[]>([]);
  const [convo, setConvo] = useState(false);       // hands-free conversation active
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState("");
  const [input, setInput] = useState("");
  const [voiceId, setVoiceId] = useState(VOICES[0].id);
  const [sttOk, setSttOk] = useState(true);
  const [micMsg, setMicMsg] = useState("");

  const recRef = useRef<SR | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const msgsRef = useRef<Turn[]>([]); msgsRef.current = msgs;
  const convoRef = useRef(false);
  const interimRef = useRef(""); interimRef.current = interim;
  const voiceRef = useRef(voiceId); voiceRef.current = voiceId;

  useEffect(() => {
    // @ts-expect-error vendor-prefixed
    const SRClass = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
    if (!SRClass) { setSttOk(false); return; }
    const r: SR = new SRClass();
    r.lang = "en-US"; r.interimResults = true; r.continuous = false;
    r.onresult = (e) => { let t = ""; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; setInterim(t); };
    r.onerror = () => { setListening(false); if (convoRef.current) setTimeout(beginListen, 500); };
    recRef.current = r;
    return () => { try { r.stop(); } catch { /* */ } };
  }, []);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [msgs, interim]);

  function beginListen() {
    const r = recRef.current;
    if (!r || !convoRef.current || busyOrSpeakingRef.current) return;
    setInterim(""); setListening(true);
    r.onend = () => {
      setListening(false);
      const t = interimRef.current.trim();
      setInterim("");
      if (t) send(t);
      else if (convoRef.current) setTimeout(beginListen, 400); // user paused — keep waiting
    };
    try { r.start(); } catch { setTimeout(() => { if (convoRef.current) beginListen(); }, 600); }
  }

  // track busy/speaking without stale closures
  const busyOrSpeakingRef = useRef(false);
  useEffect(() => { busyOrSpeakingRef.current = busy || speaking; }, [busy, speaking]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    const next = [...msgsRef.current, { role: "user" as const, text }];
    setMsgs(next); setInput(""); setBusy(true);
    try {
      const r = await fetch("/api/hermes/talk", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, voiceId: voiceRef.current, history: msgsRef.current }),
      });
      const j = await r.json();
      const reply = j.reply || `(${j.error || "no reply"})`;
      setMsgs((m) => [...m, { role: "assistant", text: reply }]);
      setBusy(false);
      if (j.audio) {
        const a = new Audio(j.audio); audioRef.current = a; setSpeaking(true);
        a.onended = () => { setSpeaking(false); if (convoRef.current) setTimeout(beginListen, 250); };
        a.play().catch(() => { setSpeaking(false); if (convoRef.current) setTimeout(beginListen, 250); });
      } else if (convoRef.current) {
        setTimeout(beginListen, 250);
      }
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", text: `(error: ${String(e)})` }]);
      setBusy(false);
      if (convoRef.current) setTimeout(beginListen, 400);
    }
  }

  async function startConvo() {
    if (!sttOk) return;
    // Explicitly request mic permission first. Without this, a blocked mic makes
    // recognition.start() error → silent retry loop → feels like "nothing happens".
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      setMicMsg("");
    } catch {
      setMicMsg("Microphone blocked — click the 🎤 in your browser's address bar to Allow, or type below.");
      return;
    }
    convoRef.current = true; setConvo(true);
    beginListen();
  }
  function endConvo() {
    convoRef.current = false; setConvo(false);
    try { recRef.current?.stop(); } catch { /* */ }
    try { audioRef.current?.pause(); } catch { /* */ }
    setListening(false); setSpeaking(false); setInterim("");
  }
  function toggleConvo() { if (convo) endConvo(); else startConvo(); }

  const orbState = listening ? "listen" : busy ? "think" : speaking ? "speak" : convo ? "active" : "idle";
  const status = micMsg ? micMsg : !convo ? (sttOk ? "Tap to start a hands-free conversation" : "Voice needs Chrome — type below")
    : listening ? "Listening… (just talk)" : busy ? "Hermes is thinking…" : speaking ? "Speaking…" : "Your turn…";

  return (
    <div className="panel p-6 flex flex-col" style={{ height: "min(72vh, 760px)" }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="grid place-items-center w-9 h-9 rounded-xl" style={{ background: "rgba(96,165,250,0.18)", color: ACCENT }}><Volume2 size={17} /></div>
          <div><div className="text-sm font-medium" style={{ color: ACCENT }}>Talk to Hermes</div>
            <div className="text-[11px] text-[var(--fg-dimmer)]">Hands-free voice · MiniMax M3 brain + MiniMax voice</div></div>
        </div>
        <div className="flex items-center gap-1.5">
          {VOICES.map((v) => (
            <button key={v.id} onClick={() => setVoiceId(v.id)}
              className="px-2.5 py-1 rounded-full border text-[11.5px] transition"
              style={{ borderColor: voiceId === v.id ? ACCENT : "var(--panel-border)", color: voiceId === v.id ? "var(--fg)" : "var(--fg-dim)", background: voiceId === v.id ? "rgba(96,165,250,0.14)" : "transparent" }}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={scrollRef} className="scroll flex-1 min-h-0 overflow-y-auto py-3 space-y-3">
        {msgs.length === 0 && !interim && (
          <div className="h-full grid place-items-center text-center text-[var(--fg-dim)]">
            <div>
              <div className="mx-auto mb-4 orb" data-s={orbState} />
              <p className="text-sm">Tap the orb and just talk — it keeps the conversation going.</p>
              <p className="text-[12px] text-[var(--fg-dimmer)] mt-1">Tap again any time to end. No need to tap between turns.</p>
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "flex-row-reverse" : ""} gap-2.5`}>
            <div className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed ${m.role === "user" ? "rounded-tr-md bg-[rgba(255,255,255,0.05)] border border-[var(--panel-border)]" : "rounded-tl-md border"}`}
              style={m.role === "assistant" ? { background: "linear-gradient(135deg, rgba(96,165,250,0.12), transparent 60%)", borderColor: "rgba(96,165,250,0.4)" } : undefined}>
              {m.text}
            </div>
          </div>
        ))}
        {interim && <div className="flex flex-row-reverse"><div className="max-w-[78%] rounded-2xl rounded-tr-md px-4 py-2.5 text-[14px] text-[var(--fg-dim)] border border-dashed" style={{ borderColor: "var(--panel-border)" }}>{interim}</div></div>}
        {busy && <div className="flex gap-2 items-center text-[13px] text-[var(--fg-dim)]"><Loader2 size={14} className="animate-spin" /> thinking…</div>}
      </div>

      <div className="pt-3 border-t border-[var(--panel-border)]">
        <div className="flex items-center justify-center mb-2.5">
          <button onClick={toggleConvo} disabled={!sttOk}
            title={convo ? "Tap to end the conversation" : "Tap to start — then just talk"}
            className="orb-btn disabled:opacity-40" data-s={orbState}>
            {convo ? <PhoneOff size={22} /> : <Mic size={24} />}
          </button>
        </div>
        <div className="text-center text-[12.5px] mb-3" style={{ color: convo ? "#34d399" : ACCENT }}>
          {convo && <span style={{ color: "#34d399" }}>● </span>}{status}
        </div>
        <div className="flex gap-2 items-end">
          <input value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(input.trim()); } }}
            placeholder="…or type to talk" disabled={busy}
            className="flex-1 bg-[rgba(0,0,0,0.25)] border rounded-xl px-3.5 py-2.5 text-[14px] outline-none focus:border-[var(--panel-border-hot)]"
            style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
          <button onClick={() => send(input.trim())} disabled={busy || !input.trim()}
            className="px-3.5 h-[44px] rounded-xl flex items-center gap-1.5 text-sm transition disabled:opacity-40"
            style={{ background: `${ACCENT}24`, border: `1px solid ${ACCENT}55`, color: ACCENT }}><Send size={15} /></button>
        </div>
      </div>

      <style jsx>{`
        .orb, .orb-btn { width: 84px; height: 84px; border-radius: 50%;
          background: radial-gradient(circle at 35% 30%, #93c5fd, #2563eb 70%);
          box-shadow: 0 0 50px -8px ${ACCENT}; display: grid; place-items: center; color: #fff; border: none; cursor: pointer; transition: transform .15s; }
        .orb { width: 64px; height: 64px; }
        .orb-btn:hover { transform: scale(1.06); }
        .orb-btn[data-s="active"], .orb[data-s="active"] { background: radial-gradient(circle at 35% 30%, #6ee7b7, #2563eb 70%); }
        .orb-btn[data-s="listen"], .orb[data-s="listen"] { animation: ring 1.1s infinite; background: radial-gradient(circle at 35% 30%, #fca5f1, #db2777 70%); }
        .orb-btn[data-s="speak"], .orb[data-s="speak"] { animation: ring 0.7s infinite; background: radial-gradient(circle at 35% 30%, #6ee7b7, #059669 70%); }
        .orb-btn[data-s="think"], .orb[data-s="think"] { animation: spin 1s linear infinite; }
        @keyframes ring { 0%{box-shadow:0 0 0 0 ${ACCENT}66} 70%{box-shadow:0 0 0 22px transparent} 100%{box-shadow:0 0 0 0 transparent} }
        @keyframes spin { to { transform: rotate(360deg) } }
      `}</style>
    </div>
  );
}

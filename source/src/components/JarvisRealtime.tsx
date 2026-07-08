"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send, X, Radio, History, Maximize2, Hammer } from "lucide-react";

const CYAN = "#22d3ee";
const TEAL = "#34d399";

// Voice builds use GLM 5.2 (z.ai) — fast, reliable, strong at one-shot HTML/JS
// (falls back to the on-device model server-side if z.ai ever hiccups) — and land
// in the same workspace + gallery as the text Jarvis, so a voice "build a snake
// game" joins the creations.
const BUILD_PROJECT = "free-claude-code";
const BUILD_ENGINE = "glm";
function jPreviewUrl(file: string): string {
  return `/api/freeclaude/preview/${encodeURIComponent(BUILD_PROJECT)}/${file.split("/").map(encodeURIComponent).join("/")}`;
}

type Status = "idle" | "connecting" | "live" | "error";
interface Line { id: string; role: "you" | "jarvis"; text: string; }

// Real-time speech-to-speech with OpenAI's Realtime API (gpt-realtime) over WebRTC.
// No clicking per turn — server VAD detects when you stop talking and it replies in
// real time. You can also type any time. Mints an ephemeral key from our server.
export default function JarvisRealtime({ voice = "ash", onClose }: { voice?: string; onClose?: () => void }) {
  const [status, setStatus] = useState<Status>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [building, setBuilding] = useState(false);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [showHist, setShowHist] = useState(false);
  const [hist, setHist] = useState<Array<{ id: string; you: string; jarvis: string; ts: number; kind?: string }>>([]);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const curAsstRef = useRef<string | null>(null);   // id of the assistant line currently streaming
  const curAsstTextRef = useRef("");                // accumulated assistant transcript (for logging)
  const lastUserRef = useRef("");                   // most recent user utterance (to pair when logging)
  const idRef = useRef(0);
  const nid = () => `r${(idRef.current++).toString(36)}`;   // stable, collision-free across renders

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [lines]);

  // Persist each turn to the same history store the rest of Jarvis uses (disk + Obsidian vault).
  function logTurn(you: string, jarvis: string) {
    if (!you && !jarvis) return;
    fetch("/api/hermes/jarvis-log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ you, jarvis, kind: "realtime" }) }).catch(() => {});
  }

  const pushUser = (text: string) => { lastUserRef.current = text; setLines((l) => [...l, { id: nid(), role: "you", text }]); };
  const asstDelta = (delta: string) => { curAsstTextRef.current += delta; setLines((l) => {
    if (curAsstRef.current) return l.map((x) => x.id === curAsstRef.current ? { ...x, text: x.text + delta } : x);
    const id = nid(); curAsstRef.current = id; return [...l, { id, role: "jarvis", text: delta }];
  }); };
  const finishLine = () => { curAsstRef.current = null; };   // stop appending; keep text until response end

  // One response finished — render a fallback line if no transcript deltas arrived, then LOG it once.
  function finalizeResponse(ev: { response?: { output?: Array<{ content?: Array<{ transcript?: string; text?: string }> }> } }) {
    let text = curAsstTextRef.current.trim();
    if (!text) {
      const out = ev.response?.output || [];
      for (const item of out) for (const c of (item.content || [])) text += (c.transcript || c.text || "");
      text = text.trim();
      if (text) setLines((l) => [...l, { id: nid(), role: "jarvis", text }]);
    }
    if (text) logTurn(lastUserRef.current, text);
    lastUserRef.current = ""; curAsstRef.current = null; curAsstTextRef.current = "";
  }

  function onEvent(raw: string) {
    let ev: { type?: string; delta?: string; transcript?: string; call_id?: string; name?: string; arguments?: string; response?: { output?: Array<{ content?: Array<{ transcript?: string; text?: string }> }> } };
    try { ev = JSON.parse(raw); } catch { return; }
    const t = ev.type || "";
    if (t.endsWith("output_audio_transcript.delta") || t.endsWith("audio_transcript.delta")) { if (ev.delta) asstDelta(ev.delta); }
    else if (t.endsWith("output_audio_transcript.done") || t.endsWith("audio_transcript.done")) finishLine();
    else if (t === "conversation.item.input_audio_transcription.completed") { if (ev.transcript?.trim()) pushUser(ev.transcript.trim()); }
    else if (t === "response.function_call_arguments.done") void handleFunctionCall(ev);
    else if (t === "response.created") setSpeaking(true);
    else if (t === "response.done") { setSpeaking(false); finalizeResponse(ev); }
    else if (t === "error") setErr((ev as { error?: { message?: string } }).error?.message || "realtime error");
  }

  // Hand a tool result back to the model so it can confirm out loud, then let it respond.
  function sendFnResult(call_id: string | undefined, output: Record<string, unknown>) {
    const dc = dcRef.current; if (!dc || dc.readyState !== "open") return;
    dc.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id, output: JSON.stringify(output) } }));
    dc.send(JSON.stringify({ type: "response.create" }));
  }

  // The butler called a tool — dispatch by name (falling back to arg shape), run it,
  // then hand the result back so it can confirm out loud.
  async function handleFunctionCall(ev: { call_id?: string; name?: string; arguments?: string }) {
    let args: { target?: string; prompt?: string } = {};
    try { args = JSON.parse(ev.arguments || "{}"); } catch { /* ignore */ }
    const fn = ev.name || (args.prompt ? "build_app" : "open_app_or_site");
    if (fn === "build_app") { await runBuild(args.prompt || "", ev.call_id); return; }
    // default: open a website or Mac app
    const target = args.target || "";
    if (target) setLines((l) => [...l, { id: nid(), role: "jarvis", text: `⚙️ Opening ${target}…` }]);
    let ok = false;
    try { ok = (await fetch("/api/hermes/realtime/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target }) }).then((r) => r.json()))?.ok; } catch { /* ignore */ }
    sendFnResult(ev.call_id, { success: ok, target });
  }

  // Build a single HTML app on-device via the same Agent Factory the text Jarvis uses,
  // stream it, preview it live, and report back so JARVIS confirms aloud.
  async function runBuild(prompt: string, call_id?: string) {
    if (!prompt.trim()) { sendFnResult(call_id, { success: false, error: "no prompt given" }); return; }
    setBuilding(true); setPreviewFile(null);
    setLines((l) => [...l, { id: nid(), role: "jarvis", text: `⚙️ Building “${prompt}”…` }]);
    let file: string | null = null, err: string | null = null;
    try {
      const r = await fetch("/api/freeclaude/build", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, project: BUILD_PROJECT, engine: BUILD_ENGINE }) });
      if (r.body) {
        const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          const ls = buf.split("\n"); buf = ls.pop() ?? "";
          for (const line of ls) { if (!line.trim()) continue; try { const j = JSON.parse(line); if (j.t === "done") file = j.file; else if (j.t === "error") err = j.m; } catch { /* ignore */ } }
        }
      }
    } catch (e) { err = String(e); }
    setBuilding(false);
    if (file) {
      setPreviewFile(file);
      setLines((l) => [...l, { id: nid(), role: "jarvis", text: "✅ Built — previewing below." }]);
      sendFnResult(call_id, { success: true, file });
    } else {
      setLines((l) => [...l, { id: nid(), role: "jarvis", text: `⚠️ Couldn't build that${err ? ` — ${err}` : ""}.` }]);
      sendFnResult(call_id, { success: false, error: err || "build failed" });
    }
  }

  async function sdpExchange(model: string, ephemeral: string, offerSdp: string): Promise<string> {
    const attempts: [string, Record<string, string>][] = [
      [`https://api.openai.com/v1/realtime/calls?model=${model}`, { Authorization: `Bearer ${ephemeral}`, "Content-Type": "application/sdp" }],
      [`https://api.openai.com/v1/realtime?model=${model}`, { Authorization: `Bearer ${ephemeral}`, "Content-Type": "application/sdp", "OpenAI-Beta": "realtime=v1" }],
    ];
    for (const [url, headers] of attempts) {
      try { const r = await fetch(url, { method: "POST", body: offerSdp, headers }); if (r.ok) return await r.text(); } catch { /* try next */ }
    }
    throw new Error("Couldn't open the realtime audio link.");
  }

  const connect = useCallback(async () => {
    if (status === "connecting" || status === "live") return;
    setErr(null); setStatus("connecting");
    try {
      const tok = await fetch("/api/hermes/realtime/session", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voice }),
      }).then((r) => r.json());
      if (!tok?.value) throw new Error(tok?.error || "couldn't start a realtime session");

      const pc = new RTCPeerConnection(); pcRef.current = pc;
      pc.ontrack = (e) => { if (audioRef.current) { audioRef.current.srcObject = e.streams[0]; audioRef.current.play().catch(() => {}); } };
      pc.onconnectionstatechange = () => { if (pc.connectionState === "failed" || pc.connectionState === "closed") setStatus((s) => s === "live" ? "idle" : s); };

      const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = ms; ms.getTracks().forEach((tr) => pc.addTrack(tr, ms));

      const dc = pc.createDataChannel("oai-events"); dcRef.current = dc;
      dc.onmessage = (e) => onEvent(e.data);
      dc.onopen = () => setStatus("live");

      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      const answer = await sdpExchange(tok.model || "gpt-realtime", tok.value, offer.sdp || "");
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
      // dc.onopen flips to "live"
    } catch (e) {
      setErr(String((e as Error)?.message || e)); setStatus("error"); cleanup();
    }
  }, [status, voice]);

  function cleanup() {
    try { dcRef.current?.close(); } catch {}
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    try { pcRef.current?.getSenders().forEach((s) => s.track?.stop()); pcRef.current?.close(); } catch {}
    dcRef.current = null; pcRef.current = null; streamRef.current = null; curAsstRef.current = null;
  }
  const disconnect = useCallback(() => { cleanup(); setStatus("idle"); setSpeaking(false); setBuilding(false); }, []);
  useEffect(() => () => cleanup(), []);

  // Stop the mic the instant the page is hidden (switched browser tab or app) — an
  // always-on realtime mic should never keep listening once you've looked away.
  useEffect(() => {
    const onHide = () => { if (document.hidden) disconnect(); };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [disconnect]);

  // Auto-connect the moment the panel opens — no button needed (Realtime is the default).
  const startedRef = useRef(false);
  useEffect(() => { if (!startedRef.current) { startedRef.current = true; void connect(); } }, [connect]);

  // If the page loaded without a user gesture, the browser may block Jarvis's audio.
  // Silently retry play on the first interaction anywhere — invisible, no button.
  useEffect(() => {
    const unlock = () => { audioRef.current?.play().catch(() => {}); };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => { window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
  }, []);

  function sendText() {
    const text = input.trim(); const dc = dcRef.current;
    if (!text || !dc || dc.readyState !== "open") return;
    pushUser(text); setInput("");
    dc.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } }));
    dc.send(JSON.stringify({ type: "response.create" }));
  }

  async function loadHistory() {
    try { const d = await fetch("/api/hermes/jarvis-log", { cache: "no-store" }).then((r) => r.json()); setHist(d.turns || []); } catch { /* ignore */ }
    setShowHist(true);
  }

  const dot = status === "live" ? TEAL : status === "connecting" ? "#f59e0b" : status === "error" ? "#f87171" : "var(--fg-dimmer)";
  return (
    <div className="rounded-2xl border overflow-hidden" style={{ borderColor: `${CYAN}55`, background: "rgba(34,211,238,0.04)" }}>
      <audio ref={audioRef} autoPlay hidden />
      <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: `${CYAN}33` }}>
        <span className="text-[12px] font-mono flex items-center gap-2" style={{ color: CYAN }}>
          <span className="w-2 h-2 rounded-full" style={{ background: dot, boxShadow: status === "live" ? `0 0 8px ${TEAL}` : undefined }} />
          REALTIME · {status === "live" ? (speaking ? "JARVIS SPEAKING" : "LISTENING — just talk") : status.toUpperCase()}
        </span>
        <div className="flex items-center gap-2">
          <button onClick={() => showHist ? setShowHist(false) : loadHistory()} title="Saved conversation history"
            className="px-2.5 h-8 rounded-lg border text-[12px] flex items-center gap-1.5"
            style={{ borderColor: showHist ? CYAN : "var(--panel-border)", color: showHist ? CYAN : "var(--fg-dim)" }}>
            <History size={13} /> {showHist ? "Live" : "History"}
          </button>
          {status === "idle" || status === "error" ? (
            <button onClick={connect} className="px-3 h-8 rounded-lg border text-[12px] flex items-center gap-1.5" style={{ borderColor: TEAL, color: TEAL, background: "rgba(52,211,153,0.12)" }}>
              <Radio size={13} /> Go live
            </button>
          ) : (
            <button onClick={disconnect} className="px-3 h-8 rounded-lg border text-[12px] flex items-center gap-1.5 text-rose-300" style={{ borderColor: "rgba(248,113,113,0.5)" }}>
              <X size={13} /> End
            </button>
          )}
          {onClose && <button onClick={() => { disconnect(); onClose(); }} title="Close" className="p-1.5 rounded-lg hover:bg-rose-500/15 text-rose-300/80"><X size={14} /></button>}
        </div>
      </div>

      <div ref={scrollRef} className="px-4 py-3 space-y-2 overflow-y-auto" style={{ maxHeight: 320, minHeight: 120 }}>
        {showHist ? (
          hist.length === 0 ? <div className="text-[12.5px] text-[var(--fg-dimmer)] text-center py-6">No saved conversations yet.</div> : (
            hist.map((h) => (
              <div key={h.id} className="border-b border-[var(--panel-border)]/40 pb-2 mb-1.5">
                <div className="text-[10px] text-[var(--fg-dimmer)] mb-1 font-mono">{new Date(h.ts).toLocaleString()}{h.kind ? ` · ${h.kind}` : ""}</div>
                {h.you && <div className="text-[13.5px] leading-relaxed mb-0.5"><span className="text-[10px] uppercase tracking-widest mr-2" style={{ color: "var(--gold)" }}>You</span>{h.you}</div>}
                {h.jarvis && <div className="text-[13.5px] leading-relaxed"><span className="text-[10px] uppercase tracking-widest mr-2" style={{ color: CYAN }}>JARVIS</span>{h.jarvis}</div>}
              </div>
            ))
          )
        ) : (
          <>
            {status === "connecting" && <div className="text-[12.5px] text-[var(--fg-dim)] flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Opening the live link… allow the mic if asked.</div>}
            {status === "idle" && lines.length === 0 && <div className="text-[12.5px] text-[var(--fg-dimmer)] text-center py-6">Hit <b style={{ color: TEAL }}>Go live</b> once, then just talk — no clicking per reply. Type any time too.</div>}
            {err && <div className="text-[12px] text-rose-300 bg-rose-500/10 border border-rose-400/30 rounded-lg px-3 py-2">{err}</div>}
            {lines.map((l) => (
              <div key={l.id} className="text-[14px] leading-relaxed">
                <span className="text-[10px] uppercase tracking-widest mr-2" style={{ color: l.role === "you" ? "var(--gold)" : CYAN }}>{l.role === "you" ? "You" : "JARVIS"}</span>
                <span className="text-[var(--fg)]">{l.text}</span>
              </div>
            ))}
          </>
        )}
      </div>

      {(building || previewFile) && (
        <div className="border-t" style={{ borderColor: `${CYAN}33` }}>
          <div className="flex items-center gap-2 px-4 py-2 text-[11px] font-mono" style={{ color: CYAN }}>
            {building ? <><Loader2 size={12} className="animate-spin" /> BUILDING ON YOUR MAC…</> : <><Hammer size={12} /> LIVE BUILD · {previewFile}</>}
            {previewFile && !building && (
              <div className="ml-auto flex items-center gap-1.5">
                <a href={jPreviewUrl(previewFile)} target="_blank" rel="noopener noreferrer" title="Open in new tab" className="p-1 rounded hover:bg-[rgba(34,211,238,0.12)]" style={{ color: "var(--fg-dim)" }}><Maximize2 size={12} /></a>
                <button onClick={() => setPreviewFile(null)} title="Close preview" className="p-1 rounded hover:bg-rose-500/15 text-rose-300/80"><X size={12} /></button>
              </div>
            )}
          </div>
          {previewFile && !building && (
            <iframe key={previewFile} src={jPreviewUrl(previewFile)} title="jarvis voice build" className="w-full border-0 bg-black" style={{ height: 320 }} sandbox="allow-scripts allow-pointer-lock allow-same-origin" />
          )}
        </div>
      )}

      <div className="flex gap-2 px-4 py-3 border-t" style={{ borderColor: `${CYAN}22` }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") sendText(); }}
          placeholder={status === "live" ? "Talk, or type any time and press Enter…" : "Go live first to chat"}
          disabled={status !== "live"}
          className="flex-1 bg-[rgba(0,0,0,0.3)] border border-[var(--panel-border)] rounded-lg px-3.5 h-10 text-sm outline-none focus:border-[var(--panel-border-hot)] text-[var(--fg)] disabled:opacity-40" />
        <button onClick={sendText} disabled={status !== "live" || !input.trim()} className="px-4 h-10 rounded-lg border border-[var(--panel-border)] text-[13px] text-[var(--fg-dim)] disabled:opacity-30 flex items-center gap-1.5"><Send size={14} /> Send</button>
      </div>
    </div>
  );
}

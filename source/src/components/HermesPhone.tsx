"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Phone, Cloud, Cpu, Bot, RefreshCw, Sparkles, Square, Loader2, PhoneCall, ChevronDown, Eye, EyeOff } from "lucide-react";

// Mask all but the country code + last 2 digits — safe to show on a screen-recording.
function maskNumber(n?: string): string {
  if (!n) return "No number yet";
  const d = n.replace(/[^\d+]/g, "");
  if (d.length < 5) return "•••";
  return `${d.slice(0, 2)} ••• ••• ••${d.slice(-2)}`;
}

interface Status {
  apiServer: { up: boolean; port: number; keySet: boolean };
  elevenKeySet: boolean;
  tunnel: { running: boolean; url: string | null; reachable: boolean; cloudflared: boolean };
  eleven: { configured: boolean; numbers?: { phone_number: string; id: string; agent_id?: string; agent_name?: string }[]; hermesAgentId?: string | null; error?: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function HermesPhone() {
  const [s, setS] = useState<Status | null>(null);
  const [phase, setPhase] = useState<"idle" | "working" | "live">("idle");
  const [step, setStep] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [reveal, setReveal] = useState(false);
  const sRef = useRef<Status | null>(null);

  const fetchStatus = useCallback(async (): Promise<Status | null> => {
    try { const j = await (await fetch("/api/hermes/phone/status", { cache: "no-store" })).json(); sRef.current = j; setS(j); return j; }
    catch { return null; }
  }, []);
  useEffect(() => { fetchStatus(); const t = setInterval(() => { if (phase !== "working") fetchStatus(); }, 6000); return () => clearInterval(t); }, [fetchStatus, phase]);

  const num = s?.eleven?.numbers?.[0];
  const agentLinked = !!s?.eleven?.hermesAgentId && num?.agent_id === s?.eleven?.hermesAgentId;
  const live = !!(s?.apiServer.up && s?.tunnel.reachable && agentLinked);
  useEffect(() => { if (live && phase !== "working") setPhase("live"); }, [live, phase]);

  async function pollUntil(pred: (s: Status) => boolean, secs: number): Promise<boolean> {
    for (let i = 0; i < secs; i++) { const j = await fetchStatus(); if (j && pred(j)) return true; await sleep(1000); }
    return false;
  }

  async function goLive() {
    setErr(null); setPhase("working");
    try {
      const st = sRef.current ?? (await fetchStatus());
      if (!st) throw new Error("Can't reach Agent OS");
      if (!st.apiServer.keySet || !st.elevenKeySet) throw new Error("Missing keys — set ELEVENLABS_API_KEY + API_SERVER_KEY in Hermes → Manage → API Keys.");

      if (!st.tunnel.cloudflared) {
        setStep("Installing the tunnel (one-time)… your network is slow, this can take a couple minutes.");
        await fetch("/api/hermes/phone/install-tunnel", { method: "POST" });
        const ok = await pollUntil((x) => x.tunnel.cloudflared, 240);
        if (!ok) throw new Error("Tunnel still downloading (slow network). Leave this tab open and press Go Live again in a minute.");
      }

      setStep("Opening a secure tunnel to Hermes…");
      const t = await (await fetch("/api/hermes/phone/tunnel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "start" }) })).json();
      if (!t.ok || !t.url) throw new Error(t.error ?? "Couldn't open the tunnel.");

      setStep("Linking your ElevenLabs phone agent…");
      const sy = await (await fetch("/api/hermes/phone/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) })).json();
      if (!sy.ok) throw new Error(sy.error ?? "Couldn't link the agent.");

      setStep("Confirming…");
      await pollUntil((x) => !!(x.apiServer.up && x.tunnel.reachable), 15);
      await fetchStatus();
      setPhase("live");
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
      setPhase("idle");
    }
  }

  async function stop() {
    setStep("Stopping…"); setPhase("working");
    try { await fetch("/api/hermes/phone/tunnel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "stop" }) }); } catch {}
    await fetchStatus(); setPhase("idle"); setStep("");
  }

  const stages = [
    { icon: <Phone size={15} />, label: "Number", ok: !!num },
    { icon: <Bot size={15} />, label: "ElevenLabs", ok: agentLinked },
    { icon: <Cloud size={15} />, label: "Tunnel", ok: !!s?.tunnel.reachable },
    { icon: <Cpu size={15} />, label: "Hermes", ok: !!s?.apiServer.up },
  ];
  const working = phase === "working";

  return (
    <div className="space-y-4">
      {/* ───────── HERO ───────── */}
      <div className="relative overflow-hidden rounded-3xl p-8 text-center"
        style={{ background: live
          ? "radial-gradient(120% 120% at 50% 0%, rgba(52,211,153,0.18), rgba(15,16,25,0.6) 60%)"
          : "radial-gradient(120% 120% at 50% 0%, rgba(96,165,250,0.18), rgba(124,58,237,0.10) 40%, rgba(15,16,25,0.6) 70%)",
          border: "1px solid var(--panel-border)" }}>
        {/* pulse rings */}
        <div className="relative mx-auto mb-4 grid place-items-center" style={{ width: 110, height: 110 }}>
          {[0, 1, 2].map((i) => (
            <motion.span key={i} className="absolute rounded-full"
              style={{ width: 70, height: 70, border: `2px solid ${live ? "#34d399" : "#60a5fa"}` }}
              animate={{ scale: [1, 2.1], opacity: [0.5, 0] }}
              transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.8, ease: "easeOut" }} />
          ))}
          <motion.div className="relative grid place-items-center rounded-full"
            style={{ width: 70, height: 70, background: live ? "linear-gradient(135deg,#34d399,#10b981)" : "linear-gradient(135deg,#60a5fa,#7c3aed)", color: "#fff", boxShadow: `0 8px 40px -6px ${live ? "#34d399" : "#7c3aed"}` }}
            animate={working ? { rotate: [0, 8, -8, 0] } : {}} transition={{ duration: 1, repeat: working ? Infinity : 0 }}>
            {live ? <PhoneCall size={30} /> : <Phone size={30} />}
          </motion.div>
        </div>

        <div className="text-[11px] uppercase tracking-[0.25em] text-[var(--fg-dimmer)] mb-1">Call your Hermes agent</div>
        <div className="flex items-center justify-center gap-2">
          <div className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "var(--font-display, inherit)" }}>
            {num ? (reveal ? num.phone_number : maskNumber(num.phone_number)) : "No number yet"}
          </div>
          {num && (
            <button onClick={() => setReveal((v) => !v)} title={reveal ? "Hide number" : "Reveal number"}
              className="text-[var(--fg-dimmer)] hover:text-[var(--fg-dim)] transition">
              {reveal ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          )}
        </div>
        {num && !reveal && <div className="text-[10.5px] text-[var(--fg-dimmer)] mt-1">🔒 hidden for screen-recording — tap the eye to reveal</div>}

        {/* state pill */}
        <div className="mt-3 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[12.5px]"
          style={{ background: live ? "rgba(52,211,153,0.15)" : "rgba(255,255,255,0.05)", border: `1px solid ${live ? "rgba(52,211,153,0.5)" : "var(--panel-border)"}`, color: live ? "#34d399" : "var(--fg-dim)" }}>
          {live ? (<><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-70 animate-ping" /><span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" /></span> Live — pick up the phone ☎️</>)
            : working ? (<><Loader2 size={13} className="animate-spin" /> Setting up…</>)
            : "Not connected yet"}
        </div>
      </div>

      {/* ───────── PIPELINE ───────── */}
      <div className="panel p-4">
        <div className="flex items-center justify-between gap-2">
          {stages.map((st, i) => (
            <div key={i} className="contents">
              <div className="flex flex-col items-center gap-1.5 shrink-0" style={{ minWidth: 64 }}>
                <div className="grid place-items-center rounded-xl" style={{ width: 38, height: 38,
                  background: st.ok ? "rgba(52,211,153,0.14)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${st.ok ? "rgba(52,211,153,0.45)" : "var(--panel-border)"}`,
                  color: st.ok ? "#34d399" : "var(--fg-dim)" }}>{st.icon}</div>
                <span className="text-[10.5px] text-[var(--fg-dim)]">{st.label}</span>
              </div>
              {i < stages.length - 1 && (
                <div className="relative flex-1 h-[2px] mt-[-14px]" style={{ background: "var(--panel-border)" }}>
                  {stages[i].ok && stages[i + 1].ok && (
                    <motion.span className="absolute top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full"
                      style={{ background: live ? "#34d399" : "#60a5fa" }}
                      animate={{ left: ["0%", "100%"], opacity: [0, 1, 0] }}
                      transition={{ duration: 1.6, repeat: Infinity, ease: "linear", delay: i * 0.3 }} />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ───────── PRIMARY ACTION ───────── */}
      <div className="panel p-5">
        {!live ? (
          <button onClick={goLive} disabled={working}
            className="group w-full flex items-center justify-center gap-2.5 py-3.5 rounded-2xl text-[15px] font-semibold transition disabled:opacity-60"
            style={{ background: "linear-gradient(135deg,#60a5fa,#7c3aed)", color: "#fff", boxShadow: "0 10px 30px -10px #7c3aed" }}>
            {working ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
            {working ? "Setting it up…" : "Go Live ☎️"}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex-1 text-center text-[13.5px] text-emerald-300 font-medium py-2">✅ Your phone agent is live</div>
            <button onClick={goLive} disabled={working} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12.5px] border border-[var(--panel-border)] text-[var(--fg-dim)] hover:text-[var(--fg)]"><RefreshCw size={13} /> Re-sync</button>
            <button onClick={stop} disabled={working} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12.5px]" style={{ border: "1px solid rgba(248,113,113,0.4)", color: "#f87171" }}><Square size={13} /> Stop</button>
          </div>
        )}

        <AnimatePresence>
          {working && step && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
              className="mt-3 text-[12.5px] text-[var(--fg-dim)] text-center">{step}</motion.div>
          )}
        </AnimatePresence>
        {err && <div className="mt-3 text-[12.5px] text-center" style={{ color: "#f87171" }}>{err}</div>}

        <div className="mt-3 text-center text-[11px] text-[var(--fg-dimmer)]">
          One tap installs the tunnel, opens it, and links your ElevenLabs agent. The tunnel URL changes if it restarts — just hit Go Live again.
        </div>
      </div>

      {/* ───────── DETAILS (tucked away) ───────── */}
      <button onClick={() => setShowDetails((v) => !v)} className="flex items-center gap-1.5 mx-auto text-[11.5px] text-[var(--fg-dimmer)] hover:text-[var(--fg-dim)]">
        <ChevronDown size={13} className={showDetails ? "rotate-180 transition" : "transition"} /> Setup details
      </button>
      <AnimatePresence>
        {showDetails && s && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="panel p-4 text-[12px] text-[var(--fg-dim)] space-y-1.5 overflow-hidden">
            <div>• ElevenLabs key: {s.elevenKeySet ? "✓ set" : "✗ missing"}</div>
            <div>• Hermes API server: {s.apiServer.up ? `✓ up on :${s.apiServer.port}` : "✗ down"} {s.apiServer.keySet ? "" : "(key missing)"}</div>
            <div>• cloudflared: {s.tunnel.cloudflared ? "✓ installed" : "✗ not installed (Go Live installs it)"}</div>
            <div>• Tunnel: {s.tunnel.url ? `${s.tunnel.reachable ? "✓ reachable" : "⚠ not reachable"} — ${s.tunnel.url}` : "not running"}</div>
            <div>• Number: {num ? (reveal ? num.phone_number : maskNumber(num.phone_number)) : "none"} {agentLinked ? "→ ✓ Hermes agent" : num?.agent_name ? `→ ${num.agent_name}` : ""}</div>
            {s.eleven?.error && <div className="text-amber-300">• ElevenLabs: {s.eleven.error}</div>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

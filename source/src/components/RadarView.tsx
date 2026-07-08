"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Radar, Zap, Loader2, ArrowUpRight, Sparkles, Clock, Copy, Check, X, History as HistoryIcon, Globe } from "lucide-react";
import dynamic from "next/dynamic";

// the WebGL particle orb is client-only (uses window / three.js)
const RadarOrb = dynamic(() => import("./RadarOrb"), { ssr: false });

// THE RADAR — a 24/7 oracle that reads the live X firehose via the Grok Build CLI and
// tells you what's breaking RIGHT NOW + what to post about today. Jarvis arc-reactor HUD.

interface Signal {
  headline: string; why_now: string; angle: string; format: string;
  heat: number; posted: string; freshness: string; category: string;
  post_count: string; url: string; handle: string; sources: string[]; hook: string;
}
interface DayEntry { day: string; scannedAt: string | null; count: number; signals: Signal[]; }

const CAT_COLOR: Record<string, string> = {
  Models: "#22d3ee", Agents: "#34d399", Tools: "#a78bfa", SEO: "#a3e635", Drama: "#fb7185", Money: "#fbbf24",
};
const catColor = (c: string) => CAT_COLOR[c] || "#22d3ee";

const SWEEP_STATUS = [
  "Consulting the oracle…", "Reading the X firehose…", "Catching what broke in the last hours…",
  "Cross-checking the open web…", "Filtering the noise…", "Ranking by heat + freshness…", "Writing your angles…",
];

function ago(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.floor((Date.now() - Date.parse(iso)) / 1000);
  if (isNaN(s)) return "—";
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function dayLabel(d: string): string {
  const dt = new Date(d + "T12:00:00");
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export default function RadarView() {
  const [live, setLive] = useState<Signal[]>([]);
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const [history, setHistory] = useState<DayEntry[]>([]);
  const [viewDay, setViewDay] = useState<string | null>(null); // null = live
  const [booting, setBooting] = useState(true);
  const [sweeping, setSweeping] = useState(false);
  const [statusIdx, setStatusIdx] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [drafting, setDrafting] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [pubResult, setPubResult] = useState<Record<string, { phase?: string; results?: { site: string; url: string; editUrl: string; title: string }[]; indexed?: boolean; error?: string }>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [oracleImg, setOracleImg] = useState<string | null>(null);
  const [view, setView] = useState<"signals" | "published">("signals");
  const [pubHistory, setPubHistory] = useState<{ at: string; headline: string; status: string; indexed: boolean; results: { site: string; url: string; editUrl: string; title: string }[] }[]>([]);
  const [mounted, setMounted] = useState(false); // gate the float-coord SVG stage to client only (no hydration mismatch)
  const cardsRef = useRef<HTMLDivElement>(null);
  const scannedAtRef = useRef<string | null>(null);

  useEffect(() => { setMounted(true); }, []);

  const signals = viewDay ? (history.find((h) => h.day === viewDay)?.signals || []) : live;

  // pick the best available oracle image
  useEffect(() => {
    const img = new Image();
    img.onload = () => setOracleImg("/radar/face.png");
    img.onerror = () => setOracleImg("/radar/oracle-a.png");
    img.src = "/radar/face.png";
  }, []);

  const loadHistory = useCallback(() => {
    fetch("/api/radar/history").then((r) => r.json()).then((d) => setHistory(d.days || [])).catch(() => {});
  }, []);

  const loadPublished = useCallback(() => {
    fetch("/api/radar/published", { cache: "no-store" }).then((r) => r.json()).then((d) => setPubHistory(d.items || [])).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/radar/latest").then((r) => r.json())
      .then((d) => { if (!alive) return; setLive(d.signals || []); setScannedAt(d.scannedAt || null); })
      .catch(() => {}).finally(() => { if (alive) setBooting(false); });
    loadHistory();
    loadPublished();
    return () => { alive = false; };
  }, [loadHistory, loadPublished]);

  useEffect(() => {
    if (!sweeping) return;
    const i = setInterval(() => setStatusIdx((n) => (n + 1) % SWEEP_STATUS.length), 3800);
    return () => clearInterval(i);
  }, [sweeping]);

  // keep a ref of the shown result's timestamp so any poller compares against what's on screen
  useEffect(() => { scannedAtRef.current = scannedAt; }, [scannedAt]);

  // Poll the server-side sweep until it's idle, then swap in the fresh result. Shared by the
  // manual Consult button AND resume-on-load — so the sweep keeps updating the UI even if you
  // navigate away and come back (the sweep itself always runs server-side in the background).
  const pollUntilDone = useCallback(() => {
    const deadline = Date.now() + 480_000;
    const poll = async () => {
      if (Date.now() > deadline) { setErr("The oracle took too long — try again."); setSweeping(false); return; }
      try {
        const s = await (await fetch("/api/radar/scan", { cache: "no-store" })).json();
        if (s.running) { setTimeout(poll, 5000); return; }
        if (s.error) { setErr(s.error); setSweeping(false); return; }
        const lat = await (await fetch("/api/radar/latest", { cache: "no-store" })).json();
        if (lat.ok && lat.scannedAt && lat.scannedAt !== scannedAtRef.current) {
          setLive(lat.signals || []); setScannedAt(lat.scannedAt); setDrafts({}); setActive(null); loadHistory();
          setSweeping(false);
        } else { setTimeout(poll, 4000); } // idle but result not written yet — one more beat
      } catch { setTimeout(poll, 6000); }
    };
    setTimeout(poll, 2000);
  }, [loadHistory]);

  // Resume: if a sweep is already running server-side when this view loads, show the scanning
  // state and keep polling — so navigating away mid-sweep doesn't lose the result.
  useEffect(() => {
    let alive = true;
    fetch("/api/radar/scan", { cache: "no-store" }).then((r) => r.json()).then((s) => {
      if (alive && s?.running) { setSweeping(true); setStatusIdx(0); pollUntilDone(); }
    }).catch(() => {});
    return () => { alive = false; };
  }, [pollUntilDone]);

  const sweep = useCallback(async () => {
    if (sweeping) return;
    setSweeping(true); setErr(null); setStatusIdx(0); setViewDay(null);
    try {
      const r = await fetch("/api/radar/scan", { method: "POST" });
      const d = await r.json();
      if (!d.ok) { setErr(d.error || "Couldn't start the sweep."); setSweeping(false); return; }
      pollUntilDone(); // fire-and-forget: runs server-side; the poll swaps cards in when done
    } catch (e) {
      setErr(String((e as Error)?.message || e)); setSweeping(false);
    }
  }, [sweeping, pollUntilDone]);

  const draft = useCallback(async (key: string, s: Signal) => {
    if (drafting !== null) return;
    setDrafting(key);
    try {
      const r = await fetch("/api/radar/draft", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ headline: s.headline, why_now: s.why_now, angle: s.angle, format: s.format }) });
      const d = await r.json();
      setDrafts((m) => ({ ...m, [key]: d.ok ? d.draft : `⚠ ${d.error || "Couldn't draft this one."}` }));
    } catch (e) { setDrafts((m) => ({ ...m, [key]: `⚠ ${String((e as Error)?.message || e)}` })); }
    finally { setDrafting(null); }
  }, [drafting]);

  // Publish a signal to ALL WordPress sites as unique SEO articles — fire-and-forget + poll progress.
  const publish = useCallback(async (key: string, s: Signal) => {
    if (publishing !== null) return;
    setPublishing(key);
    setPubResult((m) => ({ ...m, [key]: { phase: "Starting…" } }));
    try {
      const r = await fetch("/api/radar/publish", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ headline: s.headline, why_now: s.why_now, angle: s.angle, hook: s.hook, url: s.url, sites: "all", status: "publish" }) });
      const d = await r.json();
      if (!d.ok) { setPubResult((m) => ({ ...m, [key]: { error: d.error || "Couldn't start publishing." } })); setPublishing(null); return; }
      const deadline = Date.now() + 460_000;
      const poll = async () => {
        if (Date.now() > deadline) { setPubResult((m) => ({ ...m, [key]: { error: "Took too long — check WordPress." } })); setPublishing(null); return; }
        try {
          const st = await (await fetch("/api/radar/publish", { cache: "no-store" })).json();
          if (st.running) { setPubResult((m) => ({ ...m, [key]: { phase: st.phase || "Working…", results: st.results } })); setTimeout(poll, 3500); return; }
          if ((!st.results || !st.results.length) && st.error) { setPubResult((m) => ({ ...m, [key]: { error: st.error } })); setPublishing(null); return; }
          setPubResult((m) => ({ ...m, [key]: { results: st.results || [], indexed: st.indexed, error: st.error } })); setPublishing(null); loadPublished();
        } catch { setTimeout(poll, 5000); }
      };
      setTimeout(poll, 4000);
    } catch (e) {
      setPubResult((m) => ({ ...m, [key]: { error: String((e as Error)?.message || e) } })); setPublishing(null);
    }
  }, [publishing, loadPublished]);

  const copyDraft = (key: string) => {
    const txt = drafts[key]; if (!txt) return;
    navigator.clipboard?.writeText(txt).then(() => { setCopied(key); setTimeout(() => setCopied(null), 1600); }).catch(() => {});
  };
  const focusSignal = (i: number) => {
    setActive(i);
    cardsRef.current?.querySelector(`[data-sig="${i}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // HUD geometry — coords ROUNDED to 2dp so SSR + client render identical strings (no hydration mismatch)
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const S = 460, C = S / 2, ORB_R = S * 0.155, NODE_R = S * 0.345, TICK_R = S * 0.455;
  const R_ARC1 = r2(S * 0.42), R_ARC2 = r2(S * 0.37), R_ARC3 = r2(S * 0.30);
  const nodes = signals.map((s, i) => {
    const a = (i / Math.max(1, signals.length)) * Math.PI * 2 - Math.PI / 2;
    return { i, s, a,
      x: r2(C + NODE_R * Math.cos(a)), y: r2(C + NODE_R * Math.sin(a)),
      ex: r2(C + (ORB_R + 8) * Math.cos(a)), ey: r2(C + (ORB_R + 8) * Math.sin(a)),
      size: r2(9 + (s.heat / 100) * 9) };
  });
  const ticks = Array.from({ length: 72 }, (_, k) => {
    const a = (k / 72) * Math.PI * 2; const long = k % 6 === 0;
    const r0 = TICK_R, r1 = TICK_R + (long ? 11 : 6);
    return { x1: r2(C + r0 * Math.cos(a)), y1: r2(C + r0 * Math.sin(a)), x2: r2(C + r1 * Math.cos(a)), y2: r2(C + r1 * Math.sin(a)), long };
  });
  const pct = (v: number) => `${(v / S) * 100}%`;
  const kf = (i: number) => (viewDay || "live") + ":" + i;

  return (
    <div className="rdr">
      <style>{`
        .rdr{ --cy:#22d3ee; --tl:#34d399; --am:#fbbf24; --ink:#dbeafe; --dim:#6b7a8d; }
        .rdr{ color:var(--ink); font-family:'Manrope',system-ui,sans-serif; }
        .rdr-bar{ display:flex; align-items:center; gap:14px; flex-wrap:wrap; padding:13px 18px; border:1px solid rgba(34,211,238,.22); border-radius:14px; background:linear-gradient(180deg,rgba(34,211,238,.05),rgba(34,211,238,.01)); }
        .rdr-live{ display:inline-flex; align-items:center; gap:8px; font-family:'JetBrains Mono',monospace; font-size:.66rem; letter-spacing:.18em; text-transform:uppercase; color:var(--cy); }
        .rdr-live .d{ width:8px;height:8px;border-radius:50%;background:var(--cy);box-shadow:0 0 10px var(--cy); animation:rdr-blink 1.6s infinite; }
        @keyframes rdr-blink{ 0%,100%{opacity:1} 50%{opacity:.25} }
        .rdr-meta{ font-family:'JetBrains Mono',monospace; font-size:.72rem; color:var(--dim); display:flex; align-items:center; gap:6px; }
        .rdr-trend{ margin-left:auto; display:inline-flex; align-items:center; gap:6px; text-decoration:none; font-family:'JetBrains Mono',monospace; font-size:.72rem; color:#cbd5e1; border:1px solid rgba(255,255,255,.2); border-radius:999px; padding:8px 14px; transition:border-color .15s,background .15s; }
        .rdr-trend:hover{ border-color:#fff; background:rgba(255,255,255,.06); }
        .rdr-sweepbtn{ display:inline-flex; align-items:center; gap:9px; background:var(--cy); color:#04121a; font-weight:800; font-family:'Bricolage Grotesque',sans-serif; padding:11px 24px; border-radius:999px; border:0; cursor:pointer; box-shadow:0 0 26px rgba(34,211,238,.45); transition:transform .15s, box-shadow .2s; }
        .rdr-sweepbtn:hover{ transform:translateY(-1px); box-shadow:0 0 36px rgba(34,211,238,.7); }
        .rdr-sweepbtn:disabled{ opacity:.7; cursor:default; }
        .rdr-grid{ display:grid; grid-template-columns:500px 1fr; gap:26px; margin-top:20px; align-items:start; }
        @media(max-width:1060px){ .rdr-grid{ grid-template-columns:1fr; } }

        /* HUD ORACLE */
        .rdr-hud{ position:relative; border:1px solid rgba(34,211,238,.14); border-radius:20px; padding:22px; overflow:hidden;
          background:radial-gradient(circle at 50% 44%, rgba(34,211,238,.10), rgba(4,7,12,0) 60%), #04070c; }
        .rdr-hud::before{ content:""; position:absolute; inset:0; pointer-events:none; opacity:.55; z-index:9; mix-blend-mode:overlay;
          background:repeating-linear-gradient(0deg, rgba(34,211,238,.07) 0 1px, transparent 1px 3px); animation:rdr-flicker 4.5s steps(60) infinite; }
        @keyframes rdr-flicker{ 0%,100%{opacity:.5} 47%{opacity:.5} 48%{opacity:.78} 49%{opacity:.45} 50%{opacity:.7} 51%{opacity:.5} 92%{opacity:.5} 93%{opacity:.85} 94%{opacity:.5} }
        .rdr-hud::after{ content:""; position:absolute; inset:0; pointer-events:none; z-index:8;
          background:radial-gradient(circle at 50% 48%, transparent 38%, rgba(0,0,0,.35) 78%, rgba(0,0,0,.7) 100%); }
        .rdr-scanbeam{ position:absolute; left:0; right:0; height:2px; z-index:9; pointer-events:none;
          background:linear-gradient(90deg, transparent, rgba(120,240,255,.55), transparent); box-shadow:0 0 12px rgba(34,211,238,.5); animation:rdr-beam 5.5s ease-in-out infinite; }
        @keyframes rdr-beam{ 0%{ top:8%; opacity:0 } 15%{opacity:1} 85%{opacity:1} 100%{ top:92%; opacity:0 } }
        .rdr-hud.sweeping{ border-color:rgba(251,59,92,.5); animation:rdr-alarm 1.2s ease-in-out infinite; }
        @keyframes rdr-alarm{ 0%,100%{ box-shadow:0 0 0 0 rgba(251,59,92,0) } 50%{ box-shadow:inset 0 0 60px rgba(251,59,92,.18) } }
        .rdr-corner{ position:absolute; width:22px; height:22px; border:2px solid rgba(34,211,238,.5); }
        .rdr-corner.tl{ top:12px; left:12px; border-right:0; border-bottom:0; }
        .rdr-corner.tr{ top:12px; right:12px; border-left:0; border-bottom:0; }
        .rdr-corner.bl{ bottom:12px; left:12px; border-right:0; border-top:0; }
        .rdr-corner.br{ bottom:12px; right:12px; border-left:0; border-top:0; }
        .rdr-hudtag{ position:absolute; top:16px; left:0; right:0; text-align:center; font-family:'JetBrains Mono',monospace; font-size:.56rem; letter-spacing:.34em; text-transform:uppercase; color:rgba(34,211,238,.7); z-index:6; }
        .rdr-stage{ position:relative; width:460px; max-width:100%; aspect-ratio:1; margin:6px auto 0; }
        .rdr-svg{ position:absolute; inset:0; width:100%; height:100%; overflow:visible; }
        .rdr-orb{ position:absolute; left:50%; top:50%; width:31%; height:31%; transform:translate(-50%,-50%); border-radius:50%; overflow:hidden;
          border:1.5px solid rgba(130,235,255,.7); box-shadow:0 0 60px rgba(34,211,238,.55), inset 0 0 36px rgba(34,211,238,.4);
          background:radial-gradient(circle at 40% 34%, #1a8fc0, #06283b 70%); }
        .rdr-orb .face{ position:absolute; inset:-6%; background-image:var(--oracle); background-size:cover; background-position:center; opacity:.96; animation:rdr-slow 80s linear infinite; }
        .rdr-orb .glasshine{ position:absolute; inset:0; background:radial-gradient(circle at 34% 28%, rgba(255,255,255,.55), transparent 38%); mix-blend-mode:screen; }
        .rdr-orb .scan{ position:absolute; left:0; right:0; height:30%; background:linear-gradient(180deg, transparent, rgba(120,240,255,.18), transparent); animation:rdr-scan 3.4s ease-in-out infinite; }
        @keyframes rdr-scan{ 0%{ top:-30%; } 100%{ top:100%; } }
        @keyframes rdr-slow{ to{ transform:rotate(360deg); } }
        .rdr-orb3d{ position:absolute; left:50%; top:50%; width:72%; height:72%; transform:translate(-50%,-50%); z-index:4; pointer-events:none; }
        .rdr-orbpulse{ position:absolute; left:50%; top:50%; width:38%; height:38%; transform:translate(-50%,-50%); border-radius:50%; box-shadow:0 0 0 1px rgba(34,211,238,.4); animation:rdr-corepulse 2.8s ease-out infinite; }
        @keyframes rdr-corepulse{ 0%{ width:31%;height:31%;opacity:.6 } 100%{ width:46%;height:46%;opacity:0 } }
        .rdr-orblabel{ position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); text-align:center; z-index:5; pointer-events:none; text-shadow:0 0 14px #000,0 0 6px #000; }
        .rdr-orblabel b{ font-family:'Bricolage Grotesque',sans-serif; font-size:1.9rem; color:#eafdff; display:block; line-height:1; }
        .rdr-orblabel span{ font-family:'JetBrains Mono',monospace; font-size:.46rem; letter-spacing:.28em; color:#bff3ff; text-transform:uppercase; }
        .rdr-arc{ transform-origin:${C}px ${C}px; }
        .rdr-node{ position:absolute; transform:translate(-50%,-50%); cursor:pointer; z-index:7; }
        .rdr-node .dot{ border-radius:50%; }
        .rdr-node .ping{ position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); border-radius:50%; width:8px;height:8px; animation:rdr-ping 2.8s ease-out infinite; }
        @keyframes rdr-ping{ 0%{ width:8px;height:8px;opacity:.7 } 100%{ width:48px;height:48px;opacity:0 } }
        .rdr-node .lbl{ position:absolute; left:16px; top:-8px; white-space:nowrap; font-family:'JetBrains Mono',monospace; font-size:.6rem; color:var(--ink); background:rgba(4,7,12,.9); padding:3px 8px; border-radius:6px; opacity:0; transition:opacity .15s; pointer-events:none; max-width:170px; overflow:hidden; text-overflow:ellipsis; }
        .rdr-node:hover .lbl, .rdr-node.on .lbl{ opacity:1; }
        .rdr-empty{ position:absolute; inset:0; display:grid; place-items:center; text-align:center; color:var(--dim); font-family:'JetBrains Mono',monospace; font-size:.78rem; padding:40px; z-index:8; }
        .rdr-status{ margin-top:16px; text-align:center; font-family:'JetBrains Mono',monospace; font-size:.76rem; color:var(--cy); min-height:18px; }
        .rdr-legend{ display:flex; flex-wrap:wrap; gap:9px 14px; margin-top:12px; justify-content:center; }
        .rdr-legend span{ font-family:'JetBrains Mono',monospace; font-size:.6rem; color:var(--dim); display:inline-flex; align-items:center; gap:5px; }
        .rdr-legend i{ width:8px;height:8px;border-radius:50%; }
        .rdr-hud.sweeping .rdr-orb{ box-shadow:0 0 90px rgba(34,211,238,.85), inset 0 0 36px rgba(34,211,238,.5); }

        /* HISTORY strip */
        .rdr-hist{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin:16px 0 0; }
        .rdr-hist .hl{ font-family:'JetBrains Mono',monospace; font-size:.6rem; letter-spacing:.16em; text-transform:uppercase; color:var(--dim); display:inline-flex; align-items:center; gap:6px; }
        .rdr-chip{ font-family:'JetBrains Mono',monospace; font-size:.66rem; color:var(--ink); background:rgba(34,211,238,.05); border:1px solid rgba(34,211,238,.2); border-radius:999px; padding:5px 12px; cursor:pointer; transition:border-color .15s,background .15s; }
        .rdr-chip:hover{ border-color:var(--cy); }
        .rdr-chip.on{ background:var(--cy); color:#04121a; border-color:var(--cy); font-weight:700; }
        .rdr-chip.litem{ color:var(--cy); }

        /* FEED */
        .rdr-viewing{ display:flex; align-items:center; gap:10px; font-family:'JetBrains Mono',monospace; font-size:.72rem; color:var(--am); margin-bottom:4px; }
        .rdr-viewing button{ background:none; border:1px solid rgba(34,211,238,.3); color:var(--cy); border-radius:999px; padding:3px 12px; font-size:.66rem; cursor:pointer; font-family:'JetBrains Mono',monospace; }
        .rdr-feed{ display:flex; flex-direction:column; gap:14px; }
        .rdr-card{ border:1px solid rgba(34,211,238,.16); border-radius:14px; background:rgba(34,211,238,.04); padding:18px 20px; position:relative; overflow:hidden; transition:border-color .2s; }
        .rdr-card.on{ border-color:var(--cy); box-shadow:0 0 0 1px rgba(34,211,238,.3), 0 10px 40px rgba(34,211,238,.08); }
        .rdr-card .edge{ position:absolute; left:0; top:0; bottom:0; width:3px; }
        .rdr-toprow{ display:flex; align-items:center; gap:9px; margin-bottom:6px; flex-wrap:wrap; }
        .rdr-rank{ font-family:'Bricolage Grotesque',sans-serif; font-size:.8rem; color:var(--dim); }
        .rdr-time{ font-family:'JetBrains Mono',monospace; font-size:.64rem; color:var(--cy); display:inline-flex; align-items:center; gap:5px; background:rgba(34,211,238,.07); border:1px solid rgba(34,211,238,.2); border-radius:999px; padding:3px 9px; }
        .rdr-posts{ font-family:'JetBrains Mono',monospace; font-size:.62rem; color:#fbbf24; background:rgba(251,191,36,.1); border:1px solid rgba(251,191,36,.32); border-radius:999px; padding:3px 9px; }
        .rdr-fromx{ font-family:'JetBrains Mono',monospace; font-size:.6rem; letter-spacing:.08em; color:#cbd5e1; display:inline-flex; align-items:center; gap:5px; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.18); border-radius:999px; padding:3px 9px; }
        .rdr-fromx b{ color:#fff; }
        .rdr-cat{ margin-left:auto; font-family:'JetBrains Mono',monospace; font-size:.56rem; letter-spacing:.12em; text-transform:uppercase; padding:3px 9px; border-radius:999px; white-space:nowrap; }
        .rdr-card h3{ font-family:'Bricolage Grotesque',sans-serif; font-weight:700; font-size:1.18rem; color:#eafdff; margin:2px 0 0; line-height:1.2; }
        .rdr-heat{ display:flex; align-items:center; gap:8px; margin:11px 0 4px; }
        .rdr-heat .track{ flex:1; height:6px; background:rgba(34,211,238,.08); border-radius:999px; overflow:hidden; }
        .rdr-heat .fill{ height:100%; border-radius:999px; background:linear-gradient(90deg,#f59e0b,#fbbf24); transition:width 1s cubic-bezier(.22,1,.36,1); }
        .rdr-heat .n{ font-family:'JetBrains Mono',monospace; font-size:.66rem; color:var(--am); min-width:32px; text-align:right; }
        .rdr-why{ font-size:.92rem; color:#c3d3e6; margin:8px 0; }
        .rdr-angle{ font-size:.92rem; color:var(--ink); margin:8px 0; padding-left:12px; border-left:2px solid var(--tl); }
        .rdr-angle b{ color:var(--tl); }
        .rdr-srcrow{ display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin:11px 0 4px; }
        .rdr-xbtn{ display:inline-flex; align-items:center; gap:7px; text-decoration:none; font-family:'JetBrains Mono',monospace; font-size:.72rem; font-weight:700; color:#fff; background:linear-gradient(180deg,#1d2735,#0b1118); border:1px solid rgba(120,200,255,.4); border-radius:8px; padding:6px 13px; box-shadow:0 0 14px rgba(34,211,238,.18); transition:transform .15s,box-shadow .2s; }
        .rdr-xbtn:hover{ transform:translateY(-1px); box-shadow:0 0 22px rgba(34,211,238,.4); }
        .rdr-xbtn .xg{ font-weight:800; font-size:.86rem; }
        .rdr-handle{ font-family:'JetBrains Mono',monospace; font-size:.66rem; color:var(--cy); }
        .rdr-src .s{ font-family:'JetBrains Mono',monospace; font-size:.62rem; color:var(--dim); background:rgba(34,211,238,.05); border:1px solid rgba(34,211,238,.14); border-radius:6px; padding:3px 8px; }
        .rdr-hook{ font-style:italic; color:#9fb6cc; font-size:.9rem; margin:8px 0; }
        .rdr-actions{ display:flex; align-items:center; gap:10px; margin-top:12px; flex-wrap:wrap; }
        .rdr-fmt{ font-family:'JetBrains Mono',monospace; font-size:.6rem; letter-spacing:.1em; text-transform:uppercase; color:var(--cy); border:1px solid rgba(34,211,238,.3); border-radius:999px; padding:4px 11px; }
        .rdr-draftbtn{ display:inline-flex; align-items:center; gap:7px; background:linear-gradient(180deg,rgba(52,211,153,.18),rgba(52,211,153,.06)); color:var(--tl); border:1px solid rgba(52,211,153,.45); border-radius:999px; padding:7px 16px; font-weight:700; font-size:.84rem; cursor:pointer; transition:transform .15s; }
        .rdr-draftbtn:hover{ transform:translateY(-1px); } .rdr-draftbtn:disabled{ opacity:.6; cursor:default; }
        .rdr-pubbtn{ display:inline-flex; align-items:center; gap:7px; background:linear-gradient(180deg,rgba(212,165,116,.20),rgba(212,165,116,.06)); color:#e6c69a; border:1px solid rgba(212,165,116,.5); border-radius:999px; padding:7px 16px; font-weight:700; font-size:.84rem; cursor:pointer; transition:transform .15s; }
        .rdr-pubbtn:hover{ transform:translateY(-1px); } .rdr-pubbtn:disabled{ opacity:.55; cursor:default; }
        .rdr-pub{ margin-top:12px; border-top:1px dashed rgba(212,165,116,.22); padding-top:12px; }
        .rdr-pub .pub-prog{ display:inline-flex; align-items:center; gap:8px; font-family:'JetBrains Mono',monospace; font-size:.78rem; color:#e6c69a; }
        .rdr-pub .pub-err{ font-size:.82rem; color:#f0a0a0; }
        .rdr-pub .pub-done{ background:rgba(212,165,116,.07); border:1px solid rgba(212,165,116,.3); border-radius:12px; padding:13px 15px; }
        .rdr-pub .pdh{ font-family:'JetBrains Mono',monospace; font-size:.66rem; letter-spacing:.1em; text-transform:uppercase; color:#5ab896; }
        .rdr-pub .pdrow{ display:flex; align-items:center; gap:14px; margin-top:8px; padding-top:8px; border-top:1px solid rgba(212,165,116,.12); }
        .rdr-pub .pdrow:first-of-type{ border-top:none; }
        .rdr-pub .pdsite{ flex:1; min-width:0; color:#f3ebda; font-weight:600; font-size:.88rem; font-family:'JetBrains Mono',monospace; overflow:hidden; text-overflow:ellipsis; }
        .rdr-pub .pdrow a{ display:inline-flex; align-items:center; gap:3px; color:#e6c69a; font-weight:600; font-size:.82rem; text-decoration:none; border-bottom:1px solid rgba(212,165,116,.35); white-space:nowrap; }
        .rdr-vtoggle{ display:inline-flex; gap:3px; background:rgba(8,14,22,.6); border:1px solid rgba(34,211,238,.18); border-radius:999px; padding:3px; }
        .rdr-vtoggle button{ font-family:'JetBrains Mono',monospace; font-size:.66rem; letter-spacing:.04em; color:var(--dim,#a59783); background:none; border:none; border-radius:999px; padding:5px 12px; cursor:pointer; transition:background .15s,color .15s; }
        .rdr-vtoggle button.on{ background:rgba(34,211,238,.16); color:#bdf3ff; }
        .rdr-phist h3{ margin-top:6px; }
        .rdr-phist .ph-badge{ font-family:'JetBrains Mono',monospace; font-size:.6rem; letter-spacing:.1em; padding:2px 8px; border-radius:999px; border:1px solid; }
        .rdr-phist .ph-count{ font-family:'JetBrains Mono',monospace; font-size:.62rem; color:var(--dim,#a59783); margin-left:auto; }
        .ph-sites{ display:flex; flex-direction:column; gap:7px; margin-top:12px; }
        .ph-row{ display:flex; align-items:center; gap:14px; background:rgba(8,14,22,.5); border:1px solid rgba(212,165,116,.14); border-radius:10px; padding:9px 13px; }
        .ph-row .ph-site{ flex:1; min-width:0; font-family:'JetBrains Mono',monospace; font-size:.8rem; color:#f3ebda; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .ph-row a{ color:#e6c69a; font-weight:600; font-size:.78rem; text-decoration:none; border-bottom:1px solid rgba(212,165,116,.3); white-space:nowrap; }
        .ph-row a:hover{ color:#2ce0ff; }
        .rdr-draft{ margin-top:14px; border-top:1px dashed rgba(34,211,238,.2); padding-top:12px; }
        .rdr-draft .dh{ display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
        .rdr-draft .dh span{ font-family:'JetBrains Mono',monospace; font-size:.6rem; letter-spacing:.14em; text-transform:uppercase; color:var(--tl); }
        .rdr-draft .cpy{ display:inline-flex; align-items:center; gap:5px; background:none; border:1px solid rgba(34,211,238,.25); color:var(--dim); border-radius:7px; padding:4px 9px; font-size:.66rem; cursor:pointer; font-family:'JetBrains Mono',monospace; }
        .rdr-draft pre{ white-space:pre-wrap; font-family:'Manrope',sans-serif; font-size:.9rem; color:#cfe0f0; background:rgba(4,8,14,.5); border:1px solid rgba(34,211,238,.12); border-radius:10px; padding:14px 16px; margin:0; line-height:1.55; max-height:340px; overflow:auto; }
        .rdr-err{ margin-top:14px; border:1px solid rgba(251,113,133,.4); background:rgba(251,113,133,.08); color:#fecdd3; border-radius:12px; padding:12px 16px; font-size:.88rem; display:flex; gap:10px; align-items:flex-start; }
        .rdr-skel{ height:120px; border-radius:14px; background:linear-gradient(90deg,rgba(34,211,238,.04),rgba(34,211,238,.09),rgba(34,211,238,.04)); background-size:200% 100%; animation:rdr-shimmer 1.4s infinite; border:1px solid rgba(34,211,238,.1); }
        @keyframes rdr-shimmer{ to{ background-position:-200% 0; } }
      `}</style>

      <div className="rdr-bar">
        <span className="rdr-live"><span className="d" /> {sweeping ? "Consulting" : "Live"}</span>
        <span className="rdr-meta"><Clock size={13} /> last consulted {ago(scannedAt)}</span>
        <span className="rdr-meta" style={{ opacity: .8 }}>· wakes at 6am · logs to Obsidian</span>
        <div className="rdr-vtoggle">
          <button className={view === "signals" ? "on" : ""} onClick={() => setView("signals")}>Signals</button>
          <button className={view === "published" ? "on" : ""} onClick={() => { setView("published"); loadPublished(); }}>Published{pubHistory.length ? ` · ${pubHistory.length}` : ""}</button>
        </div>
        <a className="rdr-trend" href="https://x.com/explore/tabs/trending" target="_blank" rel="noopener noreferrer"><span style={{ fontWeight: 800 }}>𝕏</span> Trending ↗</a>
        <button className="rdr-sweepbtn" onClick={sweep} disabled={sweeping}>
          {sweeping ? <Loader2 size={16} className="animate-spin" /> : <Radar size={16} />}
          {sweeping ? "Consulting…" : "Consult the oracle"}
        </button>
      </div>

      <div className="rdr-grid">
        {/* HUD ORACLE */}
        <div className={`rdr-hud ${sweeping ? "sweeping" : ""}`}>
          <div className="rdr-corner tl" /><div className="rdr-corner tr" /><div className="rdr-corner bl" /><div className="rdr-corner br" />
          <div className="rdr-scanbeam" />
          <div className="rdr-hudtag">⟁ Hermes Oracle · {signals.length || 0} signals · {sweeping ? "scanning" : "online"} ⟁</div>
          <div className="rdr-stage" style={{ ["--oracle" as string]: oracleImg ? `url('${oracleImg}')` : "none" }}>
            <svg className="rdr-svg" viewBox={`0 0 ${S} ${S}`} preserveAspectRatio="none">
              {/* tick ring */}
              {ticks.map((t, k) => (
                <line key={k} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="#22d3ee" strokeWidth={t.long ? 1.4 : 0.7} opacity={t.long ? 0.6 : 0.28} />
              ))}
              {/* rotating arcs */}
              <circle className="rdr-arc" cx={C} cy={C} r={R_ARC1} fill="none" stroke="#22d3ee" strokeWidth="2.4" strokeDasharray="70 120" opacity="0.55" strokeLinecap="round">
                <animateTransform attributeName="transform" type="rotate" from={`0 ${C} ${C}`} to={`360 ${C} ${C}`} dur={sweeping ? "5s" : "16s"} repeatCount="indefinite" />
              </circle>
              <circle className="rdr-arc" cx={C} cy={C} r={R_ARC2} fill="none" stroke="#34d399" strokeWidth="1.6" strokeDasharray="30 200" opacity="0.5" strokeLinecap="round">
                <animateTransform attributeName="transform" type="rotate" from={`360 ${C} ${C}`} to={`0 ${C} ${C}`} dur={sweeping ? "7s" : "24s"} repeatCount="indefinite" />
              </circle>
              <circle cx={C} cy={C} r={R_ARC3} fill="none" stroke="rgba(34,211,238,.18)" strokeWidth="1" />
              {/* energy threads to nodes */}
              {nodes.map((n) => (
                <line key={n.i} x1={n.ex} y1={n.ey} x2={n.x} y2={n.y} stroke={catColor(n.s.category)} strokeWidth={active === n.i ? 1.8 : 1} strokeDasharray="4 6" opacity={active === n.i ? 0.95 : 0.42}>
                  <animate attributeName="stroke-dashoffset" from="0" to="-20" dur="1.1s" repeatCount="indefinite" />
                </line>
              ))}
            </svg>

            <div className="rdr-orbpulse" />
            <div className="rdr-orb3d">{oracleImg && <RadarOrb image={oracleImg} sweeping={sweeping} />}</div>

            {nodes.map((n) => {
              const col = catColor(n.s.category);
              return (
                <div key={n.i} className={`rdr-node ${active === n.i ? "on" : ""}`} style={{ left: pct(n.x), top: pct(n.y) }} onClick={() => focusSignal(n.i)}>
                  <div className="ping" style={{ boxShadow: `0 0 0 1px ${col}` }} />
                  <div className="dot" style={{ width: n.size, height: n.size, background: col, boxShadow: `0 0 ${n.size + 4}px ${col}` }} />
                  <span className="lbl" style={{ borderLeft: `2px solid ${col}` }}>{n.s.headline}</span>
                </div>
              );
            })}
            {!signals.length && !booting && (
              <div className="rdr-empty">The oracle is silent.<br />Hit <b style={{ color: "#22d3ee" }}>Consult the oracle</b>.</div>
            )}
          </div>
          <div className="rdr-status">{sweeping ? SWEEP_STATUS[statusIdx] : (signals.length ? "Tap a node to jump to its signal ↓" : "")}</div>
          <div className="rdr-legend">{Object.entries(CAT_COLOR).map(([k, v]) => (<span key={k}><i style={{ background: v, boxShadow: `0 0 6px ${v}` }} />{k}</span>))}</div>

          {/* HISTORY */}
          {history.length > 0 && (
            <div className="rdr-hist">
              <span className="hl"><HistoryIcon size={12} /> history</span>
              <span className={`rdr-chip ${!viewDay ? "on" : ""}`} onClick={() => { setViewDay(null); setActive(null); }}>Live</span>
              {history.map((h) => (
                <span key={h.day} className={`rdr-chip litem ${viewDay === h.day ? "on" : ""}`} onClick={() => { setViewDay(h.day); setActive(null); }} title={`${h.count} signals`}>
                  {dayLabel(h.day)}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* FEED */}
        <div className="rdr-feed" ref={cardsRef}>
          {view === "published" ? (
            pubHistory.length === 0 ? (
              <div className="rdr-card"><h3>Nothing published yet.</h3>
                <p className="rdr-why">Hit <b style={{ color: "#e6c69a" }}>Publish to WP</b> on any signal and it lands here — every article, with links to every site it went live on.</p></div>
            ) : pubHistory.map((p, i) => (
              <div key={`${p.at}-${i}`} className="rdr-card rdr-phist">
                <div className="rdr-toprow">
                  <span className="rdr-time"><Clock size={11} /> {ago(p.at)}</span>
                  <span className="ph-badge" style={{ color: p.status === "draft" ? "#c4607e" : "#5ab896", borderColor: p.status === "draft" ? "#c4607e55" : "#5ab89655" }}>{p.status === "draft" ? "DRAFT" : "LIVE"}</span>
                  {p.indexed && <span className="rdr-posts">✓ indexing</span>}
                  <span className="ph-count">{p.results.length} site{p.results.length > 1 ? "s" : ""}</span>
                </div>
                <h3>{p.headline}</h3>
                <div className="ph-sites">
                  {p.results.map((r) => (
                    <div className="ph-row" key={r.site}>
                      <span className="ph-site">{r.site}</span>
                      <a href={r.url} target="_blank" rel="noopener noreferrer">View ↗</a>
                      <a href={r.editUrl} target="_blank" rel="noopener noreferrer">Edit ↗</a>
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (<>
          {viewDay && (
            <div className="rdr-viewing">Viewing {dayLabel(viewDay)} <button onClick={() => { setViewDay(null); setActive(null); }}>← back to live</button></div>
          )}
          {err && <div className="rdr-err"><X size={16} style={{ marginTop: 2 }} /><div>{err}</div></div>}
          {booting && [0, 1, 2].map((i) => <div key={i} className="rdr-skel" />)}
          {!booting && !signals.length && !err && (
            <div className="rdr-card"><h3>The oracle hasn&apos;t spoken yet.</h3>
              <p className="rdr-why">Consult it — Hermes searches X live (via Grok) and returns the 6 biggest trending AI stories to post about today, each with the source tweet, the time it broke, your angle, and a ready hook.</p></div>
          )}
          {signals.map((s, i) => {
            const col = catColor(s.category); const key = kf(i);
            return (
              <div key={key} data-sig={i} className={`rdr-card ${active === i ? "on" : ""}`} onMouseEnter={() => setActive(i)}>
                <div className="edge" style={{ background: col, boxShadow: `0 0 12px ${col}` }} />
                <div className="rdr-toprow">
                  <span className="rdr-rank">{String(i + 1).padStart(2, "0")}</span>
                  <span className="rdr-time"><Clock size={11} /> {s.posted || s.freshness}</span>
                  {s.post_count && <span className="rdr-posts">🔥 {s.post_count}</span>}
                  {s.handle && <span className="rdr-fromx"><b>𝕏</b> @{s.handle}</span>}
                  <span className="rdr-cat" style={{ color: col, border: `1px solid ${col}55`, background: `${col}14` }}>{s.category}</span>
                </div>
                <h3>{s.headline}</h3>
                <div className="rdr-heat">
                  <Zap size={13} style={{ color: "var(--am)" }} />
                  <div className="track"><div className="fill" style={{ width: `${s.heat}%` }} /></div>
                  <div className="n">{s.heat}</div>
                </div>
                <p className="rdr-why">{s.why_now}</p>
                <p className="rdr-angle"><b>Your angle: </b>{s.angle}</p>
                <div className="rdr-srcrow rdr-src">
                  {s.url && <a className="rdr-xbtn" href={s.url} target="_blank" rel="noopener noreferrer"><span className="xg">𝕏</span> {/i\/trending/.test(s.url) ? "Open trend" : "Open on X"} <ArrowUpRight size={13} /></a>}
                  {s.sources.map((src, k) => <span className="s" key={k}>{src}</span>)}
                </div>
                {s.hook && <p className="rdr-hook">“{s.hook}”</p>}
                <div className="rdr-actions">
                  <span className="rdr-fmt">{s.format}</span>
                  <button className="rdr-draftbtn" onClick={() => draft(key, s)} disabled={drafting !== null}>
                    {drafting === key ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    {drafting === key ? "Drafting…" : drafts[key] ? "Re-draft" : "Draft this"}
                    {!drafts[key] && drafting !== key && <ArrowUpRight size={14} />}
                  </button>
                  <button className="rdr-pubbtn" onClick={() => publish(key, s)} disabled={publishing !== null} title="Write a unique SEO article for each of your 3 WordPress sites (with the source tweet embedded + cross-links), publish them, and submit for indexing">
                    {publishing === key ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />}
                    {publishing === key ? "Publishing…" : pubResult[key]?.results?.length ? "Published ✓" : "Publish to WP"}
                  </button>
                </div>
                {pubResult[key] && (
                  <div className="rdr-pub">
                    {publishing === key ? (
                      <div className="pub-prog"><Loader2 size={13} className="animate-spin" /> {pubResult[key].phase || "Working…"}</div>
                    ) : pubResult[key].results && pubResult[key].results!.length ? (
                      <div className="pub-done">
                        <div className="pdh">✓ Published to {pubResult[key].results!.length} site{pubResult[key].results!.length > 1 ? "s" : ""}{pubResult[key].indexed ? " · submitted for indexing" : ""}</div>
                        {pubResult[key].results!.map((rr) => (
                          <div className="pdrow" key={rr.site}>
                            <span className="pdsite">{rr.site}</span>
                            <a href={rr.url} target="_blank" rel="noopener noreferrer">View <ArrowUpRight size={11} /></a>
                            <a href={rr.editUrl} target="_blank" rel="noopener noreferrer">Edit <ArrowUpRight size={11} /></a>
                          </div>
                        ))}
                        {pubResult[key].error && <div className="pub-err" style={{ marginTop: 8 }}>⚠ {pubResult[key].error}</div>}
                      </div>
                    ) : (
                      <div className="pub-err">⚠ {pubResult[key].error || "Publishing failed."}</div>
                    )}
                  </div>
                )}
                {drafts[key] && (
                  <div className="rdr-draft">
                    <div className="dh"><span>✦ ready to quote-post on 𝕏</span>
                      <button className="cpy" onClick={() => copyDraft(key)}>{copied === key ? <Check size={12} /> : <Copy size={12} />}{copied === key ? "copied" : "copy"}</button>
                    </div>
                    <pre>{drafts[key]}</pre>
                  </div>
                )}
              </div>
            );
          })}
          </>)}
        </div>
      </div>
    </div>
  );
}

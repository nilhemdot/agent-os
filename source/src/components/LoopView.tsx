"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCw, Square, Check, X, Loader2, Target, FlaskConical, Eye, Code2, ExternalLink, Download, FolderOpen, RefreshCw } from "lucide-react";

function fmtAgo(ms: number): string {
  if (!ms) return "";
  const d = Date.now() - ms;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

// Pull a complete HTML doc out of a loop artifact (strip ```html fences if any).
function extractHtml(text: string): string | null {
  const fence = /```(?:html)?\s*\n?([\s\S]*?)```/i.exec(text);
  const body = fence ? fence[1] : text;
  if (/<!doctype html|<html[\s>]|<body[\s>]|<svg[\s>]|<canvas[\s>]/i.test(body)) {
    const m = /(<!doctype html[\s\S]*<\/html>|<html[\s\S]*<\/html>|<svg[\s\S]*<\/svg>)/i.exec(body);
    return (m ? m[1] : body).trim();
  }
  return null;
}

const ACCENT = "#2dd4bf";
const WORKERS = [
  { id: "nex-agi/nex-n2-pro:free", label: "N2 ✦ · free (OpenRouter)" },
  { id: "nous:stepfun/step-3.7-flash:free", label: "Step Flash ✦ · free (Nous Portal)" },
  { id: "z-ai/glm-5.2", label: "GLM 5.2 · cheap workhorse" },
  { id: "anthropic/claude-opus-4.8", label: "Claude Opus 4.8 · premium" },
  { id: "moonshotai/kimi-k2.7", label: "Kimi K2.7 · fast" },
];
const JUDGES = [
  { id: "nex-agi/nex-n2-pro:free", label: "N2 ✦ · free", free: true },
  { id: "local", label: "Local · free, offline", free: true },
  { id: "z-ai/glm-5.2", label: "GLM 5.2 · cheap", free: false },
  { id: "openrouter/fusion", label: "Fusion council · premium (paid)", free: false },
];
const DEFAULT_JUDGE = "nex-agi/nex-n2-pro:free";
const CYCLE = ["Check state", "Decide", "Act", "Gather feedback", "Verify / terminate"];

interface Iter { n: number; steps: string[]; detail: string; verdict?: { pass: boolean; score: number; issues: string[]; summary: string }; error?: string }
interface Build { slug: string; file: string; name: string; bytes: number; mtime: number; url: string }

export default function LoopView() {
  const [goal, setGoal] = useState("");
  const [artifact, setArtifact] = useState("");
  const [worker, setWorker] = useState(WORKERS[0].id);
  const [judge, setJudge] = useState(DEFAULT_JUDGE);
  const [view, setView] = useState<"preview" | "code">("preview");
  const [maxIters, setMaxIters] = useState(4);
  const [running, setRunning] = useState(false);
  const [iters, setIters] = useState<Iter[]>([]);
  const [current, setCurrent] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const [nous, setNous] = useState<{ loggedIn: boolean; models: string[] }>({ loggedIn: false, models: [] });
  const [builds, setBuilds] = useState<Build[]>([]);
  const [preview, setPreview] = useState<Build | null>(null);

  async function loadBuilds() {
    try { const j = await fetch("/api/loop/builds", { cache: "no-store" }).then((r) => r.json()); setBuilds(j.builds || []); } catch { /* offline */ }
  }
  useEffect(() => { loadBuilds(); }, []);

  useEffect(() => {
    fetch("/api/loop/nous-models").then((r) => r.json()).then((d) => {
      setNous({ loggedIn: !!d.loggedIn, models: Array.isArray(d.models) ? d.models : [] });
      // Builder defaults to MiniMax M3 (Hermes OAuth, reliable) — see WORKERS[0]. Only
      // Portal ":free"-tier models run without credits, so we never auto-pick models[0] (paid).
    }).catch(() => { /* offline */ });
  }, []);

  function pushStep(n: number, step: string, detail: string) {
    setIters((prev) => {
      const i = prev.findIndex((x) => x.n === n);
      if (i < 0) return [...prev, { n, steps: [step], detail }];
      const next = [...prev]; next[i] = { ...next[i], steps: [...next[i].steps, step], detail }; return next;
    });
  }
  function setVerdict(n: number, verdict: Iter["verdict"]) {
    setIters((prev) => prev.map((x) => (x.n === n ? { ...x, verdict } : x)));
  }
  function setIterErr(n: number, e: string) {
    setIters((prev) => { const i = prev.findIndex((x) => x.n === n); if (i < 0) return [...prev, { n, steps: [], detail: "", error: e }]; const next = [...prev]; next[i] = { ...next[i], error: e }; return next; });
  }

  async function run() {
    if (!goal.trim() || running) return;
    setRunning(true); setIters([]); setCurrent(artifact); setResult(null); setErr(null);
    const ac = new AbortController(); ctrl.current = ac;
    try {
      const r = await fetch("/api/loop/run", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: ac.signal,
        body: JSON.stringify({ goal, artifact, worker, judge, maxIters }),
      });
      if (!r.body) throw new Error("no stream");
      const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const line of lines) {
          const s = line.trim(); if (!s) continue; let j: Record<string, unknown>;
          try { j = JSON.parse(s); } catch { continue; }
          const t = j.t as string;
          if (t === "iter") pushStep(j.n as number, j.step as string, j.detail as string);
          else if (t === "artifact") setCurrent(j.artifact as string);
          else if (t === "verdict") setVerdict(j.n as number, { pass: j.pass as boolean, score: j.score as number, issues: (j.issues as string[]) || [], summary: j.summary as string });
          else if (t === "error") setErr(j.m as string);
          else if (t === "done") { setResult(j.reason as string); if (j.artifact) setCurrent(j.artifact as string); }
          else if (j.step === "error") setIterErr(j.n as number, j.detail as string);
        }
      }
    } catch (e) { if (!ac.signal.aborted) setErr(String(e)); }
    finally { setRunning(false); ctrl.current = null; loadBuilds(); }
  }
  function stop() { ctrl.current?.abort(); setRunning(false); }

  return (
    <div className="max-w-[1000px] mx-auto w-full pb-16">
      {/* intro */}
      <p className="text-[13.5px] leading-relaxed mb-4" style={{ color: "var(--fg-dim)" }}>
        Stop being the loop. Define what <b style={{ color: "var(--fg)" }}>done</b> looks like, and the system runs the cycle itself — a builder acts, then a <b style={{ color: ACCENT }}>free judge</b> (N2 by default — no per-token cost) grades it adversarially out of 100. It keeps fixing until the judge passes or progress stalls. The builder never grades its own homework.
      </p>

      {/* the 5-step cycle */}
      <div className="flex flex-wrap items-center gap-1.5 mb-5">
        {CYCLE.map((c, i) => (
          <span key={c} className="inline-flex items-center gap-1.5">
            <span className="text-[11px] px-2.5 py-1 rounded-md border" style={{ borderColor: "var(--panel-border)", background: "var(--panel)", color: "var(--fg-dim)" }}>
              <span style={{ color: ACCENT, fontWeight: 700 }}>{i + 1}</span> {c}
            </span>
            {i < CYCLE.length - 1 && <span style={{ color: "var(--fg-dimmer)" }}>→</span>}
          </span>
        ))}
        <span className="text-[11px] ml-1" style={{ color: "var(--fg-dimmer)" }}>↻ loops back until the gate passes</span>
      </div>

      {/* config */}
      <div className="rounded-xl border p-4 mb-5" style={{ borderColor: "var(--panel-border)", background: "var(--panel)" }}>
        <label className="flex items-center gap-2 text-[12px] font-semibold mb-1.5" style={{ color: "var(--fg)" }}><Target size={14} style={{ color: ACCENT }} /> Definition of done</label>
        <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={3} disabled={running}
          placeholder="e.g. A single-file HTML ROI calculator — enter hours saved per week + hourly rate, show yearly $ saved, dark neon theme, big readable numbers, works on mobile. (Apps, tools, games, landing pages, or copy — anything. It builds it, the judge grades it, it loops until it passes.)"
          className="w-full text-[13.5px] rounded-lg p-3 mb-3 resize-y outline-none" style={{ background: "var(--bg)", border: "1px solid var(--panel-border)", color: "var(--fg)" }} />

        <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: "var(--fg)" }}>Starting point <span style={{ color: "var(--fg-dimmer)", fontWeight: 400 }}>· optional — leave blank to build from scratch</span></label>
        <textarea value={artifact} onChange={(e) => setArtifact(e.target.value)} rows={2} disabled={running}
          placeholder="Paste a draft to refine, or leave empty."
          className="w-full text-[13.5px] rounded-lg p-3 mb-3 resize-y outline-none" style={{ background: "var(--bg)", border: "1px solid var(--panel-border)", color: "var(--fg)" }} />

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[12px]" style={{ color: "var(--fg-dim)" }}>Builder</span>
            <select value={worker} onChange={(e) => setWorker(e.target.value)} disabled={running}
              className="text-[12.5px] rounded-md px-2.5 py-1.5 outline-none max-w-[270px]" style={{ background: "var(--bg)", border: "1px solid var(--panel-border)", color: "var(--fg)" }}>
              <optgroup label="Free">
                {WORKERS.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
              </optgroup>
              {nous.models.length > 0 && (
                <optgroup label="Nous Portal · 300+ models (paid tiers need credits)">
                  {nous.models.map((m) => <option key={`nous:${m}`} value={`nous:${m}`}>{m}</option>)}
                </optgroup>
              )}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12px]" style={{ color: "var(--fg-dim)" }}>Max rounds</span>
            <input type="number" min={2} max={8} value={maxIters} onChange={(e) => setMaxIters(Math.max(2, Math.min(8, Number(e.target.value) || 4)))} disabled={running}
              className="w-14 text-[12.5px] rounded-md px-2 py-1.5 outline-none" style={{ background: "var(--bg)", border: "1px solid var(--panel-border)", color: "var(--fg)" }} />
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: "var(--fg-dim)" }}><FlaskConical size={12} style={{ color: ACCENT }} /> Judge</span>
            <select value={judge} onChange={(e) => setJudge(e.target.value)} disabled={running}
              className="text-[12.5px] rounded-md px-2.5 py-1.5 outline-none max-w-[230px]" style={{ background: "var(--bg)", border: "1px solid var(--panel-border)", color: "var(--fg)" }}>
              <optgroup label="Free + paid">
                {JUDGES.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
              </optgroup>
              {nous.models.length > 0 && (
                <optgroup label="Nous Portal · 300+ models (paid tiers need credits)">
                  {nous.models.map((m) => <option key={`judge-nous:${m}`} value={`nous:${m}`}>{m}</option>)}
                </optgroup>
              )}
            </select>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {running
              ? <button onClick={stop} className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-[13px] font-semibold" style={{ background: "rgba(239,68,68,.14)", border: "1px solid rgba(239,68,68,.4)", color: "#f87171" }}><Square size={13} /> Stop</button>
              : <button onClick={run} disabled={!goal.trim()} className="inline-flex items-center gap-1.5 px-5 h-9 rounded-lg text-[13px] font-semibold disabled:opacity-40" style={{ background: ACCENT, color: "#04221c" }}><RotateCw size={14} /> Run loop</button>}
          </div>
        </div>
        <p className="text-[10.5px] mt-3" style={{ color: "var(--fg-dimmer)" }}>
          Loops are token-hungry by design — so both the builder and the judge default to <b style={{ color: ACCENT }}>free</b> models (N2). {nous.loggedIn
            ? <>Your <b style={{ color: ACCENT }}>Nous Portal</b> models are also free under your sub — pick one for the builder or judge.</>
            : <>Connect <b style={{ color: ACCENT }}>Nous Portal</b> — run <span className="font-mono">hermes portal</span> — for more free models in both dropdowns.</>} If the free judge ever throttles, it falls back to your <b style={{ color: ACCENT }}>local</b> model. Results save to your vault under <span className="font-mono">Agentic OS/Loops</span>.
        </p>
      </div>

      {err && <div className="text-[13px] px-4 py-3 rounded-lg mb-4" style={{ background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", color: "#f87171" }}>{err}</div>}

      {/* BUILDS WORKSPACE — every visual build the loop has made, openable */}
      {builds.length > 0 && (
        <div className="rounded-xl border p-4 mb-5" style={{ borderColor: "var(--panel-border)", background: "var(--panel)" }}>
          <div className="flex items-center justify-between mb-3">
            <span className="inline-flex items-center gap-2 text-[12px] font-semibold" style={{ color: "var(--fg)" }}><FolderOpen size={14} style={{ color: ACCENT }} /> Builds workspace <span style={{ color: "var(--fg-dimmer)", fontWeight: 400 }}>· {builds.length}</span></span>
            <button onClick={loadBuilds} title="Refresh" className="text-[var(--fg-dimmer)] hover:text-[var(--fg)]"><RefreshCw size={12} /></button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
            {builds.map((b) => (
              <div key={b.file} className="rounded-lg border overflow-hidden group" style={{ borderColor: preview?.file === b.file ? `${ACCENT}66` : "var(--panel-border)", background: "var(--bg)" }}>
                <button onClick={() => setPreview(preview?.file === b.file ? null : b)} className="block w-full text-left">
                  <div className="h-[116px] overflow-hidden relative" style={{ background: "#0b0713" }}>
                    <iframe title={b.name} src={b.url} sandbox="allow-scripts allow-same-origin" scrolling="no"
                      className="pointer-events-none origin-top-left" style={{ width: 800, height: 500, transform: "scale(0.34)", border: "none" }} />
                  </div>
                  <div className="px-2.5 py-2 border-t" style={{ borderColor: "var(--panel-border)" }}>
                    <div className="text-[11.5px] font-medium truncate" style={{ color: "var(--fg)" }}>{b.name}</div>
                    <div className="text-[10px] mono" style={{ color: "var(--fg-dimmer)" }}>{fmtAgo(b.mtime)} · {(b.bytes / 1024).toFixed(0)}KB</div>
                  </div>
                </button>
              </div>
            ))}
          </div>
          {preview && (
            <div className="mt-3 rounded-lg border overflow-hidden" style={{ borderColor: `${ACCENT}55` }}>
              <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "var(--panel-border)", background: `${ACCENT}0c` }}>
                <span className="text-[12px] font-medium" style={{ color: ACCENT }}>{preview.name}</span>
                <div className="flex items-center gap-2">
                  <a href={preview.url} target="_blank" rel="noopener noreferrer" className="text-[11px] inline-flex items-center gap-1" style={{ color: "var(--fg-dim)" }}><ExternalLink size={11} /> Open</a>
                  <button onClick={() => setPreview(null)} className="text-[var(--fg-dimmer)] hover:text-[var(--fg)]"><X size={13} /></button>
                </div>
              </div>
              <iframe title={preview.name} src={preview.url} sandbox="allow-scripts allow-same-origin allow-pointer-lock" className="w-full bg-white" style={{ height: 560, border: "none" }} />
            </div>
          )}
        </div>
      )}

      {/* result banner */}
      {result && (
        <div className="text-[13.5px] px-4 py-3 rounded-lg mb-4 flex items-center gap-2" style={{ background: "rgba(45,212,191,.1)", border: `1px solid ${ACCENT}55`, color: "var(--fg)" }}>
          <Check size={16} style={{ color: ACCENT }} /> {result}
        </div>
      )}

      {/* live iterations */}
      {iters.length > 0 && (
        <div className="space-y-3 mb-5">
          {iters.map((it) => (
            <div key={it.n} className="rounded-xl border p-3.5" style={{ borderColor: it.verdict?.pass ? `${ACCENT}66` : "var(--panel-border)", background: "var(--panel)" }}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[12.5px] font-semibold" style={{ color: "var(--fg)" }}>Round {it.n}</div>
                {it.verdict && (
                  <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: it.verdict.pass ? ACCENT : "#f0a850" }}>
                    {it.verdict.pass ? <Check size={14} /> : <X size={14} />} {it.verdict.pass ? "PASSED" : "rejected"} · {it.verdict.score}/100
                  </div>
                )}
              </div>
              {/* step trace */}
              <div className="flex flex-wrap gap-1.5 mb-2">
                {["state", "act", "verify"].map((step) => {
                  const reached = it.steps.includes(step);
                  const isLast = it.steps[it.steps.length - 1] === step && running && !it.verdict;
                  const lbl = step === "state" ? "check state" : step === "act" ? "build" : "Fusion verify";
                  return (
                    <span key={step} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded" style={{ background: reached ? "var(--bg)" : "transparent", color: reached ? "var(--fg-dim)" : "var(--fg-dimmer)", border: "1px solid var(--panel-border)" }}>
                      {isLast ? <Loader2 size={10} className="animate-spin" style={{ color: ACCENT }} /> : reached ? <Check size={10} style={{ color: ACCENT }} /> : null} {lbl}
                    </span>
                  );
                })}
                {it.detail && !it.verdict && <span className="text-[11px]" style={{ color: "var(--fg-dimmer)" }}>{it.detail}</span>}
              </div>
              {it.error && <div className="text-[12px]" style={{ color: "#f87171" }}>{it.error}</div>}
              {it.verdict && (
                <div className="text-[12.5px]" style={{ color: "var(--fg-dim)" }}>
                  <div className="mb-1" style={{ color: "var(--fg)" }}>{it.verdict.summary}</div>
                  {it.verdict.issues.length > 0 && (
                    <ul className="list-none space-y-0.5">
                      {it.verdict.issues.map((iss, k) => <li key={k} className="flex gap-1.5"><span style={{ color: "#f0a850" }}>→</span><span>{iss}</span></li>)}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* current / final artifact — live HTML preview when it's an app/site/game/tool */}
      {current && (() => {
        const html = extractHtml(current);
        const showPreview = html && view === "preview";
        return (
          <div className="rounded-xl border" style={{ borderColor: "var(--panel-border)", background: "var(--panel)" }}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b gap-2" style={{ borderColor: "var(--panel-border)" }}>
              <span className="text-[12px] font-semibold" style={{ color: "var(--fg)" }}>{result ? "Final result" : "Work in progress"}{html ? " · live build" : ""}</span>
              <div className="flex items-center gap-2">
                {html && (
                  <div className="flex items-center rounded-md overflow-hidden border" style={{ borderColor: "var(--panel-border)" }}>
                    <button onClick={() => setView("preview")} className="text-[11px] px-2 py-1 inline-flex items-center gap-1" style={{ background: view === "preview" ? `${ACCENT}22` : "transparent", color: view === "preview" ? ACCENT : "var(--fg-dim)" }}><Eye size={11} /> Preview</button>
                    <button onClick={() => setView("code")} className="text-[11px] px-2 py-1 inline-flex items-center gap-1" style={{ background: view === "code" ? `${ACCENT}22` : "transparent", color: view === "code" ? ACCENT : "var(--fg-dim)" }}><Code2 size={11} /> Code</button>
                  </div>
                )}
                {html && <button onClick={() => { const u = URL.createObjectURL(new Blob([html], { type: "text/html" })); window.open(u, "_blank"); setTimeout(() => URL.revokeObjectURL(u), 8000); }} className="text-[11px] px-2 py-1 rounded inline-flex items-center gap-1" style={{ color: "var(--fg-dim)", border: "1px solid var(--panel-border)" }}><ExternalLink size={11} /> Open</button>}
                {html && <button onClick={() => { const u = URL.createObjectURL(new Blob([html], { type: "text/html" })); const a = document.createElement("a"); a.href = u; a.download = "loop-build.html"; a.click(); setTimeout(() => URL.revokeObjectURL(u), 8000); }} className="text-[11px] px-2 py-1 rounded inline-flex items-center gap-1" style={{ color: "var(--fg-dim)", border: "1px solid var(--panel-border)" }}><Download size={11} /> Save</button>}
                <button onClick={() => navigator.clipboard?.writeText(html || current)} className="text-[11px] px-2 py-1 rounded" style={{ color: "var(--fg-dim)", border: "1px solid var(--panel-border)" }}>Copy</button>
              </div>
            </div>
            {showPreview
              ? <iframe title="loop build" srcDoc={html!} sandbox="allow-scripts allow-same-origin allow-pointer-lock" className="w-full rounded-b-xl bg-white" style={{ height: 560, border: "none" }} />
              : <pre className="text-[13px] leading-relaxed p-4 whitespace-pre-wrap font-sans max-h-[560px] overflow-auto" style={{ color: "var(--fg)" }}>{current}</pre>}
          </div>
        );
      })()}
    </div>
  );
}

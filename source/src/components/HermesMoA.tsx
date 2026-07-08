"use client";

import { useEffect, useRef, useState } from "react";
import { Boxes, Crown, Play, Loader2, ChevronDown, ChevronRight, Trophy, ExternalLink, Zap, FolderOpen, Maximize2, MessageSquare, RefreshCw } from "lucide-react";

const GOLD = "var(--gold)";
const EMERALD = "var(--emerald)";
const PLUM = "var(--plum)";

interface RefResult { model: string; ok: boolean; secs: number; tokens: number; text: string; }
interface MoAResult {
  final: string; finalOk: boolean; aggregator: string; aggSecs: number; totalSecs: number; references: RefResult[];
}
interface Build { name: string; title: string; bytes: number; mtime: number; }
interface Run { at: number; prompt: string; totalSecs: number; aggregator: string; final: string; references: { model: string; secs: number }[]; }

const EXAMPLES = [
  "Design a referral loop for a $59/mo community that already has 3,600 members.",
  "Write a tight Python function to find the median of two sorted arrays in O(log(m+n)).",
  "What's the strongest counter-argument to 'the best model wins'? Steel-man it in 4 points.",
];

// The MoA builds that went onto GoldieBench (panel built them, aggregator merged the best).
const BENCH_BUILDS = [
  { slug: "arcade", label: "Neon Breakout", cat: "Game" },
  { slug: "fireworks", label: "Fireworks", cat: "Visual" },
  { slug: "galaxy", label: "Particle Galaxy", cat: "Sim" },
];

function short(m: string) { return m.split("/").pop() || m; }

function ago(ms: number) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function HermesMoA() {
  const [preset, setPreset] = useState<{ references: string[]; aggregator: string } | null>(null);
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<MoAResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openDrafts, setOpenDrafts] = useState(false);
  const [builds, setBuilds] = useState<Build[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  function loadWorkspace() {
    fetch("/api/moa/workspace").then((r) => r.json())
      .then((d) => {
        const bs: Build[] = d.builds || [];
        setBuilds(bs); setRuns(d.runs || []);
        // auto-select the newest build so a preview is always showing (Hermes Workspace behaviour)
        setSelected((cur) => (cur && bs.some((b) => b.name === cur)) ? cur : (bs[0]?.name ?? null));
      }).catch(() => {});
  }

  useEffect(() => {
    fetch("/api/moa").then((r) => r.json()).then((d) => setPreset(d.preset)).catch(() => {});
    loadWorkspace();
  }, []);

  async function run() {
    if (!prompt.trim() || running) return;
    setRunning(true); setError(null); setResult(null); setOpenDrafts(false);
    try {
      const r = await fetch("/api/moa", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const d = await r.json();
      if (!r.ok || d.error) setError(d.error || `HTTP ${r.status}`);
      else { setResult(d); loadWorkspace(); if (d.build) setSelected(d.build); }
    } catch (e) { setError(String(e)); }
    finally { setRunning(false); }
  }

  const refs = preset?.references ?? ["anthropic/claude-opus-4.8", "openai/gpt-5.5"];
  const agg = preset?.aggregator ?? "anthropic/claude-opus-4.8";

  return (
    <div className="h-full overflow-y-auto px-5 py-5" style={{ color: "var(--fg)" }}>
      <div className="mx-auto max-w-3xl">
        {/* header */}
        <div className="flex items-center gap-3 mb-1">
          <div className="grid place-items-center rounded-xl p-2" style={{ background: "var(--gold-soft)", color: GOLD }}>
            <Boxes size={20} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Mixture of Agents</h1>
            <p className="text-xs" style={{ color: "var(--fg-dimmer)" }}>
              A panel of frontier models answers in parallel — a chair model synthesises one better answer.
              The model doesn&apos;t matter, the system does.
            </p>
          </div>
        </div>

        {/* the panel preset */}
        <div className="rounded-2xl border p-4 mt-4" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--fg-dimmer)" }}>
              The panel · live via OpenRouter
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full" style={{ background: "var(--gold-soft)", color: GOLD }}>
              hermes moa · /moa
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {refs.map((m) => (
              <span key={m} className="inline-flex items-center gap-1.5 text-xs font-mono px-2.5 py-1.5 rounded-lg border"
                style={{ borderColor: "var(--border)", color: "var(--fg-dim)" }}>
                <Zap size={12} style={{ color: EMERALD }} /> {short(m)}
              </span>
            ))}
            <ChevronRight size={14} style={{ color: "var(--fg-dimmer)" }} />
            <span className="inline-flex items-center gap-1.5 text-xs font-mono px-2.5 py-1.5 rounded-lg border"
              style={{ borderColor: GOLD, color: GOLD, background: "var(--gold-soft)" }}>
              <Crown size={12} /> {short(agg)} <span style={{ color: "var(--fg-dimmer)" }}>· aggregator</span>
            </span>
          </div>
        </div>

        {/* prompt */}
        <div className="mt-4">
          <textarea ref={taRef} value={prompt} onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(); }}
            placeholder="Ask the panel anything…  (⌘↵ to run)"
            rows={3}
            className="w-full resize-y rounded-xl border px-3 py-2.5 text-sm outline-none"
            style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--fg)" }} />
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <button onClick={run} disabled={running || !prompt.trim()}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg disabled:opacity-50 transition-opacity"
              style={{ background: GOLD, color: "#1a1020" }}>
              {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {running ? "Panel deliberating…" : "Run the panel"}
            </button>
            {EXAMPLES.map((ex, i) => (
              <button key={i} onClick={() => setPrompt(ex)}
                className="text-[11px] px-2 py-1 rounded-md border hover:opacity-80 transition-opacity"
                style={{ borderColor: "var(--border)", color: "var(--fg-dimmer)" }}>
                {ex.length > 38 ? ex.slice(0, 38) + "…" : ex}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border px-3 py-2.5 text-sm" style={{ borderColor: "var(--rust)", color: "var(--rust)" }}>
            {error}
          </div>
        )}

        {/* result */}
        {result && (
          <div className="mt-5">
            <div className="flex items-center gap-2 mb-2">
              <Crown size={14} style={{ color: GOLD }} />
              <span className="text-sm font-medium">Aggregated answer</span>
              <span className="text-[11px] font-mono" style={{ color: "var(--fg-dimmer)" }}>
                {result.totalSecs}s total · chair {result.aggSecs}s
              </span>
            </div>
            <div className="rounded-2xl border p-4 text-sm whitespace-pre-wrap leading-relaxed"
              style={{ borderColor: GOLD, background: "var(--gold-soft)" }}>
              {result.final}
            </div>

            {/* per-model drafts */}
            <button onClick={() => setOpenDrafts((v) => !v)}
              className="inline-flex items-center gap-1 text-xs mt-3 hover:opacity-80" style={{ color: "var(--fg-dimmer)" }}>
              {openDrafts ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {openDrafts ? "Hide" : "Show"} the {result.references.length} private panel drafts
            </button>
            {openDrafts && (
              <div className="grid gap-3 mt-2 sm:grid-cols-2">
                {result.references.map((r) => (
                  <div key={r.model} className="rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-mono" style={{ color: r.ok ? EMERALD : "var(--rust)" }}>{short(r.model)}</span>
                      <span className="text-[10px] font-mono" style={{ color: "var(--fg-dimmer)" }}>{r.secs}s · {r.tokens} tok</span>
                    </div>
                    <p className="text-xs whitespace-pre-wrap leading-relaxed" style={{ color: "var(--fg-dim)" }}>
                      {r.text.length > 700 ? r.text.slice(0, 700) + "…" : r.text}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Workspace — everything the panel has made */}
        <div className="rounded-2xl border p-4 mt-6" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FolderOpen size={15} style={{ color: GOLD }} />
              <span className="text-sm font-medium">Workspace</span>
              <span className="text-[11px]" style={{ color: "var(--fg-dimmer)" }}>
                everything the panel has made · {builds.length} build{builds.length === 1 ? "" : "s"}
                {runs.length ? ` · ${runs.length} run${runs.length === 1 ? "" : "s"}` : ""}
              </span>
            </div>
            <button onClick={loadWorkspace} title="Refresh" className="hover:opacity-70" style={{ color: "var(--fg-dimmer)" }}>
              <RefreshCw size={13} />
            </button>
          </div>

          {builds.length === 0 && runs.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--fg-dimmer)" }}>
              Nothing yet — run the panel above, or have it build something. Everything it makes saves here.
            </p>
          ) : (
            <>
              {/* File-browser + live preview pane — same browse-and-preview UX as the Hermes Workspace tab */}
              {builds.length > 0 && (
                <div className="grid gap-3 lg:grid-cols-[230px_1fr] rounded-xl border overflow-hidden"
                  style={{ borderColor: "var(--border)" }}>
                  {/* file list */}
                  <div className="max-h-[460px] overflow-y-auto p-2" style={{ background: "var(--bg)", borderRight: "1px solid var(--border)" }}>
                    {builds.map((b) => {
                      const on = selected === b.name;
                      return (
                        <button key={b.name} onClick={() => setSelected(b.name)}
                          className="w-full text-left rounded-lg px-2.5 py-2 mb-0.5 transition-colors"
                          style={{ background: on ? "var(--gold-soft)" : "transparent" }}>
                          <div className="flex items-center gap-1.5">
                            <Boxes size={11} style={{ color: on ? GOLD : "var(--fg-dimmer)" }} />
                            <span className="text-xs font-medium truncate" style={{ color: on ? GOLD : "var(--fg)" }}>{b.title}</span>
                          </div>
                          <span className="text-[10px] font-mono ml-[18px]" style={{ color: "var(--fg-dimmer)" }}>
                            {(b.bytes / 1024).toFixed(0)}KB · {ago(b.mtime)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {/* preview pane */}
                  <div className="flex flex-col" style={{ background: "#05030a", minHeight: 360 }}>
                    {selected ? (
                      <>
                        <div className="flex items-center justify-between px-3 py-1.5" style={{ borderBottom: "1px solid var(--border)" }}>
                          <span className="text-[11px] font-mono truncate" style={{ color: "var(--fg-dim)" }}>{selected}</span>
                          <a href={`/api/moa/file/${encodeURIComponent(selected)}`} target="_blank" rel="noreferrer"
                            title="Open fullscreen" className="inline-flex items-center gap-1 text-[11px] hover:opacity-70" style={{ color: GOLD }}>
                            open <Maximize2 size={11} />
                          </a>
                        </div>
                        <iframe key={selected} src={`/api/moa/file/${encodeURIComponent(selected)}`} title={selected}
                          sandbox="allow-scripts allow-same-origin allow-popups"
                          className="w-full border-0 flex-1" style={{ minHeight: 320 }} />
                      </>
                    ) : (
                      <div className="grid place-items-center flex-1 text-xs" style={{ color: "var(--fg-dimmer)" }}>Select a build to preview</div>
                    )}
                  </div>
                </div>
              )}
              {runs.length > 0 && (
                <div className="mt-4">
                  <div className="flex items-center gap-1.5 mb-2 text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--fg-dimmer)" }}>
                    <MessageSquare size={12} /> recent panel runs
                  </div>
                  <div className="grid gap-2">
                    {runs.slice(0, 6).map((r, i) => (
                      <div key={i} className="rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium truncate" style={{ color: "var(--fg)" }}>{r.prompt}</p>
                          <span className="text-[10px] font-mono whitespace-nowrap" style={{ color: "var(--fg-dimmer)" }}>{r.totalSecs}s · {ago(r.at)}</span>
                        </div>
                        <p className="text-[11px] mt-1 line-clamp-2 leading-relaxed" style={{ color: "var(--fg-dim)" }}>{r.final}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* GoldieBench strip */}
        <div className="rounded-2xl border p-4 mt-6" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
          <div className="flex items-center gap-2 mb-2">
            <Trophy size={15} style={{ color: GOLD }} />
            <span className="text-sm font-medium">On GoldieBench</span>
            <span className="text-[11px]" style={{ color: "var(--fg-dimmer)" }}>
              the panel built these — aggregator merged the best of each
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {BENCH_BUILDS.map((b) => (
              <a key={b.slug} href={`https://goldiebench.com/compare/${b.slug}-moa.html`} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border hover:opacity-80 transition-opacity"
                style={{ borderColor: "var(--border)", color: "var(--fg-dim)" }}>
                <span style={{ color: PLUM }}>{b.cat}</span> {b.label} <ExternalLink size={11} style={{ color: "var(--fg-dimmer)" }} />
              </a>
            ))}
            <a href="https://goldiebench.com" target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border hover:opacity-80 transition-opacity"
              style={{ borderColor: GOLD, color: GOLD }}>
              View the leaderboard <ExternalLink size={11} />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

// Ultracode view — the "wow" surface.
//
// Left: run history (newest first). Right: the selected run's animated Swarm
// Map — a constellation of subagent nodes fanning out from the orchestrator,
// colour-coded by status, sized by token spend — plus the live cost meter,
// the verdict feed (adversarial summaries), and the final result.
//
// A run that's still `running` polls its detail every 1.5s so the swarm
// animates live as Claude spins up agents. Completed runs are fully
// replayable — this is the screen the demo video shows off.

import { useEffect, useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { Zap, RefreshCw, Trash2, DollarSign, Clock, Users, Loader2, CheckCircle2, AlertCircle, Sparkles, ShieldCheck, Scissors, Rocket, Brain, Send, Square, Ban } from "lucide-react";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";

// One-click Ultracode missions — preset prompts that fire scoped dynamic
// workflows. Each runs through /api/claude/chat with ultracode:true; the server
// captures the run, and the history list below picks it up live.
interface Mission { id: string; label: string; icon: React.ReactNode; color: string; project: string; prompt: string; }
const MISSIONS: Mission[] = [
  {
    id: "security", label: "Security audit", icon: <ShieldCheck size={13} />, color: "#f472b6", project: "ultracode-security",
    prompt: "Run a security audit of this Agent OS codebase (src/). Use parallel subagents to hunt independently for: (1) injection / unsafe shell exec, (2) missing input validation at API boundaries, (3) secret/credential leakage, (4) path-traversal in file routes. Have reviewer agents try to refute each finding before it's reported. Output a prioritised findings report as security-audit.md — real issues only, no false positives.",
  },
  {
    id: "deadcode", label: "Find dead code", icon: <Scissors size={13} />, color: "#5ab896", project: "ultracode-deadcode",
    prompt: "Find dead code + cleanup opportunities across src/. Use parallel subagents to scan different areas, then cross-check: unused exports, unreachable branches, orphaned components, duplicated helpers. Verify each candidate is genuinely unused before listing it. Output dead-code-report.md with file:line references and a confidence level per item.",
  },
  {
    id: "showcase", label: "Build a showcase page", icon: <Rocket size={13} />, color: "#d4a574", project: "ultracode-showcase",
    prompt: "Build a dazzling single-file HTML showcase page at index.html for 'Agent OS'. Use parallel subagents: hero section, animated feature grid, CSS animation library, closing CTA — then assemble into one self-contained index.html. Dark midnight-aubergine theme (#15101a), gold (#d4a574) + pink (#f472b6) accents, premium animated, fully responsive, zero external deps.",
  },
  {
    id: "stresstest", label: "Stress-test a plan", icon: <Brain size={13} />, color: "#60a5fa", project: "ultracode-plan",
    prompt: "I want to add real-time multiplayer to a web app. Stress-test this plan from every angle using parallel subagents: one argues the websocket approach, one argues server-sent events, one plays the skeptic hunting for scaling/cost failure modes, one checks security. Have them debate, then converge on a recommended architecture with the tradeoffs spelled out. Write the verdict to plan-review.md.",
  },
];

const GOLD = "#d4a574";
const PINK = "#f472b6";
const EMERALD = "#5ab896";
const PLUM = "#c4607e";
const BLUE = "#60a5fa";

type SubStatus = "running" | "completed" | "failed";
interface SubagentNode {
  taskId: string; toolUseId: string; description: string; subagentType: string;
  taskType?: string; prompt?: string; status: SubStatus; lastTool?: string;
  tokens: number; durationMs: number; summary?: string; outputFile?: string;
  startedAt: number; finishedAt?: number;
}
interface VerdictEntry { at: number; category: string; detail: string; }
interface RunTurn { prompt: string; at: number; }
interface UltracodeRun {
  id: string; prompt: string; project?: string; model: string; ultracode: boolean;
  sessionId?: string; turns?: RunTurn[];
  startedAt: number; finishedAt?: number; status: "running" | "completed" | "failed" | "stopped";
  subagents: SubagentNode[]; verdicts: VerdictEntry[]; headline?: string;
  liveText?: string; resultText?: string; costUsd?: number; numTurns?: number; durationMs?: number; tokensTotal?: number;
}
interface RunSummary {
  id: string; prompt: string; headline?: string; status: UltracodeRun["status"];
  subagentCount: number; costUsd?: number; durationMs?: number; startedAt: number;
}

function fmtAgo(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function fmtDur(ms?: number): string {
  if (!ms) return "—";
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}
function statusColor(s: SubStatus): string {
  return s === "completed" ? EMERALD : s === "failed" ? PLUM : GOLD;
}
// Reviewer / adversarial agents get a pink ring; workers gold/blue.
function ringColor(t: string): string {
  if (/review|adversar|critic|verif|refut/i.test(t)) return PINK;
  if (/research|explore|search/i.test(t)) return BLUE;
  return GOLD;
}

export default function UltracodeView() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [run, setRun] = useState<UltracodeRun | null>(null);
  const [launching, setLaunching] = useState<string | null>(null); // mission id in flight
  const [customPrompt, setCustomPrompt] = useState("");

  const loadList = useCallback(async () => {
    try {
      const r = await fetch("/api/claude/ultracode", { cache: "no-store" });
      const j = await r.json();
      const rs: RunSummary[] = j.runs ?? [];
      setRuns(rs);
      setOpenId((cur) => cur ?? (rs[0]?.id ?? null));
    } catch { /* ignore */ }
  }, []);
  usePollWhileVisible(loadList, 4000);

  // Load + live-refresh the open run. (Declared before launchMission so the
  // reply path can call it.)
  const openIdRef = useRef(openId);
  openIdRef.current = openId;
  const loadRun = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/claude/ultracode?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const j = await r.json();
      if (j.run && openIdRef.current === id) setRun(j.run);
    } catch { /* ignore */ }
  }, []);

  // Fire an Ultracode mission. We must drain the response stream (not fire-and-
  // forget) — if the client disconnects, the route's cancel() kills the child.
  // We read + discard chunks; the history poll animates the swarm meanwhile.
  const launchMission = useCallback(async (id: string, prompt: string, project: string, resumeRunId?: string) => {
    if (launching || !prompt.trim()) return;
    setLaunching(id);
    if (resumeRunId) setOpenId(resumeRunId); // keep the resumed run open + live-polling
    try {
      const r = await fetch("/api/claude/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(resumeRunId ? { prompt, resumeRunId } : { prompt, ultracode: true, project }),
      });
      if (!r.body) return;
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let opened = !!resumeRunId; // already open when resuming
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!opened) {
          buf += decoder.decode(value, { stream: true });
          const m = /"ultracode_run_started"[^}]*"runId":"([^"]+)"/.exec(buf);
          if (m) { setOpenId(m[1]); opened = true; void loadList(); }
        }
        // else: keep draining to keep the child alive; data is captured server-side.
      }
    } catch { /* ignore */ }
    finally {
      setLaunching(null);
      void loadList();
      if (resumeRunId) void loadRun(resumeRunId);
    }
  }, [launching, loadList, loadRun]);

  useEffect(() => { if (openId) loadRun(openId); else setRun(null); }, [openId, loadRun]);
  // Fast poll while the open run is still going.
  usePollWhileVisible(() => { if (openId && run?.status === "running") loadRun(openId); }, 1500, [openId, run?.status]);

  async function del(id: string) {
    if (!confirm("Delete this Ultracode run from history?")) return;
    await fetch(`/api/claude/ultracode?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (openId === id) { setOpenId(null); setRun(null); }
    await loadList();
  }

  const stopRun = useCallback(async (id: string) => {
    try {
      await fetch("/api/claude/ultracode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "stop", id }),
      });
    } catch { /* ignore */ }
    // Give the child a beat to die, then refresh status.
    setTimeout(() => { void loadRun(id); void loadList(); }, 600);
  }, [loadRun, loadList]);

  return (
    <div className="space-y-4">
      {/* Banner */}
      <div className="relative overflow-hidden rounded-xl border p-4"
           style={{ borderColor: `${GOLD}33`, background: `linear-gradient(135deg, ${GOLD}12, ${PINK}08, transparent)` }}>
        <div className="flex items-start gap-3">
          <div className="grid place-items-center w-10 h-10 rounded-lg"
               style={{ background: `${GOLD}1a`, color: GOLD, border: `1px solid ${GOLD}40` }}>
            <Zap size={18} fill="currentColor" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.25em] mb-1" style={{ color: GOLD }}>Ultracode · Dynamic Workflows</div>
            <div className="text-[18px] font-semibold text-[var(--cream)] mb-1">Watch the swarm work</div>
            <div className="text-[12.5px] text-[var(--cream-mute)] max-w-[680px] leading-snug">
              Every Ultracode run is captured + replayable. Each node below is a real subagent Claude spun up — fanned out in parallel, checked by reviewers, converged into one answer. Launch a mission below, or turn on <strong style={{ color: GOLD }}>Ultracode</strong> in the Chat tab for a custom job.
            </div>
          </div>
        </div>

        {/* One-click missions */}
        <div className="mt-3.5 pt-3 border-t" style={{ borderColor: "var(--line-soft)" }}>
          <div className="text-[9.5px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold mb-2 flex items-center gap-1.5">
            <Rocket size={11} /> Launch a mission · fires a dynamic workflow
          </div>
          <div className="flex flex-wrap gap-2">
            {MISSIONS.map((m) => (
              <button key={m.id}
                onClick={() => launchMission(m.id, m.prompt, m.project)}
                disabled={!!launching}
                title={m.prompt}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11.5px] font-medium transition disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ borderColor: `${m.color}55`, background: `${m.color}12`, color: m.color }}>
                {launching === m.id ? <Loader2 size={13} className="animate-spin" /> : m.icon}
                {m.label}
              </button>
            ))}
          </div>
          {/* Custom mission */}
          <div className="mt-2 flex items-center gap-2">
            <input
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && customPrompt.trim() && !launching) launchMission("custom", customPrompt, "ultracode-custom"); }}
              placeholder="…or type a custom mission and hit enter (runs at xhigh effort)"
              disabled={!!launching}
              className="flex-1 px-3 py-1.5 text-[12px] rounded-md border bg-transparent text-[var(--cream)] placeholder:text-[var(--cream-mute)] disabled:opacity-50"
              style={{ borderColor: "var(--line-soft)" }}
            />
            <button
              onClick={() => launchMission("custom", customPrompt, "ultracode-custom")}
              disabled={!!launching || !customPrompt.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-[11px] uppercase tracking-widest font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ borderColor: `${GOLD}`, background: `${GOLD}1a`, color: GOLD }}>
              {launching === "custom" ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              Launch
            </button>
          </div>
          {launching && (
            <div className="mt-2 text-[11px] flex items-center gap-1.5" style={{ color: GOLD }}>
              <Loader2 size={11} className="animate-spin" />
              Mission running — watch the swarm spawn below. This uses xhigh effort + real tokens.
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
        {/* Run history */}
        <div className="panel p-2 flex flex-col" style={{ minHeight: 520 }}>
          <div className="flex items-center justify-between px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold">
              Runs · {runs.length}
            </div>
            <button onClick={loadList} title="Refresh" className="text-[var(--cream-mute)] hover:text-[var(--cream)]"><RefreshCw size={12} /></button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto scroll space-y-1.5">
            {runs.length === 0 && (
              <div className="px-2 py-4 text-[11px] text-[var(--cream-mute)] leading-snug">
                No Ultracode runs yet. Flip on <strong style={{ color: GOLD }}>Ultracode</strong> in Chat, send a big task, and it&apos;ll appear here with the full swarm replay.
              </div>
            )}
            {runs.map((r) => (
              <div key={r.id}
                   role="button" tabIndex={0}
                   onClick={() => setOpenId(r.id)}
                   onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenId(r.id); } }}
                   className="p-2.5 rounded-md border transition cursor-pointer"
                   style={{
                     borderColor: openId === r.id ? `${GOLD}66` : "var(--line-soft)",
                     background: openId === r.id ? `${GOLD}10` : "transparent",
                   }}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {r.status === "running"
                      ? <Loader2 size={11} className="animate-spin shrink-0" style={{ color: GOLD }} />
                      : r.status === "failed"
                        ? <AlertCircle size={11} className="shrink-0" style={{ color: PLUM }} />
                        : r.status === "stopped"
                          ? <Ban size={11} className="shrink-0" style={{ color: "var(--cream-mute)" }} />
                          : <CheckCircle2 size={11} className="shrink-0" style={{ color: EMERALD }} />}
                    <span className="text-[11.5px] text-[var(--cream)] truncate font-medium">{r.prompt}</span>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); del(r.id); }} className="text-[var(--cream-mute)] hover:text-[var(--plum)] shrink-0" title="Delete"><Trash2 size={11} /></button>
                </div>
                {r.headline && <div className="text-[10.5px] text-[var(--cream-mute)] line-clamp-2 mb-1 leading-snug">{r.headline}</div>}
                <div className="flex items-center gap-2.5 text-[10px] mono" style={{ color: "var(--cream-mute)" }}>
                  <span className="flex items-center gap-0.5"><Users size={9} /> {r.subagentCount}</span>
                  {r.costUsd !== undefined && <span className="flex items-center gap-0.5"><DollarSign size={9} />{r.costUsd.toFixed(2)}</span>}
                  <span className="flex items-center gap-0.5"><Clock size={9} /> {fmtDur(r.durationMs)}</span>
                  <span className="ml-auto">{fmtAgo(r.startedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Selected run — swarm map + stats */}
        <div className="panel p-0 flex flex-col overflow-hidden" style={{ minHeight: 520 }}>
          {!run ? (
            <div className="flex-1 grid place-items-center text-center p-6">
              <div>
                <Sparkles size={22} style={{ color: GOLD }} className="mx-auto mb-2 opacity-60" />
                <div className="text-[12.5px] text-[var(--cream)] mb-1">Select a run to replay the swarm</div>
                <div className="text-[11px] text-[var(--cream-mute)]">Each node is a real subagent. Watch them spawn, work, and converge.</div>
              </div>
            </div>
          ) : (
            <RunDetail run={run} launching={launching}
              onReply={(text) => launchMission("reply", text, run.project ?? "ultracode-custom", run.id)}
              onStop={() => stopRun(run.id)} />
          )}
        </div>
      </div>
    </div>
  );
}

function RunDetail({ run, launching, onReply, onStop }: { run: UltracodeRun; launching: string | null; onReply: (text: string) => void; onStop: () => void }) {
  const total = run.subagents.length;
  const done = run.subagents.filter((s) => s.status === "completed").length;
  const running = run.subagents.filter((s) => s.status === "running").length;
  const failed = run.subagents.filter((s) => s.status === "failed").length;
  const [reply, setReply] = useState("");
  const busy = launching === "reply" || run.status === "running";
  const followUps = (run.turns ?? []).slice(1); // turn 0 is the original mission, shown as header

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header stats */}
      <div className="px-4 py-3 border-b" style={{ borderColor: "var(--line-soft)" }}>
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="text-[13px] text-[var(--cream)] font-medium line-clamp-2">{run.prompt}</div>
          {run.status === "running" && (
            <button onClick={onStop}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition"
              style={{ background: "rgba(248,113,113,0.16)", border: "1px solid rgba(248,113,113,0.45)", color: "#f87171" }}
              title="Stop this run — kills the workflow + all its subagents">
              <Square size={12} fill="currentColor" /> Stop
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Stat icon={<Users size={11} />} label="agents" value={String(total)} color={GOLD} />
          <Stat icon={<CheckCircle2 size={11} />} label="done" value={String(done)} color={EMERALD} />
          {running > 0 && <Stat icon={<Loader2 size={11} className="animate-spin" />} label="running" value={String(running)} color={GOLD} />}
          {failed > 0 && <Stat icon={<AlertCircle size={11} />} label="failed" value={String(failed)} color={PLUM} />}
          {run.costUsd !== undefined && <Stat icon={<DollarSign size={11} />} label="cost" value={`$${run.costUsd.toFixed(2)}`} color={EMERALD} />}
          <Stat icon={<Clock size={11} />} label="time" value={fmtDur(run.durationMs)} color={BLUE} />
          {run.tokensTotal !== undefined && <Stat icon={<Zap size={11} />} label="tokens" value={`${(run.tokensTotal / 1000).toFixed(0)}k`} color={PINK} />}
        </div>
      </div>

      {/* Swarm map — or, while planning with no agents yet, a live "thinking" panel */}
      <div className="flex-1 min-h-0 overflow-hidden relative" style={{ background: "radial-gradient(ellipse at center, rgba(212,165,116,0.05), #0a070d)" }}>
        {run.status === "running" && run.subagents.length === 0
          ? <PlanningPanel run={run} />
          : <SwarmMap run={run} />}
      </div>

      {/* Verdict + result */}
      <div className="border-t max-h-[220px] overflow-y-auto scroll" style={{ borderColor: "var(--line-soft)" }}>
        {run.headline && (
          <div className="px-4 py-2.5 flex items-start gap-2 border-b" style={{ borderColor: "var(--line-soft)", background: `${EMERALD}08` }}>
            <Sparkles size={13} className="shrink-0 mt-0.5" style={{ color: EMERALD }} />
            <div className="text-[12px] text-[var(--cream)] leading-snug font-medium">{run.headline}</div>
          </div>
        )}
        {run.verdicts.length > 1 && (
          <div className="px-4 py-2 space-y-1 border-b" style={{ borderColor: "var(--line-soft)" }}>
            <div className="text-[9.5px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold mb-1">Verdict trail</div>
            {run.verdicts.map((v, i) => (
              <div key={i} className="text-[11px] text-[var(--cream-mute)] flex items-start gap-1.5">
                <span className="mono shrink-0" style={{ color: GOLD }}>{(v.at / 1000).toFixed(0)}s</span>
                <span className="leading-snug">{v.detail}</span>
              </div>
            ))}
          </div>
        )}
        {followUps.length > 0 && (
          <div className="px-4 py-2 space-y-1.5 border-b" style={{ borderColor: "var(--line-soft)" }}>
            <div className="text-[9.5px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold">Your replies</div>
            {followUps.map((t, i) => (
              <div key={i} className="text-[11.5px] text-[var(--cream)] rounded-md px-2.5 py-1.5" style={{ background: "rgba(217,119,87,0.1)", border: "1px solid rgba(217,119,87,0.25)" }}>
                {t.prompt}
              </div>
            ))}
          </div>
        )}
        {(run.resultText || (run.status === "running" && run.liveText)) && (
          <div className="px-4 py-3">
            <div className="text-[9.5px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold mb-1.5 flex items-center gap-1.5">
              {run.status === "running" ? <><Loader2 size={10} className="animate-spin" /> Streaming…</> : "Final answer"}
            </div>
            <div className="text-[12px] text-[var(--cream)] whitespace-pre-wrap leading-relaxed">{run.resultText || run.liveText}</div>
          </div>
        )}
      </div>

      {/* Reply box — resumes this exact session so context (team design,
          assumptions) carries over. Disabled while a turn is running. */}
      <div className="border-t p-3" style={{ borderColor: "var(--line-soft)" }}>
        <div className="flex items-end gap-2 rounded-xl border bg-[rgba(0,0,0,0.25)] p-2 focus-within:border-[var(--panel-border-hot)] transition" style={{ borderColor: "var(--line-soft)" }}>
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if ((e.key === "Enter") && (e.metaKey || e.ctrlKey) && reply.trim() && !busy) {
                e.preventDefault(); onReply(reply.trim()); setReply("");
              }
            }}
            rows={2}
            disabled={busy}
            placeholder={busy ? "Workflow running — wait for it to finish…" : "Reply to this run (resumes the session — full context kept). ⌘+Enter to send."}
            className="flex-1 bg-transparent outline-none resize-none px-2 py-1.5 text-[12.5px] text-[var(--cream)] placeholder:text-[var(--cream-mute)] disabled:opacity-50"
          />
          <button
            onClick={() => { if (reply.trim() && !busy) { onReply(reply.trim()); setReply(""); } }}
            disabled={busy || !reply.trim()}
            className="px-3 py-2 rounded-lg text-[12px] font-semibold flex items-center gap-1.5 transition disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: "rgba(217,119,87,0.18)", border: "1px solid rgba(217,119,87,0.5)", color: "#d97757" }}>
            {launching === "reply" ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            Reply
          </button>
        </div>
        {run.status !== "running" && (
          <div className="text-[10px] text-[var(--cream-mute)] mt-1.5 px-1">
            Continues the same Claude session via <code className="mono">--resume</code> at xhigh effort — it remembers everything above.
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md" style={{ background: `${color}10`, border: `1px solid ${color}30` }}>
      <span style={{ color }}>{icon}</span>
      <span className="text-[12px] mono font-semibold" style={{ color: "var(--cream)" }}>{value}</span>
      <span className="text-[9px] uppercase tracking-widest" style={{ color: "var(--cream-mute)" }}>{label}</span>
    </div>
  );
}

// Shown while a run is live but hasn't spawned subagents yet — i.e. Claude is
// planning/thinking (which at xhigh effort can take 1-3 min). Without this the
// swarm map looks frozen on "0 agents". We tick an elapsed timer client-side
// and stream the orchestrator's live text so it's obviously working.
function PlanningPanel({ run }: { run: UltracodeRun }) {
  const [now, setNow] = useState(Date.now());
  const liveRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (liveRef.current) liveRef.current.scrollTop = liveRef.current.scrollHeight;
  }, [run.liveText]);
  const elapsed = Math.max(0, Math.floor((now - run.startedAt) / 1000));
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="h-full flex flex-col p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="relative grid place-items-center w-12 h-12 rounded-full shrink-0"
             style={{ background: `${GOLD}1a`, border: `2px solid ${GOLD}` }}>
          <Loader2 size={20} className="animate-spin" style={{ color: GOLD }} />
        </div>
        <div>
          <div className="text-[14px] font-semibold text-[var(--cream)]">Claude is planning the workflow…</div>
          <div className="text-[11.5px] text-[var(--cream-mute)]">
            xhigh effort thinks hard before it spawns agents. Elapsed <span className="mono" style={{ color: GOLD }}>{mm}:{ss}</span> · subagents will appear here the moment they fan out.
          </div>
        </div>
      </div>
      {run.liveText ? (
        <div ref={liveRef} className="flex-1 min-h-0 overflow-y-auto scroll rounded-lg border p-3 text-[12px] leading-relaxed whitespace-pre-wrap"
             style={{ borderColor: "var(--line-soft)", background: "rgba(0,0,0,0.25)", color: "var(--cream)" }}>
          {run.liveText}
          <span className="inline-block w-2 h-4 ml-0.5 align-middle animate-pulse" style={{ background: GOLD }} />
        </div>
      ) : (
        <div className="flex-1 grid place-items-center text-[12px] text-[var(--cream-mute)]">
          <div className="flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> thinking… (no output yet)</div>
        </div>
      )}
    </div>
  );
}

// The constellation. Orchestrator at centre, subagents on a ring (two rings if
// many), edges from centre to each. SVG viewBox keeps it responsive.
function SwarmMap({ run }: { run: UltracodeRun }) {
  const agents = run.subagents;
  const W = 800, H = 440;
  const cx = W / 2, cy = H / 2;
  const n = agents.length;

  // Lay agents on 1–2 rings depending on count.
  const positions = agents.map((a, i) => {
    const ring = n > 10 && i >= Math.ceil(n / 2) ? 1 : 0;
    const ringCount = ring === 0 ? Math.min(n, Math.ceil(n / (n > 10 ? 2 : 1))) : n - Math.ceil(n / 2);
    const idxInRing = ring === 0 ? i : i - Math.ceil(n / 2);
    const radius = ring === 0 ? 150 : 110;
    const denom = Math.max(ringCount, 1);
    const angle = (idxInRing / denom) * Math.PI * 2 - Math.PI / 2 + (ring === 1 ? Math.PI / denom : 0);
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });

  const nodeRadius = (a: SubagentNode) => {
    const base = 14;
    const byTokens = Math.min(16, Math.sqrt(a.tokens) / 12);
    return base + byTokens;
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      {/* edges */}
      {positions.map((p, i) => {
        const a = agents[i];
        const c = statusColor(a.status);
        return (
          <motion.line key={`e-${a.taskId}`} x1={cx} y1={cy} x2={p.x} y2={p.y}
            stroke={c} strokeWidth={a.status === "running" ? 1.6 : 1} strokeOpacity={a.status === "running" ? 0.5 : 0.25}
            initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.5, delay: i * 0.04 }} />
        );
      })}

      {/* orchestrator */}
      <circle cx={cx} cy={cy} r={26} fill={`${GOLD}22`} stroke={GOLD} strokeWidth={2} />
      <text x={cx} y={cy - 2} textAnchor="middle" fontSize="11" fontWeight="700" fill={GOLD}>CLAUDE</text>
      <text x={cx} y={cy + 11} textAnchor="middle" fontSize="8" fill="#a59783">orchestrator</text>
      {run.status === "running" && (
        <circle cx={cx} cy={cy} r={26} fill="none" stroke={GOLD} strokeWidth={1.5} opacity={0.5}>
          <animate attributeName="r" values="26;40;26" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.5;0;0.5" dur="2s" repeatCount="indefinite" />
        </circle>
      )}

      {/* subagents */}
      {positions.map((p, i) => {
        const a = agents[i];
        const c = statusColor(a.status);
        const r = nodeRadius(a);
        const label = a.description.length > 22 ? a.description.slice(0, 21) + "…" : a.description;
        return (
          <motion.g key={`n-${a.taskId}`}
            initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 16, delay: i * 0.05 }}
            style={{ transformOrigin: `${p.x}px ${p.y}px` }}>
            {/* type ring */}
            <circle cx={p.x} cy={p.y} r={r + 4} fill="none" stroke={ringColor(a.subagentType)} strokeWidth={1} strokeOpacity={0.4} />
            <circle cx={p.x} cy={p.y} r={r} fill={`${c}26`} stroke={c} strokeWidth={2} />
            {/* working pulse */}
            {a.status === "running" && (
              <circle cx={p.x} cy={p.y} r={r} fill="none" stroke={c} strokeWidth={1.5}>
                <animate attributeName="r" values={`${r};${r + 12};${r}`} dur="1.4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.7;0;0.7" dur="1.4s" repeatCount="indefinite" />
              </circle>
            )}
            {a.status === "completed" && (
              <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="13" fill={c}>✓</text>
            )}
            {a.status === "failed" && (
              <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="13" fill={c}>✕</text>
            )}
            {/* label below */}
            <text x={p.x} y={p.y + r + 14} textAnchor="middle" fontSize="9.5" fill="#f3ebda">{label}</text>
            <text x={p.x} y={p.y + r + 25} textAnchor="middle" fontSize="8" fill="#a59783">
              {a.subagentType}{a.tokens > 0 ? ` · ${(a.tokens / 1000).toFixed(1)}k` : ""}
            </text>
          </motion.g>
        );
      })}

      {n === 0 && (
        <text x={cx} y={cy + 60} textAnchor="middle" fontSize="12" fill="#a59783">
          {run.status === "running" ? "waiting for subagents to spawn…" : "single-pass run (no subagents spawned)"}
        </text>
      )}
    </svg>
  );
}

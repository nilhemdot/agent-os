"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Terminal, Brain, Globe, ChevronRight, ChevronDown,
  CheckCircle2, XCircle, Loader2, AlertTriangle, Hash,
} from "lucide-react";

// Renders a Codex goal log into structured event cards instead of raw JSONL.
//
// Input: the raw text we collect by appending stdout/stderr of `codex exec --json`.
//   - One JSON object per line for real Codex events (item.completed, etc.)
//   - `[stderr] …` prefixed lines for stuff the wrapper captured from stderr
//   - Anything else is plain text we render dimly
//
// We turn that into a vertical timeline of typed event cards. Long command
// outputs collapse by default. Stderr noise hides behind a toggle.

const ACCENT = "#22c55e";

type EvKind =
  | "agent_message"
  | "command_started"
  | "command_completed"
  | "reasoning"
  | "web_search"
  | "thread_started"
  | "turn_completed"
  | "stderr"
  | "raw";

interface Ev {
  i: number;
  kind: EvKind;
  // Specific payload — only the relevant subset for each kind
  text?: string;          // agent_message / reasoning / raw
  command?: string;       // command_*
  cwd?: string;
  output?: string;        // command_completed
  exitCode?: number | null;
  status?: string;        // command in_progress / completed / failed
  query?: string;         // web_search
  threadId?: string;      // thread_started
  tokens?: { input: number; output: number; reasoning?: number; cached?: number };
}

function parseLog(log: string): Ev[] {
  const lines = log.split(/\r?\n/);
  const out: Ev[] = [];
  // Track command starts so we can pair completed events with their started counterparts
  const runningCmdIds = new Map<string, number>(); // id -> index in `out`

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    // Server-wrapper stderr prefix
    if (trimmed.startsWith("[stderr]")) {
      out.push({ i, kind: "stderr", text: trimmed.replace(/^\[stderr\]\s*/, "") });
      return;
    }

    // Try JSON
    let j: unknown = null;
    try { j = JSON.parse(trimmed); }
    catch {
      out.push({ i, kind: "raw", text: trimmed });
      return;
    }

    if (!j || typeof j !== "object") {
      out.push({ i, kind: "raw", text: trimmed });
      return;
    }
    const obj = j as { type?: string; thread_id?: string; usage?: { input_tokens?: number; output_tokens?: number; reasoning_output_tokens?: number; cached_input_tokens?: number }; item?: { id?: string; type?: string; text?: string; command?: string; cwd?: string; aggregated_output?: string; exit_code?: number | null; status?: string; query?: string } };
    const t = obj.type;

    if (t === "thread.started") {
      out.push({ i, kind: "thread_started", threadId: typeof obj.thread_id === "string" ? obj.thread_id : "" });
    } else if (t === "turn.started") {
      // Skip — visually too quiet. We rely on agent messages to mark progress.
    } else if (t === "turn.completed") {
      const u = obj.usage ?? {};
      out.push({
        i, kind: "turn_completed",
        tokens: {
          input: u.input_tokens ?? 0,
          output: u.output_tokens ?? 0,
          reasoning: u.reasoning_output_tokens,
          cached: u.cached_input_tokens,
        },
      });
    } else if (t === "item.completed" || t === "item.started") {
      const it = obj.item ?? {};
      const itype = it.type;
      if (itype === "agent_message" && typeof it.text === "string" && it.text.trim()) {
        out.push({ i, kind: "agent_message", text: it.text });
      } else if (itype === "reasoning") {
        const txt = typeof it.text === "string" ? it.text : "";
        if (txt.trim()) out.push({ i, kind: "reasoning", text: txt });
      } else if (itype === "command_execution") {
        if (t === "item.started") {
          out.push({ i, kind: "command_started", command: it.command, cwd: it.cwd, status: it.status });
          if (it.id) runningCmdIds.set(it.id, out.length - 1);
        } else {
          // command_execution completed — if we have a matching started event, upgrade it
          const cmd = it.command ?? "";
          const output = it.aggregated_output ?? "";
          const exit = it.exit_code ?? null;
          // Decode JSON-encoded \n inside aggregated_output so it reads as real newlines
          const decodedOutput = output.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
          const startedAt = it.id ? runningCmdIds.get(it.id) : undefined;
          if (typeof startedAt === "number") {
            out[startedAt] = {
              ...out[startedAt],
              kind: "command_completed",
              command: cmd || out[startedAt].command,
              output: decodedOutput,
              exitCode: exit,
              status: it.status,
            };
            if (it.id) runningCmdIds.delete(it.id);
          } else {
            out.push({ i, kind: "command_completed", command: cmd, output: decodedOutput, exitCode: exit, status: it.status });
          }
        }
      } else if (itype === "web_search") {
        out.push({ i, kind: "web_search", query: typeof it.query === "string" ? it.query : "" });
      }
      // (other item.types like image_generation could be added here later)
    } else {
      // Unknown JSON event — keep but render quietly
      out.push({ i, kind: "raw", text: trimmed });
    }
  });

  return out;
}

// Truncate long output for the collapsed view + indicate if there's more
function clip(s: string, max = 400): { head: string; more: number } {
  if (s.length <= max) return { head: s, more: 0 };
  return { head: s.slice(0, max), more: s.length - max };
}

export default function GoalLogStream({ log, running }: { log: string; running: boolean }) {
  const events = useMemo(() => parseLog(log), [log]);
  const [showStderr, setShowStderr] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const stderrCount = events.filter((e) => e.kind === "stderr").length;
  const visible = events.filter((e) => showStderr || e.kind !== "stderr");

  function toggleExpanded(i: number) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i); else n.add(i);
      return n;
    });
  }

  if (events.length === 0) {
    return (
      <div className="text-[12px] text-[var(--cream-mute)] italic flex items-center gap-2">
        {running && <Loader2 size={12} className="animate-spin" />}
        {running ? "Codex is warming up…" : "No output yet."}
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {/* Top meta strip — counts + stderr toggle */}
      <div className="flex items-center justify-between text-[10px] uppercase tracking-widest" style={{ color: "var(--cream-mute)" }}>
        <span>{events.filter(e => e.kind !== "stderr" && e.kind !== "raw").length} events</span>
        {stderrCount > 0 && (
          <button onClick={() => setShowStderr((v) => !v)}
            className="flex items-center gap-1 hover:text-[var(--cream-dim)]">
            <AlertTriangle size={10} />
            {showStderr ? "Hide" : "Show"} {stderrCount} log line{stderrCount === 1 ? "" : "s"}
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {visible.map((e) => {
          switch (e.kind) {
            case "thread_started":
              return (
                <motion.div key={e.i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex items-center gap-2 text-[10px] tracking-widest uppercase"
                  style={{ color: "var(--cream-mute)" }}>
                  <Hash size={10} style={{ color: ACCENT }} />
                  <span>Session</span>
                  <span className="mono" style={{ color: "var(--cream-dim)" }}>{e.threadId?.slice(0, 12)}…</span>
                </motion.div>
              );

            case "agent_message":
              return (
                <motion.div key={e.i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                  className="rounded-md px-4 py-3 border"
                  style={{
                    background: "rgba(34,197,94,0.05)",
                    borderColor: "rgba(34,197,94,0.22)",
                  }}>
                  <div className="text-[10px] uppercase tracking-widest mb-1.5 flex items-center gap-1.5" style={{ color: ACCENT }}>
                    <Sparkles size={10} /> Codex
                  </div>
                  <div className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--cream)" }}>
                    {e.text}
                  </div>
                </motion.div>
              );

            case "reasoning":
              return (
                <motion.div key={e.i} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="rounded-md px-3 py-2 border"
                  style={{ background: "rgba(255,255,255,0.015)", borderColor: "var(--line-soft)" }}>
                  <div className="text-[10px] uppercase tracking-widest mb-1 flex items-center gap-1.5" style={{ color: "var(--cream-mute)" }}>
                    <Brain size={10} /> Thinking
                  </div>
                  <div className="text-[12px] italic leading-relaxed whitespace-pre-wrap" style={{ color: "var(--cream-soft)", opacity: 0.7 }}>
                    {e.text}
                  </div>
                </motion.div>
              );

            case "command_started":
              return (
                <motion.div key={e.i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                  className="rounded-md px-3 py-2 border flex items-center gap-2.5"
                  style={{ background: "rgba(212,165,116,0.04)", borderColor: "rgba(212,165,116,0.22)" }}>
                  <Loader2 size={13} className="animate-spin shrink-0" style={{ color: "var(--gold)" }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: "var(--gold)" }}>
                      Running command
                    </div>
                    <div className="text-[11.5px] mono truncate" style={{ color: "var(--cream-soft)" }}>
                      {(e.command ?? "").replace(/^\/bin\/(?:ba|z|fi|)sh\s+-l?c\s+["']?/, "").replace(/["']?$/, "")}
                    </div>
                  </div>
                </motion.div>
              );

            case "command_completed": {
              const ok = e.exitCode === 0 || e.exitCode == null;
              const out = e.output ?? "";
              const { head, more } = clip(out);
              const isOpen = expanded.has(e.i);
              const cmdClean = (e.command ?? "").replace(/^\/bin\/(?:ba|z|fi|)sh\s+-l?c\s+["']?/, "").replace(/["']?$/, "");
              return (
                <motion.div key={e.i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                  className="rounded-md border"
                  style={{ background: "rgba(255,255,255,0.018)", borderColor: ok ? "rgba(90,184,150,0.22)" : "rgba(196,96,126,0.28)" }}>
                  <button onClick={() => toggleExpanded(e.i)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left">
                    {ok
                      ? <CheckCircle2 size={13} style={{ color: "var(--emerald)" }} className="shrink-0" />
                      : <XCircle size={13} style={{ color: "var(--plum)" }} className="shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] uppercase tracking-widest mb-0.5 flex items-center gap-1.5"
                           style={{ color: ok ? "var(--emerald)" : "var(--plum)" }}>
                        <Terminal size={10} />
                        Command {ok ? "done" : `failed (exit ${e.exitCode})`}
                      </div>
                      <div className="text-[11.5px] mono truncate" style={{ color: "var(--cream-soft)" }}>
                        {cmdClean}
                      </div>
                    </div>
                    {out && (
                      isOpen
                        ? <ChevronDown size={12} style={{ color: "var(--cream-mute)" }} />
                        : <ChevronRight size={12} style={{ color: "var(--cream-mute)" }} />
                    )}
                  </button>
                  {out && (
                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden">
                          <div className="border-t px-3 py-2" style={{ borderColor: "var(--line-soft)" }}>
                            <pre className="text-[11px] leading-relaxed whitespace-pre-wrap mono max-h-[260px] overflow-y-auto scroll"
                                 style={{ color: "var(--cream-soft)" }}>
                              {out}
                            </pre>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  )}
                  {!isOpen && out && (
                    <div className="px-3 pb-2 text-[10.5px] mono truncate" style={{ color: "var(--cream-mute)" }}>
                      <span style={{ opacity: 0.65 }}>{head.split("\n")[0].slice(0, 110)}</span>
                      {more > 0 && <span className="ml-1" style={{ color: ACCENT, opacity: 0.8 }}>+{Math.round(more / 100) / 10}K more chars</span>}
                    </div>
                  )}
                </motion.div>
              );
            }

            case "web_search":
              return (
                <motion.div key={e.i} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="rounded-md px-3 py-2 border flex items-center gap-2"
                  style={{ background: "rgba(96,165,250,0.05)", borderColor: "rgba(96,165,250,0.22)" }}>
                  <Globe size={12} style={{ color: "var(--gold-soft)" }} />
                  <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--gold-soft)" }}>Web search</div>
                  <div className="text-[12px] italic" style={{ color: "var(--cream)" }}>&ldquo;{e.query}&rdquo;</div>
                </motion.div>
              );

            case "turn_completed": {
              const t = e.tokens ?? { input: 0, output: 0 };
              return (
                <motion.div key={e.i} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="flex items-center justify-end gap-3 text-[10px] tracking-widest"
                  style={{ color: "var(--cream-mute)" }}>
                  <span>{t.input.toLocaleString()} in</span>
                  <span>·</span>
                  <span>{t.output.toLocaleString()} out</span>
                  {t.reasoning ? <><span>·</span><span>{t.reasoning.toLocaleString()} reasoning</span></> : null}
                  {t.cached ? <><span>·</span><span>{t.cached.toLocaleString()} cached</span></> : null}
                </motion.div>
              );
            }

            case "stderr":
              return (
                <motion.div key={e.i} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="text-[10.5px] mono pl-3 border-l"
                  style={{ borderColor: "var(--line-soft)", color: "var(--cream-mute)", opacity: 0.65 }}>
                  {e.text}
                </motion.div>
              );

            case "raw":
            default:
              return (
                <motion.div key={e.i} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="text-[10.5px] mono whitespace-pre-wrap" style={{ color: "var(--cream-mute)", opacity: 0.5 }}>
                  {e.text}
                </motion.div>
              );
          }
        })}
      </AnimatePresence>

      {running && (
        <div className="flex items-center gap-2 text-[11px] pt-1" style={{ color: ACCENT }}>
          <Loader2 size={11} className="animate-spin" /> Working…
        </div>
      )}
    </div>
  );
}

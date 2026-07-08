"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Layers, Loader2, ExternalLink, RefreshCw, CornerDownLeft } from "lucide-react";

const CLAUDE = "#d97757";   // Claude Code terracotta
const EMERALD = "#34E5B0";  // GLM emerald
const TERM_LSK = "agentic-os/glm-code/terminal/v1"; // persisted scrollback

interface HistEntry { ts: number; prompt: string; project: string; ok: boolean; cost?: number; turns?: number; }

type Tab = "terminal" | "workspace";
interface Line {
  kind: "user" | "text" | "tool" | "tool_result" | "result" | "system" | "error" | "stderr" | "info";
  text?: string; name?: string; input?: Record<string, unknown>;
  cost?: number; turns?: number; ms?: number; model?: string; tools?: number; subtype?: string;
}
interface Build { project: string; mtime: number; fileCount: number; html: string[]; files: { rel: string; bytes: number }[]; }

const EXAMPLES = [
  "a Pomodoro timer with a weekly stats chart",
  "a markdown notes app with live preview",
  "a tip calculator with split-by-person",
];

function toolLine(s: Line): string {
  const inp = s.input || {};
  const f = (p: unknown) => String(p ?? "").split("/").pop() ?? "";
  if (s.name === "Write") return `Write(${f(inp.file_path)})`;
  if (s.name === "Edit" || s.name === "MultiEdit") return `Edit(${f(inp.file_path)})`;
  if (s.name === "Read") return `Read(${f(inp.file_path)})`;
  if (s.name === "Bash") return `Bash(${String(inp.command ?? "").slice(0, 48)})`;
  if (s.name === "TodoWrite") return `Update todos`;
  return `${s.name}(${Object.keys(inp)[0] ? String(Object.values(inp)[0]).slice(0, 40) : ""})`;
}

export default function GLMCodeView() {
  const [tab, setTab] = useState<Tab>("terminal");
  const [input, setInput] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [building, setBuilding] = useState(false);
  const [project, setProject] = useState<string | null>(null);
  const [ready, setReady] = useState<boolean | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const termRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hydrated = useRef(false);

  // persisted build history (durable, also logged to Obsidian) + saved scrollback
  const [history, setHistory] = useState<HistEntry[]>([]);
  const [obsidian, setObsidian] = useState<string | null>(null);
  const loadHistory = useCallback(async () => {
    try { const r = await fetch("/api/glm-code/history", { cache: "no-store" }); const j = await r.json(); setHistory(j.history ?? []); setObsidian(j.obsidian ?? null); } catch {}
  }, []);

  useEffect(() => {
    // restore the terminal scrollback so what you typed before is still here
    try { const raw = localStorage.getItem(TERM_LSK); if (raw) setLines(JSON.parse(raw).slice(-400)); } catch {}
    hydrated.current = true;
    loadHistory();
  }, [loadHistory]);
  // save scrollback on every change
  useEffect(() => { if (hydrated.current) try { localStorage.setItem(TERM_LSK, JSON.stringify(lines.slice(-400))); } catch {} }, [lines]);

  useEffect(() => {
    const ping = () => fetch("/api/glm-code/status", { cache: "no-store" }).then((r) => r.json()).then((j) => setReady(!!j.ready)).catch(() => setReady(false));
    ping(); const id = setInterval(ping, 8000); return () => clearInterval(id);
  }, []);
  useEffect(() => { if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight; }, [lines, building]);

  const [builds, setBuilds] = useState<Build[]>([]);
  const loadBuilds = useCallback(async () => {
    try { const r = await fetch("/api/glm-code/workspace", { cache: "no-store" }); const j = await r.json(); setBuilds(j.builds ?? []); } catch {}
  }, []);
  useEffect(() => { loadBuilds(); }, [loadBuilds]);

  const build = useCallback(async (text?: string) => {
    const p = (text ?? input).trim();
    if (!p || building) return;
    setInput("");
    setLines((l) => [...l, { kind: "user", text: p }]);
    setBuilding(true); setProject(null);
    const ctrl = new AbortController(); ctrlRef.current = ctrl;
    try {
      const r = await fetch("/api/glm-code/build", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: p }), signal: ctrl.signal,
      });
      const reader = r.body?.getReader(); const dec = new TextDecoder(); let buf = "";
      while (reader) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const ln = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (!ln.trim()) continue;
          let e: Line & { type?: string; project?: string };
          try { e = JSON.parse(ln); } catch { continue; }
          const type = (e as { type?: string }).type;
          if (type === "start") setProject(e.project ?? null);
          else if (type === "system") setLines((l) => [...l, { kind: "system", model: e.model, tools: e.tools }]);
          else if (type === "text") setLines((l) => [...l, { kind: "text", text: e.text }]);
          else if (type === "tool") setLines((l) => [...l, { kind: "tool", name: e.name, input: e.input }]);
          else if (type === "tool_result") setLines((l) => [...l, { kind: "tool_result", text: e.text }]);
          else if (type === "result") setLines((l) => [...l, { kind: "result", subtype: e.subtype, cost: e.cost, turns: e.turns, ms: e.ms }]);
          else if (type === "stderr") setLines((l) => [...l, { kind: "stderr", text: e.text }]);
          else if (type === "error") setLines((l) => [...l, { kind: "error", text: e.text }]);
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setLines((l) => [...l, { kind: "error", text: String(err).slice(0, 160) }]);
    }
    setBuilding(false); loadBuilds(); loadHistory();
  }, [input, building, loadBuilds, loadHistory]);

  function stop() { ctrlRef.current?.abort(); setBuilding(false); setLines((l) => [...l, { kind: "info", text: "⎿ Interrupted." }]); }
  function clearTerm() { setLines([]); try { localStorage.removeItem(TERM_LSK); } catch {} }

  const currentBuild = builds.find((b) => b.project === project);
  const currentHtml = currentBuild?.html?.[0];
  const previewUrl = (proj: string, file: string) => `/api/glm-code/preview/${proj}/${file.split("/").map(encodeURIComponent).join("/")}`;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* header */}
      <div className="flex items-center gap-3 mb-3 shrink-0 flex-wrap">
        <div className="w-8 h-8 rounded-lg grid place-items-center text-[#1a0f0a] font-bold" style={{ background: `linear-gradient(135deg,${CLAUDE},${EMERALD})` }}>✻</div>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-[var(--cream)] leading-none flex items-center gap-2">
            GLM Code
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: `${EMERALD}1e`, color: EMERALD, border: `1px solid ${EMERALD}40` }}>
              {ready == null ? <Loader2 size={9} className="animate-spin" /> : <span className="w-1.5 h-1.5 rounded-full" style={{ background: ready ? EMERALD : "#e8728a" }} />}
              {ready == null ? "checking" : ready ? "Ollama Cloud ready" : "Ollama offline"}
            </span>
          </div>
          <div className="text-[10.5px] text-[var(--cream-mute)] mt-1">Claude Code, running on <b style={{ color: EMERALD }}>glm-5.2:cloud</b> · xhigh effort · Ollama Cloud</div>
        </div>
        <div className="ml-auto flex gap-1.5">
          {([{ k: "terminal", label: "Terminal" }, { k: "workspace", label: "Workspace" }] as const).map((t) => (
            <button key={t.k} onClick={() => { setTab(t.k); if (t.k === "workspace") loadBuilds(); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border transition"
              style={{ borderColor: tab === t.k ? CLAUDE : "var(--line-soft)", background: tab === t.k ? `${CLAUDE}1e` : "transparent", color: tab === t.k ? CLAUDE : "var(--cream-dim)" }}>
              {t.label}{t.k === "workspace" && builds.length ? ` · ${builds.length}` : ""}
            </button>
          ))}
        </div>
      </div>

      {/* ── TERMINAL ── */}
      {tab === "terminal" && (
        <div className="flex flex-col min-h-0 flex-1 rounded-xl overflow-hidden border" style={{ borderColor: "var(--line-soft)", background: "#0d0a12" }}>
          {/* title bar */}
          <div className="flex items-center gap-2 px-3.5 py-2 border-b shrink-0" style={{ borderColor: "#221a2c", background: "#120e18" }}>
            <span className="flex gap-1.5"><i className="w-3 h-3 rounded-full inline-block" style={{ background: "#ff5f57" }} /><i className="w-3 h-3 rounded-full inline-block" style={{ background: "#febc2e" }} /><i className="w-3 h-3 rounded-full inline-block" style={{ background: "#28c840" }} /></span>
            <span className="text-[11px] text-[var(--cream-mute)] mono ml-1">glm-code — claude — ~/.agentic-os/glm-code</span>
            {lines.length > 0 && <button onClick={clearTerm} className="ml-auto mono text-[10px] text-[var(--cream-mute)] hover:text-[var(--cream)]">clear</button>}
          </div>

          {/* scrollback */}
          <div ref={termRef} onClick={() => inputRef.current?.focus()} className="flex-1 min-h-0 overflow-y-auto scroll px-4 py-3 mono text-[12.5px] leading-[1.7] cursor-text" style={{ color: "#cdbfd0" }}>
            {/* welcome banner */}
            <div className="rounded-lg border px-4 py-3 mb-3" style={{ borderColor: "#2c2236", background: "#140f1c" }}>
              <div style={{ color: CLAUDE }}>✻ Welcome back!</div>
              <div className="mt-2 whitespace-pre" style={{ color: "#8a7e90" }}>{`   ▝▘  `}<span style={{ color: CLAUDE }}>Claude Code</span>{`  v2.1.195`}</div>
              <div className="mt-2" style={{ color: "#8a7e90" }}>  model: <span style={{ color: EMERALD }}>glm-5.2:cloud</span> with <span style={{ color: "var(--cream)" }}>xhigh effort</span> · Ollama Cloud billing</div>
              <div style={{ color: "#8a7e90" }}>  cwd:   ~/.agentic-os/glm-code</div>
              {obsidian && <div style={{ color: "#8a7e90" }}>  log:   <span style={{ color: EMERALD }}>↪ Obsidian</span> · {obsidian.replace(/^.*\/Obsidian Vault\//, "")}</div>}
              <div style={{ color: "#6f6577" }}>  history saved — your session + every build persist here</div>
            </div>

            {lines.length === 0 && (
              <div className="mb-2" style={{ color: "#8a7e90" }}>
                <div style={{ color: "var(--cream)" }}>Tips for getting started</div>
                <div>1. Just type what you want built and press <span style={{ color: CLAUDE }}>Enter</span> — it writes the files itself.</div>
                <div>2. It runs the real Claude Code tool loop (Write, Edit, Bash) on GLM-5.2.</div>
                <div>3. Every project lands in the <span style={{ color: CLAUDE }}>Workspace</span> tab, with a live preview.</div>
                <div className="mt-2" style={{ color: "var(--cream)" }}>What&apos;s new</div>
                <div>★ Claude Code&apos;s agentic harness now runs on GLM-5.2 — 1M context, a fraction of the cost.</div>
                {history.length > 0 && (
                  <div className="mt-3">
                    <div style={{ color: "var(--cream)" }}>Recent builds <span style={{ color: "#6f6577" }}>(saved + logged to Obsidian)</span></div>
                    {history.slice(0, 6).map((h, i) => (
                      <div key={i} className="truncate">{h.ok ? "✅" : "⚠️"} <span style={{ color: CLAUDE }}>{h.project}</span> · {h.turns ?? "—"} turns · ${Number(h.cost ?? 0).toFixed(2)} — <span style={{ color: "#6f6577" }}>{h.prompt.slice(0, 64)}</span></div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {lines.map((s, i) => {
              if (s.kind === "user") return <div key={i} className="mt-2"><span style={{ color: CLAUDE }}>&gt; </span><span style={{ color: "var(--cream)" }}>{s.text}</span></div>;
              if (s.kind === "system") return <div key={i} style={{ color: "#6f6577" }}>⎿ booted · {s.tools} tools · {s.model}</div>;
              if (s.kind === "text") return <div key={i} className="whitespace-pre-wrap" style={{ color: "#cdbfd0" }}><span style={{ color: CLAUDE }}>● </span>{s.text}</div>;
              if (s.kind === "tool") return <div key={i} style={{ color: "var(--cream)" }}><span style={{ color: EMERALD }}>● </span>{toolLine(s)}</div>;
              if (s.kind === "tool_result") return <div key={i} className="truncate" style={{ color: "#6f6577" }}>  ⎿ {s.text}</div>;
              if (s.kind === "result") return <div key={i} className="mt-1" style={{ color: s.subtype === "success" ? EMERALD : "#e8728a" }}>⎿ {s.subtype === "success" ? "Done" : s.subtype} · {s.turns} turns · ${Number(s.cost ?? 0).toFixed(3)} · {Math.round((s.ms ?? 0) / 1000)}s</div>;
              if (s.kind === "info") return <div key={i} style={{ color: "#6f6577" }}>{s.text}</div>;
              if (s.kind === "stderr") return <div key={i} className="truncate" style={{ color: "#6f6577", opacity: .7 }}>{s.text}</div>;
              if (s.kind === "error") return <div key={i} style={{ color: "#e8728a" }}>⎿ {s.text}</div>;
              return null;
            })}

            {building && <div className="inline-flex items-center gap-2 mt-1" style={{ color: CLAUDE }}><Loader2 size={12} className="animate-spin" /> <span style={{ color: "#8a7e90" }}>working…</span></div>}

            {currentBuild && currentHtml && !building && (
              <div className="mt-1"><a href={previewUrl(currentBuild.project, currentHtml)} target="_blank" rel="noopener" style={{ color: EMERALD }}>  ⎿ open {currentHtml} ↗</a></div>
            )}
          </div>

          {/* prompt input */}
          <div className="border-t px-3.5 py-2.5 shrink-0 flex items-center gap-2" style={{ borderColor: "#221a2c", background: "#120e18" }}>
            <span className="mono text-[13px]" style={{ color: building ? "#6f6577" : CLAUDE }}>&gt;</span>
            <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} disabled={building}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); build(); } }}
              placeholder={building ? "building… (esc to stop)" : "tell Claude Code what to build…"}
              className="flex-1 bg-transparent mono text-[13px] focus:outline-none disabled:opacity-60" style={{ color: "var(--cream)" }} />
            {building
              ? <button onClick={stop} className="mono text-[11px] px-2 py-1 rounded border" style={{ borderColor: "#e8728a55", color: "#e8728a" }}>esc</button>
              : <button onClick={() => build()} disabled={!input.trim() || ready === false} className="inline-flex items-center gap-1 mono text-[11px] px-2 py-1 rounded border disabled:opacity-30" style={{ borderColor: `${CLAUDE}55`, color: CLAUDE }}><CornerDownLeft size={11} /> run</button>}
          </div>
          {/* examples / shortcuts */}
          <div className="px-3.5 pb-2.5 shrink-0 flex items-center gap-2 flex-wrap" style={{ background: "#120e18" }}>
            <span className="mono text-[10px]" style={{ color: "#6f6577" }}>? try:</span>
            {EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => build(ex)} disabled={building} className="mono text-[10px] px-2 py-0.5 rounded-full border disabled:opacity-40 transition" style={{ borderColor: "var(--line-soft)", color: "var(--cream-dim)" }}>{ex}</button>
            ))}
          </div>
        </div>
      )}

      {/* ── WORKSPACE ── */}
      {tab === "workspace" && (
        <div className="panel p-0 flex flex-col min-h-0 flex-1 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--line-soft)] shrink-0">
            <Layers size={14} style={{ color: EMERALD }} />
            <span className="text-[12.5px] text-[var(--cream)] font-medium">GLM Code builds</span>
            <span className="text-[10.5px] text-[var(--cream-mute)]">{builds.length} project{builds.length === 1 ? "" : "s"} · saved on your Mac</span>
            <button onClick={loadBuilds} className="ml-auto p-1.5 rounded-lg border border-[var(--line-soft)] text-[var(--cream-mute)] hover:text-[var(--cream)]"><RefreshCw size={12} /></button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto scroll p-3">
            {builds.length === 0 ? (
              <div className="h-full grid place-items-center text-center"><div className="text-[11.5px] text-[var(--cream-mute)] max-w-[320px]">No builds yet. Type a goal in the Terminal and Claude Code (on GLM-5.2) builds it — every project lands here.</div></div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {builds.map((b) => (
                  <div key={b.project} className="rounded-xl border border-[var(--line-soft)] overflow-hidden bg-[var(--bg-card)] hover:border-[#d9775755] transition">
                    {b.html[0]
                      ? <iframe src={previewUrl(b.project, b.html[0])} title={b.project} loading="lazy" sandbox="allow-scripts allow-same-origin allow-popups" className="w-full bg-black border-0" style={{ aspectRatio: "16/10" }} />
                      : <div className="w-full grid place-items-center text-[var(--cream-mute)] text-[11px] bg-[#06120f]" style={{ aspectRatio: "16/10" }}>{b.fileCount} file{b.fileCount === 1 ? "" : "s"} · no html</div>}
                    <div className="p-2.5">
                      <div className="text-[12px] font-medium text-[var(--cream)] truncate mono">{b.project}</div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[9.5px] text-[var(--cream-mute)]">{b.fileCount} file{b.fileCount === 1 ? "" : "s"}</span>
                        {b.html[0] && <a href={previewUrl(b.project, b.html[0])} target="_blank" rel="noopener" className="ml-auto text-[9.5px] inline-flex items-center gap-1" style={{ color: EMERALD }}><ExternalLink size={9} /> open</a>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare, Target, ListChecks, Layers,
  Send, Square, Play, Trash2, RefreshCw, FolderOpen, FileText,
  Copy, Download, X, Eye, ExternalLink, FilePlus,
} from "lucide-react";
import GoalLogStream from "./GoalLogStream";

// Codex agent surface — four tabs (same shape as Antigravity):
//   Chat       — one-shot streaming via /api/codex/chat
//   Goal Mode  — long-running goals tracked in ~/.agentic-os/codex-goals.json
//   Sessions   — past Codex sessions (read from ~/.codex/session_index.jsonl)
//   Workspace  — artefacts created by goals (text/image/video/audio/HTML preview)

type Tab = "chat" | "goal" | "sessions" | "workspace";

interface CodexSession { id: string; threadName: string; updatedAt: number; }
interface Goal {
  id: string;
  title: string;
  prompt: string;
  status: "queued" | "running" | "completed" | "failed" | "stopped";
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  pid?: number;
  cwd: string;
  lastOutput?: string;
  logFile: string;
  exitCode?: number | null;
}
interface CdxProject { name: string; root: string; mtime: number; fileCount: number; }
type CdxFileKind = "text" | "image" | "video" | "audio" | "pdf" | "binary";
interface CdxFile { name: string; relPath: string; bytes: number; mtime: number; kind: CdxFileKind; }
interface Msg { role: "user" | "assistant" | "system"; text: string; }

// ── Session detail types (returned from /api/codex/session) ──
interface SessionTurn { role: "user" | "assistant" | "reasoning"; text: string; ts?: number; }
interface SessionToolCall { name: string; args: string; output?: string; }
interface SessionDetail {
  id: string;
  threadName: string;
  cwd: string;
  cwdExists: boolean;
  startedAt: number;
  model: string | null;
  turns: SessionTurn[];
  toolCalls: SessionToolCall[];
  referencedFiles: string[];
  cwdFiles: CdxFile[];
}

// Convert an absolute path under $HOME into the path-segment list our session-file
// endpoint expects. Returns null when the file isn't under HOME (we never serve those).
function sessionFileUrl(absPath: string, home: string): string | null {
  if (!absPath || !absPath.startsWith(home + "/")) return null;
  const rel = absPath.slice(home.length + 1);
  return `/api/codex/session-file/${rel.split("/").map(encodeURIComponent).join("/")}`;
}
function kindFromExt(name: string): CdxFileKind {
  const e = (name.split(".").pop() || "").toLowerCase();
  if (["png","jpg","jpeg","webp","gif","svg","avif"].includes(e)) return "image";
  if (["mp4","webm","mov","m4v","mkv"].includes(e)) return "video";
  if (["mp3","wav","m4a","ogg","aac","flac"].includes(e)) return "audio";
  if (e === "pdf") return "pdf";
  if (["html","htm","css","js","jsx","ts","tsx","json","md","txt","csv","py","sh"].includes(e)) return "text";
  return "binary";
}

const ACCENT = "#22c55e";
const STORAGE_KEY = "agentic-os/codex/history/v1";
const ACTIVE_PROJECT_KEY = "agentic-os/codex/active-project/v1";

function fmtAgo(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}
function statusColor(s: Goal["status"]): string {
  if (s === "running") return "var(--gold)";
  if (s === "completed") return "var(--emerald)";
  if (s === "failed") return "var(--plum)";
  return "var(--cream-mute)";
}

export default function CodexView() {
  const [tab, setTab] = useState<Tab>("chat");

  // ─── Chat state ───
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [partial, setPartial] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const ctrlRef = useRef<AbortController | null>(null);

  // How Codex handles approvals. It runs headlessly (`codex exec`), so it can't
  // show a terminal popup — pick the policy up front. Persisted across sessions.
  const [approvalMode, setApprovalMode] = useState<"auto" | "readonly" | "yolo">("auto");
  useEffect(() => {
    try { const v = window.localStorage.getItem("codex-approval-mode"); if (v === "auto" || v === "readonly" || v === "yolo") setApprovalMode(v); } catch {}
  }, []);
  function changeApprovalMode(v: "auto" | "readonly" | "yolo") {
    setApprovalMode(v);
    try { window.localStorage.setItem("codex-approval-mode", v); } catch {}
  }
  const scrollRef = useRef<HTMLDivElement>(null);

  // ─── Goal state ───
  const [goals, setGoals] = useState<Goal[]>([]);
  const [goalTitle, setGoalTitle] = useState("");
  const [goalPrompt, setGoalPrompt] = useState("");
  const [openGoalId, setOpenGoalId] = useState<string | null>(null);
  const [openGoalLog, setOpenGoalLog] = useState<string>("");

  // ─── Sessions state ───
  const [sessions, setSessions] = useState<CodexSession[]>([]);
  const [openSession, setOpenSession] = useState<SessionDetail | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionFile, setSessionFile] = useState<{ absPath: string; url: string | null; kind: CdxFileKind } | null>(null);
  // Server $HOME is needed to convert absolute paths → preview URLs. Cached on first use.
  const [homeDir, setHomeDir] = useState<string>("");

  // ─── Workspace state ───
  const [projects, setProjects] = useState<CdxProject[]>([]);
  const [selected, setSelected] = useState<CdxProject | null>(null);
  const [files, setFiles] = useState<CdxFile[]>([]);
  const [open, setOpen] = useState<{ path: string; content: string; bytes: number; truncated: boolean; kind: CdxFileKind } | null>(null);
  const [htmlMode, setHtmlMode] = useState<"source" | "preview">("preview");
  const [newProjectName, setNewProjectName] = useState("");

  // Active project — every chat (and every codex spawn) lands here.
  const [activeProject, setActiveProject] = useState<string>("codex-default");
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const p = window.localStorage.getItem(ACTIVE_PROJECT_KEY);
      if (p) setActiveProject(p);
    } catch {}
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(ACTIVE_PROJECT_KEY, activeProject); } catch {}
  }, [activeProject]);

  // Restore chat history
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setMsgs(JSON.parse(raw).slice(-200));
    } catch {}
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-200))); } catch {}
  }, [msgs]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, partial]);

  useEffect(() => {
    if (!streaming) { setElapsed(0); return; }
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 250);
    return () => clearInterval(t);
  }, [streaming]);

  // ─── API loaders ───
  async function refreshGoals() {
    try {
      const r = await fetch("/api/codex/goals", { cache: "no-store" });
      const j = await r.json();
      setGoals(Array.isArray(j.goals) ? j.goals : []);
    } catch {}
  }
  async function refreshSessions() {
    try {
      const r = await fetch("/api/codex/sessions?limit=80", { cache: "no-store" });
      const j = await r.json();
      setSessions(Array.isArray(j.sessions) ? j.sessions : []);
    } catch {}
  }

  // Open a session — fetch its full transcript + cwd file listing.
  async function openSessionById(id: string) {
    setSessionLoading(true);
    setOpenSession(null);
    setSessionFile(null);
    try {
      const r = await fetch(`/api/codex/session?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const j = await r.json();
      if (j.session) {
        setOpenSession(j.session);
        // Infer $HOME from the cwd (first 3 segments: /Users/<user>)
        if (j.session.cwd && !homeDir) {
          const m = /^(\/(?:Users|home)\/[^/]+)(?:\/|$)/.exec(j.session.cwd);
          if (m) setHomeDir(m[1]);
        }
      }
    } catch {}
    setSessionLoading(false);
  }
  function openSessionFile(absPath: string) {
    if (!homeDir) return;
    const url = sessionFileUrl(absPath, homeDir);
    if (!url) return;
    setSessionFile({ absPath, url, kind: kindFromExt(absPath) });
  }
  async function refreshProjects() {
    try {
      const r = await fetch("/api/codex/workspace", { cache: "no-store" });
      const j = await r.json();
      setProjects(Array.isArray(j.projects) ? j.projects : []);
    } catch {}
  }
  useEffect(() => { refreshGoals(); refreshSessions(); refreshProjects(); }, []);
  // Live-poll the active tab so the user sees status updates on goals
  useEffect(() => {
    if (tab === "goal") {
      const t = setInterval(refreshGoals, 4000);
      return () => clearInterval(t);
    }
    if (tab === "workspace") {
      const t = setInterval(refreshProjects, 5000);
      return () => clearInterval(t);
    }
  }, [tab]);

  // ─── Chat: send ───
  async function sendChat() {
    const prompt = input.trim();
    if (!prompt || streaming) return;
    const history = msgs;
    setMsgs((m) => [...m, { role: "user", text: prompt }]);
    setInput("");
    setPartial("");
    setStreaming(true);

    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    let acc = "";
    let sawDeltas = false;

    try {
      const r = await fetch("/api/codex/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, history, project: activeProject, approvalMode }),
        signal: ctrl.signal,
      });
      if (!r.body) throw new Error("no body");
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);
            // Real codex --json event shapes (verified by probing the CLI):
            //   { type: "thread.started", thread_id }
            //   { type: "turn.started" }
            //   { type: "item.completed", item: { type: "agent_message" | "reasoning" | "command_execution" | ..., text } }
            //   { type: "item.started" / "item.delta",  item: { text?, delta? } } — for streaming variants
            //   { type: "turn.completed", usage: { input_tokens, output_tokens, ... } }
            //   { type: "stderr", text }  — our wrapper appends these from child.stderr
            //   { type: "done", code }    — our wrapper appends this on close
            const item = evt.item;
            if (evt.type === "item.delta" && item?.type === "agent_message" && typeof item.delta === "string") {
              sawDeltas = true; acc += item.delta; setPartial(acc);
            } else if (evt.type === "item.completed" && item?.type === "agent_message" && typeof item.text === "string") {
              // Codex emits the whole assistant message at once in item.completed.
              // If no deltas have arrived, this IS our answer.
              if (!sawDeltas) { acc = item.text; setPartial(acc); }
            } else if (evt.type === "item.completed" && item?.type === "reasoning" && typeof item.text === "string") {
              // Optional: surface reasoning as a faint preamble. Skip for now to keep replies clean.
            } else if (evt.type === "error" && evt.message) {
              acc += `\n[error: ${evt.message}]`;
            } else if (evt.type === "stderr" && /error/i.test(evt.text ?? "")) {
              // Most stderr is noise (skill loading warnings); only surface real errors.
              if (/failed|panic|cannot/i.test(evt.text)) acc += `\n[codex stderr] ${evt.text.trim()}`;
            }
          } catch { /* skip non-JSON */ }
        }
      }
    } catch (e) { acc += `\n\n[error: ${String(e)}]`; }

    setMsgs((m) => [...m, { role: "assistant", text: acc || "(no output)" }]);
    setPartial(""); setStreaming(false);
    // Refresh project list — Codex may have written files into the active project
    refreshProjects();
  }
  function stopChat() { ctrlRef.current?.abort(); setStreaming(false); }
  function clearChat() {
    if (streaming) return;
    setMsgs([]); setPartial("");
    if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
  }

  // ─── Goals: create / stop / delete / open log ───
  async function createGoal() {
    const title = goalTitle.trim() || goalPrompt.split("\n")[0].slice(0, 80);
    const prompt = goalPrompt.trim();
    if (!prompt) return;
    setGoalTitle(""); setGoalPrompt("");
    await fetch("/api/codex/goals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, prompt, approvalMode }),
    });
    refreshGoals();
  }
  async function stopGoal(id: string) {
    await fetch(`/api/codex/goals?id=${encodeURIComponent(id)}&action=stop`, { method: "PATCH" });
    refreshGoals();
  }
  async function deleteGoal(id: string) {
    await fetch(`/api/codex/goals?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (openGoalId === id) { setOpenGoalId(null); setOpenGoalLog(""); }
    refreshGoals();
  }
  async function openGoal(id: string) {
    setOpenGoalId(id);
    try {
      const r = await fetch(`/api/codex/goals?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const j = await r.json();
      setOpenGoalLog(j.log ?? "");
    } catch { setOpenGoalLog(""); }
  }
  // Live-tail the open goal's log while it's running
  useEffect(() => {
    if (!openGoalId) return;
    const goal = goals.find((g) => g.id === openGoalId);
    if (!goal || goal.status !== "running") return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/codex/goals?id=${encodeURIComponent(openGoalId)}`, { cache: "no-store" });
        const j = await r.json();
        setOpenGoalLog(j.log ?? "");
      } catch {}
    }, 2500);
    return () => clearInterval(t);
  }, [openGoalId, goals]);

  // ─── Workspace: create / select project + open file ───
  async function createProject() {
    const name = newProjectName.trim();
    if (!name) return;
    setNewProjectName("");
    try {
      const r = await fetch("/api/codex/workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const j = await r.json();
      if (j.name) {
        setActiveProject(j.name);
        await refreshProjects();
      }
    } catch {}
  }

  async function selectProject(p: CdxProject) {
    setSelected(p); setOpen(null);
    try {
      const r = await fetch(`/api/codex/workspace?project=${encodeURIComponent(p.name)}`, { cache: "no-store" });
      const j = await r.json();
      setFiles(j.files ?? []);
    } catch { setFiles([]); }
  }
  async function loadFile(f: CdxFile) {
    if (!selected) return;
    if (f.kind !== "text") {
      setOpen({ path: f.relPath, content: "", bytes: f.bytes, truncated: false, kind: f.kind });
      return;
    }
    try {
      const r = await fetch(`/api/codex/workspace/file?project=${encodeURIComponent(selected.name)}&path=${encodeURIComponent(f.relPath)}`, { cache: "no-store" });
      const j = await r.json();
      if (j.content !== undefined) setOpen({ path: f.relPath, content: j.content, bytes: j.bytes, truncated: j.truncated, kind: "text" });
    } catch {}
  }
  function rawUrl(relPath: string): string {
    if (!selected) return "";
    const segs = relPath.split("/").map(encodeURIComponent).join("/");
    return `/api/codex/preview/${encodeURIComponent(selected.name)}/${segs}`;
  }

  // ─── Tabs ───
  const tabs: { key: Tab; label: string; icon: React.ReactNode; count?: number }[] = useMemo(() => [
    { key: "chat",      label: "Chat",      icon: <MessageSquare size={12} /> },
    { key: "goal",      label: "Goal Mode", icon: <Target size={12} />, count: goals.filter(g => g.status === "running").length || undefined },
    { key: "sessions",  label: "Sessions",  icon: <ListChecks size={12} />, count: sessions.length || undefined },
    { key: "workspace", label: "Workspace", icon: <Layers size={12} />, count: projects.length || undefined },
  ], [goals, sessions, projects]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Tab bar + active-project pill */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex gap-2">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border transition text-[11px] uppercase tracking-[0.18em]"
              style={{
                borderColor: tab === t.key ? ACCENT : "var(--line-soft)",
                background: tab === t.key ? `${ACCENT}1e` : "transparent",
                color: tab === t.key ? ACCENT : "var(--cream-dim)",
                fontFamily: "'Manrope', sans-serif",
                fontWeight: 600,
              }}>
              {t.icon}{t.label}
              {t.count !== undefined && (
                <span className="hand text-[1.05rem] ml-1" style={{ color: ACCENT }}>{t.count}</span>
              )}
            </button>
          ))}
        </div>
        <span className="pill" title="Active scratch project — Codex chats write files here"
              style={{ background: `${ACCENT}18`, borderColor: `${ACCENT}40`, color: ACCENT }}>
          <FolderOpen size={10} className="inline mr-1" />{activeProject}
        </span>
      </div>

      <div className="flex-1 min-h-0 surface-card p-0 overflow-hidden flex flex-col" style={{ borderColor: `${ACCENT}30` }}>
        {/* ─── CHAT TAB ─── */}
        {tab === "chat" && (
          <>
            <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: "var(--line-soft)" }}>
              <div className="flex items-center gap-2">
                <span className="action-tag" style={{ color: ACCENT }}>Codex · Direct</span>
                <span className="pill" style={{ color: ACCENT, borderColor: `${ACCENT}30`, background: `${ACCENT}0c` }}>codex exec --json</span>
              </div>
              {msgs.length > 0 && !streaming && (
                <button onClick={clearChat} className="text-[11px] flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[rgba(255,255,255,0.04)]" style={{ color: "var(--cream-mute)" }}>
                  <Trash2 size={11} /> clear
                </button>
              )}
            </div>
            <div ref={scrollRef} className="scroll flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
              <AnimatePresence initial={false}>
                {msgs.length === 0 && !streaming && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[var(--cream-soft)] text-sm leading-relaxed">
                    <p className="text-base text-[var(--cream)]">Codex — single-shot chat.</p>
                    <p className="mt-2">Every send runs <code className="mono text-[var(--cream)]">codex exec --json</code> against your default Codex profile.</p>
                    <ul className="mt-3 text-xs text-[var(--cream-mute)] space-y-1">
                      <li>• Multi-turn memory: prior conversation packed into each new prompt</li>
                      <li>• Same auth + model as your terminal codex</li>
                      <li>• For long-running work, switch to <strong>Goal Mode</strong></li>
                      <li>• Esc to abort an in-flight call</li>
                    </ul>
                  </motion.div>
                )}
                {msgs.map((m, i) => (
                  <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                    className={`rounded-xl px-4 py-3 text-sm leading-relaxed border ${
                      m.role === "user"
                        ? "bg-[rgba(34,197,94,0.06)] border-[rgba(34,197,94,0.22)] text-[var(--cream)]"
                        : "bg-[rgba(255,255,255,0.02)] border-[rgba(255,255,255,0.06)] text-[var(--cream)]"
                    }`}>
                    <div className="text-[10px] tracking-widest uppercase mb-1 opacity-60">{m.role === "user" ? "you" : "codex"}</div>
                    <div className="whitespace-pre-wrap font-[var(--font-geist-mono)]">{m.text}</div>
                  </motion.div>
                ))}
                {streaming && (
                  <motion.div key="partial" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="rounded-xl px-4 py-3 text-sm leading-relaxed border bg-[rgba(255,255,255,0.02)] border-[rgba(255,255,255,0.06)]">
                    <div className="text-[10px] tracking-widest uppercase mb-1 opacity-60 flex items-center gap-2">
                      codex
                      <span className="inline-flex">
                        <span className="tick live" style={{ color: ACCENT }} />
                        <span className="tick live" style={{ color: ACCENT, animationDelay: ".2s" }} />
                        <span className="tick live" style={{ color: ACCENT, animationDelay: ".4s" }} />
                      </span>
                      <span className="text-emerald-400/70 normal-case tracking-normal metric">{elapsed}s</span>
                    </div>
                    <div className="whitespace-pre-wrap font-[var(--font-geist-mono)]">{partial || "thinking…"}</div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div className="border-t p-2 flex items-end gap-2" style={{ borderColor: "var(--line-soft)" }}>
              <select value={approvalMode} onChange={(e) => changeApprovalMode(e.target.value as "auto" | "readonly" | "yolo")}
                title="How Codex handles approvals. It runs headlessly, so it can't show a popup — Auto-approve keeps it sandboxed to the workspace; Ask (read-only) lets it plan but never write; YOLO removes the sandbox entirely."
                className="self-stretch bg-transparent border rounded-lg px-2 text-xs text-[var(--cream-mute)] outline-none cursor-pointer"
                style={{ borderColor: "var(--line-soft)" }}>
                <option value="auto">✅ Auto-approve</option>
                <option value="readonly">👀 Ask (read-only)</option>
                <option value="yolo">🚀 YOLO</option>
              </select>
              <textarea value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendChat(); }
                  if (e.key === "Escape" && streaming) stopChat();
                }}
                rows={2}
                placeholder="Ask Codex…  (⌘+Enter to send)"
                className="flex-1 bg-transparent outline-none resize-none px-3 py-2 text-sm text-[var(--cream)] placeholder:text-[var(--cream-mute)]" />
              {streaming ? (
                <button onClick={stopChat}
                  className="px-3 py-2 rounded-lg bg-[rgba(248,113,113,0.15)] border border-[rgba(248,113,113,0.4)] text-rose-300 text-sm flex items-center gap-1.5 hover:bg-[rgba(248,113,113,0.22)]">
                  <Square size={14} /> Stop
                </button>
              ) : (
                <button onClick={sendChat} disabled={!input.trim()}
                  className="px-3 py-2 rounded-lg text-sm flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  style={{ background: `${ACCENT}28`, border: `1px solid ${ACCENT}66`, color: ACCENT }}>
                  <Send size={14} /> Send
                </button>
              )}
            </div>
          </>
        )}

        {/* ─── GOAL MODE TAB ─── */}
        {tab === "goal" && (
          <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-0 h-full min-h-0">
            <aside className="border-r p-4 space-y-3 overflow-y-auto scroll" style={{ borderColor: "var(--line-soft)" }}>
              <div>
                <div className="action-tag mb-2" style={{ color: ACCENT }}>New goal</div>
                <input value={goalTitle} onChange={(e) => setGoalTitle(e.target.value)}
                  placeholder="Title (optional)"
                  className="w-full bg-transparent border rounded-md px-3 py-2 text-sm text-[var(--cream)] outline-none mb-2"
                  style={{ borderColor: "var(--line-soft)" }} />
                <textarea value={goalPrompt} onChange={(e) => setGoalPrompt(e.target.value)}
                  rows={6}
                  placeholder="What should Codex achieve? Be specific. It runs auto-approved in a dedicated scratch dir until the goal is met or stopped."
                  className="w-full bg-transparent border rounded-md px-3 py-2 text-sm text-[var(--cream)] outline-none mb-2"
                  style={{ borderColor: "var(--line-soft)" }} />
                <select value={approvalMode} onChange={(e) => changeApprovalMode(e.target.value as "auto" | "readonly" | "yolo")}
                  title="How Codex handles approvals during the goal run. Auto-approve stays sandboxed to the scratch dir; YOLO removes the sandbox."
                  className="w-full bg-transparent border rounded-md px-3 py-2 text-sm text-[var(--cream-mute)] outline-none mb-2 cursor-pointer"
                  style={{ borderColor: "var(--line-soft)" }}>
                  <option value="auto">✅ Auto-approve (sandboxed to the scratch dir)</option>
                  <option value="readonly">👀 Ask (read-only — plans but won't write)</option>
                  <option value="yolo">🚀 YOLO (no sandbox — full access)</option>
                </select>
                <button onClick={createGoal} disabled={!goalPrompt.trim()}
                  className="w-full px-3 py-2 rounded-md text-sm flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: `${ACCENT}28`, border: `1px solid ${ACCENT}66`, color: ACCENT }}>
                  <Play size={14} /> Launch goal
                </button>
              </div>
              <div className="pt-3 border-t" style={{ borderColor: "var(--line-soft)" }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="action-tag" style={{ color: "var(--cream-dim)" }}>All goals · {goals.length}</div>
                  <button onClick={refreshGoals} className="text-[var(--cream-mute)] hover:text-[var(--cream-dim)]"><RefreshCw size={11} /></button>
                </div>
                <div className="space-y-1.5">
                  {goals.length === 0 && <div className="text-[11px] text-[var(--cream-mute)] italic">No goals yet. Set one above.</div>}
                  {goals.map((g) => (
                    <button key={g.id} onClick={() => openGoal(g.id)}
                      className="block w-full text-left p-3 rounded-md border transition"
                      style={{
                        borderColor: openGoalId === g.id ? `${ACCENT}66` : "var(--line-soft)",
                        background: openGoalId === g.id ? `${ACCENT}10` : "transparent",
                      }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[12px] text-[var(--cream)] truncate flex-1">{g.title}</span>
                        <span className="action-tag ml-2 shrink-0" style={{ color: statusColor(g.status) }}>{g.status}</span>
                      </div>
                      <div className="text-[10px] text-[var(--cream-mute)] truncate mono">{fmtAgo(g.createdAt)}</div>
                    </button>
                  ))}
                </div>
              </div>
            </aside>
            <main className="flex flex-col min-h-0 overflow-hidden">
              {openGoalId ? (() => {
                const goal = goals.find((g) => g.id === openGoalId);
                if (!goal) return <div className="p-6 text-[var(--cream-mute)] text-sm">Goal not found.</div>;
                return (
                  <>
                    <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--line-soft)" }}>
                      <div className="min-w-0">
                        <div className="action-title truncate">{goal.title}</div>
                        <div className="text-[11px] text-[var(--cream-mute)] mono mt-0.5 truncate">{goal.cwd}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="action-tag" style={{ color: statusColor(goal.status) }}>● {goal.status}</span>
                        {goal.status === "running" && (
                          <button onClick={() => stopGoal(goal.id)} className="px-2 py-1 rounded-md text-[11px] flex items-center gap-1"
                            style={{ background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.35)", color: "#fca5a5" }}>
                            <Square size={10} /> Stop
                          </button>
                        )}
                        <button onClick={() => deleteGoal(goal.id)} className="px-2 py-1 rounded-md text-[11px] flex items-center gap-1"
                          style={{ color: "var(--cream-mute)" }}>
                          <Trash2 size={10} /> Delete
                        </button>
                      </div>
                    </div>
                    <div className="px-5 py-3 border-b" style={{ borderColor: "var(--line-soft)" }}>
                      <div className="text-[10px] uppercase tracking-widest mb-1.5" style={{ color: "var(--cream-mute)" }}>Prompt</div>
                      <div className="text-[13px] text-[var(--cream-soft)] whitespace-pre-wrap leading-relaxed">{goal.prompt}</div>
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto scroll p-5">
                      <div className="text-[10px] uppercase tracking-widest mb-3 flex items-center gap-1.5" style={{ color: "var(--cream-mute)" }}>
                        <span>Live timeline</span>
                        {goal.status === "running" && (
                          <span className="inline-block w-1.5 h-1.5 rounded-full"
                                style={{ background: ACCENT, boxShadow: `0 0 8px ${ACCENT}`, animation: "pulse 1.6s ease-in-out infinite" }} />
                        )}
                      </div>
                      <GoalLogStream log={openGoalLog} running={goal.status === "running"} />
                    </div>
                  </>
                );
              })() : (
                <div className="p-8 text-[var(--cream-soft)] text-sm leading-relaxed max-w-prose">
                  <div className="action-title mb-2">Goal Mode</div>
                  <p className="mb-3">Hand Codex a long-horizon objective. It runs <code className="mono text-[var(--cream)]">codex exec</code> auto-approved (sandboxed to a dedicated scratch dir) until the goal is met — or until you stop it.</p>
                  <p className="mb-3">Each goal has its own working directory under <code className="mono">~/codex-scratch/&lt;id&gt;/</code> so artefacts don&apos;t collide.</p>
                  <p className="text-[var(--cream-mute)]">Pick or start a goal on the left.</p>
                </div>
              )}
            </main>
          </div>
        )}

        {/* ─── SESSIONS TAB ─── split-view: list ◀── transcript + files + preview */}
        {tab === "sessions" && (
          <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-0 h-full min-h-0">
            {/* Sessions list */}
            <aside className="border-r p-3 overflow-y-auto scroll space-y-1" style={{ borderColor: "var(--line-soft)" }}>
              <div className="flex items-center justify-between mb-2">
                <div className="action-tag" style={{ color: ACCENT }}>
                  <ListChecks size={11} className="inline mr-1" /> Sessions · {sessions.length}
                </div>
                <button onClick={refreshSessions} className="text-[var(--cream-mute)] hover:text-[var(--cream-dim)]">
                  <RefreshCw size={11} />
                </button>
              </div>
              <div className="text-[10.5px] leading-relaxed mb-2" style={{ color: "var(--cream-mute)" }}>
                Click any past Codex session → see the transcript + every file it touched. Images, videos, HTML pages preview inline.
              </div>
              {sessions.length === 0 && (
                <div className="text-[11px] text-[var(--cream-mute)] italic p-2">No sessions yet.</div>
              )}
              {sessions.map((s) => (
                <button key={s.id} onClick={() => openSessionById(s.id)}
                  className="block w-full text-left p-2.5 rounded-md border transition"
                  style={{
                    borderColor: openSession?.id === s.id ? `${ACCENT}66` : "var(--line-soft)",
                    background: openSession?.id === s.id ? `${ACCENT}10` : "transparent",
                  }}>
                  <div className="text-[12px] text-[var(--cream)] truncate">{s.threadName}</div>
                  <div className="text-[10px] text-[var(--cream-mute)] mono mt-0.5 truncate">{fmtAgo(s.updatedAt)} · {s.id.slice(0, 8)}</div>
                </button>
              ))}
            </aside>

            {/* Session detail */}
            <main className="flex flex-col min-h-0 overflow-hidden">
              {sessionLoading ? (
                <div className="p-8 text-[var(--cream-mute)] text-sm">Loading session…</div>
              ) : !openSession ? (
                <div className="p-8 text-[var(--cream-mute)] text-sm leading-relaxed max-w-prose">
                  <div className="action-title mb-2">Past sessions</div>
                  <p>Pick a session on the left. You&apos;ll see:</p>
                  <ul className="mt-2 text-[12px] space-y-1 text-[var(--cream-soft)]">
                    <li>• Every message between you and Codex</li>
                    <li>• Every tool call (commands, file edits, browser actions)</li>
                    <li>• A live file list from the session&apos;s working directory</li>
                    <li>• Click any image / video / HTML → preview right here</li>
                  </ul>
                </div>
              ) : (
                <>
                  {/* Header */}
                  <div className="px-5 py-3 border-b" style={{ borderColor: "var(--line-soft)" }}>
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <div className="action-title truncate">{openSession.threadName}</div>
                      <span className="action-tag shrink-0" style={{ color: ACCENT }}>{fmtAgo(openSession.startedAt)}</span>
                    </div>
                    <div className="text-[10.5px] text-[var(--cream-mute)] mono truncate">
                      cwd: {openSession.cwd}
                      {!openSession.cwdExists && <span className="ml-2" style={{ color: "var(--plum)" }}>(no longer exists on disk)</span>}
                    </div>
                  </div>

                  {/* Scrollable body — transcript + files */}
                  <div className="flex-1 min-h-0 overflow-y-auto scroll p-4 space-y-4">
                    {/* Transcript */}
                    <section>
                      <div className="action-tag mb-2" style={{ color: "var(--cream-dim)" }}>Transcript · {openSession.turns.length} turns</div>
                      <div className="space-y-2">
                        {openSession.turns.map((t, i) => (
                          <div key={i} className={`rounded-md px-3 py-2 text-[13px] leading-relaxed border ${
                            t.role === "user"
                              ? "bg-[rgba(34,197,94,0.06)] border-[rgba(34,197,94,0.22)]"
                              : t.role === "reasoning"
                              ? "bg-[rgba(255,255,255,0.015)] border-[rgba(255,255,255,0.04)]"
                              : "bg-[rgba(255,255,255,0.02)] border-[rgba(255,255,255,0.06)]"
                          }`}>
                            <div className="text-[10px] tracking-widest uppercase opacity-60 mb-1">{t.role}</div>
                            <div className="whitespace-pre-wrap font-[var(--font-geist-mono)] text-[var(--cream)]"
                                 style={t.role === "reasoning" ? { opacity: 0.6 } : undefined}>
                              {t.text.length > 1800 ? t.text.slice(0, 1800) + "\n…[truncated]" : t.text}
                            </div>
                          </div>
                        ))}
                        {openSession.turns.length === 0 && (
                          <div className="text-[11px] text-[var(--cream-mute)] italic">No message turns captured.</div>
                        )}
                      </div>
                    </section>

                    {/* Tool calls */}
                    {openSession.toolCalls.length > 0 && (
                      <section>
                        <div className="action-tag mb-2" style={{ color: "var(--cream-dim)" }}>Tool calls · {openSession.toolCalls.length}</div>
                        <div className="space-y-1.5">
                          {openSession.toolCalls.map((tc, i) => (
                            <details key={i} className="rounded-md border" style={{ borderColor: "var(--line-soft)" }}>
                              <summary className="px-3 py-2 cursor-pointer text-[11.5px] mono" style={{ color: "var(--cream)" }}>
                                <span style={{ color: ACCENT }}>→ {tc.name}</span>
                              </summary>
                              <div className="p-3 border-t text-[10.5px] mono space-y-2" style={{ borderColor: "var(--line-soft)" }}>
                                <div>
                                  <div className="text-[var(--cream-mute)] mb-1">args</div>
                                  <pre className="whitespace-pre-wrap text-[var(--cream-soft)]">{tc.args}</pre>
                                </div>
                                {tc.output && (
                                  <div>
                                    <div className="text-[var(--cream-mute)] mb-1">output</div>
                                    <pre className="whitespace-pre-wrap text-[var(--cream-soft)]">{tc.output}</pre>
                                  </div>
                                )}
                              </div>
                            </details>
                          ))}
                        </div>
                      </section>
                    )}

                    {/* Files in cwd */}
                    {openSession.cwdFiles.length > 0 && (
                      <section>
                        <div className="action-tag mb-2" style={{ color: "var(--cream-dim)" }}>
                          Files in cwd · {openSession.cwdFiles.length}
                        </div>
                        <div className="space-y-0.5">
                          {openSession.cwdFiles.map((f) => {
                            const abs = `${openSession.cwd}/${f.relPath}`;
                            const isOpen = sessionFile?.absPath === abs;
                            return (
                              <button key={f.relPath} onClick={() => openSessionFile(abs)}
                                className="w-full flex items-center justify-between px-3 py-1.5 rounded-md text-left transition hover:bg-[rgba(255,255,255,0.02)]"
                                style={{ background: isOpen ? `${ACCENT}10` : "transparent" }}>
                                <div className="flex items-center gap-2 min-w-0">
                                  <FileText size={11} style={{ color: ACCENT }} />
                                  <span className="text-[12px] mono truncate" style={{ color: "var(--cream)" }}>{f.relPath}</span>
                                  <span className="text-[9.5px] uppercase tracking-widest ml-1" style={{ color: "var(--cream-mute)" }}>{f.kind}</span>
                                </div>
                                <div className="text-[10px] mono shrink-0 ml-2" style={{ color: "var(--cream-mute)" }}>
                                  {(f.bytes / 1024).toFixed(1)}KB
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    )}

                    {/* Referenced files (mentioned in transcript / tool args) */}
                    {openSession.referencedFiles.length > 0 && (
                      <section>
                        <div className="action-tag mb-2" style={{ color: "var(--cream-dim)" }}>
                          Referenced in transcript · {openSession.referencedFiles.length}
                        </div>
                        <div className="space-y-0.5">
                          {openSession.referencedFiles.map((p) => {
                            const isOpen = sessionFile?.absPath === p;
                            const kind = kindFromExt(p);
                            return (
                              <button key={p} onClick={() => openSessionFile(p)}
                                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-left transition hover:bg-[rgba(255,255,255,0.02)]"
                                style={{ background: isOpen ? `${ACCENT}10` : "transparent" }}>
                                <FileText size={11} style={{ color: ACCENT }} />
                                <span className="text-[11.5px] mono truncate min-w-0 flex-1" style={{ color: "var(--cream)" }}>{p}</span>
                                <span className="text-[9.5px] uppercase tracking-widest shrink-0" style={{ color: "var(--cream-mute)" }}>{kind}</span>
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    )}
                  </div>

                  {/* Inline file preview */}
                  <AnimatePresence>
                    {sessionFile && sessionFile.url && (
                      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        className="border-t" style={{ borderColor: `${ACCENT}30` }}>
                        <div className="flex items-center justify-between px-3 py-2 border-b"
                          style={{ borderColor: `${ACCENT}30`, background: `${ACCENT}0c` }}>
                          <div className="flex items-center gap-1.5 text-[11px] mono truncate" style={{ color: ACCENT }}>
                            <FileText size={11} />
                            <span className="truncate">{sessionFile.absPath.split("/").slice(-3).join("/")}</span>
                            <span className="ml-2 text-[10px] uppercase tracking-widest text-[var(--cream-mute)]">{sessionFile.kind}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <a href={sessionFile.url} target="_blank" rel="noopener noreferrer"
                              className="text-[var(--cream-dim)] hover:text-[var(--cream)] flex items-center gap-1 text-[10px] uppercase tracking-widest">
                              <ExternalLink size={10} /> New tab
                            </a>
                            <a href={sessionFile.url} download={sessionFile.absPath.split("/").pop()}
                              className="text-[var(--cream-dim)] hover:text-[var(--cream)] flex items-center gap-1 text-[10px] uppercase tracking-widest">
                              <Download size={10} /> Save
                            </a>
                            <button onClick={() => setSessionFile(null)} className="text-[var(--cream-dim)] hover:text-[var(--cream)]">
                              <X size={12} />
                            </button>
                          </div>
                        </div>
                        {sessionFile.kind === "image" && (
                          <a href={sessionFile.url} target="_blank" rel="noopener noreferrer" className="block bg-[rgba(0,0,0,0.6)]">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={sessionFile.url} alt={sessionFile.absPath} className="w-full max-h-[520px] object-contain" />
                          </a>
                        )}
                        {sessionFile.kind === "video" && (
                          <video src={sessionFile.url} controls preload="metadata" className="w-full max-h-[520px] bg-black" />
                        )}
                        {sessionFile.kind === "audio" && (
                          <div className="p-3 bg-[rgba(0,0,0,0.6)]"><audio src={sessionFile.url} controls className="w-full" /></div>
                        )}
                        {sessionFile.kind === "pdf" && (
                          <iframe src={sessionFile.url} title={sessionFile.absPath} className="w-full h-[520px] bg-white" />
                        )}
                        {sessionFile.kind === "text" && /\.html?$/.test(sessionFile.absPath) && (
                          <iframe src={sessionFile.url} title={sessionFile.absPath} className="w-full h-[520px] bg-white"
                            sandbox="allow-scripts allow-forms allow-popups allow-modals" />
                        )}
                        {sessionFile.kind === "text" && !/\.html?$/.test(sessionFile.absPath) && (
                          // For non-HTML text, just open in new tab — we don't want to wedge huge source dumps into this pane
                          <div className="p-4 text-[12px] text-[var(--cream-soft)]">
                            Text file — <a href={sessionFile.url} target="_blank" rel="noopener noreferrer" style={{ color: ACCENT }} className="hover:underline">open in new tab</a>.
                          </div>
                        )}
                        {sessionFile.kind === "binary" && (
                          <div className="p-4 text-[12px] text-[var(--cream-soft)]">
                            Binary file — <a href={sessionFile.url} download style={{ color: ACCENT }} className="hover:underline">download to view</a>.
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              )}
            </main>
          </div>
        )}

        {/* ─── WORKSPACE TAB ─── */}
        {tab === "workspace" && (
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-0 h-full min-h-0">
            <aside className="border-r p-3 space-y-2 overflow-y-auto scroll" style={{ borderColor: "var(--line-soft)" }}>
              <div className="flex items-center justify-between mb-1">
                <div className="action-tag" style={{ color: ACCENT }}>
                  <FolderOpen size={11} className="inline mr-1" /> Projects · {projects.length}
                </div>
                <button onClick={refreshProjects} className="text-[var(--cream-mute)] hover:text-[var(--cream-dim)]"><RefreshCw size={11} /></button>
              </div>
              <div className="text-[10.5px] leading-relaxed mb-2" style={{ color: "var(--cream-mute)" }}>
                Anything Codex writes during a chat or Goal Mode run lands in <code className="mono">~/codex-scratch/&lt;project&gt;/</code>. Click a file → preview inline.
              </div>

              {/* Create new project */}
              <div className="flex items-center gap-1.5 p-2 rounded-md border" style={{ borderColor: "var(--line-soft)" }}>
                <input
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") createProject(); }}
                  placeholder="new-project-name"
                  className="flex-1 bg-transparent outline-none text-[11px] mono"
                  style={{ color: "var(--cream)" }} />
                <button onClick={createProject} disabled={!newProjectName.trim()}
                  className="px-2 py-1 rounded-md text-[10px] uppercase tracking-widest disabled:opacity-40 transition"
                  style={{ background: `${ACCENT}28`, border: `1px solid ${ACCENT}66`, color: ACCENT }}>
                  <FilePlus size={10} className="inline mr-0.5" /> Add
                </button>
              </div>

              {projects.length === 0 && (
                <div className="text-[11px] text-[var(--cream-mute)] italic p-2">
                  No projects yet. Send a prompt in Chat — Codex will write to the active project, then it&apos;ll appear here.
                </div>
              )}
              {projects.map((p) => (
                // div, not button — inner "Set active" button can't be a child
                // of an outer <button> (hydration error).
                <div key={p.name}
                  role="button"
                  tabIndex={0}
                  onClick={() => selectProject(p)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectProject(p); } }}
                  className="block w-full text-left p-3 rounded-md border transition cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--cream-mute)]"
                  style={{
                    borderColor: selected?.name === p.name ? `${ACCENT}66` : "var(--line-soft)",
                    background: selected?.name === p.name ? `${ACCENT}10` : "transparent",
                  }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] text-[var(--cream)] truncate">{p.name}</span>
                    {activeProject === p.name && (
                      <span className="text-[9px] uppercase tracking-widest shrink-0" style={{ color: ACCENT }}>active</span>
                    )}
                  </div>
                  <div className="text-[10px] text-[var(--cream-mute)] mono mt-0.5">{p.fileCount} files · {fmtAgo(p.mtime)}</div>
                  {activeProject !== p.name && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setActiveProject(p.name); }}
                      className="mt-2 text-[10px] uppercase tracking-widest hover:underline"
                      style={{ color: "var(--cream-mute)" }}>
                      Set active →
                    </button>
                  )}
                </div>
              ))}
            </aside>
            <main className="flex flex-col min-h-0 overflow-hidden">
              {!selected ? (
                <div className="p-6 text-[var(--cream-mute)] text-sm">Pick a project on the left.</div>
              ) : (
                <>
                  <div className="px-4 py-2.5 border-b flex items-center justify-between" style={{ borderColor: "var(--line-soft)" }}>
                    <div className="min-w-0">
                      <div className="text-[13px] text-[var(--cream)] truncate">{selected.name}</div>
                      <div className="text-[10.5px] text-[var(--cream-mute)] mono truncate">{selected.root}</div>
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto scroll p-2 space-y-0.5">
                    {files.map((f) => (
                      <button key={f.relPath} onClick={() => loadFile(f)}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-md text-left transition hover:bg-[rgba(255,255,255,0.02)]"
                        style={{ background: open?.path === f.relPath ? `${ACCENT}10` : "transparent" }}>
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText size={11} style={{ color: ACCENT }} />
                          <span className="text-[12px] mono truncate" style={{ color: "var(--cream)" }}>{f.relPath}</span>
                          <span className="text-[10px] uppercase tracking-widest ml-1" style={{ color: "var(--cream-mute)" }}>{f.kind}</span>
                        </div>
                        <div className="text-[10px] mono shrink-0 ml-2" style={{ color: "var(--cream-mute)" }}>
                          {(f.bytes / 1024).toFixed(1)}KB · {fmtAgo(f.mtime)}
                        </div>
                      </button>
                    ))}
                  </div>
                  <AnimatePresence>
                    {open && (
                      <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        className="border-t" style={{ borderColor: `${ACCENT}30` }}>
                        <div className="flex items-center justify-between px-3 py-2 border-b"
                          style={{ borderColor: `${ACCENT}30`, background: `${ACCENT}0c` }}>
                          <div className="flex items-center gap-1.5 text-[11px] mono truncate" style={{ color: ACCENT }}>
                            <FileText size={11} /><span className="truncate">{open.path}</span>
                            <span className="ml-2 text-[10px] uppercase tracking-widest text-[var(--cream-mute)]">{open.kind}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {/\.html?$/.test(open.path) && (
                              <>
                                <div className="flex items-center rounded-md overflow-hidden border" style={{ borderColor: `${ACCENT}40` }}>
                                  <button onClick={() => setHtmlMode("preview")}
                                    className="text-[10px] uppercase tracking-widest px-2 py-1 transition"
                                    style={{
                                      background: htmlMode === "preview" ? `${ACCENT}28` : "transparent",
                                      color: htmlMode === "preview" ? ACCENT : "var(--cream-dim)",
                                    }}><Eye size={10} className="inline mr-1" />Preview</button>
                                  <button onClick={() => setHtmlMode("source")}
                                    className="text-[10px] uppercase tracking-widest px-2 py-1 transition"
                                    style={{
                                      background: htmlMode === "source" ? `${ACCENT}28` : "transparent",
                                      color: htmlMode === "source" ? ACCENT : "var(--cream-dim)",
                                    }}><FileText size={10} className="inline mr-1" />Source</button>
                                </div>
                                <a href={rawUrl(open.path)} target="_blank" rel="noopener noreferrer"
                                  className="text-[var(--cream-dim)] hover:text-[var(--cream)] flex items-center gap-1 text-[10px] uppercase tracking-widest">
                                  <ExternalLink size={10} /> New tab
                                </a>
                              </>
                            )}
                            {open.kind === "text" && (
                              <button onClick={() => navigator.clipboard?.writeText(open.content)}
                                className="text-[var(--cream-dim)] hover:text-[var(--cream)] flex items-center gap-1 text-[10px] uppercase tracking-widest">
                                <Copy size={10} /> Copy
                              </button>
                            )}
                            <a href={rawUrl(open.path)} download={open.path.split("/").pop()}
                              className="text-[var(--cream-dim)] hover:text-[var(--cream)] flex items-center gap-1 text-[10px] uppercase tracking-widest">
                              <Download size={10} /> Save
                            </a>
                            <button onClick={() => setOpen(null)} className="text-[var(--cream-dim)] hover:text-[var(--cream)]"><X size={12}/></button>
                          </div>
                        </div>
                        {open.kind === "text" && (() => {
                          const isHtml = /\.html?$/.test(open.path);
                          if (isHtml && htmlMode === "preview") {
                            return <iframe src={rawUrl(open.path)} title={open.path} className="w-full h-[520px] bg-white" sandbox="allow-scripts allow-forms allow-popups allow-modals" />;
                          }
                          return (
                            <pre className="scroll p-3 text-[12px] leading-relaxed text-[var(--cream)] whitespace-pre-wrap font-[var(--font-geist-mono)] max-h-[440px] overflow-auto">
                              {open.content}
                            </pre>
                          );
                        })()}
                        {open.kind === "image" && (
                          <a href={rawUrl(open.path)} target="_blank" rel="noopener noreferrer" className="block bg-[rgba(0,0,0,0.6)]">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={rawUrl(open.path)} alt={open.path} className="w-full max-h-[520px] object-contain" />
                          </a>
                        )}
                        {open.kind === "video" && (
                          <video src={rawUrl(open.path)} controls preload="metadata" className="w-full max-h-[520px] bg-black" />
                        )}
                        {open.kind === "audio" && (
                          <div className="p-3 bg-[rgba(0,0,0,0.6)]"><audio src={rawUrl(open.path)} controls className="w-full" /></div>
                        )}
                        {open.kind === "pdf" && (
                          <iframe src={rawUrl(open.path)} title={open.path} className="w-full h-[520px] bg-white" />
                        )}
                        {open.kind === "binary" && (
                          <div className="p-4 text-[12px] text-[var(--cream-soft)]">
                            Binary file — <a href={rawUrl(open.path)} download={open.path.split("/").pop()} style={{ color: ACCENT }} className="hover:underline">download to view</a>.
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              )}
            </main>
          </div>
        )}
      </div>
    </div>
  );
}

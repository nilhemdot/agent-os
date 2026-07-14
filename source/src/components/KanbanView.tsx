"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, X, RefreshCw, MessageSquare, AlertCircle, CheckCircle2, Archive,
  PlayCircle, Hand, GitBranch, User2, Clock, Send, Wand2,
  Layers, Zap, AlertTriangle, FileText, Copy, Download, FolderOpen, Eye, Film, Code2, Sparkles,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { COLUMNS, STATUS_COLOUR, type KanbanStatus, type KanbanTask, type KanbanTaskDetail, type KanbanAssignee, type KanbanStats } from "@/lib/kanban";

// Inline markdown renderer for Kanban task outputs (content already in memory —
// unlike MarkdownView which fetches a URL). Aubergine-themed, compact.
function Md({ children }: { children: string }) {
  const cleaned = children.replace(/^---\n[\s\S]*?\n---\n/, ""); // strip frontmatter
  return (
    <div className="text-[13px] leading-relaxed text-[var(--fg)]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h1 className="text-[22px] font-semibold tracking-tight mt-3 mb-2 text-[var(--fg)]" {...p} />,
          h2: (p) => <h2 className="text-[17px] font-semibold mt-5 mb-2 text-[var(--fg)] border-t border-[var(--panel-border)] pt-4 first:border-0 first:pt-0 first:mt-2" {...p} />,
          h3: (p) => <h3 className="text-[14.5px] font-semibold mt-3 mb-1 text-[var(--fg)]" {...p} />,
          p:  (p) => <p className="my-2 text-[13px] leading-[1.65]" {...p} />,
          ul: (p) => <ul className="my-2 space-y-1 pl-5 list-disc marker:text-[var(--fg-dimmer)]" {...p} />,
          ol: (p) => <ol className="my-2 space-y-1 pl-5 list-decimal marker:text-[var(--fg-dimmer)]" {...p} />,
          li: (p) => <li className="text-[13px] leading-[1.6]" {...p} />,
          a:  (p) => <a className="text-[var(--accent-cyan)] hover:underline" target="_blank" rel="noopener noreferrer" {...p} />,
          strong: (p) => <strong className="font-semibold text-[var(--fg)]" {...p} />,
          code: ({ className, children, ...rest }) => className?.includes("language-")
            ? <code className={`${className} text-[12px]`} {...rest}>{children}</code>
            : <code className="px-1 py-0.5 rounded text-[12px] bg-[rgba(168,85,247,0.12)] border border-[rgba(168,85,247,0.2)] text-[#e9d5ff] font-[var(--font-geist-mono)]" {...rest}>{children}</code>,
          pre: (p) => <pre className="my-3 rounded-lg border border-[var(--panel-border)] bg-[rgba(0,0,0,0.45)] p-3 overflow-x-auto text-[12px] font-[var(--font-geist-mono)]" {...p} />,
          table: (p) => <div className="my-3 overflow-x-auto"><table className="w-full text-[12px] border-collapse" {...p} /></div>,
          th: (p) => <th className="text-left px-2.5 py-1.5 border-b border-[var(--panel-border-hot)] text-[var(--fg-dim)] font-semibold uppercase tracking-wide text-[10.5px]" {...p} />,
          td: (p) => <td className="px-2.5 py-1.5 border-b border-[var(--panel-border)] align-top" {...p} />,
          blockquote: (p) => <blockquote className="border-l-2 border-[var(--accent-violet)] pl-3 my-3 italic text-[var(--fg-dim)]" {...p} />,
          hr: () => <hr className="my-5 border-0 h-px bg-[var(--panel-border)]" />,
        }}
      >{cleaned}</ReactMarkdown>
    </div>
  );
}

function isMarkdownPath(p: string): boolean { return /\.(md|markdown|mdx)$/i.test(p); }
const VIDEO_RE = /\.(mp4|webm|mov|m4v)$/i; // delivered videos play inline in the task card

interface BoardRow { slug: string; name: string; current: boolean; }

interface BoardResponse {
  board: string;
  boards: BoardRow[];
  tasks: KanbanTask[];
  stats: KanbanStats;
  assignees: KanbanAssignee[];
  ok: boolean;
  reason?: "node-sqlite-missing" | "db-read-failed" | string;
  setup?: { hermesInstalled: boolean; dbExists: boolean; nodeOk: boolean };
}

function fmtAgo(ts: number | null): string {
  if (!ts) return "—";
  const d = Date.now() - ts * 1000;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`;
  return `${Math.floor(d / 86_400_000)}d`;
}

export default function KanbanView() {
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [boardSlug, setBoardSlug] = useState<string>("default");

  // Deep-link + stickiness: /kanban?board=aipb-page opens that board directly,
  // and the last viewed board is remembered across visits.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("board");
    const remembered = localStorage.getItem("kanban-board");
    const pick = q || remembered;
    if (pick && /^[a-z0-9_-]{1,64}$/.test(pick)) setBoardSlug(pick);
  }, []);
  useEffect(() => {
    try { localStorage.setItem("kanban-board", boardSlug); } catch { /* */ }
  }, [boardSlug]);
  // Content Machine: finished blog/video artifact paths, rendered INSIDE pinned cards
  const [contentArt, setContentArt] = useState<{ blog?: string; video?: string }>({});
  useEffect(() => {
    if (boardSlug !== "content") { setContentArt({}); return; }
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch("/api/content/board", { cache: "no-store" });
        const j = (await r.json()) as { ok?: boolean; state?: { lanes: Array<{ id: string; artifact?: { previewPath?: string; file?: string } }> } };
        if (stop || !j.ok || !j.state) return;
        const seo = j.state.lanes.find((l) => l.id === "seo");
        const vid = j.state.lanes.find((l) => l.id === "video");
        setContentArt({ blog: seo?.artifact?.previewPath, video: vid?.artifact?.file });
      } catch { /* */ }
    };
    load();
    const iv = setInterval(load, 5000);
    return () => { stop = true; clearInterval(iv); };
  }, [boardSlug]);
  const cpUrl = (rel: string) => `/api/content/preview/${rel.split("/").map(encodeURIComponent).join("/")}`;
  const [filter, setFilter] = useState<string>("");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("");
  const [showArchived, setShowArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<KanbanTaskDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Create-card form state
  const [newTitle, setNewTitle] = useState("");
  const [newAssignee, setNewAssignee] = useState("julian"); // default to user's active profile
  const [newBody, setNewBody] = useState("");
  const [newTriage, setNewTriage] = useState(true);
  // Dispatcher result toast
  const [dispatchResult, setDispatchResult] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);

  // Deep-link: /kanban?task=<id> opens that task's drawer directly (shareable link).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("task");
    if (id) setSelectedId(id);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/hermes/kanban/board?board=${encodeURIComponent(boardSlug)}`, { cache: "no-store" });
      const j: BoardResponse = await r.json();
      setBoard(j);
      setError(null);
    } catch (e) { setError(String(e)); }
  }, [boardSlug]);

  // Hash the relevant fields so we only re-render when something actually changed.
  // Stops Framer Motion's AnimatePresence from doing layout work on every poll tick.
  const lastFingerprintRef = useRef<string>("");
  useEffect(() => {
    refresh();
    // Auto-refresh every 20s. The board doesn't change that fast and re-renders are expensive.
    refreshTimer.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/hermes/kanban/board?board=${encodeURIComponent(boardSlug)}`, { cache: "no-store" });
        const j: BoardResponse = await r.json();
        // Fingerprint: id|status|assignee|priority|title per task. Skip update if unchanged.
        const fp = j.tasks.map((t) => `${t.id}:${t.status}:${t.assignee ?? ""}:${t.priority}:${t.title}`).join("|");
        if (fp !== lastFingerprintRef.current) {
          lastFingerprintRef.current = fp;
          setBoard(j);
        }
      } catch {}
    }, 20_000);
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current); };
  }, [refresh, boardSlug]);

  // Load detail when a card is selected
  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/hermes/kanban/task?id=${selectedId}&board=${boardSlug}`, { cache: "no-store" });
        const j: KanbanTaskDetail = await r.json();
        if (!cancelled) setDetail(j);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [selectedId, boardSlug, board]);

  async function action(body: Record<string, unknown>): Promise<boolean> {
    setBusy(String(body.action ?? ""));
    setError(null);
    try {
      const r = await fetch("/api/hermes/kanban/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ board: boardSlug, ...body }),
      });
      const j = await r.json();
      if (!j.ok) {
        setError(j.stderr || j.stdout || `${body.action} failed`);
        setBusy(null);
        return false;
      }
      await refresh();
      setBusy(null);
      return true;
    } catch (e) { setError(String(e)); setBusy(null); return false; }
  }

  async function createTask() {
    if (!newTitle.trim() || creating) return;
    setCreating(true);
    const ok = await action({
      action: "create",
      title: newTitle.trim(),
      body: newBody.trim() || undefined,
      assignee: newAssignee || undefined,
      triage: newTriage,
    });
    if (ok) { setNewTitle(""); setNewBody(""); }
    setCreating(false);
  }

  // Fire the dispatcher right now instead of waiting up to 60s for the next tick.
  async function dispatchNow() {
    setBusy("dispatch");
    setDispatchResult(null);
    try {
      const r = await fetch(`/api/hermes/kanban/dispatch?board=${boardSlug}`, { method: "POST" });
      const j = await r.json();
      const d = j.dispatch ?? j; // dispatch field or top-level
      const spawned = (d.spawned ?? []).length;
      const promoted = d.promoted ?? 0;
      const reclaimed = d.reclaimed ?? 0;
      const skippedUnassigned = (d.skipped_unassigned ?? []).length;
      const lines = [
        `Promoted ${promoted} · Spawned ${spawned} · Reclaimed ${reclaimed}`,
      ];
      if (skippedUnassigned > 0) {
        lines.push(`⚠ ${skippedUnassigned} ready task${skippedUnassigned === 1 ? "" : "s"} skipped — no assignee set`);
      }
      setDispatchResult({
        kind: skippedUnassigned > 0 ? "warn" : "ok",
        text: lines.join(" · "),
      });
      await refresh();
    } catch (e) {
      setDispatchResult({ kind: "warn", text: `dispatch failed: ${String(e)}` });
    }
    setBusy(null);
    setTimeout(() => setDispatchResult(null), 8000);
  }

  // Tasks filtered by search + assignee + archived toggle
  const tasksFiltered = useMemo(() => {
    if (!board) return [];
    return board.tasks.filter((t) => {
      if (!showArchived && t.status === "archived") return false;
      if (assigneeFilter && (t.assignee ?? "(unassigned)") !== assigneeFilter) return false;
      if (filter) {
        const q = filter.toLowerCase();
        if (!t.title.toLowerCase().includes(q) && !t.id.includes(q)) return false;
      }
      return true;
    });
  }, [board, filter, assigneeFilter, showArchived]);

  const byStatus = useMemo(() => {
    const out: Record<string, KanbanTask[]> = {};
    for (const c of COLUMNS) out[c.key] = [];
    if (showArchived) out["archived"] = [];
    for (const t of tasksFiltered) {
      const arr = out[t.status] ?? (out[t.status] = []);
      arr.push(t);
    }
    return out;
  }, [tasksFiltered, showArchived]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {board && board.boards.length > 1 && (
          <select
            value={boardSlug}
            onChange={(e) => setBoardSlug(e.target.value)}
            className="bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-2.5 h-[34px] text-[12.5px] text-[var(--fg)]"
          >
            {board.boards.map((b) => <option key={b.slug} value={b.slug}>{b.name} ({b.slug})</option>)}
          </select>
        )}
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search…"
          className="bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-3 h-[34px] text-[12.5px] text-[var(--fg)] flex-1 min-w-[140px] max-w-[280px]"
        />
        <select
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          className="bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-2.5 h-[34px] text-[12.5px] text-[var(--fg-dim)]"
        >
          <option value="">All assignees</option>
          {board?.assignees.map((a) => (
            <option key={a.name} value={a.name}>{a.name} {Object.keys(a.counts).length > 0 ? `· ${Object.values(a.counts).reduce((s,n)=>s+n,0)}` : ""}</option>
          ))}
        </select>
        <button
          onClick={() => setShowArchived((v) => !v)}
          className="px-2.5 h-[34px] rounded-lg border text-[12px] transition"
          style={{
            background: showArchived ? "rgba(90,93,128,0.18)" : "transparent",
            borderColor: showArchived ? "#5a5d80" : "var(--panel-border)",
            color: showArchived ? "var(--fg)" : "var(--fg-dim)",
          }}
        >
          {showArchived ? "Hide archived" : "Show archived"}
        </button>
        <button
          onClick={refresh}
          disabled={!!busy}
          className="px-2.5 h-[34px] rounded-lg border border-[var(--panel-border)] hover:border-[var(--panel-border-hot)] text-[12px] text-[var(--fg-dim)] hover:text-[var(--fg)] flex items-center gap-1 transition disabled:opacity-40"
        >
          <RefreshCw size={11} className={busy === "refresh" ? "animate-spin" : ""} /> Refresh
        </button>
        <button
          onClick={dispatchNow}
          disabled={!!busy}
          className="px-2.5 h-[34px] rounded-lg flex items-center gap-1.5 text-[12px] transition disabled:opacity-40"
          style={{ background: "rgba(20,184,166,0.18)", border: "1px solid rgba(20,184,166,0.55)", color: "#14b8a6" }}
          title="Skip the 60s tick — make the dispatcher promote + spawn now"
        >
          {busy === "dispatch" ? <RefreshCw size={11} className="animate-spin" /> : <Zap size={11} />} Dispatch now
        </button>
        <div className="ml-auto text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">
          {board?.tasks.length ?? "…"} tasks · {board?.assignees.length ?? "…"} profiles
        </div>
      </div>

      {/* Create card */}
      <div className="panel p-3">
        <div className="flex items-start gap-2 flex-wrap md:flex-nowrap">
          <Plus size={14} className="text-[#14b8a6] mt-2 shrink-0" />
          <div className="flex-1 min-w-0">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) createTask(); }}
              placeholder="New task title… (⌘+Enter to create)"
              className="w-full bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-3 h-[36px] text-[13.5px] text-[var(--fg)] outline-none focus:border-[var(--panel-border-hot)]"
            />
            {newTitle.trim() && (
              <textarea
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
                rows={2}
                placeholder="Optional body / context for the worker…"
                className="mt-2 w-full bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-3 py-2 text-[12.5px] text-[var(--fg)] outline-none focus:border-[var(--panel-border-hot)] resize-y"
              />
            )}
          </div>
          <select
            value={newAssignee}
            onChange={(e) => setNewAssignee(e.target.value)}
            className="bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-2.5 h-[36px] text-[12.5px] text-[var(--fg-dim)]"
          >
            <option value="">(unassigned)</option>
            {board?.assignees.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--fg-dim)] cursor-pointer h-[36px] px-2 select-none">
            <input type="checkbox" checked={newTriage} onChange={(e) => setNewTriage(e.target.checked)} className="accent-violet-400" />
            Triage
          </label>
          <button
            onClick={createTask}
            disabled={!newTitle.trim() || creating}
            className="px-3 h-[36px] rounded-lg flex items-center gap-1.5 text-[13px] transition disabled:opacity-40"
            style={{ background: "rgba(20,184,166,0.18)", border: "1px solid rgba(20,184,166,0.55)", color: "#14b8a6" }}
          >
            <Plus size={14} /> Add
          </button>
        </div>
        {newTriage && newTitle.trim() && (
          <div className="mt-1.5 text-[10.5px] text-[var(--fg-dimmer)] uppercase tracking-widest pl-6">
            Triage on · orchestrator can auto-decompose if `kanban.auto_decompose` is enabled in your config
          </div>
        )}
      </div>

      {error && (
        <div className="panel p-3 border-rose-400/40 text-rose-300 text-[12.5px] flex items-start gap-2">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          <pre className="font-[var(--font-geist-mono)] whitespace-pre-wrap break-words flex-1">{error}</pre>
          <button onClick={() => setError(null)} className="text-rose-300 hover:text-rose-100"><X size={14}/></button>
        </div>
      )}

      {dispatchResult && (
        <div
          className="panel p-3 text-[12.5px] flex items-start gap-2"
          style={{
            borderColor: dispatchResult.kind === "warn" ? "rgba(251,191,36,0.5)" : "rgba(20,184,166,0.5)",
            color: dispatchResult.kind === "warn" ? "#fbbf24" : "#14b8a6",
          }}
        >
          {dispatchResult.kind === "warn" ? <AlertTriangle size={13} className="shrink-0 mt-0.5" /> : <Zap size={13} className="shrink-0 mt-0.5" />}
          <div className="flex-1">{dispatchResult.text}</div>
          <button onClick={() => setDispatchResult(null)} className="opacity-70 hover:opacity-100"><X size={14}/></button>
        </div>
      )}

      {/* Setup card — shown when the Kanban backend isn't ready (no Node 22 /
          no Hermes / no board yet). Turns a confusing empty board into clear
          next steps. */}
      {board?.ok === false && <KanbanSetupCard reason={board.reason} setup={board.setup} />}

      {/* Columns */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {COLUMNS.map((col) => {
          const tasks = (byStatus[col.key] ?? []).slice().sort(
            (a, b) => (b.title.startsWith("📌") ? 1 : 0) - (a.title.startsWith("📌") ? 1 : 0)
          );
          return (
            <section
              key={col.key}
              className="panel p-3 min-h-[180px] flex flex-col"
              style={{ borderTopColor: col.accent, borderTopWidth: "2px" }}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background: col.accent, boxShadow: `0 0 8px ${col.accent}` }} />
                  <h3 className="text-[11px] uppercase tracking-widest font-medium" style={{ color: col.accent }}>{col.label}</h3>
                </div>
                <span className="text-[10px] metric text-[var(--fg-dimmer)]">{tasks.length}</span>
              </div>
              <div className="space-y-2 flex-1 min-h-0">
                  {tasks.length === 0 && (
                    <div className="text-[11px] text-[var(--fg-dimmer)] italic px-1 py-2">empty</div>
                  )}
                  {tasks.map((t) => {
                    // Content Machine: a "📌" card renders its finished artifact preview INSIDE the card
                    if (boardSlug === "content" && t.title.startsWith("📌")) {
                      const isBlog = /blog/i.test(t.title);
                      const rel = isBlog ? contentArt.blog : contentArt.video;
                      const src = rel ? cpUrl(rel) : "";
                      const accent = isBlog ? "#d4a574" : "#00ccff";
                      return (
                        <button
                          key={t.id}
                          onClick={() => setSelectedId(t.id)}
                          className="w-full text-left rounded-lg border overflow-hidden transition hover:brightness-110"
                          style={{ borderColor: accent, background: "rgba(0,0,0,0.35)" }}
                        >
                          <div className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-semibold" style={{ background: `${accent}1e`, color: accent }}>
                            <span>📌</span><span className="truncate">{t.title.replace(/^📌\s*/, "")}</span>
                          </div>
                          <div className="bg-black" style={{ height: 158 }}>
                            {!src ? (
                              <div className="grid place-items-center h-full text-[10px] text-[var(--fg-dimmer)]">rendering…</div>
                            ) : isBlog ? (
                              <iframe src={src} title={t.title} className="w-full h-full border-0 pointer-events-none" sandbox="allow-scripts allow-same-origin" />
                            ) : (
                              <video src={src} muted loop autoPlay playsInline className="w-full h-full object-cover" />
                            )}
                          </div>
                          <div className="px-2.5 py-1 text-[9.5px] text-[var(--fg-dimmer)]">click to open · pinned result</div>
                        </button>
                      );
                    }
                    // A ready/triage card with no assignee will be skipped by the dispatcher forever — flag it.
                    const isStuck = !t.assignee && (t.status === "ready" || t.status === "triage");
                    return (
                      <button
                        key={t.id}
                        onClick={() => setSelectedId(t.id)}
                        className="w-full text-left rounded-lg border bg-[rgba(255,255,255,0.025)] hover:bg-[rgba(255,255,255,0.04)] p-2.5 transition"
                        style={{
                          borderColor: isStuck ? "rgba(251,191,36,0.5)" : "var(--panel-border)",
                          background: isStuck ? "rgba(251,191,36,0.05)" : undefined,
                        }}
                      >
                        <div className="flex items-start justify-between gap-1.5">
                          <div className="text-[12.5px] text-[var(--fg)] leading-snug line-clamp-3">{t.title}</div>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between gap-1.5 text-[10px] text-[var(--fg-dimmer)]">
                          <div className="flex items-center gap-1 truncate">
                            {t.assignee ? (
                              <>
                                <User2 size={9} />
                                <span className="text-[var(--fg-dim)] truncate">{t.assignee}</span>
                              </>
                            ) : isStuck ? (
                              <span className="flex items-center gap-1 text-amber-300" title="Dispatcher skips ready/triage tasks with no assignee — set one to unstick.">
                                <AlertTriangle size={9} /> unassigned · stuck
                              </span>
                            ) : (
                              <span className="italic">unassigned</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Clock size={9} />
                            <span>{fmtAgo(t.created_at)}</span>
                          </div>
                        </div>
                        <div className="mt-0.5 font-[var(--font-geist-mono)] text-[9.5px] text-[var(--fg-dimmer)] truncate">{t.id}</div>
                      </button>
                    );
                  })}
              </div>
            </section>
          );
        })}
      </div>

      {/* Drawer */}
      <AnimatePresence>
        {selectedId && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={() => setSelectedId(null)}
          >
            <motion.aside
              initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 280 }}
              onClick={(e) => e.stopPropagation()}
              // inline position MUST win over `.panel { position: relative }` (globals.css),
              // otherwise top-0/bottom-0 are ignored, the drawer grows to fit content,
              // and the scroll body can never be height-constrained (= no scrolling).
              style={{ position: "absolute" }}
              className="absolute top-0 right-0 bottom-0 w-full md:w-[640px] panel p-0 overflow-hidden border-l border-[var(--panel-border)]"
            >
              <TaskDrawer
                taskId={selectedId}
                boardSlug={boardSlug}
                detail={detail}
                assignees={board?.assignees ?? []}
                busy={busy}
                onClose={() => setSelectedId(null)}
                onAction={action}
              />
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface DrawerProps {
  taskId: string;
  boardSlug: string;
  detail: KanbanTaskDetail | null;
  assignees: KanbanAssignee[];
  busy: string | null;
  onClose: () => void;
  onAction: (body: Record<string, unknown>) => Promise<boolean>;
}

interface WsFile { name: string; relPath: string; bytes: number; mtime: number; isText: boolean; }

function TaskDrawer({ taskId, boardSlug, detail, assignees, busy, onClose, onAction }: DrawerProps) {
  const t = detail?.task;
  const [comment, setComment] = useState("");
  const [blockReason, setBlockReason] = useState("");
  const [showBlock, setShowBlock] = useState(false);
  const [wsFiles, setWsFiles] = useState<WsFile[]>([]);
  const [wsRoot, setWsRoot] = useState<string>("");
  const [openFile, setOpenFile] = useState<{ path: string; content: string; bytes: number; truncated: boolean; video?: boolean } | null>(null);
  const [mdRendered, setMdRendered] = useState(true); // .md files render formatted by default
  // Raw byte URL for media files (video/audio/image) so they play inline in the card.
  const wsRawUrl = (rel: string) => `/api/hermes/kanban/workspace/raw?id=${taskId}&board=${boardSlug}&path=${encodeURIComponent(rel)}`;

  // Load workspace files when the task opens / changes
  useEffect(() => {
    if (!t) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/hermes/kanban/workspace?id=${taskId}&board=${boardSlug}`, { cache: "no-store" });
        const j = await r.json();
        if (!cancelled) { setWsFiles(j.files ?? []); setWsRoot(j.root ?? ""); }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [taskId, boardSlug, t?.status]);

  async function loadFile(rel: string) {
    // Video files stream raw + play inline — no JSON content fetch.
    if (VIDEO_RE.test(rel)) { setOpenFile({ path: rel, content: "", bytes: 0, truncated: false, video: true }); return; }
    try {
      const r = await fetch(`/api/hermes/kanban/workspace/file?id=${taskId}&board=${boardSlug}&path=${encodeURIComponent(rel)}`, { cache: "no-store" });
      const j = await r.json();
      if (j.content !== undefined) { setOpenFile({ path: rel, content: j.content, bytes: j.bytes, truncated: j.truncated }); setMdRendered(true); }
    } catch {}
  }

  if (!t) {
    return (
      <div className="h-full grid place-items-center text-[var(--fg-dim)] text-sm">Loading {taskId}…</div>
    );
  }

  const status: KanbanStatus = t.status;
  const accent = STATUS_COLOUR[status];

  async function sendComment() {
    if (!comment.trim()) return;
    const ok = await onAction({ action: "comment", id: taskId, text: comment });
    if (ok) setComment("");
  }

  async function reassign(name: string) {
    await onAction({ action: "assign", id: taskId, assignee: name || "none" });
  }

  const isBusy = (a: string) => busy === a;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[var(--panel-border)] bg-[rgba(0,0,0,0.25)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest">
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
                style={{ color: accent, background: `${accent}1a`, border: `1px solid ${accent}55` }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: accent }} />
                {status}
              </span>
              <span className="font-[var(--font-geist-mono)] text-[var(--fg-dimmer)]">{t.id}</span>
              <span className="text-[var(--fg-dimmer)]">· {fmtAgo(t.created_at)} ago</span>
            </div>
            <h2 className="mt-1.5 text-[18px] font-medium text-[var(--fg)] leading-snug">{t.title}</h2>
          </div>
          <button onClick={onClose} className="text-[var(--fg-dim)] hover:text-[var(--fg)] shrink-0"><X size={18}/></button>
        </div>

        {/* Meta row */}
        <div className="mt-3 flex items-center gap-3 flex-wrap text-[11.5px]">
          <div className="flex items-center gap-1.5 text-[var(--fg-dim)]">
            <User2 size={11} />
            <select
              value={t.assignee ?? ""}
              onChange={(e) => reassign(e.target.value)}
              className="bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-md px-1.5 py-0.5 text-[11.5px] text-[var(--fg)]"
            >
              <option value="">(unassigned)</option>
              {assignees.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
            </select>
          </div>
          {t.priority > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-[rgba(168,85,247,0.16)] text-[#c4b5fd] text-[10px] uppercase tracking-widest">
              p{t.priority}
            </span>
          )}
          {t.tenant && (
            <span className="px-1.5 py-0.5 rounded bg-[rgba(34,211,238,0.12)] text-[#22d3ee] text-[10px] uppercase tracking-widest">
              {t.tenant}
            </span>
          )}
          {t.workspace_path && (
            <span className="font-[var(--font-geist-mono)] text-[10px] text-[var(--fg-dimmer)] truncate" title={t.workspace_path}>
              ws: {t.workspace_path.replace(/^\/(?:Users|home)\/[^/]+/, "~")}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="px-5 py-3 border-b border-[var(--panel-border)] flex flex-wrap gap-1.5">
        {status === "triage" && (
          <>
            <ActBtn onClick={() => onAction({ action: "specify", id: taskId })} busy={isBusy("specify")} icon={<Wand2 size={12}/>} colour="#a855f7">Specify</ActBtn>
            <ActBtn onClick={() => onAction({ action: "decompose", id: taskId })} busy={isBusy("decompose")} icon={<Layers size={12}/>} colour="#a855f7">Decompose</ActBtn>
          </>
        )}
        {status === "blocked" && (
          <ActBtn onClick={() => onAction({ action: "unblock", id: taskId })} busy={isBusy("unblock")} icon={<PlayCircle size={12}/>} colour="#22d3ee">Unblock</ActBtn>
        )}
        {!["done", "archived", "blocked"].includes(status) && (
          <ActBtn onClick={() => setShowBlock((v) => !v)} icon={<Hand size={12}/>} colour="#fbbf24">Block…</ActBtn>
        )}
        {!["done", "archived"].includes(status) && (
          <ActBtn onClick={() => onAction({ action: "complete", id: taskId })} busy={isBusy("complete")} icon={<CheckCircle2 size={12}/>} colour="#86efac">Complete</ActBtn>
        )}
        {status !== "archived" && (
          <ActBtn onClick={() => { if (confirm("Archive this task?")) onAction({ action: "archive", id: taskId }); }} busy={isBusy("archive")} icon={<Archive size={12}/>} colour="#5a5d80">Archive</ActBtn>
        )}
      </div>

      {showBlock && (
        <div className="px-5 py-3 border-b border-amber-400/30 bg-[rgba(251,191,36,0.06)]">
          <div className="flex items-center gap-2">
            <input
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
              placeholder="Why are you blocking this?"
              className="flex-1 bg-[rgba(0,0,0,0.3)] border border-amber-400/30 rounded-md px-2.5 h-[32px] text-[12px] text-[var(--fg)]"
              autoFocus
            />
            <button
              onClick={async () => {
                if (!blockReason.trim()) return;
                const ok = await onAction({ action: "block", id: taskId, reason: blockReason });
                if (ok) { setBlockReason(""); setShowBlock(false); }
              }}
              className="px-3 h-[32px] rounded-md bg-amber-400/20 border border-amber-400/50 text-amber-300 text-[12px]"
            >
              Confirm
            </button>
            <button onClick={() => setShowBlock(false)} className="text-amber-300/70 hover:text-amber-200"><X size={14}/></button>
          </div>
        </div>
      )}

      {/* Scrollable body */}
      <div className="scroll flex-1 min-h-0 overflow-y-auto p-5 space-y-5">
        {t.body && (
          <section>
            <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-1.5">Description</div>
            <Md>{t.body}</Md>
          </section>
        )}

        {detail && detail.parents.length > 0 && (
          <section>
            <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-1.5 flex items-center gap-1.5"><GitBranch size={10}/> Parents</div>
            <ul className="text-[11.5px] space-y-1">
              {detail.parents.map((p) => (
                <li key={p.id} className="flex justify-between gap-2 text-[var(--fg-dim)]">
                  <span className="truncate">{p.title}</span>
                  <span className="font-[var(--font-geist-mono)] shrink-0 text-[var(--fg-dimmer)]" style={{ color: STATUS_COLOUR[p.status] }}>{p.status}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {detail && detail.children.length > 0 && (
          <section>
            <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-1.5 flex items-center gap-1.5"><GitBranch size={10}/> Children</div>
            <ul className="text-[11.5px] space-y-1">
              {detail.children.map((c) => (
                <li key={c.id} className="flex justify-between gap-2 text-[var(--fg-dim)]">
                  <span className="truncate">{c.title}</span>
                  <span className="font-[var(--font-geist-mono)] shrink-0 text-[var(--fg-dimmer)]" style={{ color: STATUS_COLOUR[c.status] }}>{c.status}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {detail && detail.latest_summary && (
          <section>
            <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-1.5 flex items-center gap-1.5">
              <Sparkles size={10} style={{ color: "var(--accent-cyan)" }} /> Latest handoff summary
            </div>
            <div className="rounded-lg border border-[var(--panel-border)] bg-[rgba(0,0,0,0.3)] px-4 py-3">
              <Md>{detail.latest_summary}</Md>
            </div>
          </section>
        )}

        {/* Workspace files */}
        {t.result && t.result.trim() && t.result.trim() !== (detail?.latest_summary ?? "").trim() && (
          <section>
            <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-1.5 flex items-center gap-1.5">
              <Sparkles size={10} style={{ color: "var(--accent-cyan)" }} /> Output
            </div>
            <div className="rounded-lg border border-[var(--panel-border)] bg-[rgba(0,0,0,0.3)] px-4 py-3">
              <Md>{t.result}</Md>
            </div>
          </section>
        )}

        <section>
          <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-1.5 flex items-center gap-1.5">
            <FolderOpen size={10} /> Workspace ({wsFiles.length} {wsFiles.length === 1 ? "file" : "files"})
          </div>
          {wsRoot && (
            <div className="flex items-center gap-1.5 mb-2 text-[10.5px] font-[var(--font-geist-mono)] text-[var(--fg-dimmer)]">
              <span className="truncate" title={wsRoot}>{wsRoot.replace(/^\/(?:Users|home)\/[^/]+/, "~")}</span>
              <button
                onClick={() => navigator.clipboard?.writeText(wsRoot)}
                className="opacity-60 hover:opacity-100 transition shrink-0"
                title="Copy workspace path"
              >
                <Copy size={10} />
              </button>
            </div>
          )}
          {wsFiles.length === 0 ? (
            <div className="text-[11.5px] text-[var(--fg-dim)] italic">
              No files yet. {t.status === "running" ? "Worker is still going — refresh once it completes." : "Worker hasn't produced files here."}
            </div>
          ) : (
            <ul className="space-y-1 mb-3">
              {wsFiles.map((f) => (
                <li key={f.relPath}>
                  <button
                    onClick={() => loadFile(f.relPath)}
                    disabled={!f.isText && !VIDEO_RE.test(f.relPath)}
                    className="w-full text-left flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border border-[var(--panel-border)] hover:border-[var(--panel-border-hot)] hover:bg-[rgba(255,255,255,0.03)] transition disabled:opacity-50 disabled:cursor-default"
                    title={f.isText ? "Click to preview" : VIDEO_RE.test(f.relPath) ? "Click to play" : "Binary file — preview unavailable"}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {VIDEO_RE.test(f.relPath)
                        ? <Film size={11} className="shrink-0 text-[var(--accent-pink,#FF5CC8)]" />
                        : <FileText size={11} className="shrink-0 text-[var(--accent-cyan)]" />}
                      <span className="text-[12px] font-[var(--font-geist-mono)] text-[var(--fg)] truncate">{f.relPath}</span>
                    </div>
                    <span className="text-[10px] text-[var(--fg-dimmer)] shrink-0">
                      {(f.bytes / 1024).toFixed(f.bytes < 10240 ? 1 : 0)}KB · {fmtAgo(f.mtime / 1000)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {openFile && (
            <div className="rounded-lg border border-[var(--accent-cyan)]/40 bg-[rgba(0,0,0,0.45)] overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--accent-cyan)]/30 bg-[rgba(34,211,238,0.06)]">
                <div className="flex items-center gap-1.5 text-[11px] font-[var(--font-geist-mono)] text-[var(--accent-cyan)] truncate">
                  <FileText size={11} />
                  <span className="truncate">{openFile.path}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isMarkdownPath(openFile.path) && (
                    <div className="flex rounded-md overflow-hidden border border-[var(--panel-border)]">
                      <button onClick={() => setMdRendered(true)}
                        className="px-2 py-0.5 text-[10px] uppercase tracking-widest flex items-center gap-1"
                        style={{ background: mdRendered ? "rgba(34,211,238,0.14)" : "transparent", color: mdRendered ? "var(--accent-cyan)" : "var(--fg-dim)" }}>
                        <Eye size={10} /> Rendered
                      </button>
                      <button onClick={() => setMdRendered(false)}
                        className="px-2 py-0.5 text-[10px] uppercase tracking-widest flex items-center gap-1"
                        style={{ background: !mdRendered ? "rgba(34,211,238,0.14)" : "transparent", color: !mdRendered ? "var(--accent-cyan)" : "var(--fg-dim)" }}>
                        <Code2 size={10} /> Source
                      </button>
                    </div>
                  )}
                  {openFile.video ? (
                    <a
                      href={wsRawUrl(openFile.path)}
                      download={openFile.path.split("/").pop() || "video.mp4"}
                      className="text-[var(--fg-dim)] hover:text-[var(--fg)] transition flex items-center gap-1 text-[10px] uppercase tracking-widest"
                      title="Download video"
                    >
                      <Download size={10} /> Save
                    </a>
                  ) : (
                    <>
                      <button
                        onClick={() => navigator.clipboard?.writeText(openFile.content)}
                        className="text-[var(--fg-dim)] hover:text-[var(--fg)] transition flex items-center gap-1 text-[10px] uppercase tracking-widest"
                        title="Copy file contents"
                      >
                        <Copy size={10} /> Copy
                      </button>
                      <button
                        onClick={() => {
                          const blob = new Blob([openFile.content], { type: "text/plain" });
                          const u = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = u; a.download = openFile.path.split("/").pop() || "file";
                          document.body.appendChild(a); a.click(); a.remove();
                          URL.revokeObjectURL(u);
                        }}
                        className="text-[var(--fg-dim)] hover:text-[var(--fg)] transition flex items-center gap-1 text-[10px] uppercase tracking-widest"
                        title="Save to your Downloads"
                      >
                        <Download size={10} /> Save
                      </button>
                    </>
                  )}
                  <button onClick={() => setOpenFile(null)} className="text-[var(--fg-dim)] hover:text-[var(--fg)]"><X size={12}/></button>
                </div>
              </div>
              {openFile.video ? (
                <div className="p-3 bg-black/40">
                  <video
                    src={wsRawUrl(openFile.path)}
                    controls
                    preload="metadata"
                    className="w-full max-h-[440px] rounded-md bg-black"
                  />
                </div>
              ) : isMarkdownPath(openFile.path) && mdRendered ? (
                <div className="p-4"><Md>{openFile.content}</Md></div>
              ) : (
                <pre className="p-3 text-[12px] leading-relaxed text-[var(--fg)] whitespace-pre-wrap font-[var(--font-geist-mono)]">
                  {openFile.content}
                </pre>
              )}
              {openFile.truncated && (
                <div className="px-3 py-1.5 text-[10px] text-amber-300 border-t border-amber-400/30 bg-[rgba(251,191,36,0.06)]">
                  ⚠ File is large — only the first 1MB shown. Click <strong>Save</strong> for the full file.
                </div>
              )}
            </div>
          )}
        </section>

        {detail && detail.runs && detail.runs.length > 0 && (
          <section>
            <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-1.5">Run history ({detail.runs.length})</div>
            <ul className="space-y-1.5">
              {detail.runs.map((r, i) => (
                <li key={r.id ?? i} className="border-l-2 border-[var(--panel-border)] pl-2.5 text-[11.5px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--fg)] font-medium">{r.outcome ?? "?"} {r.profile ? `· ${r.profile}` : ""}</span>
                    <span className="text-[10px] text-[var(--fg-dimmer)]">{r.ended_at ? `${Math.round(((r.ended_at - (r.started_at ?? 0)) || 0))}s` : "—"}</span>
                  </div>
                  {r.summary && <div className="mt-0.5 text-[var(--fg-dim)] line-clamp-2">{r.summary}</div>}
                  {r.error && <div className="mt-0.5 text-rose-300/80 line-clamp-2">{r.error}</div>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-1.5 flex items-center gap-1.5">
            <MessageSquare size={10}/> Comments ({detail?.comments.length ?? 0})
          </div>
          {detail && detail.comments.length > 0 ? (
            <ul className="space-y-2 mb-2">
              {detail.comments.map((c, i) => (
                <li key={c.id ?? i} className="rounded-lg border border-[var(--panel-border)] bg-[rgba(255,255,255,0.02)] px-3.5 py-3">
                  <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-1.5 flex items-center gap-1.5">
                    <span className="font-semibold text-[var(--fg-dim)]">{c.author ?? "anonymous"}</span>
                    <span className="text-[var(--panel-border-hot)]">·</span> {fmtAgo(c.created_at)} ago
                  </div>
                  <Md>{c.body}</Md>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-[11.5px] text-[var(--fg-dim)] mb-2 italic">No comments yet. Drop one to give the worker context on its next run.</div>
          )}
          <div className="flex items-start gap-2">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendComment(); }}
              rows={2}
              placeholder="Add a comment… (⌘+Enter to send)"
              className="flex-1 bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-2.5 py-1.5 text-[12.5px] text-[var(--fg)] outline-none focus:border-[var(--panel-border-hot)] resize-y"
            />
            <button
              onClick={sendComment}
              disabled={!comment.trim() || isBusy("comment")}
              className="h-[36px] px-3 rounded-lg text-[12px] flex items-center gap-1 transition disabled:opacity-40"
              style={{ background: "rgba(20,184,166,0.18)", border: "1px solid rgba(20,184,166,0.55)", color: "#14b8a6" }}
            >
              <Send size={12}/> Send
            </button>
          </div>
        </section>

        {detail && detail.events.length > 0 && (
          <section>
            <details>
              <summary className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] cursor-pointer hover:text-[var(--fg-dim)]">
                Event log ({detail.events.length})
              </summary>
              <ul className="mt-2 space-y-0.5 max-h-[200px] overflow-auto scroll">
                {detail.events.slice().reverse().map((e, i) => (
                  <li key={e.id ?? i} className="text-[10.5px] font-[var(--font-geist-mono)] text-[var(--fg-dim)] flex gap-2">
                    <span className="text-[var(--fg-dimmer)] shrink-0">{fmtAgo(e.created_at)}</span>
                    <span className="text-[var(--fg)] shrink-0">{e.kind}</span>
                    {e.payload && Object.keys(e.payload).length > 0 && (
                      <span className="truncate text-[var(--fg-dimmer)]">{JSON.stringify(e.payload).slice(0, 100)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          </section>
        )}
      </div>
    </div>
  );
}

function ActBtn({
  onClick, busy, icon, colour, children,
}: { onClick: () => void; busy?: boolean; icon: React.ReactNode; colour: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="px-2.5 h-[28px] rounded-md flex items-center gap-1.5 text-[12px] transition disabled:opacity-40"
      style={{ background: `${colour}1a`, border: `1px solid ${colour}55`, color: colour }}
    >
      {busy ? <RefreshCw size={11} className="animate-spin" /> : icon}{children}
    </button>
  );
}

// Shown when the Kanban backend isn't usable. The board is Hermes-powered
// (reads ~/.hermes/kanban.db, writes via the `hermes kanban` CLI) and the read
// path needs node:sqlite (Node 22+). This card translates whichever piece is
// missing into clear next steps — instead of a confusing empty board.
function KanbanSetupCard({ reason, setup }: {
  reason?: string;
  setup?: { hermesInstalled: boolean; dbExists: boolean; nodeOk: boolean };
}) {
  const nodeOk = setup?.nodeOk !== false && reason !== "node-sqlite-missing";
  const hermesInstalled = setup?.hermesInstalled !== false;

  // Pick the single most relevant blocker to lead with.
  let title: string;
  let body: string;
  let steps: { label: string; cmd?: string }[];

  if (!nodeOk) {
    title = "The Kanban needs Node 22 or newer";
    body = "The board reads its data via Node's built-in SQLite (node:sqlite), which only exists on Node 22+. You're on an older Node, so the board can't load.";
    steps = [
      { label: "Check your version", cmd: "node -v" },
      { label: "Install Node 22 (Homebrew)", cmd: "brew install node@22" },
      { label: "Then restart the dev server", cmd: "npm run dev" },
    ];
  } else if (!hermesInstalled) {
    title = "The Kanban is powered by Hermes — install it to use it";
    body = "This isn't a placeholder — the board reads Hermes's task database and creates tasks through the Hermes CLI. With no Hermes installed, the board is empty and “create task” can't work. (Same reason the agent cards need Hermes.)";
    steps = [
      { label: "Install Hermes", cmd: "npm i -g @nousresearch/hermes-agent" },
      { label: "Authenticate a provider", cmd: "hermes login" },
      { label: "Create your first task (initialises the board)", cmd: "hermes kanban create \"My first task\"" },
      { label: "Restart, then reload this page", cmd: "npm run dev" },
    ];
  } else {
    title = "No board yet — create your first task";
    body = "Hermes is installed but hasn't created a Kanban board database yet. One command initialises it, then this page will mirror your tasks live.";
    steps = [
      { label: "Initialise the board", cmd: "hermes kanban create \"My first task\"" },
      { label: "Confirm it exists", cmd: "hermes kanban list" },
    ];
  }

  return (
    <div className="panel p-4 border" style={{ borderColor: "rgba(96,165,250,0.4)", background: "rgba(96,165,250,0.06)" }}>
      <div className="flex items-start gap-3">
        <div className="grid place-items-center w-9 h-9 rounded-lg shrink-0"
             style={{ background: "rgba(96,165,250,0.16)", color: "#60a5fa", border: "1px solid rgba(96,165,250,0.4)" }}>
          <Layers size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-[var(--fg)] mb-1">{title}</div>
          <div className="text-[12.5px] text-[var(--fg-dim)] leading-snug mb-3">{body}</div>
          <div className="space-y-1.5">
            {steps.map((s, i) => (
              <div key={i}>
                <div className="text-[11px] text-[var(--fg-dimmer)] mb-0.5">{i + 1}. {s.label}</div>
                {s.cmd && (
                  <code className="block text-[11.5px] font-[var(--font-geist-mono)] px-2.5 py-1.5 rounded-md"
                        style={{ background: "rgba(0,0,0,0.35)", color: "#60a5fa", border: "1px solid var(--panel-border)" }}>
                    {s.cmd}
                  </code>
                )}
              </div>
            ))}
          </div>
          <div className="text-[11px] text-[var(--fg-dimmer)] mt-3 leading-snug">
            Once <code className="font-[var(--font-geist-mono)]">hermes kanban list</code> shows your tasks in the terminal, this page mirrors them automatically. The dashboard is a window onto Hermes — not its own database.
          </div>
        </div>
      </div>
    </div>
  );
}

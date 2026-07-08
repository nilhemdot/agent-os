"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookOpen, Plus, Send, RefreshCw, MessageSquare, Library, Headphones,
  Video as VideoIcon, Image as ImageIcon, Brain, FileText, Layers, FileQuestion,
  Sparkles, AlertCircle, Download, Clock, ExternalLink, X, ChevronRight,
  Telescope, Globe, Zap, Loader2,
} from "lucide-react";
import VoiceButton from "./VoiceButton";

type Tab = "library" | "shortvideo" | "research" | "chat" | "studio" | "assets";
type ResearchSource = { title?: string; url?: string; source?: string; link?: string; type?: string; snippet?: string; description?: string; summary?: string; [k: string]: unknown };
type ResearchPhase = "idle" | "starting" | "running" | "done" | "error";
// The 9 artifact types the new MCP actually supports (matches studio_create + download_artifact).
type ArtifactType =
  | "audio" | "video" | "infographic" | "slide_deck" | "report"
  | "flashcards" | "quiz" | "data_table" | "mind_map";

interface Notebook {
  id: string;
  title?: string;          // new MCP returns "title", not "name"
  name?: string;           // tolerate old shape too
  description?: string;
  source_count?: number;
  created_at?: string | number;
  updated_at?: string | number;
  url?: string;
  share_url?: string;
}
interface Artifact {
  artifact_id: string;
  type: string;
  title?: string;
  status?: string;
  created_at?: string | number;
  // Per-type URL fields returned by studio_status — usually one will be populated
  audio_url?: string | null;
  video_url?: string | null;
  infographic_url?: string | null;
  slide_deck_url?: string | null;
  report_content?: string | null;
  flashcard_count?: number | null;
  duration_seconds?: number | null;
  custom_instructions?: string | null;
}
interface SavedAsset {
  name: string; path: string; relPath: string;
  bytes: number; mtime: number; notebook: string;
  kind: "audio" | "video" | "image" | "pdf" | "html" | "doc" | "other";
}
interface ChatMsg { role: "user" | "assistant"; text: string; ts: number; }

const STORAGE_PREFIX = "agentic-os-notebooklm-chat-v2:";

const ARTIFACT_TYPES: { value: ArtifactType; label: string; icon: React.ReactNode; colour: string }[] = [
  { value: "audio",       label: "Audio Overview", icon: <Headphones size={14} />,    colour: "#22d3ee" },
  { value: "video",       label: "Video",          icon: <VideoIcon size={14} />,     colour: "#a855f7" },
  { value: "slide_deck",  label: "Slide Deck",     icon: <Layers size={14} />,        colour: "#fde047" },
  { value: "mind_map",    label: "Mind Map",       icon: <Brain size={14} />,         colour: "#10b981" },
  { value: "infographic", label: "Infographic",    icon: <ImageIcon size={14} />,     colour: "#ec4899" },
  { value: "flashcards",  label: "Flashcards",     icon: <Layers size={14} />,        colour: "#fb923c" },
  { value: "quiz",        label: "Quiz",           icon: <FileQuestion size={14} />,  colour: "#f87171" },
  { value: "data_table",  label: "Data Table",     icon: <FileText size={14} />,      colour: "#60a5fa" },
  { value: "report",      label: "Report",         icon: <FileText size={14} />,      colour: "#fb7185" },
];

const ACCENT = "#fde047";

function fmtAgo(input: string | number | undefined): string {
  if (!input) return "—";
  const ts = typeof input === "number" ? input : Date.parse(input);
  if (!Number.isFinite(ts)) return "—";
  const d = Date.now() - (ts > 1e12 ? ts : ts * 1000);
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d/60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d/3_600_000)}h ago`;
  return `${Math.floor(d/86_400_000)}d ago`;
}
function notebookLabel(n: Notebook): string { return n.title || n.name || n.id; }

export default function NotebookView() {
  const [tab, setTab] = useState<Tab>("library");
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [authErr, setAuthErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Chat
  const [question, setQuestion] = useState("");
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [thinking, setThinking] = useState(false);

  // Studio
  const [studioType, setStudioType] = useState<ArtifactType>("audio");
  const [studioPrompt, setStudioPrompt] = useState("");
  const [studioBusy, setStudioBusy] = useState(false);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);

  // Short Video generator
  const [svFocus, setSvFocus] = useState("");
  const [svBusy, setSvBusy] = useState(false);
  const [svStatus, setSvStatus] = useState<string | null>(null);
  const [svVideo, setSvVideo] = useState<string | null>(null);
  const svPoll = useRef<ReturnType<typeof setTimeout> | null>(null);
  const SV_RENDERING = "⏳ Google is rendering your short — usually 10–15 min (that's the wait; the video is ~60s). It shows up under \"Your shorts\" below and plays automatically when it's done — you can leave and come back.";
  const SV_PENDING_KEY = "agentic-os/notebooklm-sv-pending";
  const [svRecent, setSvRecent] = useState<{ id: string; status: string; label: string; cached: boolean }[]>([]);
  useEffect(() => () => { if (svPoll.current) clearTimeout(svPoll.current); }, []);

  const loadRecent = useCallback(async (nb: string) => {
    try { const r = await fetch(`/api/notebooklm/shortvideo/recent?nb=${nb}`, { cache: "no-store" }); const j = await r.json(); setSvRecent(j.videos || []); } catch { setSvRecent([]); }
  }, []);

  const pollShort = useCallback((nb: string, artId: string) => {
    if (svPoll.current) clearTimeout(svPoll.current);
    const tick = async () => {
      try {
        const s = await fetch(`/api/notebooklm/shortvideo/status?nb=${nb}&id=${artId}`, { cache: "no-store" }).then((x) => x.json());
        if (s.status === "completed" && s.video) { setSvVideo(s.video); setSvStatus("Done ✓ — your short is ready."); setSvBusy(false); try { localStorage.removeItem(SV_PENDING_KEY); } catch {} loadRecent(nb); }
        else if (s.status === "failed") { setSvStatus("⚠ Generation failed — try a different notebook or focus."); setSvBusy(false); try { localStorage.removeItem(SV_PENDING_KEY); } catch {} }
        else { setSvStatus(SV_RENDERING); loadRecent(nb); svPoll.current = setTimeout(tick, 12000); }
      } catch { svPoll.current = setTimeout(tick, 15000); }
    };
    svPoll.current = setTimeout(tick, 3000);
  }, [loadRecent]);

  async function playRecent(id: string) {
    if (!activeId) return;
    setSvStatus("Loading that short…");
    try {
      const s = await fetch(`/api/notebooklm/shortvideo/status?nb=${activeId}&id=${id}`, { cache: "no-store" }).then((x) => x.json());
      if (s.status === "completed" && s.video) { setSvVideo(s.video); setSvStatus(null); loadRecent(activeId); }
      else setSvStatus("That one's still rendering — check back in a few minutes.");
    } catch { setSvStatus("Couldn't load that short."); }
  }

  // Resume a still-cooking render on return.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SV_PENDING_KEY);
      if (raw) { const { nb, id } = JSON.parse(raw); if (nb && id) { setSvBusy(true); setSvStatus("⏳ Picking your short back up…"); pollShort(nb, id); } }
    } catch {}
  }, [pollShort]);
  // Whenever a notebook is picked on the Short Video tab, list its shorts.
  useEffect(() => { if (tab === "shortvideo" && activeId) loadRecent(activeId); }, [tab, activeId, loadRecent]);
  // While any short is still rendering, quietly refresh the list every 30s.
  useEffect(() => {
    if (tab !== "shortvideo" || !activeId) return;
    const rendering = svRecent.some((v) => v.status !== "completed" && !/fail/i.test(v.status));
    if (!rendering) return;
    const iv = setInterval(() => loadRecent(activeId), 30000);
    return () => clearInterval(iv);
  }, [tab, activeId, svRecent, loadRecent]);

  async function generateShort() {
    if (!activeId || svBusy) return;
    setSvBusy(true); setSvVideo(null); setSvStatus("Starting your short…");
    try {
      const r = await fetch("/api/notebooklm/shortvideo", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notebookId: activeId, focus: svFocus }),
      });
      const j = await r.json();
      if (!r.ok || j.error) { setSvStatus(`⚠ ${j.error || `HTTP ${r.status}`}`); setSvBusy(false); return; }
      try { localStorage.setItem(SV_PENDING_KEY, JSON.stringify({ nb: activeId, id: j.artifactId })); } catch {}
      setSvStatus(SV_RENDERING);
      pollShort(activeId, j.artifactId);
    } catch (e) { setSvStatus(`⚠ ${String(e).slice(0, 120)}`); setSvBusy(false); }
  }

  // Saved assets (downloaded artifacts in the vault)
  const [savedAssets, setSavedAssets] = useState<SavedAsset[]>([]);

  // NotebookLM's new agentic research
  const [rQuery, setRQuery] = useState("");
  const [rMode, setRMode] = useState<"fast" | "deep">("fast");
  const [rPhase, setRPhase] = useState<ResearchPhase>("idle");
  const [rSources, setRSources] = useState<ResearchSource[]>([]);
  const [rTaskId, setRTaskId] = useState<string | null>(null);
  const [rMsg, setRMsg] = useState("");
  const [rImporting, setRImporting] = useState(false);
  const rPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (rPollRef.current) clearInterval(rPollRef.current); }, []);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const t = sp.get("tab");
    if (t && ["library", "shortvideo", "research", "chat", "studio", "assets"].includes(t)) setTab(t as Tab);
    const nb = sp.get("nb"); if (nb) setActiveId(nb);
  }, []);

  // Persist the Research tab: when a notebook is active, load its last research so the
  // discovered sources are visible whenever you open it — not only during a live run.
  useEffect(() => {
    if (!activeId) { setRSources([]); setRPhase("idle"); setRMsg(""); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/notebooklm/research?notebook_id=${activeId}`, { cache: "no-store" });
        const j = await r.json();
        const srcs: ResearchSource[] = Array.isArray(j.sources) ? j.sources : [];
        if (cancelled) return;
        if (srcs.length) { setRSources(srcs); setRPhase("done"); setRTaskId(j.task_id || null); setRMsg(`${srcs.length} sources from your last research`); }
        else { setRSources([]); setRPhase("idle"); setRMsg(""); }
      } catch { /* */ }
    })();
    return () => { cancelled = true; };
  }, [activeId]);

  const activeNotebook = notebooks.find((n) => n.id === activeId) ?? null;

  const refreshNotebooks = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch("/api/notebooklm/notebooks", { cache: "no-store" });
      const j = await r.json();
      const list: Notebook[] = j?.notebooks ?? j?.data?.notebooks ?? (Array.isArray(j) ? j : []);
      setNotebooks(list);
    } catch (e) { setErr(String(e)); }
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const r = await fetch("/api/notebooklm/health", { cache: "no-store" });
      const j = await r.json();
      setAuthed(!!j?.data?.authenticated);
      setAuthErr(j?.data?.error ?? null);
    } catch (e) { setAuthed(false); setAuthErr(String(e)); }
  }, []);

  const refreshAssets = useCallback(async () => {
    try {
      const r = await fetch("/api/notebooklm/library", { cache: "no-store" });
      const j = await r.json();
      setSavedAssets(j?.savedAssets ?? []);
    } catch { /* ignore */ }
  }, []);

  const refreshArtifacts = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/notebooklm/studio?notebook_id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const j = await r.json();
      // studio_status returns: { status, notebook_id, summary: {total, completed, in_progress}, artifacts: [...] }
      const list: Artifact[] = j?.artifacts ?? [];
      setArtifacts(Array.isArray(list) ? list : []);
    } catch { setArtifacts([]); }
  }, []);

  useEffect(() => { refreshHealth(); refreshNotebooks(); refreshAssets(); }, [refreshHealth, refreshNotebooks, refreshAssets]);
  useEffect(() => {
    if (activeId) refreshArtifacts(activeId);
  }, [activeId, refreshArtifacts]);

  // Chat history persistence per notebook
  useEffect(() => {
    if (!activeId) { setMsgs([]); return; }
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + activeId);
      setMsgs(raw ? JSON.parse(raw) : []);
    } catch { setMsgs([]); }
  }, [activeId]);
  useEffect(() => {
    if (!activeId) return;
    try { localStorage.setItem(STORAGE_PREFIX + activeId, JSON.stringify(msgs.slice(-50))); } catch {}
  }, [msgs, activeId]);

  async function ask() {
    const q = question.trim();
    if (!q || !activeId || thinking) return;
    setMsgs((m) => [...m, { role: "user", text: q, ts: Date.now() }]);
    setQuestion(""); setThinking(true);
    try {
      const r = await fetch("/api/notebooklm/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q, notebook_id: activeId, notebook_name: activeNotebook ? notebookLabel(activeNotebook) : undefined }),
      });
      const j = await r.json();
      const ans = j?.answer ?? j?.response ?? j?.error ?? "(no answer)";
      setMsgs((m) => [...m, { role: "assistant", text: String(ans), ts: Date.now() }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", text: `[error] ${String(e)}`, ts: Date.now() }]);
    }
    setThinking(false);
  }

  async function createArtifact() {
    if (!activeId || studioBusy) return;
    setStudioBusy(true); setErr(null);
    try {
      const r = await fetch("/api/notebooklm/studio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          notebook_id: activeId,
          artifact_type: studioType,
          custom_prompt: studioPrompt.trim() || undefined,
        }),
      });
      const j = await r.json();
      if (j?.error) setErr(String(j.error));
      else { setStudioPrompt(""); await refreshArtifacts(activeId); }
    } catch (e) { setErr(String(e)); }
    setStudioBusy(false);
  }

  async function downloadArtifact(artifact: Artifact) {
    if (!activeId || !activeNotebook) return;
    setBusy(`dl-${artifact.artifact_id}`);
    setErr(null);
    try {
      const r = await fetch("/api/notebooklm/artifact/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          notebook_id: activeId,
          artifact_id: artifact.artifact_id,
          artifact_type: artifact.type,
          title: artifact.title,
          notebook_name: notebookLabel(activeNotebook),
        }),
      });
      const j = await r.json();
      if (j?.error) setErr(String(j.error));
      else await refreshAssets();
    } catch (e) { setErr(String(e)); }
    setBusy(null);
  }

  async function createNotebook() {
    const title = prompt("Notebook title:");
    if (!title) return;
    setBusy("new-nb"); setErr(null);
    try {
      const r = await fetch("/api/notebooklm/notebooks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const j = await r.json();
      if (j?.error) setErr(String(j.error));
      else await refreshNotebooks();
    } catch (e) { setErr(String(e)); }
    setBusy(null);
  }

  // --- NotebookLM agentic research: start → poll → import ---
  function pollResearch(taskId: string | null) {
    if (rPollRef.current) clearInterval(rPollRef.current);
    const tick = async () => {
      if (!activeId) return;
      try {
        const qs = new URLSearchParams({ notebook_id: activeId });
        if (taskId) qs.set("task_id", taskId);
        const r = await fetch(`/api/notebooklm/research?${qs.toString()}`, { cache: "no-store" });
        const j = await r.json();
        const srcs: ResearchSource[] = Array.isArray(j.sources) ? j.sources : [];
        if (srcs.length) setRSources(srcs);
        const st = String(j.status || "").toLowerCase();
        if (/(complete|done|ready|success|finish)/.test(st)) {
          if (rPollRef.current) clearInterval(rPollRef.current);
          setRPhase("done"); setRMsg(`${srcs.length} source${srcs.length === 1 ? "" : "s"} discovered`);
        } else if (/(error|fail)/.test(st)) {
          if (rPollRef.current) clearInterval(rPollRef.current);
          setRPhase("error"); setRMsg(String(j.error || "Research failed."));
        }
      } catch { /* keep polling */ }
    };
    tick();
    rPollRef.current = setInterval(tick, 4000);
  }

  async function startResearch() {
    if (!activeId || !rQuery.trim() || rPhase === "starting" || rPhase === "running") return;
    setRPhase("starting"); setRSources([]); setRTaskId(null);
    setRMsg(rMode === "deep" ? "Sending the agent deep into the web…" : "Scanning the web for sources…");
    try {
      const r = await fetch("/api/notebooklm/research", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: rQuery.trim(), mode: rMode, notebook_id: activeId }),
      });
      const j = await r.json();
      if (j?.error || j?.status === "error") { setRPhase("error"); setRMsg(String(j.error || "Research couldn't start.")); return; }
      setRTaskId(j.task_id || null);
      setRPhase("running");
      setRMsg(rMode === "deep" ? "Deep research running — combing ~40 sources (~5 min)…" : "Discovering sources across the web (~30s)…");
      pollResearch(j.task_id || null);
    } catch (e) { setRPhase("error"); setRMsg(String(e)); }
  }

  async function importResearch() {
    if (!activeId || rImporting) return;
    setRImporting(true);
    try {
      const r = await fetch("/api/notebooklm/research/import", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ notebook_id: activeId, task_id: rTaskId || undefined }),
      });
      const j = await r.json();
      if (j?.error) setErr(String(j.error));
      else { setRMsg(`Imported into the notebook — open Chat to query the sources.`); await refreshNotebooks(); }
    } catch (e) { setErr(String(e)); }
    setRImporting(false);
  }

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "library",  label: "Library",  icon: <Library size={14} /> },
    { key: "shortvideo", label: "Short Video", icon: <VideoIcon size={14} /> },
    { key: "research", label: "Research", icon: <Telescope size={14} /> },
    { key: "chat",     label: "Chat",     icon: <MessageSquare size={14} /> },
    { key: "studio",   label: "Studio",   icon: <Sparkles size={14} /> },
    { key: "assets",   label: "Assets",   icon: <Download size={14} /> },
  ];

  return (
    <div className="space-y-5">
      {/* Header strip with auth status */}
      <div className="panel p-3 flex items-center gap-3 flex-wrap">
        <BookOpen size={16} style={{ color: ACCENT }} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium" style={{ color: ACCENT }}>NotebookLM</div>
          <div className="text-[11px] text-[var(--fg-dim)]">
            {authed === null && "checking…"}
            {authed === false && <>⚠ Not connected — see <code>install/15-NOTEBOOKLM.md</code>. Quick fix: run <code>nlm login</code> in a terminal (or <code>nlm doctor</code> to diagnose){authErr && <> · <span className="text-rose-300">{authErr.slice(0,140)}</span></>}</>}
            {authed === true && <>✓ Authenticated · {notebooks.length} notebook{notebooks.length === 1 ? "" : "s"} · {savedAssets.length} saved asset{savedAssets.length === 1 ? "" : "s"}{activeNotebook && <> · active: <span className="text-[var(--fg)]">{notebookLabel(activeNotebook)}</span></>}</>}
          </div>
        </div>
        <button
          onClick={() => { refreshHealth(); refreshNotebooks(); refreshAssets(); if (activeId) refreshArtifacts(activeId); }}
          className="px-2.5 h-[30px] rounded-lg border border-[var(--panel-border)] hover:border-[var(--panel-border-hot)] text-[11px] text-[var(--fg-dim)] hover:text-[var(--fg)] flex items-center gap-1 transition"
        >
          <RefreshCw size={11} /> Refresh
        </button>
      </div>

      {err && (
        <div className="panel p-3 border-rose-400/40 text-rose-300 text-[12.5px] flex items-start gap-2">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          <pre className="font-[var(--font-geist-mono)] whitespace-pre-wrap break-words flex-1">{err}</pre>
          <button onClick={() => setErr(null)} className="text-rose-300 hover:text-rose-100"><X size={14}/></button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-[12.5px] transition"
              style={{
                background: active ? `${ACCENT}22` : "transparent",
                borderColor: active ? ACCENT : "var(--panel-border)",
                color: active ? "var(--fg)" : "var(--fg-dim)",
              }}>
              {t.icon}{t.label}
            </button>
          );
        })}
      </div>

      {tab === "library" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={createNotebook}
              className="px-3 h-[34px] rounded-lg flex items-center gap-1.5 text-[12px] transition"
              style={{ background: `${ACCENT}22`, border: `1px solid ${ACCENT}55`, color: ACCENT }}
            >
              <Plus size={12} /> New notebook
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {notebooks.length === 0 && (
              <div className="panel p-6 text-center text-[var(--fg-dim)] text-sm md:col-span-2 lg:col-span-3">
                {authed === false ? "Connect NotebookLM first — see install/15-NOTEBOOKLM.md (install the tool, then run `nlm login`)." : "No notebooks yet. Click \"New notebook\" or create one at notebooklm.google.com — they sync automatically."}
              </div>
            )}
            {notebooks.map((n) => {
              const active = n.id === activeId;
              return (
                <motion.button
                  key={n.id}
                  initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                  onClick={() => setActiveId(n.id)}
                  className="panel panel-hover p-4 text-left relative overflow-hidden transition"
                  style={{ borderColor: active ? ACCENT : "var(--panel-border)", background: active ? `${ACCENT}10` : undefined }}
                >
                  <div className="flex items-start gap-2 mb-1.5">
                    <BookOpen size={14} style={{ color: ACCENT }} className="shrink-0 mt-0.5" />
                    <div className="text-[14px] font-medium text-[var(--fg)] line-clamp-2 flex-1">{notebookLabel(n)}</div>
                    {active && <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded-full" style={{ background: `${ACCENT}22`, color: ACCENT }}>active</span>}
                  </div>
                  {n.description && <div className="text-[12px] text-[var(--fg-dim)] leading-snug line-clamp-3 mb-2">{n.description}</div>}
                  <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] font-[var(--font-geist-mono)] truncate">
                    {n.id}{typeof n.source_count === "number" && ` · ${n.source_count} sources`}
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>
      )}

      {tab === "shortvideo" && (
        <div className="space-y-4">
          <div className="panel p-5 space-y-4">
            <div className="flex items-center gap-2">
              <VideoIcon size={16} style={{ color: ACCENT }} />
              <div>
                <div className="text-[14px] font-medium text-[var(--fg)]">Short Video Generator</div>
                <div className="text-[12px] text-[var(--fg-dim)]">Pick a notebook, hit go. NotebookLM turns its sources into a ~60-second <b style={{ color: "var(--fg)" }}>vertical</b> short — ready for Reels, Shorts &amp; TikTok. <span className="text-[var(--fg-dimmer)]">Rendering takes ~10–15 min on Google&apos;s side; it plays here when done.</span></div>
              </div>
            </div>
            {authed === false ? (
              <div className="text-[12.5px] text-[var(--fg-dim)]">Connect NotebookLM first — run <code>nlm login</code> in a terminal.</div>
            ) : (<>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">1 · Choose a notebook</label>
                <select value={activeId ?? ""} onChange={(e) => setActiveId(e.target.value || null)}
                  className="w-full mt-1 bg-[var(--panel)] border border-[var(--panel-border)] rounded-lg px-3 h-[38px] text-[13px] text-[var(--fg)] focus:outline-none">
                  <option value="">Choose a notebook…</option>
                  {notebooks.map((n) => <option key={n.id} value={n.id}>{notebookLabel(n)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">2 · What&apos;s it about? <span className="opacity-60 normal-case tracking-normal">(optional)</span></label>
                <textarea value={svFocus} onChange={(e) => setSvFocus(e.target.value)} rows={2}
                  placeholder="e.g. the one big idea, punchy and energetic — or leave blank and let it choose"
                  className="w-full mt-1 bg-[var(--panel)] border border-[var(--panel-border)] rounded-lg px-3 py-2 text-[13px] text-[var(--fg)] focus:outline-none resize-none" />
              </div>
              <button onClick={generateShort} disabled={!activeId || svBusy}
                className="w-full h-[44px] rounded-xl flex items-center justify-center gap-2 text-[14px] font-semibold disabled:opacity-40 transition"
                style={{ background: ACCENT, color: "#1a1400" }}>
                {svBusy ? <><Loader2 size={15} className="animate-spin" /> Generating…</> : <><VideoIcon size={15} /> Generate Short Video</>}
              </button>
              {svStatus && <div className="text-[12.5px] text-center" style={{ color: svStatus.startsWith("⚠") ? "#fca5a5" : svStatus.startsWith("Done") ? "#86efac" : "var(--fg-dim)" }}>{svStatus}</div>}
              <div className="text-[11px] text-[var(--fg-dimmer)] text-center">No notebook yet? Make one in the <button onClick={() => setTab("library")} className="underline" style={{ color: ACCENT }}>Library</button> tab (add a doc, PDF, or YouTube link) — then come back.</div>
            </>)}
          </div>

          {svVideo && (
            <div className="panel p-4 flex flex-col items-center gap-3">
              <video src={svVideo} controls playsInline autoPlay muted loop className="rounded-xl bg-black" style={{ maxHeight: "72vh", aspectRatio: "9/16" }} />
              <a href={svVideo} download className="px-3 h-[34px] rounded-lg flex items-center gap-1.5 text-[12px]" style={{ background: `${ACCENT}22`, border: `1px solid ${ACCENT}55`, color: ACCENT }}><Download size={12} /> Download</a>
            </div>
          )}

          {activeId && svRecent.length > 0 && (
            <div className="panel p-4">
              <div className="flex items-center gap-2 mb-1.5">
                <VideoIcon size={13} style={{ color: ACCENT }} />
                <div className="text-[12.5px] font-medium text-[var(--fg)]">Your shorts in this notebook</div>
                <button onClick={() => loadRecent(activeId)} title="Refresh" className="ml-auto text-[var(--fg-dim)] hover:text-[var(--fg)]"><RefreshCw size={12} /></button>
              </div>
              {svRecent.map((v) => (
                <div key={v.id} className="flex items-center gap-2 py-2 border-t border-[var(--panel-border)]">
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 uppercase tracking-wide" style={{ background: v.status === "completed" ? "#22c55e22" : "#eab30822", color: v.status === "completed" ? "#86efac" : "#fde047" }}>{v.status === "completed" ? "ready" : "rendering"}</span>
                  <span className="text-[12px] text-[var(--fg-dim)] truncate flex-1">{v.label}</span>
                  {v.status === "completed"
                    ? <button onClick={() => playRecent(v.id)} className="text-[11px] px-2.5 py-1 rounded-lg shrink-0 flex items-center gap-1" style={{ background: `${ACCENT}22`, border: `1px solid ${ACCENT}55`, color: ACCENT }}>▶ Play</button>
                    : <Loader2 size={13} className="animate-spin shrink-0" style={{ color: "#fde047" }} />}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "research" && (
        <div className="space-y-4">
          {!activeNotebook ? (
            <div className="panel p-8 text-center">
              <Telescope size={28} className="mx-auto mb-3" style={{ color: ACCENT }} />
              <div className="text-sm font-medium">Pick a notebook first</div>
              <div className="mt-1 text-[12px] text-[var(--fg-dim)]">Research drops the sources it finds into a notebook. Go to Library and pick one (or make a new one).</div>
            </div>
          ) : (
            <>
              <div className="panel p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Telescope size={15} style={{ color: ACCENT }} />
                  <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">New · agentic research · into <span className="text-[var(--fg-dim)]">{notebookLabel(activeNotebook)}</span></div>
                </div>
                <p className="text-[12.5px] text-[var(--fg-dim)]">Ask anything. NotebookLM&apos;s new research agent scours the web, finds the best sources, and brings them back into your notebook — then you chat them or turn them into visuals in Studio.</p>
                <div className="flex flex-col gap-2 rounded-2xl border border-[var(--panel-border)] bg-[rgba(0,0,0,0.25)] p-2 focus-within:border-[var(--panel-border-hot)]">
                  <textarea value={rQuery} onChange={(e) => setRQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); startResearch(); } }}
                    rows={2} placeholder="e.g. the best AI agent frameworks in 2026, with pros and cons…"
                    className="flex-1 bg-transparent outline-none resize-none px-2 py-1.5 text-[14px] text-[var(--fg)] placeholder:text-[var(--fg-dimmer)]" />
                  <div className="flex items-center justify-between gap-2 px-1 flex-wrap">
                    <div className="inline-flex rounded-lg border border-[var(--panel-border)] overflow-hidden text-[11px]">
                      {([["fast", "⚡ Fast · ~30s"], ["deep", "🌊 Deep · ~5min"]] as const).map(([m, l]) => (
                        <button key={m} onClick={() => setRMode(m)} className="px-2.5 py-1.5 transition"
                          style={{ background: rMode === m ? `${ACCENT}22` : "transparent", color: rMode === m ? ACCENT : "var(--fg-dim)" }}>{l}</button>
                      ))}
                    </div>
                    <button onClick={startResearch} disabled={!rQuery.trim() || rPhase === "starting" || rPhase === "running"}
                      className="px-3 h-[34px] rounded-lg flex items-center gap-1.5 text-sm transition disabled:opacity-40"
                      style={{ background: `${ACCENT}22`, border: `1px solid ${ACCENT}55`, color: ACCENT }}>
                      <Zap size={14} /> Discover sources
                    </button>
                  </div>
                </div>
              </div>

              {rPhase !== "idle" && (
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                  className="panel p-3 flex items-center gap-3 relative overflow-hidden"
                  style={{ borderColor: rPhase === "error" ? "rgba(244,63,94,0.4)" : `${ACCENT}55` }}>
                  {(rPhase === "starting" || rPhase === "running") && (
                    <motion.span className="absolute bottom-0 left-0 h-[2px] rounded-full" style={{ background: `linear-gradient(90deg, transparent, ${ACCENT}, transparent)`, width: "40%" }}
                      animate={{ x: ["-40%", "260%"] }} transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }} />
                  )}
                  {rPhase === "done" ? <Sparkles size={16} style={{ color: ACCENT }} /> : rPhase === "error" ? <AlertCircle size={16} className="text-rose-400" /> : <Telescope size={16} style={{ color: ACCENT }} className="animate-pulse" />}
                  <div className="flex-1 text-[12.5px]" style={{ color: rPhase === "error" ? "#fda4af" : "var(--fg)" }}>{rMsg}</div>
                  {rSources.length > 0 && <div className="text-[11px] font-mono px-2 py-0.5 rounded-full" style={{ background: `${ACCENT}22`, color: ACCENT }}>{rSources.length} found</div>}
                </motion.div>
              )}

              {rSources.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <AnimatePresence>
                    {rSources.map((s, i) => {
                      const title = s.title || s.source || s.url || s.link || `Source ${i + 1}`;
                      const link = s.url || s.link || (typeof s.source === "string" && /^https?:/.test(s.source) ? s.source : undefined);
                      const blurb = s.snippet || s.description || s.summary || "";
                      const host = (() => { try { return new URL(String(link)).hostname.replace(/^www\./, ""); } catch { return String(link || "").slice(0, 40); } })();
                      return (
                        <motion.div key={i} initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: Math.min(i * 0.05, 0.6) }}
                          className="panel p-3.5 relative overflow-hidden">
                          <div className="flex items-start gap-2.5">
                            <span className="grid place-items-center w-8 h-8 rounded-lg shrink-0" style={{ background: `${ACCENT}18`, color: ACCENT }}><Globe size={15} /></span>
                            <div className="min-w-0 flex-1">
                              <div className="text-[13px] font-medium text-[var(--fg)] line-clamp-2">{String(title)}</div>
                              {blurb && <div className="text-[11.5px] text-[var(--fg-dim)] mt-1 line-clamp-2">{String(blurb)}</div>}
                              {link && <a href={String(link)} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-[11px] mt-1.5" style={{ color: ACCENT }}>{host} <ExternalLink size={10} /></a>}
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}

              {rPhase === "done" && rSources.length > 0 && (
                <div className="panel p-4 flex items-center justify-between gap-3 flex-wrap" style={{ borderColor: `${ACCENT}55` }}>
                  <div className="text-[12.5px] text-[var(--fg-dim)]">Add these {rSources.length} sources to <span className="text-[var(--fg)]">{notebookLabel(activeNotebook)}</span>, then chat them or make visuals in Studio.</div>
                  <button onClick={importResearch} disabled={rImporting}
                    className="px-3.5 h-[36px] rounded-lg flex items-center gap-1.5 text-sm transition disabled:opacity-40"
                    style={{ background: `${ACCENT}22`, border: `1px solid ${ACCENT}55`, color: ACCENT }}>
                    <Plus size={14} /> {rImporting ? "Importing…" : "Import into notebook"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === "chat" && (
        <div className="panel flex flex-col" style={{ height: "min(70vh, 800px)" }}>
          {!activeNotebook ? (
            <div className="flex-1 grid place-items-center text-center p-8">
              <div>
                <BookOpen size={28} className="mx-auto mb-3" style={{ color: ACCENT }} />
                <div className="text-sm font-medium">Pick a notebook</div>
                <div className="mt-1 text-[12px] text-[var(--fg-dim)]">Go to Library and click one.</div>
              </div>
            </div>
          ) : (
            <>
              <div className="px-5 py-3 border-b border-[var(--panel-border)]">
                <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">Notebook</div>
                <div className="text-sm font-medium truncate" style={{ color: ACCENT }}>{notebookLabel(activeNotebook)}</div>
              </div>
              <div className="scroll flex-1 min-h-0 overflow-y-auto p-5 space-y-3">
                <AnimatePresence initial={false}>
                  {msgs.length === 0 && (
                    <div className="text-[var(--fg-dim)] text-sm text-center py-10">Ask anything about this notebook — answers come from NotebookLM grounded on its sources.</div>
                  )}
                  {msgs.map((m, i) => (
                    <motion.div key={i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                      className={`flex gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                      <div className="max-w-[78%] rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap"
                        style={m.role === "user"
                          ? { background: "rgba(255,255,255,0.05)", border: "1px solid var(--panel-border)", color: "var(--fg)" }
                          : { background: `linear-gradient(135deg, ${ACCENT}10, transparent 60%)`, border: `1px solid ${ACCENT}40`, color: "var(--fg)" }}>
                        {m.text}
                      </div>
                    </motion.div>
                  ))}
                  {thinking && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-2">
                      <div className="rounded-2xl px-4 py-2.5 text-[13.5px] border" style={{ background: `${ACCENT}10`, borderColor: `${ACCENT}40` }}>
                        <span className="inline-flex">
                          <span className="tick live" style={{ color: ACCENT }} />
                          <span className="tick live" style={{ color: ACCENT, animationDelay: ".15s" }} />
                          <span className="tick live" style={{ color: ACCENT, animationDelay: ".3s" }} />
                        </span>
                        <span className="ml-2 text-[var(--fg-dim)]">NotebookLM thinking…</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <div className="border-t border-[var(--panel-border)] p-3">
                <div className="flex items-end gap-2 rounded-2xl border border-[var(--panel-border)] bg-[rgba(0,0,0,0.25)] p-2 focus-within:border-[var(--panel-border-hot)]">
                  <VoiceButton onTranscript={(t, o) => { if (o.final) setQuestion((v) => (v ? v + " " : "") + t); }} size={38} />
                  <textarea value={question} onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); ask(); } }}
                    rows={2} placeholder="Ask anything about this notebook… (⌘+Enter)"
                    className="flex-1 bg-transparent outline-none resize-none px-2 py-2 text-[14px] text-[var(--fg)] placeholder:text-[var(--fg-dimmer)]" />
                  <button onClick={ask} disabled={!question.trim() || thinking}
                    className="px-3 h-[38px] rounded-lg flex items-center gap-1.5 text-sm transition disabled:opacity-40"
                    style={{ background: `${ACCENT}22`, border: `1px solid ${ACCENT}55`, color: ACCENT }}>
                    <Send size={14} /> Ask
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "studio" && (
        <div className="space-y-5">
          {!activeNotebook ? (
            <div className="panel p-6 text-center text-[var(--fg-dim)] text-sm">Pick a notebook from the Library tab first.</div>
          ) : (
            <>
              {/* Create artifact */}
              <div className="panel p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles size={16} style={{ color: ACCENT }} />
                  <h3 className="text-sm font-medium">Generate from <span className="text-[var(--fg-dim)] font-normal">{notebookLabel(activeNotebook)}</span></h3>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-1.5 mb-3">
                  {ARTIFACT_TYPES.map((t) => {
                    const active = studioType === t.value;
                    return (
                      <button key={t.value} onClick={() => setStudioType(t.value)}
                        className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11.5px] border transition truncate"
                        style={{
                          background: active ? `${t.colour}22` : "transparent",
                          borderColor: active ? t.colour : "var(--panel-border)",
                          color: active ? "var(--fg)" : "var(--fg-dim)",
                        }}>
                        {t.icon}<span className="truncate">{t.label}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-end gap-2">
                  <input value={studioPrompt} onChange={(e) => setStudioPrompt(e.target.value)}
                    placeholder="Optional focus prompt (e.g. 'beginner-friendly', 'just the comparison angle')…"
                    className="flex-1 bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-3 h-[38px] text-sm outline-none focus:border-[var(--panel-border-hot)] text-[var(--fg)]" />
                  <button onClick={createArtifact} disabled={studioBusy}
                    className="px-4 h-[38px] rounded-lg flex items-center gap-1.5 text-sm transition disabled:opacity-40"
                    style={{ background: `${ACCENT}22`, border: `1px solid ${ACCENT}66`, color: ACCENT }}>
                    {studioBusy ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    {studioBusy ? "Generating…" : "Generate"}
                  </button>
                </div>
                <div className="mt-2 text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">
                  Audio: 2–10 min · Video: 5–15 min · Slide deck: 1–3 min · Others: 30 s–2 min · Returns immediately, generation continues in NotebookLM.
                </div>
              </div>

              {/* Existing artifacts in this notebook */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] flex items-center gap-1.5">
                    <Library size={11} /> Artifacts in {notebookLabel(activeNotebook)} ({artifacts.length})
                  </div>
                  <button onClick={() => refreshArtifacts(activeId!)} className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] hover:text-[var(--fg-dim)]">
                    <RefreshCw size={10} className="inline mr-1" />Refresh
                  </button>
                </div>
                {artifacts.length === 0 ? (
                  <div className="panel p-6 text-center text-[var(--fg-dim)] text-sm">No artifacts yet. Generate one above, or NotebookLM-side ones will appear after refresh.</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {artifacts.map((a) => {
                      const meta = ARTIFACT_TYPES.find((t) => t.value === a.type) ?? { value: a.type as ArtifactType, label: a.type || "artifact", icon: <FileText size={14} />, colour: ACCENT };
                      const ready = a.status === "ready" || a.status === "complete" || a.status === "completed";
                      const ntblmUrl = a.audio_url || a.video_url || a.infographic_url || a.slide_deck_url;
                      return (
                        <div key={a.artifact_id} className="panel p-3">
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span style={{ color: meta.colour }}>{meta.icon}</span>
                              <span className="text-[12px] font-medium truncate">{a.title || meta.label}</span>
                            </div>
                            <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded-full shrink-0"
                              style={{ background: ready ? "rgba(134,239,172,0.12)" : `${meta.colour}14`, color: ready ? "#86efac" : meta.colour }}>
                              {a.status || "—"}
                            </span>
                          </div>
                          <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] font-[var(--font-geist-mono)] truncate mb-2">{a.artifact_id.slice(0, 18)}…</div>
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => downloadArtifact(a)} disabled={busy === `dl-${a.artifact_id}` || !ready}
                              className="px-2 py-1 rounded-md text-[11px] border flex items-center gap-1 transition disabled:opacity-40"
                              style={{ background: `${meta.colour}14`, borderColor: `${meta.colour}55`, color: meta.colour }}>
                              {busy === `dl-${a.artifact_id}` ? <RefreshCw size={10} className="animate-spin" /> : <Download size={10} />} Pull
                            </button>
                            {ntblmUrl && (
                              <a href={ntblmUrl} target="_blank" rel="noopener noreferrer"
                                className="px-2 py-1 rounded-md text-[11px] border border-[var(--panel-border)] text-[var(--fg-dim)] hover:text-[var(--fg)] flex items-center gap-1 transition">
                                <ExternalLink size={10} /> View
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {tab === "assets" && (
        <div className="space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] flex items-center gap-1.5">
            <Download size={11} /> Downloaded from NotebookLM ({savedAssets.length}) · stored in <code>Agentic OS/Notebooks/_assets/</code>
          </div>
          {savedAssets.length === 0 ? (
            <div className="panel p-6 text-center text-[var(--fg-dim)] text-sm">Nothing downloaded yet. Go to a notebook&apos;s Studio tab and click <strong>Pull</strong> on any artifact.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {savedAssets.map((a) => (
                <div key={a.path} className="panel p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-medium text-[var(--fg)] truncate">{a.notebook}</div>
                      <div className="text-[10px] text-[var(--fg-dimmer)] font-[var(--font-geist-mono)] truncate">
                        {a.name} · {(a.bytes / 1024 / 1024).toFixed(1)}MB · {new Date(a.mtime).toLocaleString("en-GB", { hour12: false })}
                      </div>
                    </div>
                    <a href={`/api/notebooklm/artifact/download?path=${encodeURIComponent(a.path)}`} download={a.name}
                      className="text-[var(--fg-dim)] hover:text-[var(--fg)] flex items-center gap-1 text-[10px] uppercase tracking-widest">
                      <Download size={11} /> Save
                    </a>
                  </div>
                  <AssetPreview asset={a} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AssetPreview({ asset }: { asset: SavedAsset }) {
  const src = `/api/notebooklm/artifact/download?path=${encodeURIComponent(asset.path)}`;
  if (asset.kind === "audio") return <audio src={src} controls preload="metadata" className="w-full" />;
  if (asset.kind === "video") return <video src={src} controls preload="metadata" className="w-full max-h-[300px] rounded-lg bg-black" />;
  if (asset.kind === "image") {
    return (
      <a href={src} target="_blank" rel="noopener noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={asset.name} className="w-full max-h-[260px] object-cover rounded-lg" />
      </a>
    );
  }
  if (asset.kind === "pdf") return <iframe src={src} className="w-full h-[300px] rounded-lg bg-black" title={asset.name} />;
  if (asset.kind === "html") return <iframe src={src} className="w-full h-[300px] rounded-lg bg-white" title={asset.name} />;
  return (
    <a href={src} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-2 px-3 py-2 rounded-md border border-[var(--panel-border)] text-[var(--fg-dim)] hover:text-[var(--fg)] text-[12px] transition">
      <ChevronRight size={12} /> Open externally
    </a>
  );
}

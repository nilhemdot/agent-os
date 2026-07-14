"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Sparkles, Rocket, FileText, BookOpen, Play, Square,
  CheckCircle2, AlertCircle, Globe, FileSearch, ClipboardPaste, Save,
  History as HistoryIcon, ExternalLink, Clock,
  Search, TrendingUp, Loader2, ArrowRight, Link2,
} from "lucide-react";
import MarkdownView from "./MarkdownView";

type Tab = "research" | "openseo" | "generate" | "deploy" | "history" | "transcripts" | "skill";

interface ResearchTopic {
  keyword: string; score: number; badges: string[];
  impressions: number; clicks: number; ctr: number; position: number;
  page: string; reason: string; competitors?: { title: string; link: string }[];
}
interface ResearchResult {
  site: string; property: string; days: number; window: [string, string];
  totalQueries: number; totalImpressions: number; totalClicks: number;
  topics: ResearchTopic[];
}

interface ArticleWritten { siteId: string; filePath: string; liveUrl?: string; }
interface GenSession {
  id: string; createdAt: number; finishedAt?: number;
  keyword: string; slug: string; transcriptSource: string;
  status: "running" | "completed" | "failed" | "aborted";
  articles: ArticleWritten[]; exitCode?: number;
}
interface DeployRecord {
  id: string; startedAt: number; finishedAt?: number;
  siteId: string; siteName: string; blogBaseUrl: string;
  status: "running" | "ok" | "failed";
  liveSlug?: string; liveUrl?: string; netlifyUrl?: string;
  durationMs?: number; errorTail?: string;
}

interface Transcript { slug: string; bytes: number; mtime: number; preview: string; }
interface SiteRecent { slug: string; mtime: number; title?: string; date?: string; }
interface SiteStats { site: { id: string; name: string; url: string; path: string }; postCount: number; recent: SiteRecent[]; }

const SITE_ACCENT: Record<string, string> = {
  bestaiagentcommunity: "#d97757",
  aiprofitboardroom: "#a855f7",
  juliangoldieautomation: "#22d3ee",
  aisuccesslab: "#ec4899",
  aimoneylab: "#a3e635",
};

function badgeClass(b: string): string {
  if (b === "LOW CTR") return "bg-[rgba(56,189,248,0.14)] text-sky-300 border-sky-400/30";
  if (b === "STRIKING DISTANCE") return "bg-[rgba(163,230,53,0.14)] text-lime-300 border-lime-400/30";
  if (b === "CONTENT GAP") return "bg-[rgba(251,191,36,0.14)] text-amber-300 border-amber-400/30";
  return "bg-[rgba(168,85,247,0.14)] text-purple-300 border-purple-400/30";
}

export default function SEOView() {
  const [tab, setTab] = useState<Tab>("generate");

  // ── Generate state ─────────────────────────────────────────────────
  const [keyword, setKeyword] = useState("");
  const [slug, setSlug] = useState("");
  const [transcriptMode, setTranscriptMode] = useState<"pick" | "paste">("pick");
  const [selectedTranscript, setSelectedTranscript] = useState<string>("");
  const [pastedTranscript, setPastedTranscript] = useState<string>("");
  const [savingTranscript, setSavingTranscript] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [generating, setGenerating] = useState(false);
  const [genLog, setGenLog] = useState<string[]>([]);
  const [genDone, setGenDone] = useState<{ code: number } | null>(null);
  const [autoDeploy, setAutoDeploy] = useState<boolean>(true);
  const [writtenSiteIds, setWrittenSiteIds] = useState<Set<string>>(new Set());
  const writtenSiteIdsRef = useRef<Set<string>>(new Set());
  const genAbortRef = useRef<AbortController | null>(null);

  // ── Research (live Google Search Console) state ────────────────────
  const [rSites, setRSites] = useState<string[]>([]);
  const [rConnected, setRConnected] = useState<boolean | null>(null);
  const [rSite, setRSite] = useState("");
  const [rDays, setRDays] = useState(28);
  const [rSeed, setRSeed] = useState("");
  const [rLoading, setRLoading] = useState(false);
  const [rData, setRData] = useState<ResearchResult | null>(null);
  const [rError, setRError] = useState<string | null>(null);

  // ── OpenSEO (embedded local tool, runs in Docker on :3001) ─────────
  const [openseoUp, setOpenseoUp] = useState<boolean | null>(null);

  useEffect(() => {
    if (tab !== "research" || rConnected !== null) return;
    fetch("/api/seo/research")
      .then((r) => r.json())
      .then((j) => {
        setRConnected(!!j.connected);
        setRSites(j.sites ?? []);
        if (!rSite && j.sites?.length) setRSite(j.sites[0]);
      })
      .catch(() => setRConnected(false));
  }, [tab, rConnected, rSite]);

  useEffect(() => {
    if (tab !== "openseo") return;
    let stop = false;
    const ping = () => fetch("/api/openseo/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!stop) setOpenseoUp(!!j.running); })
      .catch(() => { if (!stop) setOpenseoUp(false); });
    ping();
    const id = setInterval(ping, 5000);
    return () => { stop = true; clearInterval(id); };
  }, [tab]);

  async function runResearch() {
    if (!rSite || rLoading) return;
    setRLoading(true); setRError(null);
    try {
      const r = await fetch("/api/seo/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ site: rSite, days: rDays, seed: rSeed.trim() }),
      });
      const j = await r.json();
      if (j.error) { setRError(j.error); setRData(null); }
      else { setRData(j); }
    } catch {
      setRError("Couldn't reach the research service.");
    }
    setRLoading(false);
  }

  function selectTopic(kw: string) {
    setKeyword(kw);
    setTab("generate");
  }

  // ── Sites / Deploy state ───────────────────────────────────────────
  const [sites, setSites] = useState<SiteStats[]>([]);
  const [deployLog, setDeployLog] = useState<Record<string, string[]>>({});
  const [deployStatus, setDeployStatus] = useState<Record<string, "ok" | "err" | "running" | undefined>>({});
  // Site IDs currently deploying (allows parallel deploys)
  const deployingCount = Object.values(deployStatus).filter((s) => s === "running").length;

  // ── History state ──────────────────────────────────────────────────
  const [historySessions, setHistorySessions] = useState<GenSession[]>([]);
  const [historyDeploys, setHistoryDeploys] = useState<DeployRecord[]>([]);

  async function refreshHistory() {
    try {
      const j = await fetch("/api/seo/history", { cache: "no-store" }).then((r) => r.json());
      setHistorySessions(j.sessions ?? []);
      setHistoryDeploys(j.deploys ?? []);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    fetch("/api/seo/transcripts").then((r) => r.json()).then((j) => setTranscripts(j.transcripts ?? []));
    fetch("/api/seo/sites").then((r) => r.json()).then((j) => setSites(j.sites ?? []));
    refreshHistory();
    // Restore auto-deploy pref
    try {
      const raw = localStorage.getItem("agentic-os-seo-autodeploy");
      if (raw !== null) setAutoDeploy(raw === "1");
    } catch {}
  }, []);

  // Persist auto-deploy pref
  useEffect(() => {
    try { localStorage.setItem("agentic-os-seo-autodeploy", autoDeploy ? "1" : "0"); } catch {}
  }, [autoDeploy]);

  // Auto-refresh history while a generate or deploy is running
  useEffect(() => {
    if (!generating && deployingCount === 0) return;
    const t = setInterval(refreshHistory, 3000);
    return () => clearInterval(t);
  }, [generating, deployingCount]);

  // Slug derived from keyword (only if user hasn't typed a custom slug)
  useEffect(() => {
    if (!keyword.trim()) return;
    const derived = keyword.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
    setSlug((current) => current && current !== derived.slice(0, current.length) ? current : derived);
  }, [keyword]);

  function pickTranscript(t: Transcript) {
    setSelectedTranscript(t.slug);
    if (!keyword) {
      setKeyword(t.slug.replace(/-/g, " "));
      setSlug(t.slug);
    }
  }

  // Map an absolute file path written by Claude → which site it belongs to (so we can deploy that site)
  function siteIdFromPath(filePath: string): string | null {
    if (filePath.includes("/AIProfitBoardroom.com/"))    return "bestaiagentcommunity";
    if (filePath.includes("/AIProfitBoardroom-main/"))   return "aiprofitboardroom";
    if (filePath.includes("/juliangoldieaiautomation/")) return "juliangoldieautomation";
    if (filePath.includes("/aisuccesslab/"))             return "aisuccesslab";
    if (filePath.includes("/aimoneylab/"))               return "aimoneylab";
    return null;
  }

  async function startGenerate() {
    if (!keyword.trim() || !slug.trim() || generating) return;
    setGenerating(true);
    setGenLog([]);
    setGenDone(null);
    setWrittenSiteIds(new Set());
    writtenSiteIdsRef.current = new Set();
    const ctrl = new AbortController();
    genAbortRef.current = ctrl;

    try {
      const payload: Record<string, unknown> = {
        keyword: keyword.trim(),
        slug: slug.trim(),
      };
      if (transcriptMode === "pick" && selectedTranscript) {
        payload.transcriptSlug = selectedTranscript;
      } else if (transcriptMode === "paste" && pastedTranscript.trim()) {
        payload.transcriptText = pastedTranscript.trim();
      }
      const r = await fetch("/api/seo/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
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
            if (evt.type === "stream_event" && evt.event?.delta?.text) {
              setGenLog((arr) => [...arr.slice(-400), evt.event.delta.text]);
            } else if (evt.type === "system" && evt.subtype) {
              setGenLog((arr) => [...arr.slice(-400), `[${evt.subtype}]\n`]);
            } else if (evt.type === "assistant" && evt.message?.content) {
              for (const part of evt.message.content) {
                if (part.type === "tool_use") {
                  setGenLog((arr) => [...arr.slice(-400), `\n[tool] ${part.name}: ${JSON.stringify(part.input).slice(0,120)}…\n`]);
                  // Track which sites have had a Write tool call land
                  if (part.name === "Write" && typeof part.input?.file_path === "string") {
                    const sid = siteIdFromPath(part.input.file_path);
                    if (sid) {
                      writtenSiteIdsRef.current.add(sid);
                      setWrittenSiteIds(new Set(writtenSiteIdsRef.current));
                    }
                  }
                }
              }
            } else if (evt.type === "result" && evt.result) {
              setGenLog((arr) => [...arr, `\n──── final ────\n${evt.result}\n`]);
            } else if (evt.type === "done") {
              setGenDone({ code: evt.code });
            } else if (evt.type === "stderr") {
              setGenLog((arr) => [...arr.slice(-400), `[stderr] ${evt.text}`]);
            }
          } catch { /* ignore */ }
        }
      }
    } catch (_e) {
      setGenLog((arr) => [...arr, `\n[error] ${String(_e)}\n`]);
    }
    setGenerating(false);
    // refresh sites + history so newly written posts/sessions appear
    fetch("/api/seo/sites").then((r) => r.json()).then((j) => setSites(j.sites ?? []));
    refreshHistory();

    // Auto-deploy each site that received a Write — in parallel.
    const writtenIds = Array.from(writtenSiteIdsRef.current);
    if (autoDeploy && writtenIds.length > 0) {
      setGenLog((arr) => [...arr, `\n──── auto-deploying ${writtenIds.length} site${writtenIds.length === 1 ? "" : "s"} ────\n`]);
      // Fire in parallel
      Promise.all(writtenIds.map((sid) => deploySite(sid))).then(() => refreshHistory());
    }
  }

  function stopGenerate() { genAbortRef.current?.abort(); setGenerating(false); }

  async function savePastedTranscript() {
    if (!pastedTranscript.trim() || !slug.trim() || savingTranscript) return;
    setSavingTranscript(true);
    setSavedNotice(null);
    try {
      const r = await fetch("/api/seo/transcript/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: slug.trim(), content: pastedTranscript }),
      });
      const j = await r.json();
      if (!r.ok) { setSavedNotice(j.error || "save failed"); }
      else {
        setSavedNotice(`saved to ${j.path}`);
        // refresh list + auto-switch to picked mode with this new transcript selected
        const refreshed = await fetch("/api/seo/transcripts").then((res) => res.json());
        setTranscripts(refreshed.transcripts ?? []);
        setSelectedTranscript(j.slug);
        setTranscriptMode("pick");
        setPastedTranscript("");
      }
    } catch (_e) { setSavedNotice(String(_e)); }
    setSavingTranscript(false);
  }

  async function deploySite(siteId: string) {
    // Allow parallel deploys — only block if THIS site is already deploying.
    if (deployStatus[siteId] === "running") return;
    setDeployStatus((s) => ({ ...s, [siteId]: "running" }));
    setDeployLog((s) => ({ ...s, [siteId]: [] }));
    try {
      const r = await fetch("/api/seo/deploy", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteId }),
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
            if (evt.type === "stdout" || evt.type === "stderr") {
              setDeployLog((s) => ({ ...s, [siteId]: [...(s[siteId] ?? []).slice(-200), evt.text] }));
            } else if (evt.type === "step") {
              setDeployLog((s) => ({ ...s, [siteId]: [...(s[siteId] ?? []), `\n▸ ${evt.label}\n`] }));
            } else if (evt.type === "step_end") {
              setDeployLog((s) => ({ ...s, [siteId]: [...(s[siteId] ?? []), `   exit ${evt.code}\n`] }));
            } else if (evt.type === "done") {
              setDeployStatus((s) => ({ ...s, [siteId]: evt.ok ? "ok" : "err" }));
            }
          } catch {}
        }
      }
    } catch (_e) {
      setDeployLog((s) => ({ ...s, [siteId]: [...(s[siteId] ?? []), `\n[error] ${String(_e)}\n`] }));
      setDeployStatus((s) => ({ ...s, [siteId]: "err" }));
    }
    refreshHistory();
  }

  const tabs: { key: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { key: "research",    label: "Research",    icon: <Search size={14} /> },
    { key: "openseo",     label: "OpenSEO",     icon: <TrendingUp size={14} /> },
    { key: "generate",    label: "Generate",    icon: <Sparkles size={14} /> },
    { key: "deploy",      label: "Deploy",      icon: <Rocket size={14} /> },
    { key: "history",     label: "History",     icon: <HistoryIcon size={14} />, badge: historySessions.length + historyDeploys.length },
    { key: "transcripts", label: "Transcripts", icon: <FileText size={14} /> },
    { key: "skill",       label: "Skill",       icon: <BookOpen size={14} /> },
  ];

  function fmtAgo(ts: number): string {
    const d = Date.now() - ts;
    if (d < 60_000) return "just now";
    if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
    if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
    return `${Math.floor(d / 86_400_000)}d ago`;
  }
  function fmtDuration(ms?: number): string {
    if (!ms) return "—";
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
  }

  return (
    <div className="space-y-5">
      {/* Tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-[12.5px] transition"
              style={{
                background: active ? "rgba(163,230,53,0.16)" : "transparent",
                borderColor: active ? "#a3e635" : "var(--panel-border)",
                color: active ? "var(--fg)" : "var(--fg-dim)",
              }}
            >
              {t.icon}{t.label}
              {typeof t.badge === "number" && t.badge > 0 && (
                <span className="text-[10px] metric px-1.5 py-0.5 rounded-full bg-[rgba(255,255,255,0.06)] text-[var(--fg-dim)]">
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
        {/* AIPB share-pack actions — let members open the setup guide or grab
            the zip. Pushed to the right via ml-auto so they don't crowd tabs. */}
        <a
          href="/seo-guide"
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[12.5px] transition border-[var(--panel-border)] text-[var(--fg-dim)] hover:text-[var(--fg)] hover:border-[rgba(163,230,53,0.4)]"
          title="Open the step-by-step SEO setup guide for AIPB members"
        >
          <BookOpen size={14} /> Setup Guide
        </a>
        <a
          href="/downloads/seo-pack.zip"
          download
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[12.5px] transition border-[rgba(163,230,53,0.4)] bg-[rgba(163,230,53,0.12)] text-lime-300 hover:bg-[rgba(163,230,53,0.18)]"
          title="Download the skill + config templates + sample transcript (.zip)"
        >
          <Save size={14} /> SEO Pack (.zip)
        </a>
      </div>

      {tab === "research" && (
        <div className="space-y-5">
          {/* GSC connection banner */}
          <div className="panel p-4 flex items-center gap-3 flex-wrap">
            <div className="w-9 h-9 rounded-lg grid place-items-center shrink-0" style={{ background: rConnected ? "rgba(163,230,53,0.14)" : "rgba(255,255,255,0.05)" }}>
              <Globe size={17} className={rConnected ? "text-[#a3e635]" : "text-[var(--fg-dim)]"} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Google Search Console</span>
                {rConnected === null ? (
                  <span className="text-[10px] text-[var(--fg-dim)]">checking…</span>
                ) : rConnected ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[rgba(163,230,53,0.16)] text-lime-300 inline-flex items-center gap-1"><CheckCircle2 size={10} /> CONNECTED</span>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[rgba(248,113,113,0.16)] text-red-300">NOT CONNECTED</span>
                )}
              </div>
              <p className="text-[11.5px] text-[var(--fg-dim)] mt-0.5">
                {rConnected !== false ? <>Pulling live, read-only search analytics from your verified GSC properties. Optional: set <code className="metric">SERPAPI_KEY</code> for richer competitor SERP data.</> : <>Run <code className="metric">python3 ~/.agentic-os/gsc-report.py</code> once to authorize read-only access.</>}
              </p>
            </div>
          </div>

          {/* research form */}
          <div className="panel p-5">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp size={16} className="text-[#a3e635]" />
              <h3 className="text-sm font-medium">Keyword research &amp; competitor analysis</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">Site to analyse</label>
                <select value={rSite} onChange={(e) => setRSite(e.target.value)} className="mt-1 w-full bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-3 h-[38px] text-sm outline-none focus:border-[var(--panel-border-hot)] text-[var(--fg)]">
                  {rSites.length === 0 && <option value="">loading…</option>}
                  {rSites.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                {rSite && <p className="text-[10px] text-[var(--fg-dimmer)] mt-1 metric">GSC property: sc-domain:{rSite}</p>}
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">Date range</label>
                <select value={rDays} onChange={(e) => setRDays(Number(e.target.value))} className="mt-1 w-full bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-3 h-[38px] text-sm outline-none focus:border-[var(--panel-border-hot)] text-[var(--fg)]">
                  <option value={7}>Last 7 days</option>
                  <option value={28}>Last 28 days</option>
                  <option value={90}>Last 90 days</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">Seed keyword (optional filter)</label>
                <input value={rSeed} onChange={(e) => setRSeed(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") runResearch(); }} placeholder="e.g. hermes workspace" className="mt-1 w-full bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-3 h-[38px] text-sm outline-none focus:border-[var(--panel-border-hot)] text-[var(--fg)]" />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
              <p className="text-[11px] text-[var(--fg-dim)] max-w-xl">Scores queries from GSC: striking distance (positions 5–20), low CTR on page 1, content gaps, and high-impression opportunities — then ranks what to write or refresh next.</p>
              <button onClick={runResearch} disabled={rLoading || !rSite} className="flex items-center gap-2 px-4 h-[38px] rounded-lg border text-sm font-medium transition disabled:opacity-50 border-[rgba(163,230,53,0.4)] bg-[rgba(163,230,53,0.14)] text-lime-300 hover:bg-[rgba(163,230,53,0.2)]">
                {rLoading ? <><Loader2 size={14} className="animate-spin" /> Researching…</> : <><Search size={14} /> Run research</>}
              </button>
            </div>
          </div>

          {rError && <div className="panel p-4 flex items-start gap-2 text-[12.5px] text-red-300"><AlertCircle size={15} className="mt-0.5 shrink-0" /> {rError}</div>}

          {rData && (
            <div className="space-y-3">
              <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-[11.5px] text-[var(--fg-dim)] px-1">
                <span><span className="metric text-[var(--fg)]">{rData.totalQueries.toLocaleString()}</span> queries analysed</span>
                <span className="metric">{rData.window[0]} → {rData.window[1]}</span>
                <span><span className="metric text-[var(--fg)]">{rData.topics.length}</span> topic suggestions</span>
                <span className="metric">{rData.totalImpressions.toLocaleString()} impr · {rData.totalClicks.toLocaleString()} clicks</span>
              </div>

              {rData.topics.length === 0 && <div className="panel p-5 text-center text-[12.5px] text-[var(--fg-dim)]">No clear opportunities in this window — try a longer date range or a different site.</div>}

              {rData.topics.map((t) => (
                <div key={t.keyword} className="panel p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-[var(--fg)]">{t.keyword}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[rgba(163,230,53,0.16)] text-lime-300 metric">SCORE {t.score.toLocaleString()}</span>
                        {t.badges.map((b) => <span key={b} className={`text-[10px] px-1.5 py-0.5 rounded-full border ${badgeClass(b)}`}>{b}</span>)}
                      </div>
                      <p className="text-[12px] text-[var(--fg-dim)] mt-1">{t.reason}</p>
                      <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap text-[11px] text-[var(--fg-dimmer)] mt-1.5 metric">
                        <span>{t.impressions.toLocaleString()} impressions</span>
                        <span>{t.clicks} clicks</span>
                        <span>{(t.ctr * 100).toFixed(1)}% CTR</span>
                        <span>avg pos {t.position}</span>
                        {t.page && <a href={t.page} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-[var(--fg-dim)] hover:text-[#a3e635] truncate max-w-[300px]"><Link2 size={10} /> {t.page.replace(/^https?:\/\//, "")}</a>}
                      </div>
                      {t.competitors && t.competitors.length > 0 && (
                        <div className="mt-2.5 pt-2.5 border-t border-[var(--panel-border)]">
                          <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-1 flex items-center gap-1"><Globe size={10} /> Top competitors in SERP</div>
                          {t.competitors.slice(0, 3).map((c) => <a key={c.link} href={c.link} target="_blank" rel="noopener" className="block text-[11.5px] text-sky-300/80 hover:text-sky-300 truncate"><ExternalLink size={9} className="inline mr-1" />{c.title}</a>)}
                        </div>
                      )}
                    </div>
                    <button onClick={() => selectTopic(t.keyword)} className="flex items-center gap-1.5 px-3 h-[34px] rounded-lg border text-[12.5px] shrink-0 transition border-[rgba(163,230,53,0.35)] text-lime-300 hover:bg-[rgba(163,230,53,0.14)]">
                      <Sparkles size={13} /> Use topic <ArrowRight size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!rData && !rError && !rLoading && (
            <div className="panel p-6 text-center text-[12.5px] text-[var(--fg-dim)]">
              Pick a site and hit <span className="text-lime-300">Run research</span> to pull your live Search Console opportunities.
            </div>
          )}
        </div>
      )}

      {tab === "generate" && (
        <div className="space-y-5">
          <div className="panel p-5">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles size={16} className="text-[#a3e635]" />
              <h3 className="text-sm font-medium">Generate 5 unique SEO articles for all 5 sites</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">Target keyword</label>
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="e.g. hermes mcp server"
                  className="mt-1 w-full bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-3 h-[38px] text-sm outline-none focus:border-[var(--panel-border-hot)] text-[var(--fg)]"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">File slug</label>
                <input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="hermes-mcp-server"
                  className="mt-1 w-full bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-3 h-[38px] text-sm outline-none focus:border-[var(--panel-border-hot)] text-[var(--fg)] font-[var(--font-geist-mono)]"
                />
              </div>
            </div>

            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">Source transcript</label>
                <div className="flex gap-1">
                  <button
                    onClick={() => setTranscriptMode("pick")}
                    className="px-2 py-1 rounded-md text-[10px] uppercase tracking-widest border transition flex items-center gap-1"
                    style={{
                      background: transcriptMode === "pick" ? "rgba(163,230,53,0.16)" : "transparent",
                      borderColor: transcriptMode === "pick" ? "#a3e635" : "var(--panel-border)",
                      color: transcriptMode === "pick" ? "var(--fg)" : "var(--fg-dim)",
                    }}
                  >
                    <FileText size={10} /> Pick existing
                  </button>
                  <button
                    onClick={() => setTranscriptMode("paste")}
                    className="px-2 py-1 rounded-md text-[10px] uppercase tracking-widest border transition flex items-center gap-1"
                    style={{
                      background: transcriptMode === "paste" ? "rgba(163,230,53,0.16)" : "transparent",
                      borderColor: transcriptMode === "paste" ? "#a3e635" : "var(--panel-border)",
                      color: transcriptMode === "paste" ? "var(--fg)" : "var(--fg-dim)",
                    }}
                  >
                    <ClipboardPaste size={10} /> Paste new
                  </button>
                </div>
              </div>

              {transcriptMode === "pick" ? (
                <>
                  <div className="panel p-2 max-h-[180px] overflow-y-auto scroll grid grid-cols-1 md:grid-cols-2 gap-1">
                    {transcripts.slice(0, 40).map((t) => {
                      const active = selectedTranscript === t.slug;
                      return (
                        <button
                          key={t.slug}
                          onClick={() => pickTranscript(t)}
                          className="text-left px-2 py-1.5 rounded-md text-[12px] transition truncate"
                          style={{
                            background: active ? "rgba(163,230,53,0.16)" : "transparent",
                            border: active ? "1px solid rgba(163,230,53,0.6)" : "1px solid var(--panel-border)",
                            color: active ? "var(--fg)" : "var(--fg-dim)",
                          }}
                          title={t.preview}
                        >
                          <span className="font-[var(--font-geist-mono)]">{t.slug}</span>
                          <span className="ml-2 text-[10px] text-[var(--fg-dimmer)]">{(t.bytes / 1024).toFixed(1)}KB</span>
                        </button>
                      );
                    })}
                  </div>
                  {selectedTranscript && (
                    <button
                      onClick={() => setSelectedTranscript("")}
                      className="mt-2 text-[11px] uppercase tracking-widest text-[var(--fg-dimmer)] hover:text-[var(--fg-dim)]"
                    >
                      clear selection
                    </button>
                  )}
                </>
              ) : (
                <div className="space-y-2">
                  <textarea
                    value={pastedTranscript}
                    onChange={(e) => setPastedTranscript(e.target.value)}
                    onPaste={async () => {
                      // Allow normal text paste; if pasted content is very large, let the browser handle it.
                      // No special handling needed — onChange picks it up.
                    }}
                    rows={10}
                    placeholder={`Paste your transcript here. Could be raw YouTube auto-captions, a Descript export, or a bullet-point outline.\n\nExample:\n\nHow to use AI agents with Hermes to rank number one. Free AI SEO agent tutorial.\n\nPROOF: Example website's traffic went from 12-19 clicks a day to 364 clicks…`}
                    className="w-full bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[var(--panel-border-hot)] text-[var(--fg)] font-[var(--font-geist-mono)] resize-y leading-relaxed"
                  />
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[var(--fg-dim)]">
                      {pastedTranscript.length.toLocaleString()} chars · {(new TextEncoder().encode(pastedTranscript).byteLength / 1024).toFixed(1)} KB
                    </span>
                    <div className="flex items-center gap-2">
                      {savedNotice && (
                        <span className={savedNotice.startsWith("saved") ? "text-emerald-300" : "text-rose-300"}>
                          {savedNotice}
                        </span>
                      )}
                      <button
                        onClick={savePastedTranscript}
                        disabled={!pastedTranscript.trim() || !slug.trim() || savingTranscript}
                        className="px-2.5 py-1 rounded-md flex items-center gap-1.5 text-[11px] border transition disabled:opacity-40"
                        style={{
                          background: "rgba(34,211,238,0.12)",
                          borderColor: "rgba(34,211,238,0.45)",
                          color: "#22d3ee",
                        }}
                        title={`Saves to ~/AIProfitBoardroom.com/.claude/transcripts/${slug || "<slug>"}.txt`}
                      >
                        <Save size={11} /> {savingTranscript ? "Saving…" : "Save & reuse"}
                      </button>
                    </div>
                  </div>
                  <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] leading-relaxed">
                    Optional: click <strong>Save & reuse</strong> to write it to <code>.claude/transcripts/{slug || "&lt;slug&gt;"}.txt</code> so it shows in the picker next time. Otherwise it's used just for this generation.
                  </div>
                </div>
              )}
            </div>

            {/* Auto-deploy toggle */}
            <div className="mt-4 flex items-center justify-between rounded-lg border border-[var(--panel-border)] bg-[rgba(168,85,247,0.06)] px-3 py-2.5">
              <div className="flex items-start gap-2.5">
                <Rocket size={14} className="text-[#a855f7] mt-0.5" />
                <div>
                  <div className="text-[13px] font-medium text-[var(--fg)]">Auto-deploy after generate</div>
                  <div className="text-[11px] text-[var(--fg-dim)] mt-0.5 leading-snug">
                    As soon as Claude finishes writing, all 5 sites build + deploy in parallel.
                  </div>
                </div>
              </div>
              <button
                onClick={() => setAutoDeploy((v) => !v)}
                className="relative w-11 h-6 rounded-full transition shrink-0"
                style={{ background: autoDeploy ? "rgba(168,85,247,0.5)" : "rgba(255,255,255,0.08)" }}
                title={autoDeploy ? "Disable auto-deploy" : "Enable auto-deploy"}
              >
                <span
                  className="absolute top-0.5 w-5 h-5 rounded-full transition-all"
                  style={{
                    left: autoDeploy ? "calc(100% - 22px)" : "2px",
                    background: autoDeploy ? "#a855f7" : "#5a5d80",
                    boxShadow: autoDeploy ? "0 0 14px #a855f7" : "none",
                  }}
                />
              </button>
            </div>

            <div className="mt-3 flex items-center justify-between">
              <div className="text-[11px] text-[var(--fg-dim)]">
                Writes to all 5 sites · ⚠️ Live filesystem writes ·{" "}
                {transcriptMode === "pick"
                  ? (selectedTranscript ? `transcript: ${selectedTranscript}` : "no transcript")
                  : (pastedTranscript.trim() ? `pasted transcript (${(pastedTranscript.length/1024).toFixed(1)}KB)` : "no transcript")
                }
              </div>
              <div className="flex items-center gap-2">
                {generating ? (
                  <button
                    onClick={stopGenerate}
                    className="px-4 h-[38px] rounded-lg flex items-center gap-1.5 text-sm bg-[rgba(248,113,113,0.15)] border border-[rgba(248,113,113,0.45)] text-rose-300"
                  >
                    <Square size={14} /> Stop
                  </button>
                ) : (
                  <button
                    onClick={startGenerate}
                    disabled={!keyword.trim() || !slug.trim()}
                    className="px-4 h-[38px] rounded-lg flex items-center gap-1.5 text-sm transition disabled:opacity-40"
                    style={{ background: "rgba(163,230,53,0.2)", border: "1px solid rgba(163,230,53,0.55)", color: "#a3e635" }}
                  >
                    <Play size={14} /> Generate 5 articles
                  </button>
                )}
              </div>
            </div>
          </div>

          {(generating || genLog.length > 0) && (
            <div className="panel p-5">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium flex items-center gap-2">
                  <FileSearch size={14} className="text-[#a3e635]" />
                  Live generation
                  {generating && <span className="inline-flex ml-2"><span className="tick live" style={{color:"#a3e635"}}/><span className="tick live" style={{color:"#a3e635",animationDelay:".15s"}}/><span className="tick live" style={{color:"#a3e635",animationDelay:".3s"}}/></span>}
                </div>
                {genDone && (
                  <div className={`text-[11px] uppercase tracking-widest ${genDone.code === 0 ? "text-emerald-300" : "text-rose-300"}`}>
                    {genDone.code === 0 ? "✓ done" : `exit ${genDone.code}`}
                  </div>
                )}
              </div>
              <pre className="scroll bg-[rgba(0,0,0,0.45)] border border-[var(--panel-border)] rounded-lg p-3 max-h-[500px] overflow-auto text-[12px] leading-relaxed font-[var(--font-geist-mono)] text-[var(--fg-dim)] whitespace-pre-wrap">
                {genLog.join("") || "starting…"}
              </pre>
            </div>
          )}

          {/* Inline deploy progress (after auto-deploy or manual click during a generate session) */}
          {(deployingCount > 0 || writtenSiteIds.size > 0) && (
            <div className="panel p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-medium flex items-center gap-2">
                  <Rocket size={14} className="text-[#a855f7]" />
                  Deploys
                  {deployingCount > 0 && (
                    <span className="text-[11px] text-[var(--fg-dim)] ml-2">
                      {deployingCount} running in parallel
                    </span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {sites.filter((s) => writtenSiteIds.has(s.site.id) || deployStatus[s.site.id]).map((s) => {
                  const accent = SITE_ACCENT[s.site.id] ?? "#a3e635";
                  const status = deployStatus[s.site.id];
                  const liveUrl = `${s.site.url}/blog/${slug}/`;
                  return (
                    <div key={s.site.id} className="rounded-lg border border-[var(--panel-border)] px-3 py-2">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="text-[12px] font-medium truncate" style={{ color: accent }}>{s.site.name}</div>
                        <span
                          className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-full shrink-0"
                          style={{
                            color: status === "ok" ? "#86efac" : status === "err" ? "#f87171" : status === "running" ? accent : "var(--fg-dimmer)",
                            background: status === "ok" ? "rgba(134,239,172,0.12)" : status === "err" ? "rgba(248,113,113,0.12)" : status === "running" ? `${accent}22` : "transparent",
                          }}
                        >
                          {status === "ok" ? "✓ live" : status === "err" ? "✗ failed" : status === "running" ? "⋯ deploying" : "queued"}
                        </span>
                      </div>
                      {status === "ok" && (
                        <a
                          href={liveUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-[var(--accent-cyan)] hover:underline truncate font-[var(--font-geist-mono)] flex items-center gap-1"
                        >
                          <ExternalLink size={10} className="shrink-0" />
                          <span className="truncate">{liveUrl}</span>
                        </a>
                      )}
                      {status === "running" && (
                        <div className="text-[11px] text-[var(--fg-dim)]">11ty build → netlify deploy</div>
                      )}
                      {status === "err" && (deployLog[s.site.id] ?? []).length > 0 && (
                        <pre className="mt-1 text-[10.5px] text-rose-300/80 bg-[rgba(248,113,113,0.06)] rounded px-1.5 py-1 max-h-[60px] overflow-auto font-[var(--font-geist-mono)] whitespace-pre-wrap">
                          {(deployLog[s.site.id] ?? []).join("").slice(-300)}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "deploy" && (
        <div className="space-y-4">
          <div className="text-[11px] text-[var(--fg-dim)] flex items-center gap-2">
            <AlertCircle size={12} /> Each deploy runs <code className="text-[var(--fg)]">npx @11ty/eleventy</code> then <code className="text-[var(--fg)]">netlify deploy --prod --dir=_site</code>. Make sure your sites are linked.
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {sites.map((s) => {
              const accent = SITE_ACCENT[s.site.id] ?? "#a3e635";
              const status = deployStatus[s.site.id];
              const log = deployLog[s.site.id] ?? [];
              return (
                <div key={s.site.id} className="panel p-4 relative overflow-hidden">
                  <div className="pointer-events-none absolute -right-8 -top-8 w-32 h-32 rounded-full blur-3xl opacity-25" style={{ background: accent }} />
                  <div className="relative flex items-start justify-between mb-3">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] flex items-center gap-1.5"><Globe size={10}/>{s.postCount} posts</div>
                      <div className="text-sm font-medium" style={{ color: accent }}>{s.site.name}</div>
                      <div className="text-[10px] text-[var(--fg-dimmer)] font-[var(--font-geist-mono)] truncate">{s.site.path}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {status === "ok"  && <CheckCircle2 size={14} className="text-emerald-300" />}
                      {status === "err" && <AlertCircle size={14} className="text-rose-300" />}
                      <button
                        disabled={status === "running"}
                        onClick={() => deploySite(s.site.id)}
                        className="px-3 h-[32px] rounded-lg text-[12px] flex items-center gap-1.5 transition disabled:opacity-60"
                        style={{ background: `${accent}22`, border: `1px solid ${accent}55`, color: accent }}
                      >
                        {status === "running" ? (
                          <><span className="tick live" style={{color: accent}}/> Deploying…</>
                        ) : (
                          <><Rocket size={12}/> Deploy</>
                        )}
                      </button>
                    </div>
                  </div>
                  <ul className="text-[11.5px] space-y-0.5 mb-2 max-h-[110px] overflow-y-auto scroll">
                    {s.recent.slice(0, 4).map((r) => (
                      <li key={r.slug} className="flex justify-between gap-2 text-[var(--fg-dim)]">
                        <span className="truncate font-[var(--font-geist-mono)]">{r.slug}</span>
                        <span className="shrink-0 text-[var(--fg-dimmer)]">{new Date(r.mtime).toLocaleDateString("en-GB",{ day:"2-digit", month:"short"})}</span>
                      </li>
                    ))}
                  </ul>
                  {log.length > 0 && (
                    <pre className="mt-2 scroll bg-[rgba(0,0,0,0.45)] border border-[var(--panel-border)] rounded-lg p-2 max-h-[200px] overflow-auto text-[11px] font-[var(--font-geist-mono)] text-[var(--fg-dim)] whitespace-pre-wrap">
                      {log.join("")}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "history" && (
        <div className="space-y-6">
          {/* Recently deployed URLs */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Rocket size={14} className="text-[#a855f7]" />
                Recently deployed
                <span className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] font-normal ml-2">
                  {historyDeploys.length} deploys logged
                </span>
              </h3>
              <button
                onClick={refreshHistory}
                className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] hover:text-[var(--fg-dim)]"
              >
                Refresh
              </button>
            </div>

            {historyDeploys.length === 0 ? (
              <div className="panel p-5 text-sm text-[var(--fg-dim)]">
                No deploys yet. Click <strong>Deploy</strong> on any site card and the log will appear here.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {historyDeploys.slice(0, 12).map((d) => {
                  const accent = SITE_ACCENT[d.siteId] ?? "#a3e635";
                  const colour = d.status === "ok" ? "#86efac" : d.status === "failed" ? "#f87171" : "#fbbf24";
                  return (
                    <motion.div
                      key={d.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="panel p-4 relative overflow-hidden"
                    >
                      <div className="pointer-events-none absolute -right-8 -top-8 w-32 h-32 rounded-full blur-3xl opacity-20" style={{ background: accent }} />
                      <div className="relative">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="min-w-0">
                            <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] flex items-center gap-1.5">
                              <Clock size={10} /> {fmtAgo(d.startedAt)} · {fmtDuration(d.durationMs)}
                            </div>
                            <div className="text-sm font-medium mt-0.5" style={{ color: accent }}>{d.siteName}</div>
                          </div>
                          <span
                            className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border shrink-0"
                            style={{ color: colour, borderColor: `${colour}55`, background: `${colour}14` }}
                          >
                            {d.status === "ok" ? "✓ ok" : d.status === "failed" ? "✗ failed" : "⋯ running"}
                          </span>
                        </div>

                        {d.liveUrl && (
                          <a
                            href={d.liveUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-[12.5px] text-[var(--accent-cyan)] hover:underline truncate"
                          >
                            <ExternalLink size={12} className="shrink-0" />
                            <span className="truncate font-[var(--font-geist-mono)]">{d.liveUrl}</span>
                          </a>
                        )}
                        {d.netlifyUrl && d.netlifyUrl !== d.liveUrl && (
                          <a
                            href={d.netlifyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-[11px] text-[var(--fg-dimmer)] hover:text-[var(--fg-dim)] truncate mt-1"
                          >
                            netlify: <span className="font-[var(--font-geist-mono)]">{d.netlifyUrl}</span>
                          </a>
                        )}
                        {d.liveSlug && !d.liveUrl && (
                          <div className="text-[11.5px] text-[var(--fg-dim)] font-[var(--font-geist-mono)] truncate">
                            slug: {d.liveSlug}
                          </div>
                        )}
                        {d.errorTail && d.status === "failed" && (
                          <pre className="mt-2 text-[10.5px] text-rose-300/80 bg-[rgba(248,113,113,0.06)] rounded px-2 py-1 max-h-[80px] overflow-auto font-[var(--font-geist-mono)] whitespace-pre-wrap">
                            {d.errorTail.slice(-400)}
                          </pre>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Session history */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Sparkles size={14} className="text-[#a3e635]" />
                Generate sessions
                <span className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] font-normal ml-2">
                  {historySessions.length} sessions logged
                </span>
              </h3>
            </div>

            {historySessions.length === 0 ? (
              <div className="panel p-5 text-sm text-[var(--fg-dim)]">
                No generate sessions yet. Run one from the <strong>Generate</strong> tab and it'll show here.
              </div>
            ) : (
              <div className="space-y-2.5">
                {historySessions.slice(0, 30).map((s) => {
                  const colour = s.status === "completed" ? "#86efac" : s.status === "failed" ? "#f87171" : s.status === "aborted" ? "#fbbf24" : "#22d3ee";
                  return (
                    <motion.div
                      key={s.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="panel p-4"
                    >
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] flex items-center gap-1.5">
                            <Clock size={10} /> {fmtAgo(s.createdAt)} · {fmtDuration(s.finishedAt ? s.finishedAt - s.createdAt : undefined)}
                          </div>
                          <div className="mt-0.5 text-sm font-medium text-[var(--fg)] truncate">{s.keyword}</div>
                          <div className="text-[11.5px] text-[var(--fg-dim)] font-[var(--font-geist-mono)] truncate">
                            slug: {s.slug} · transcript: {s.transcriptSource}
                          </div>
                        </div>
                        <span
                          className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border shrink-0"
                          style={{ color: colour, borderColor: `${colour}55`, background: `${colour}14` }}
                        >
                          {s.status === "completed" ? "✓ done" :
                           s.status === "failed"    ? "✗ failed" :
                           s.status === "aborted"   ? "⏹ aborted" : "⋯ running"}
                        </span>
                      </div>

                      {s.articles.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-[var(--panel-border)]">
                          <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-1.5">
                            {s.articles.length} of 5 articles written
                          </div>
                          <ul className="space-y-1">
                            {s.articles.map((a) => {
                              const accent = SITE_ACCENT[a.siteId] ?? "#a3e635";
                              return (
                                <li key={a.filePath} className="flex items-center gap-2 text-[11.5px]">
                                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: accent, boxShadow: `0 0 8px ${accent}` }} />
                                  {a.liveUrl ? (
                                    <a
                                      href={a.liveUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center gap-1 text-[var(--accent-cyan)] hover:underline truncate font-[var(--font-geist-mono)]"
                                    >
                                      <ExternalLink size={10} className="shrink-0 opacity-70" />
                                      <span className="truncate">{a.liveUrl}</span>
                                    </a>
                                  ) : (
                                    <span className="text-[var(--fg-dim)] truncate font-[var(--font-geist-mono)]">{a.filePath}</span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {tab === "transcripts" && (
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-widest text-[var(--fg-dimmer)]">{transcripts.length} transcripts · most recent first</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {transcripts.map((t) => (
              <button
                key={t.slug}
                onClick={() => { setTab("generate"); pickTranscript(t); }}
                className="panel panel-hover p-3 text-left"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="font-[var(--font-geist-mono)] text-[13px] text-[var(--fg)] truncate">{t.slug}</div>
                  <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] shrink-0">
                    {new Date(t.mtime).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} · {(t.bytes/1024).toFixed(1)}KB
                  </div>
                </div>
                <div className="mt-1 text-[12px] text-[var(--fg-dim)] line-clamp-2 leading-snug">{t.preview}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === "openseo" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-[13px] text-[var(--fg-dim)] max-w-[60ch]">
              <span className="text-[var(--fg)] font-medium">OpenSEO</span> — a free, self-hosted Semrush/Ahrefs alternative. Keyword research, rank tracking, backlinks &amp; site audits, powered by your own DataForSEO key. Runs locally on this Mac.
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="flex items-center gap-1.5 text-[11.5px] metric px-2.5 py-1 rounded-full border"
                style={{
                  borderColor: openseoUp ? "rgba(163,230,53,0.4)" : "var(--panel-border)",
                  color: openseoUp ? "#a3e635" : "var(--fg-dim)",
                }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: openseoUp ? "#a3e635" : openseoUp === false ? "#f87171" : "#a1a1aa" }} />
                {openseoUp == null ? "checking…" : openseoUp ? "running" : "not running"}
              </span>
              <a href="http://localhost:3001" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[12.5px] transition border-[var(--panel-border)] text-[var(--fg-dim)] hover:text-[var(--fg)] hover:border-[rgba(163,230,53,0.4)]">
                <ExternalLink size={14} /> Open full
              </a>
            </div>
          </div>

          {openseoUp === false ? (
            <div className="rounded-xl border border-[var(--panel-border)] p-6 text-[13px] text-[var(--fg-dim)] leading-relaxed">
              <div className="flex items-center gap-2 text-amber-300 mb-2"><AlertCircle size={16} /> OpenSEO isn&apos;t responding on localhost:3001.</div>
              Make sure Docker Desktop is running, then start it:
              <pre className="mt-2 p-3 rounded-lg bg-[rgba(255,255,255,0.04)] text-[12px] overflow-x-auto">cd ~/open-seo &amp;&amp; docker compose up -d</pre>
              It auto-restarts with Docker, so this is usually a one-time step after a reboot.
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden border border-[var(--panel-border)] bg-white" style={{ height: "78vh" }}>
              <iframe src="http://localhost:3001" title="OpenSEO" className="w-full h-full border-0" allow="clipboard-write" />
            </div>
          )}
        </div>
      )}

      {tab === "skill" && <MarkdownView src="/api/seo/skill" />}
    </div>
  );
}

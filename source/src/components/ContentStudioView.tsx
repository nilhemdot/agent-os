"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Pin, ExternalLink, Check, Loader2, AlertTriangle, Rocket,
  FileText, Film, CircleDot, Sparkles, RefreshCw,
} from "lucide-react";

/* ---- types mirror src/lib/contentStudio.ts ---- */
type CardStatus = "todo" | "running" | "done" | "blocked";
interface CardIteration { n: number; score: number; verdict: string; fixes: string[] }
interface ContentCard {
  id: string; column: string; title: string; profile: string | null; role: string;
  status: CardStatus; summary: string | null; startedAt: number | null; endedAt: number | null;
  iterations?: CardIteration[];
}
interface BlogArtifact {
  kind: "blog"; title: string | null; slug: string | null; previewPath: string | null;
  previewReady: boolean; pinned: boolean; deployUrl: string | null; published: boolean;
}
interface VideoArtifact {
  kind: "video"; title: string | null; file: string | null; isHtml?: boolean;
  previewReady: boolean; pinned: boolean;
}
interface ContentLane {
  id: string; title: string; accent: string; topic: string; status: string;
  deployTarget?: string; cards: ContentCard[]; artifact: BlogArtifact | VideoArtifact;
}
interface ContentState { updated: number; title: string; columns: string[]; lanes: ContentLane[] }

const previewUrl = (rel: string) =>
  `/api/content/preview/${rel.split("/").map(encodeURIComponent).join("/")}`;

function timeAgo(ts: number | null): string {
  if (!ts) return "";
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

export default function ContentStudioView() {
  const [state, setState] = useState<ContentState | null>(null);
  const [reason, setReason] = useState<string>("");
  const [publishing, setPublishing] = useState(false);
  const [publishLog, setPublishLog] = useState<string>("");
  const [pubUrl, setPubUrl] = useState<string>("");
  const fp = useRef<string>("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/content/board", { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) { setReason(j.reason || "no board"); return; }
      const next = JSON.stringify(j.state);
      if (next !== fp.current) { fp.current = next; setState(j.state); }
    } catch { /* keep last */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [load]);

  const togglePin = useCallback(async (laneId: string, pinned: boolean) => {
    await fetch("/api/content/pin", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lane: laneId, pinned }),
    });
    load();
  }, [load]);

  const publish = useCallback(async () => {
    if (!window.confirm(
      "Publish this blog post LIVE to aiprofitboardroom.com via Netlify?\n\n" +
      "This builds the 11ty site and runs a production deploy. It is public and irreversible."
    )) return;
    setPublishing(true); setPublishLog(""); setPubUrl("");
    try {
      const r = await fetch("/api/seo/deploy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId: "aiprofitboardroom" }),
      });
      const reader = r.body?.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() || "";
        for (const ln of lines) {
          if (!ln.trim()) continue;
          try {
            const ev = JSON.parse(ln);
            if (ev.type === "step") setPublishLog((p) => p + `▸ ${ev.label}\n`);
            if (ev.type === "done") { if (ev.netlifyUrl) setPubUrl(ev.netlifyUrl); if (ev.liveUrl) setPubUrl(ev.liveUrl); setPublishLog((p) => p + (ev.ok ? "✓ published\n" : `✗ ${ev.reason || "failed"}\n`)); }
            if (ev.type === "error") setPublishLog((p) => p + `✗ ${ev.text}\n`);
          } catch { /* ignore partial */ }
        }
      }
    } catch (e) {
      setPublishLog((p) => p + `✗ ${String(e)}\n`);
    } finally {
      setPublishing(false);
      load();
    }
  }, [load]);

  if (!state) {
    return (
      <div className="p-8 text-[var(--fg-dim)]">
        <div className="flex items-center gap-2 text-sm">
          <Loader2 size={15} className="animate-spin" /> Loading Content Studio…
        </div>
        {reason && <p className="mt-3 text-xs text-[var(--fg-dimmer)]">{reason}</p>}
      </div>
    );
  }

  const pinned = state.lanes.filter((l) => l.artifact.previewReady && l.artifact.pinned);

  return (
    <div className="flex flex-col gap-5 p-5 md:p-7 max-w-[1700px] mx-auto">
      {/* header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="heading-strip">
            <h1 className="text-2xl font-semibold tracking-tight" style={{ fontFamily: "'Bricolage Grotesque',sans-serif" }}>
              Content Studio
            </h1>
          </div>
          <p className="text-sm text-[var(--fg-dim)] mt-2 max-w-2xl">
            Two teams of GLM-5.2 Hermes agents — an SEO blog team and a video team — write, refine, and a judge iterates every piece until it passes. Finished work pins to the top.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {state.lanes.map((l) => (
            <span key={l.id} className="pill flex items-center gap-1.5" style={{ borderColor: `${l.accent}55`, color: l.accent }}>
              {l.id === "seo" ? <FileText size={12} /> : <Film size={12} />}
              {l.title}
              <LaneStatusDot lane={l} />
            </span>
          ))}
          <button onClick={load} className="pill flex items-center gap-1.5 text-[var(--fg-dimmer)] hover:text-[var(--fg)]" title="Refresh">
            <RefreshCw size={12} /> live
          </button>
        </div>
      </div>

      {/* pinned previews */}
      {pinned.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {pinned.map((l) => (
            <PinnedPreview
              key={l.id} lane={l}
              onUnpin={() => togglePin(l.id, false)}
              onPublish={publish}
              publishing={publishing}
              publishLog={publishLog}
              pubUrl={pubUrl}
            />
          ))}
        </div>
      )}

      {/* unpinned-but-ready hint */}
      {state.lanes.filter((l) => l.artifact.previewReady && !l.artifact.pinned).map((l) => (
        <button key={l.id} onClick={() => togglePin(l.id, true)}
          className="self-start pill flex items-center gap-1.5 text-[var(--gold)] hover:brightness-110"
          style={{ borderColor: "rgba(212,165,116,0.5)" }}>
          <Pin size={12} /> Pin the finished {l.artifact.kind === "blog" ? "blog preview" : "video"} to the top
        </button>
      ))}

      {/* the board */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {state.columns.map((col) => {
          const cards = state.lanes.flatMap((l) =>
            l.cards.filter((c) => c.column === col).map((c) => ({ card: c, lane: l }))
          );
          return (
            <section key={col} className="panel p-3 min-h-[200px] flex flex-col gap-2"
              style={{ borderTop: "2px solid var(--line)" }}>
              <div className="flex items-center justify-between mb-1">
                <span className="action-tag text-[var(--fg-dim)]">{col}</span>
                <span className="metric text-[10px] text-[var(--fg-dimmer)]">{cards.length}</span>
              </div>
              {cards.map(({ card, lane }) => (
                <Card key={card.id} card={card} accent={lane.accent}
                  isDeploy={card.id === "seo-deploy"}
                  artifact={lane.artifact}
                  onPublish={publish} publishing={publishing} />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function LaneStatusDot({ lane }: { lane: ContentLane }) {
  const running = lane.status === "running";
  const done = lane.status === "done";
  const color = done ? "#86efac" : running ? "#fbbf24" : "var(--fg-dimmer)";
  return <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: color, boxShadow: running ? `0 0 6px ${color}` : "none" }} />;
}

function StatusIcon({ status }: { status: CardStatus }) {
  if (status === "running") return <Loader2 size={13} className="animate-spin" style={{ color: "#fbbf24" }} />;
  if (status === "done") return <Check size={13} style={{ color: "#86efac" }} />;
  if (status === "blocked") return <AlertTriangle size={13} style={{ color: "#f87171" }} />;
  return <CircleDot size={13} style={{ color: "var(--fg-dimmer)" }} />;
}

function Card({
  card, accent, isDeploy, artifact, onPublish, publishing,
}: {
  card: ContentCard; accent: string; isDeploy: boolean;
  artifact: BlogArtifact | VideoArtifact; onPublish: () => void; publishing: boolean;
}) {
  const running = card.status === "running";
  return (
    <div className="rounded-lg border p-2.5 flex flex-col gap-1.5"
      style={{
        borderColor: running ? `${accent}88` : "var(--line-soft)",
        background: running ? `${accent}10` : "rgba(255,255,255,0.02)",
        boxShadow: running ? `0 0 0 1px ${accent}33` : "none",
      }}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: accent }}>{card.role}</span>
        <StatusIcon status={card.status} />
      </div>
      <div className="text-[12.5px] text-[var(--fg)] leading-snug">{card.title}</div>
      {card.profile && (
        <div className="metric text-[10px] text-[var(--fg-dimmer)] flex items-center gap-1">
          <span className="opacity-60">⌗</span>{card.profile}
          {card.endedAt && <span className="ml-auto">{timeAgo(card.endedAt)} ago</span>}
        </div>
      )}
      {card.summary && (
        <div className="text-[11px] text-[var(--fg-dim)] leading-snug line-clamp-3">{card.summary}</div>
      )}
      {/* judge iterations */}
      {card.iterations && card.iterations.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-0.5">
          {card.iterations.map((it) => (
            <span key={it.n}
              className="metric text-[9.5px] px-1.5 py-0.5 rounded"
              title={(it.fixes || []).join(" · ")}
              style={{
                border: `1px solid ${it.verdict === "PASS" ? "rgba(134,239,172,0.5)" : "rgba(251,191,36,0.5)"}`,
                color: it.verdict === "PASS" ? "#86efac" : "#fbbf24",
              }}>
              #{it.n} {it.score}/10 {it.verdict === "PASS" ? "✓" : "↻"}
            </span>
          ))}
        </div>
      )}
      {/* deploy / publish button */}
      {isDeploy && artifact.kind === "blog" && (
        <div className="mt-1">
          {artifact.published && artifact.deployUrl ? (
            <a href={artifact.deployUrl} target="_blank" rel="noopener"
              className="pill-ok flex items-center gap-1 w-fit text-[11px]">
              <Check size={11} /> Published <ExternalLink size={10} />
            </a>
          ) : artifact.previewReady ? (
            <button onClick={onPublish} disabled={publishing}
              className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-md"
              style={{ background: "linear-gradient(135deg,#e6c69a,var(--gold))", color: "#1a1018", opacity: publishing ? 0.6 : 1 }}>
              {publishing ? <Loader2 size={11} className="animate-spin" /> : <Rocket size={11} />}
              {publishing ? "Publishing…" : "Publish to aiprofitboardroom.com"}
            </button>
          ) : (
            <span className="text-[10px] text-[var(--fg-dimmer)]">waiting for a passing post…</span>
          )}
        </div>
      )}
    </div>
  );
}

function PinnedPreview({
  lane, onUnpin, onPublish, publishing, publishLog, pubUrl,
}: {
  lane: ContentLane; onUnpin: () => void; onPublish: () => void;
  publishing: boolean; publishLog: string; pubUrl: string;
}) {
  const a = lane.artifact;
  const isBlog = a.kind === "blog";
  const src = isBlog
    ? (a as BlogArtifact).previewPath ? previewUrl((a as BlogArtifact).previewPath as string) : ""
    : (a as VideoArtifact).file ? previewUrl((a as VideoArtifact).file as string) : "";
  const videoIsHtml = !isBlog && (a as VideoArtifact).isHtml;

  return (
    <div className="panel overflow-hidden flex flex-col"
      style={{ border: `1px solid ${lane.accent}66`, boxShadow: `0 16px 44px rgba(0,0,0,0.45)` }}>
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "var(--line-soft)", background: `${lane.accent}12` }}>
        <span className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: lane.accent }}>
          {isBlog ? <FileText size={13} /> : <Film size={13} />}
          {a.title || lane.title}
          <span className="pill-ok text-[9px] flex items-center gap-1"><Sparkles size={9} /> DONE</span>
        </span>
        <div className="flex items-center gap-2">
          {src && (
            <a href={src} target="_blank" rel="noopener" className="text-[var(--fg-dimmer)] hover:text-[var(--fg)]" title="Open full">
              <ExternalLink size={14} />
            </a>
          )}
          <button onClick={onUnpin} title="Unpin" className="text-[var(--gold)] hover:brightness-110"><Pin size={14} fill="currentColor" /></button>
        </div>
      </div>

      <div className="bg-black/40" style={{ height: 360 }}>
        {!src ? (
          <div className="grid place-items-center h-full text-xs text-[var(--fg-dimmer)]">no preview file</div>
        ) : isBlog || videoIsHtml ? (
          <iframe src={src} title={a.title || lane.title} className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-pointer-lock" />
        ) : (
          <video src={src} controls preload="metadata" className="w-full h-full object-contain bg-black" />
        )}
      </div>

      {isBlog && (
        <div className="px-3 py-2 border-t flex items-center justify-between gap-2" style={{ borderColor: "var(--line-soft)" }}>
          {(a as BlogArtifact).published && (a as BlogArtifact).deployUrl ? (
            <a href={(a as BlogArtifact).deployUrl as string} target="_blank" rel="noopener" className="pill-ok text-[11px] flex items-center gap-1">
              <Check size={11} /> Live <ExternalLink size={10} />
            </a>
          ) : (
            <button onClick={onPublish} disabled={publishing}
              className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-md"
              style={{ background: "linear-gradient(135deg,#e6c69a,var(--gold))", color: "#1a1018", opacity: publishing ? 0.6 : 1 }}>
              {publishing ? <Loader2 size={12} className="animate-spin" /> : <Rocket size={12} />}
              {publishing ? "Publishing…" : "Publish to aiprofitboardroom.com"}
            </button>
          )}
          {publishLog && <pre className="metric text-[9px] text-[var(--fg-dimmer)] whitespace-pre-wrap max-h-12 overflow-auto flex-1">{publishLog}</pre>}
          {pubUrl && <a href={pubUrl} target="_blank" rel="noopener" className="text-[10px] text-[var(--gold)] truncate max-w-[180px]">{pubUrl}</a>}
        </div>
      )}
    </div>
  );
}

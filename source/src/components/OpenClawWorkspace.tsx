"use client";

import { useEffect, useState } from "react";
import {
  FolderOpen, FileText, Copy, Download, X, Eye, ExternalLink, RefreshCw,
  AppWindow, Box, Layers, Workflow, Brush, ListChecks, Clock, ScrollText,
  Radio, Sparkles,
} from "lucide-react";

// OpenClaw Workspace — same pattern as Hermes Workspace, OpenClaw-flavoured.
//
// Buckets (from lib/openclawWorkspace.ts):
//   Apps · Main Workspace · Personal Workspace · Marketing Workspace ·
//   Skills · Flows · Canvas · Tasks · Cron · Logs
//
// Click bucket → see files → click file → inline preview.
// HTML renders in an iframe with Preview/Source toggle, images render inline,
// videos play with controls, audio uses the audio element, PDFs embed.

const ACCENT = "#f472b6"; // OpenClaw pink — matches the rest of the OpenClaw UI

interface HmProject { id: string; label: string; description: string; mtime: number; fileCount: number; roots: string[]; }
type HmFileKind = "text" | "image" | "video" | "audio" | "pdf" | "binary";
interface HmFile { name: string; relPath: string; bytes: number; mtime: number; isText: boolean; kind: HmFileKind; }

function fmtAgo(ms: number): string {
  if (!ms) return "—";
  const d = Date.now() - ms;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}
function bucketIcon(id: string) {
  const props = { size: 11, style: { color: ACCENT } };
  if (id === "apps")                 return <AppWindow {...props} />;
  if (id === "workspace-main")       return <FolderOpen {...props} />;
  if (id === "workspace-julian")     return <FolderOpen {...props} />;
  if (id === "workspace-marketing")  return <FolderOpen {...props} />;
  if (id === "skills")               return <Layers {...props} />;
  if (id === "flows")                return <Workflow {...props} />;
  if (id === "canvas")               return <Brush {...props} />;
  if (id === "tasks")                return <ListChecks {...props} />;
  if (id === "cron")                 return <Clock {...props} />;
  if (id === "logs")                 return <ScrollText {...props} />;
  return <Box {...props} />;
}

export default function OpenClawWorkspace() {
  const [buckets, setBuckets] = useState<HmProject[]>([]);
  const [selected, setSelected] = useState<HmProject | null>(null);
  const [files, setFiles] = useState<HmFile[]>([]);
  const [open, setOpen] = useState<{ path: string; content: string; bytes: number; truncated: boolean; kind: HmFileKind } | null>(null);
  const [htmlMode, setHtmlMode] = useState<"source" | "preview">("preview");
  const [loading, setLoading] = useState(false);

  async function refresh() {
    try {
      const r = await fetch("/api/openclaw/workspace", { cache: "no-store" });
      const j = await r.json();
      setBuckets(Array.isArray(j.buckets) ? j.buckets : []);
    } catch {}
  }
  async function selectBucket(b: HmProject) {
    // Only close the open preview when the user actively switches buckets,
    // not on every poll tick (same flash-fix as Hermes Workspace).
    setSelected(b); setOpen(null); setLoading(true);
    try {
      const r = await fetch(`/api/openclaw/workspace?bucket=${encodeURIComponent(b.id)}`, { cache: "no-store" });
      const j = await r.json();
      setFiles(Array.isArray(j.files) ? j.files : []);
    } catch { setFiles([]); }
    setLoading(false);
  }
  // Silent file-list refresh used by the poll — keeps the open preview intact.
  async function refreshFiles(bucketId: string) {
    try {
      const r = await fetch(`/api/openclaw/workspace?bucket=${encodeURIComponent(bucketId)}`, { cache: "no-store" });
      const j = await r.json();
      const next = Array.isArray(j.files) ? j.files : [];
      setFiles((prev) => {
        if (prev.length !== next.length) return next;
        for (let i = 0; i < prev.length; i++) {
          if (prev[i].relPath !== next[i].relPath || prev[i].mtime !== next[i].mtime) return next;
        }
        return prev;
      });
    } catch {}
  }
  async function loadFile(f: HmFile) {
    if (!selected) return;
    if (f.kind !== "text") {
      setOpen({ path: f.relPath, content: "", bytes: f.bytes, truncated: false, kind: f.kind });
      return;
    }
    try {
      const r = await fetch(`/api/openclaw/workspace/file?bucket=${encodeURIComponent(selected.id)}&path=${encodeURIComponent(f.relPath)}`, { cache: "no-store" });
      const j = await r.json();
      if (j.content !== undefined) setOpen({ path: f.relPath, content: j.content, bytes: j.bytes, truncated: j.truncated, kind: "text" });
    } catch {}
  }
  function rawUrl(relPath: string): string {
    if (!selected) return "";
    const segs = relPath.split("/").map(encodeURIComponent).join("/");
    return `/api/openclaw/preview/${encodeURIComponent(selected.id)}/${segs}`;
  }

  useEffect(() => { refresh(); }, []);
  // Auto-select the bucket with the most recent activity once buckets load.
  useEffect(() => {
    if (!selected && buckets.length > 0) {
      const recent = buckets.find((b) => b.fileCount > 0) ?? buckets[0];
      selectBucket(recent);
    }
  }, [buckets, selected]);
  // Poll every 6 seconds so newly-created artefacts surface live, but use the
  // silent refresh so the open preview iframe doesn't unmount/remount.
  useEffect(() => {
    const t = setInterval(() => {
      refresh();
      if (selected) refreshFiles(selected.id);
    }, 6000);
    return () => clearInterval(t);
  }, [selected]);

  // When a file is open we shift to a 3-column layout: buckets | files | preview.
  const gridCols = open
    ? "lg:grid-cols-[260px_280px_1fr]"
    : "lg:grid-cols-[320px_1fr]";

  // Total artefacts across all buckets — used in the hero strip
  const totalFiles = buckets.reduce((sum, b) => sum + b.fileCount, 0);
  const liveBuckets = buckets.filter((b) => b.fileCount > 0).length;

  return (
    <div className="space-y-4">
      {/* Hero strip — matches the Studio + Goal Mode tone */}
      <div className="relative overflow-hidden rounded-xl border p-4"
        style={{
          borderColor: `${ACCENT}40`,
          background:
            `radial-gradient(ellipse at 0% 0%, ${ACCENT}18, transparent 55%),` +
            `radial-gradient(ellipse at 100% 100%, rgba(212,165,116,0.10), transparent 55%),` +
            `linear-gradient(180deg, rgba(244,114,182,0.06), transparent)`,
        }}>
        <div className="flex items-center gap-3 mb-1">
          <div className="grid place-items-center w-9 h-9 rounded-lg"
            style={{ background: `${ACCENT}24`, color: ACCENT, boxShadow: `0 0 26px -10px ${ACCENT}` }}>
            <Sparkles size={16} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest" style={{ color: ACCENT }}>OpenClaw · Workspace</div>
            <div className="text-[15px] font-medium text-[var(--cream)]">
              Everything OpenClaw has ever built
            </div>
          </div>
          <div className="ml-auto flex items-center gap-4 text-[10.5px] uppercase tracking-widest" style={{ color: "var(--cream-mute)" }}>
            <span className="flex items-center gap-1.5">
              <Radio size={11} style={{ color: ACCENT }} className="animate-pulse" />
              live
            </span>
            <span><span className="text-[var(--cream)] font-medium">{liveBuckets}</span> active</span>
            <span><span className="text-[var(--cream)] font-medium">{totalFiles}</span> files</span>
          </div>
        </div>
        <p className="text-[12px] text-[var(--cream-dim)] max-w-[640px]">
          Apps, skills, flows, canvas outputs, Studio renders. Click any bucket → see files → click a file → live preview in the third column.
        </p>
      </div>

    <div className={`grid grid-cols-1 ${gridCols} gap-0 h-full min-h-[640px] border rounded-md overflow-hidden`}
         style={{ borderColor: "var(--line-soft)" }}>
      {/* Bucket sidebar */}
      <aside className="border-r p-3 space-y-2 overflow-y-auto scroll" style={{ borderColor: "var(--line-soft)" }}>
        <div className="flex items-center justify-between mb-1">
          <div className="action-tag" style={{ color: ACCENT }}>
            <FolderOpen size={11} className="inline mr-1" /> Buckets · {buckets.length}
          </div>
          <button onClick={refresh} className="text-[var(--cream-mute)] hover:text-[var(--cream-dim)]"><RefreshCw size={11} /></button>
        </div>
        <div className="text-[10.5px] leading-relaxed mb-2" style={{ color: "var(--cream-mute)" }}>
          Click any bucket to browse. Files less than 5 min old show a pink pulse.
        </div>
        {buckets.length === 0 && (
          <div className="text-[11px] text-[var(--cream-mute)] italic p-2">Loading buckets…</div>
        )}
        {buckets.map((b) => {
          // Bucket counts as "fresh" if its most-recent file is < 5 min old
          const fresh = b.mtime > 0 && (Date.now() - b.mtime) < 5 * 60_000;
          const isSelected = selected?.id === b.id;
          return (
          <button key={b.id} onClick={() => selectBucket(b)}
            className="relative block w-full text-left p-3 rounded-md border transition group overflow-hidden"
            style={{
              borderColor: isSelected ? `${ACCENT}88` : (fresh ? `${ACCENT}45` : "var(--line-soft)"),
              background: isSelected
                ? `linear-gradient(135deg, ${ACCENT}1f, ${ACCENT}0a)`
                : fresh
                  ? `linear-gradient(135deg, ${ACCENT}0c, transparent)`
                  : "transparent",
              boxShadow: isSelected ? `0 0 24px -10px ${ACCENT}` : undefined,
            }}>
            {fresh && (
              <span className="absolute top-2 right-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8.5px] uppercase tracking-widest font-semibold"
                style={{ background: ACCENT, color: "#1a0f20", boxShadow: `0 0 14px -2px ${ACCENT}` }}>
                <span className="w-1.5 h-1.5 rounded-full bg-[#1a0f20] animate-pulse" />
                new
              </span>
            )}
            <div className="flex items-center gap-2">
              {bucketIcon(b.id)}
              <span className="text-[12px] text-[var(--cream)] font-medium">{b.label}</span>
              <span className="ml-auto text-[10px] mono"
                style={{ color: b.fileCount > 0 ? "var(--cream-dim)" : "var(--cream-mute)" }}>
                {b.fileCount}
              </span>
            </div>
            <div className="text-[10px] text-[var(--cream-mute)] mt-1 leading-snug">{b.description}</div>
            <div className="text-[10px] mono mt-1" style={{ color: fresh ? ACCENT : "var(--cream-mute)", opacity: fresh ? 1 : 0.7 }}>
              {b.fileCount > 0 ? fmtAgo(b.mtime) : "empty"}
            </div>
          </button>
          );
        })}
      </aside>

      {/* File browser + preview */}
      <main className="flex flex-col min-h-0 overflow-hidden">
        {!selected ? (
          <div className="p-6 text-[var(--cream-mute)] text-sm">Pick a bucket on the left.</div>
        ) : (
          <>
            <div className="px-4 py-2.5 border-b flex items-center justify-between" style={{ borderColor: "var(--line-soft)" }}>
              <div className="min-w-0">
                <div className="text-[13px] text-[var(--cream)] truncate flex items-center gap-2">
                  {bucketIcon(selected.id)}{selected.label}
                  <span className="text-[10px] mono ml-1" style={{ color: "var(--cream-mute)" }}>· {selected.fileCount} files</span>
                </div>
                <div className="text-[10.5px] text-[var(--cream-mute)] mono truncate">
                  {selected.roots.join(" · ") || "(no physical dirs)"}
                </div>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto scroll p-2 space-y-0.5">
              {loading ? (
                <div className="text-[11px] text-[var(--cream-mute)] italic p-3">Loading files…</div>
              ) : files.length === 0 ? (
                <div className="text-[11px] text-[var(--cream-mute)] italic p-3">
                  This bucket is empty. Run something through OpenClaw — chat, a flow, a skill — and the outputs will land here.
                </div>
              ) : files.map((f) => {
                const fileFresh = (Date.now() - f.mtime) < 5 * 60_000;
                return (
                <button key={f.relPath} onClick={() => loadFile(f)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-md text-left transition hover:bg-[rgba(255,255,255,0.02)]"
                  style={{
                    background: open?.path === f.relPath
                      ? `${ACCENT}10`
                      : fileFresh
                        ? `${ACCENT}06`
                        : "transparent",
                  }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText size={11} style={{ color: ACCENT }} />
                    <span className="text-[12px] mono truncate" style={{ color: "var(--cream)" }}>{f.relPath}</span>
                    <span className="text-[10px] uppercase tracking-widest ml-1" style={{ color: "var(--cream-mute)" }}>{f.kind}</span>
                    {fileFresh && (
                      <span className="px-1.5 py-0.5 rounded-full text-[8.5px] uppercase tracking-widest font-semibold animate-pulse"
                        style={{ background: ACCENT, color: "#1a0f20" }}>new</span>
                    )}
                  </div>
                  <div className="text-[10px] mono shrink-0 ml-2" style={{ color: fileFresh ? ACCENT : "var(--cream-mute)" }}>
                    {(f.bytes / 1024).toFixed(1)}KB · {fmtAgo(f.mtime)}
                  </div>
                </button>
                );
              })}
            </div>
          </>
        )}
      </main>

      {/* Preview column — third column in the outer grid. Mounted only when a
          file is open. iframe `src` change handles transitions — never wrap
          in AnimatePresence here, it caused the flash bug in Hermes. */}
      {selected && open && (
        <section className="flex flex-col min-h-0 overflow-hidden border-l" style={{ borderColor: "var(--line-soft)" }}>
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
                      }}>
                      <Eye size={10} className="inline mr-1" />Preview
                    </button>
                    <button onClick={() => setHtmlMode("source")}
                      className="text-[10px] uppercase tracking-widest px-2 py-1 transition"
                      style={{
                        background: htmlMode === "source" ? `${ACCENT}28` : "transparent",
                        color: htmlMode === "source" ? ACCENT : "var(--cream-dim)",
                      }}>
                      <FileText size={10} className="inline mr-1" />Source
                    </button>
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

          {/* Preview body — fills remaining column height */}
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            {open.kind === "text" && (() => {
              const isHtml = /\.html?$/.test(open.path);
              if (isHtml && htmlMode === "preview") {
                return <iframe src={rawUrl(open.path)} title={open.path} className="w-full h-full flex-1 bg-white border-0"
                               sandbox="allow-scripts allow-forms allow-popups allow-modals" />;
              }
              return (
                <pre className="scroll flex-1 min-h-0 p-3 text-[12px] leading-relaxed text-[var(--cream)] whitespace-pre-wrap font-[var(--font-geist-mono)] overflow-auto">
                  {open.content}
                </pre>
              );
            })()}
            {open.kind === "image" && (
              <a href={rawUrl(open.path)} target="_blank" rel="noopener noreferrer"
                 className="flex-1 min-h-0 grid place-items-center bg-[rgba(0,0,0,0.6)] overflow-auto">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={rawUrl(open.path)} alt={open.path} className="max-w-full max-h-full object-contain" />
              </a>
            )}
            {open.kind === "video" && (
              <div className="flex-1 min-h-0 grid place-items-center bg-black">
                <video src={rawUrl(open.path)} controls preload="metadata" className="max-w-full max-h-full" />
              </div>
            )}
            {open.kind === "audio" && (
              <div className="flex-1 min-h-0 grid place-items-center bg-[rgba(0,0,0,0.6)] p-6">
                <div className="w-full max-w-[480px] space-y-3">
                  <div className="text-[10.5px] uppercase tracking-widest text-center" style={{ color: "var(--cream-mute)" }}>{open.path}</div>
                  <audio src={rawUrl(open.path)} controls className="w-full" />
                </div>
              </div>
            )}
            {open.kind === "pdf" && (
              <iframe src={rawUrl(open.path)} title={open.path} className="w-full h-full flex-1 bg-white border-0" />
            )}
            {open.kind === "binary" && (
              <div className="p-6 text-[12px] text-[var(--cream-soft)] flex-1 grid place-items-center">
                <div>Binary file — <a href={rawUrl(open.path)} download={open.path.split("/").pop()} style={{ color: ACCENT }} className="hover:underline">download to view</a>.</div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
    </div>
  );
}

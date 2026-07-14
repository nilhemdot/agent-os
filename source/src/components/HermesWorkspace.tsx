"use client";

import { useEffect, useState } from "react";
import {
  FolderOpen, FileText, Copy, Download, X, Eye, ExternalLink, RefreshCw,
  ImageIcon, Mic, FileType, Box, Layers, Film, AppWindow,
} from "lucide-react";

// Hermes Workspace — mirrors the Antigravity / Codex / FCC pattern but with
// "buckets" instead of "projects" (since Hermes scatters outputs by type
// rather than per-conversation subdir).
//
// Buckets (from lib/hermesWorkspace.ts):
//   Images · Audio · Pastes · Workspace · Sandboxes
//
// Click bucket → see files → click file → inline preview.
// HTML pages render in an iframe with Preview/Source toggle, images render
// inline, videos play with full controls, audio uses the audio element, PDFs
// embed. Same preview semantics as the other agents.

const ACCENT = "#60a5fa"; // Hermes blue

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
  if (id === "apps")      return <AppWindow {...props} />;
  if (id === "videos")    return <Film {...props} />;
  if (id === "images")    return <ImageIcon {...props} />;
  if (id === "audio")     return <Mic {...props} />;
  if (id === "pastes")    return <FileType {...props} />;
  if (id === "workspace") return <FolderOpen {...props} />;
  if (id === "sandboxes") return <Box {...props} />;
  return <Layers {...props} />;
}

export default function HermesWorkspace() {
  const [buckets, setBuckets] = useState<HmProject[]>([]);
  const [selected, setSelected] = useState<HmProject | null>(null);
  const [files, setFiles] = useState<HmFile[]>([]);
  const [open, setOpen] = useState<{ path: string; content: string; bytes: number; truncated: boolean; kind: HmFileKind } | null>(null);
  const [htmlMode, setHtmlMode] = useState<"source" | "preview">("preview");
  const [loading, setLoading] = useState(false);

  async function refresh() {
    try {
      const r = await fetch("/api/hermes/workspace", { cache: "no-store" });
      const j = await r.json();
      const bs: HmProject[] = Array.isArray(j.buckets) ? j.buckets : [];
      // Goals isn't really a workspace folder — keep it, but at the bottom.
      bs.sort((a, b) => (a.id === "goals" ? 1 : 0) - (b.id === "goals" ? 1 : 0));
      setBuckets(bs);
    } catch {}
  }
  async function selectBucket(b: HmProject) {
    // Only close the open preview when the user actively switches buckets,
    // not on every poll tick. The flash/disappear bug came from calling this
    // function from the poll effect — `setOpen(null)` was wiping the iframe.
    setSelected(b); setOpen(null); setLoading(true);
    try {
      const r = await fetch(`/api/hermes/workspace?bucket=${encodeURIComponent(b.id)}`, { cache: "no-store" });
      const j = await r.json();
      setFiles(Array.isArray(j.files) ? j.files : []);
    } catch { setFiles([]); }
    setLoading(false);
  }
  // Silent file-list refresh used by the poll — keeps the open preview intact
  async function refreshFiles(bucketId: string) {
    try {
      const r = await fetch(`/api/hermes/workspace?bucket=${encodeURIComponent(bucketId)}`, { cache: "no-store" });
      const j = await r.json();
      const next = Array.isArray(j.files) ? j.files : [];
      // Only update if the list actually changed — avoids a needless re-render
      // that could trigger AnimatePresence layout work on the preview pane.
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
      const r = await fetch(`/api/hermes/workspace/file?bucket=${encodeURIComponent(selected.id)}&path=${encodeURIComponent(f.relPath)}`, { cache: "no-store" });
      const j = await r.json();
      if (j.content !== undefined) setOpen({ path: f.relPath, content: j.content, bytes: j.bytes, truncated: j.truncated, kind: "text" });
    } catch {}
  }
  function rawUrl(relPath: string): string {
    if (!selected) return "";
    const segs = relPath.split("/").map(encodeURIComponent).join("/");
    return `/api/hermes/preview/${encodeURIComponent(selected.id)}/${segs}`;
  }

  useEffect(() => { refresh(); }, []);
  // Auto-select the bucket with the most recent activity once buckets load
  useEffect(() => {
    if (!selected && buckets.length > 0) {
      const recent = buckets.find((b) => b.fileCount > 0) ?? buckets[0];
      selectBucket(recent);
    }
  }, [buckets, selected]);
  // Poll every few seconds so newly-created artefacts surface live, but use
  // the SILENT refresh so the open preview iframe doesn't unmount/remount.
  useEffect(() => {
    const t = setInterval(() => {
      refresh();
      if (selected) refreshFiles(selected.id);
    }, 6000);
    return () => clearInterval(t);
  }, [selected]);

  // When a file is open we shift to a 3-column layout: buckets | files | preview.
  // Keeps the iframe visible at all times so the user never has to scroll.
  const gridCols = open
    ? "lg:grid-cols-[260px_280px_1fr]"
    : "lg:grid-cols-[320px_1fr]";

  return (
    <div className={`grid grid-cols-1 ${gridCols} gap-0 h-full min-h-[680px] border rounded-md overflow-hidden`}
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
          Hermes drops outputs into typed folders. Click any to see the files.
        </div>
        {buckets.length === 0 && (
          <div className="text-[11px] text-[var(--cream-mute)] italic p-2">Loading buckets…</div>
        )}
        {buckets.map((b) => (
          <button key={b.id} onClick={() => selectBucket(b)}
            className="block w-full text-left p-3 rounded-md border transition"
            style={{
              borderColor: selected?.id === b.id ? `${ACCENT}66` : "var(--line-soft)",
              background: selected?.id === b.id ? `${ACCENT}10` : "transparent",
            }}>
            <div className="flex items-center gap-2">
              {bucketIcon(b.id)}
              <span className="text-[12px] text-[var(--cream)]">{b.label}</span>
              <span className="ml-auto text-[10px] mono" style={{ color: "var(--cream-mute)" }}>
                {b.fileCount}
              </span>
            </div>
            <div className="text-[10px] text-[var(--cream-mute)] mt-1 leading-snug">{b.description}</div>
            <div className="text-[10px] mono mt-1" style={{ color: "var(--cream-mute)", opacity: 0.7 }}>
              {b.fileCount > 0 ? fmtAgo(b.mtime) : "empty"}
            </div>
          </button>
        ))}
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
                  This bucket is empty. Generate something in Hermes Chat — image, audio, HTML — and it&apos;ll appear here.
                </div>
              ) : files.map((f) => (
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

          </>
        )}
      </main>

      {/* Preview column — third column in the outer grid. Rendered only when a
          file is open so the layout collapses back to 2 cols otherwise. We
          intentionally don't wrap this in AnimatePresence/motion — the iframe's
          `src` change handles transitions, and mounting/unmounting the column
          on every poll was the source of the flash bug. */}
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
  );
}

"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FolderOpen, FileText, Copy, Download, RefreshCw, X, Eye, ExternalLink,
  MessageSquare, Layers,
} from "lucide-react";
import UnifiedChat from "./UnifiedChat";

interface Project { name: string; root: string; mtime: number; fileCount: number; kind: "scratch" | "brain"; }
type WsFileKind = "text" | "image" | "video" | "audio" | "pdf" | "binary";
interface WsFile { name: string; relPath: string; bytes: number; mtime: number; isText: boolean; kind: WsFileKind; }

type Tab = "chat" | "workspace";

function fmtAgo(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

export default function AntigravityView() {
  const [tab, setTab] = useState<Tab>("chat");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [files, setFiles] = useState<WsFile[]>([]);
  const [open, setOpen] = useState<{ path: string; content: string; bytes: number; truncated: boolean; kind: WsFileKind } | null>(null);
  // For HTML files we offer two views: source code (default for non-html) and
  // a live rendered iframe. Tracked separately from kind so the user can flip.
  const [htmlMode, setHtmlMode] = useState<"source" | "preview">("preview");

  async function refreshProjects() {
    try {
      const r = await fetch("/api/antigravity/workspace", { cache: "no-store" });
      const j = await r.json();
      setProjects(j.projects ?? []);
    } catch {}
  }
  async function selectProject(p: Project) {
    setSelected(p);
    setOpen(null);
    try {
      const r = await fetch(`/api/antigravity/workspace?kind=${p.kind}&project=${encodeURIComponent(p.name)}`, { cache: "no-store" });
      const j = await r.json();
      setFiles(j.files ?? []);
    } catch { setFiles([]); }
  }
  async function loadFile(f: WsFile) {
    if (!selected) return;
    // Non-text files (image/video/audio/pdf) preview via the raw byte route directly — no JSON fetch.
    if (f.kind !== "text") {
      setOpen({ path: f.relPath, content: "", bytes: f.bytes, truncated: false, kind: f.kind });
      return;
    }
    try {
      const r = await fetch(`/api/antigravity/workspace/file?kind=${selected.kind}&project=${encodeURIComponent(selected.name)}&path=${encodeURIComponent(f.relPath)}`, { cache: "no-store" });
      const j = await r.json();
      if (j.content !== undefined) setOpen({ path: f.relPath, content: j.content, bytes: j.bytes, truncated: j.truncated, kind: "text" });
    } catch {}
  }
  // URL helper for the raw byte route, used by image/video/audio/pdf previews
  function rawUrl(relPath: string): string {
    if (!selected) return "";
    return `/api/antigravity/workspace/raw?kind=${selected.kind}&project=${encodeURIComponent(selected.name)}&path=${encodeURIComponent(relPath)}`;
  }
  // Path-based preview URL — used by the HTML iframe so relative assets
  // (src/style.css, public/hero.png, etc.) resolve correctly inside the project.
  function previewUrl(relPath: string): string {
    if (!selected) return "";
    const segs = relPath.split("/").map(encodeURIComponent).join("/");
    return `/api/antigravity/preview/${selected.kind}/${encodeURIComponent(selected.name)}/${segs}`;
  }

  useEffect(() => { refreshProjects(); }, []);
  // Re-poll while user is on the workspace tab — agents may write new files mid-task
  useEffect(() => {
    if (tab !== "workspace") return;
    const t = setInterval(refreshProjects, 8000);
    return () => clearInterval(t);
  }, [tab]);

  const accent = "#7c3aed"; // matches the Antigravity sidebar accent

  return (
    <div className="space-y-5">
      {/* Tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {([
          { key: "chat" as const, label: "Chat", icon: <MessageSquare size={14} /> },
          { key: "workspace" as const, label: "Workspace files", icon: <Layers size={14} />, badge: projects.length },
        ]).map((t) => {
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-[12.5px] transition"
              style={{
                background: active ? `${accent}22` : "transparent",
                borderColor: active ? accent : "var(--panel-border)",
                color: active ? "var(--fg)" : "var(--fg-dim)",
              }}>
              {t.icon}{t.label}
              {typeof t.badge === "number" && t.badge > 0 && (
                <span className="text-[10px] metric px-1.5 py-0.5 rounded-full bg-[rgba(255,255,255,0.06)] text-[var(--fg-dim)]">{t.badge}</span>
              )}
            </button>
          );
        })}
      </div>

      {tab === "chat" && <UnifiedChat defaultAgent="antigravity" showAgentSwitcher={false} />}

      {tab === "workspace" && (
        <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-5">
          {/* Project list */}
          <aside className="space-y-2 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] flex items-center gap-1.5">
                <FolderOpen size={11} /> Projects ({projects.length})
              </div>
              <button onClick={refreshProjects}
                className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] hover:text-[var(--fg-dim)] flex items-center gap-1">
                <RefreshCw size={9} /> Refresh
              </button>
            </div>
            <div className="text-[11px] text-[var(--fg-dim)] mb-2">
              Anything Antigravity built — even when the chat reply got swallowed by a mid-task error. Reads from <code>~/.gemini/antigravity-cli/scratch</code> + <code>brain/</code>.
            </div>
            <div className="scroll max-h-[60vh] overflow-y-auto space-y-1.5 pr-1">
              {projects.length === 0 && (
                <div className="text-[12px] text-[var(--fg-dim)] py-4 px-1">No projects yet. Ask Antigravity to build something.</div>
              )}
              {projects.map((p) => {
                const active = selected?.root === p.root;
                return (
                  <motion.button key={p.root}
                    initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                    onClick={() => selectProject(p)}
                    className="w-full text-left rounded-lg border px-3 py-2 transition"
                    style={{
                      borderColor: active ? accent : "var(--panel-border)",
                      background: active ? `${accent}10` : "transparent",
                    }}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[12.5px] truncate" style={{ color: active ? "var(--fg)" : "var(--fg)" }}>
                        {p.kind === "scratch" ? p.name : p.name.slice(0, 8) + "…"}
                      </div>
                      <span className="text-[9px] uppercase tracking-widest shrink-0"
                        style={{ color: p.kind === "scratch" ? "#a3e635" : "#94a3b8" }}>
                        {p.kind}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-[var(--fg-dimmer)] flex items-center justify-between gap-2">
                      <span>{p.fileCount} file{p.fileCount === 1 ? "" : "s"}</span>
                      <span>{fmtAgo(p.mtime)}</span>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </aside>

          {/* Files + preview */}
          <main className="min-w-0 space-y-3">
            {!selected ? (
              <div className="panel p-6 text-center text-[var(--fg-dim)] text-sm">Pick a project on the left.</div>
            ) : (
              <>
                <div className="panel p-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">{selected.kind}</div>
                      <div className="text-sm font-medium truncate" style={{ color: accent }}>{selected.name}</div>
                    </div>
                    <button onClick={() => navigator.clipboard?.writeText(selected.root)}
                      className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] hover:text-[var(--fg-dim)] flex items-center gap-1">
                      <Copy size={10} /> path
                    </button>
                  </div>
                  <div className="text-[10.5px] text-[var(--fg-dimmer)] font-[var(--font-geist-mono)] break-all">
                    {selected.root.replace(/^\/(?:Users|home)\/[^/]+/, "~")}
                  </div>
                </div>

                {/* Files */}
                <div className="space-y-1 max-h-[40vh] overflow-y-auto scroll">
                  {files.length === 0 && (
                    <div className="text-[12px] text-[var(--fg-dim)] px-1 py-2">(empty)</div>
                  )}
                  {files.map((f) => (
                    <button key={f.relPath}
                      onClick={() => loadFile(f)}
                      disabled={f.kind === "binary"}
                      className="w-full text-left flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border border-[var(--panel-border)] hover:border-[var(--panel-border-hot)] hover:bg-[rgba(255,255,255,0.03)] transition disabled:opacity-60 disabled:cursor-default"
                      title={f.kind === "binary" ? "Unknown binary type — download only" : "Click to preview"}>
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText size={11} className="shrink-0" style={{ color: accent }} />
                        <span className="text-[12px] font-[var(--font-geist-mono)] truncate">{f.relPath}</span>
                        <span className="text-[9px] uppercase tracking-widest text-[var(--fg-dimmer)] shrink-0">{f.kind}</span>
                      </div>
                      <span className="text-[10px] text-[var(--fg-dimmer)] shrink-0">
                        {f.bytes < 1024 ? `${f.bytes}B` : `${(f.bytes/1024).toFixed(f.bytes < 10240 ? 1 : 0)}KB`} · {fmtAgo(f.mtime)}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Preview */}
                <AnimatePresence>
                  {open && (
                    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="rounded-lg border bg-[rgba(0,0,0,0.45)] overflow-hidden"
                      style={{ borderColor: `${accent}40` }}>
                      <div className="flex items-center justify-between px-3 py-2 border-b"
                        style={{ borderColor: `${accent}30`, background: `${accent}0c` }}>
                        <div className="flex items-center gap-1.5 text-[11px] font-[var(--font-geist-mono)] truncate" style={{ color: accent }}>
                          <FileText size={11} /><span className="truncate">{open.path}</span>
                          <span className="ml-2 text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">{open.kind}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {/\.html?$/.test(open.path) && selected && (
                            <>
                              {/* Preview / Source toggle — only meaningful for HTML */}
                              <div className="flex items-center rounded-md overflow-hidden border" style={{ borderColor: `${accent}40` }}>
                                <button
                                  onClick={() => setHtmlMode("preview")}
                                  className="text-[10px] uppercase tracking-widest px-2 py-1 transition"
                                  style={{
                                    background: htmlMode === "preview" ? `${accent}28` : "transparent",
                                    color: htmlMode === "preview" ? accent : "var(--fg-dim)",
                                  }}>
                                  <Eye size={10} className="inline mr-1" />Preview
                                </button>
                                <button
                                  onClick={() => setHtmlMode("source")}
                                  className="text-[10px] uppercase tracking-widest px-2 py-1 transition"
                                  style={{
                                    background: htmlMode === "source" ? `${accent}28` : "transparent",
                                    color: htmlMode === "source" ? accent : "var(--fg-dim)",
                                  }}>
                                  <FileText size={10} className="inline mr-1" />Source
                                </button>
                              </div>
                              <a
                                href={previewUrl(open.path)} target="_blank" rel="noopener noreferrer"
                                className="text-[var(--fg-dim)] hover:text-[var(--fg)] flex items-center gap-1 text-[10px] uppercase tracking-widest"
                                title="Open in a new tab">
                                <ExternalLink size={10} /> New tab
                              </a>
                            </>
                          )}
                          {open.kind === "text" && (
                            <>
                              <button onClick={() => navigator.clipboard?.writeText(open.content)}
                                className="text-[var(--fg-dim)] hover:text-[var(--fg)] flex items-center gap-1 text-[10px] uppercase tracking-widest">
                                <Copy size={10} /> Copy
                              </button>
                              <button
                                onClick={() => {
                                  const blob = new Blob([open.content], { type: "text/plain" });
                                  const u = URL.createObjectURL(blob);
                                  const a = document.createElement("a");
                                  a.href = u; a.download = open.path.split("/").pop() || "file";
                                  document.body.appendChild(a); a.click(); a.remove();
                                  URL.revokeObjectURL(u);
                                }}
                                className="text-[var(--fg-dim)] hover:text-[var(--fg)] flex items-center gap-1 text-[10px] uppercase tracking-widest">
                                <Download size={10} /> Save
                              </button>
                            </>
                          )}
                          {open.kind !== "text" && (
                            <a href={rawUrl(open.path)} download={open.path.split("/").pop()}
                              className="text-[var(--fg-dim)] hover:text-[var(--fg)] flex items-center gap-1 text-[10px] uppercase tracking-widest">
                              <Download size={10} /> Save
                            </a>
                          )}
                          <button onClick={() => setOpen(null)} className="text-[var(--fg-dim)] hover:text-[var(--fg)]"><X size={12}/></button>
                        </div>
                      </div>

                      {open.kind === "text" && (() => {
                        const isHtml = /\.html?$/.test(open.path);
                        if (isHtml && htmlMode === "preview") {
                          return (
                            <iframe
                              src={previewUrl(open.path)}
                              title={open.path}
                              className="w-full h-[640px] bg-white"
                              sandbox="allow-scripts allow-forms allow-popups allow-modals"
                            />
                          );
                        }
                        return (
                          <>
                            <pre className="scroll p-3 text-[12px] leading-relaxed text-[var(--fg)] whitespace-pre-wrap font-[var(--font-geist-mono)] max-h-[500px] overflow-auto">
                              {open.content}
                            </pre>
                            {open.truncated && (
                              <div className="px-3 py-1.5 text-[10px] text-amber-300 border-t border-amber-400/30 bg-[rgba(251,191,36,0.06)]">
                                ⚠ Large file — first 1MB shown. Click <strong>Save</strong> for full file.
                              </div>
                            )}
                          </>
                        );
                      })()}
                      {open.kind === "image" && (
                        <a href={rawUrl(open.path)} target="_blank" rel="noopener noreferrer" className="block bg-[rgba(0,0,0,0.6)]">
                          <img src={rawUrl(open.path)} alt={open.path} className="w-full max-h-[600px] object-contain" />
                        </a>
                      )}
                      {open.kind === "video" && (
                        <video src={rawUrl(open.path)} controls preload="metadata" className="w-full max-h-[600px] bg-black" />
                      )}
                      {open.kind === "audio" && (
                        <div className="p-3 bg-[rgba(0,0,0,0.6)]">
                          <audio src={rawUrl(open.path)} controls className="w-full" />
                        </div>
                      )}
                      {open.kind === "pdf" && (
                        <iframe src={rawUrl(open.path)} title={open.path} className="w-full h-[600px] bg-white" />
                      )}
                      {open.kind === "binary" && (
                        <div className="p-4 text-[12px] text-[var(--fg-dim)]">
                          Binary file — <a href={rawUrl(open.path)} download={open.path.split("/").pop()} className="text-[var(--accent-cyan)] hover:underline">download to view</a>.
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
  );
}

"use client";

// Claude Workspace — browse + preview everything the Claude agent has built.
// Scans ~/.agentic-os/claude-projects/<project>/. Mirrors the FCC/Hermes
// workspace UX: project list → file tree → preview pane (iframe for HTML,
// <img>/<video> for media, code view for text).

import { useEffect, useState, useCallback } from "react";
import { FolderTree, FileText, RefreshCw, ExternalLink, Image as ImageIcon, Film, Code2, FileQuestion } from "lucide-react";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";

const ACCENT = "#d97757"; // Claude rust

interface Project { name: string; root: string; mtime: number; fileCount: number; }
type FileKind = "text" | "image" | "video" | "audio" | "pdf" | "binary";
interface WsFile { name: string; relPath: string; bytes: number; mtime: number; isText: boolean; kind: FileKind; }

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function fmtAgo(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function kindIcon(k: FileKind) {
  if (k === "image") return <ImageIcon size={12} />;
  if (k === "video") return <Film size={12} />;
  if (k === "text") return <Code2 size={12} />;
  if (k === "binary") return <FileQuestion size={12} />;
  return <FileText size={12} />;
}

export default function ClaudeWorkspace() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [files, setFiles] = useState<WsFile[]>([]);
  const [openFile, setOpenFile] = useState<WsFile | null>(null);
  const [fileText, setFileText] = useState<string>("");
  const [previewMode, setPreviewMode] = useState<"preview" | "source">("preview");

  const loadProjects = useCallback(async () => {
    try {
      const r = await fetch("/api/claude/workspace", { cache: "no-store" });
      const j = await r.json();
      const ps: Project[] = j.projects ?? [];
      setProjects(ps);
      setActiveProject((cur) => cur ?? (ps[0]?.name ?? null));
    } catch { /* ignore */ }
  }, []);

  usePollWhileVisible(loadProjects, 8000);

  useEffect(() => {
    if (!activeProject) { setFiles([]); return; }
    let stop = false;
    (async () => {
      try {
        const r = await fetch(`/api/claude/workspace?project=${encodeURIComponent(activeProject)}`, { cache: "no-store" });
        const j = await r.json();
        if (!stop) setFiles(j.files ?? []);
      } catch { /* ignore */ }
    })();
    return () => { stop = true; };
  }, [activeProject]);

  async function openIt(f: WsFile) {
    setOpenFile(f);
    setPreviewMode(f.relPath.endsWith(".html") || f.relPath.endsWith(".htm") ? "preview" : (f.isText ? "source" : "preview"));
    if (f.isText && activeProject) {
      try {
        const r = await fetch(`/api/claude/workspace/file?project=${encodeURIComponent(activeProject)}&path=${encodeURIComponent(f.relPath)}`, { cache: "no-store" });
        const j = await r.json();
        setFileText(j.content ?? "(empty)");
      } catch { setFileText("(failed to load)"); }
    } else {
      setFileText("");
    }
  }

  const previewUrl = openFile && activeProject
    ? `/api/claude/preview/${encodeURIComponent(activeProject)}/${openFile.relPath.split("/").map(encodeURIComponent).join("/")}`
    : null;
  const isHtml = openFile && (openFile.relPath.endsWith(".html") || openFile.relPath.endsWith(".htm"));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[240px_260px_1fr] gap-3" style={{ height: "min(74vh, 820px)" }}>
      {/* Projects */}
      <div className="panel p-2 flex flex-col min-h-0">
        <div className="flex items-center justify-between px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold flex items-center gap-1.5">
            <FolderTree size={12} /> Projects
          </div>
          <button onClick={loadProjects} title="Refresh" className="text-[var(--cream-mute)] hover:text-[var(--cream)]"><RefreshCw size={12} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto scroll space-y-1">
          {projects.length === 0 && (
            <div className="px-2 py-3 text-[11px] text-[var(--cream-mute)] leading-snug">
              Nothing yet. Ask Claude to build something in the Chat tab — files land here.
            </div>
          )}
          {projects.map((p) => (
            <button key={p.name}
              onClick={() => { setActiveProject(p.name); setOpenFile(null); }}
              className="block w-full text-left px-2.5 py-2 rounded-md border transition"
              style={{
                borderColor: activeProject === p.name ? `${ACCENT}66` : "var(--line-soft)",
                background: activeProject === p.name ? `${ACCENT}12` : "transparent",
              }}>
              <div className="text-[12px] text-[var(--cream)] truncate font-medium">{p.name}</div>
              <div className="text-[10px] text-[var(--cream-mute)] mono mt-0.5">{p.fileCount} files · {fmtAgo(p.mtime)}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Files */}
      <div className="panel p-2 flex flex-col min-h-0">
        <div className="px-2 py-1.5 text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold">
          Files {files.length > 0 && `· ${files.length}`}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto scroll space-y-0.5">
          {files.length === 0 && (
            <div className="px-2 py-3 text-[11px] text-[var(--cream-mute)]">No files in this project yet.</div>
          )}
          {files.map((f) => (
            <button key={f.relPath} onClick={() => openIt(f)}
              className="block w-full text-left px-2.5 py-1.5 rounded-md transition hover:bg-[rgba(255,255,255,0.03)]"
              style={{ background: openFile?.relPath === f.relPath ? "rgba(255,255,255,0.05)" : "transparent" }}>
              <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--cream)] truncate">
                <span style={{ color: ACCENT }}>{kindIcon(f.kind)}</span>
                <span className="truncate">{f.relPath}</span>
              </div>
              <div className="text-[9.5px] text-[var(--cream-mute)] mono mt-0.5 pl-5">{fmtBytes(f.bytes)} · {fmtAgo(f.mtime)}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Preview */}
      <div className="panel p-0 flex flex-col min-h-0 overflow-hidden">
        {!openFile ? (
          <div className="flex-1 grid place-items-center text-center p-6">
            <div>
              <FolderTree size={22} style={{ color: ACCENT }} className="mx-auto mb-2 opacity-60" />
              <div className="text-[12.5px] text-[var(--cream)] mb-1">Pick a file to preview</div>
              <div className="text-[11px] text-[var(--cream-mute)]">HTML renders live · images + video play · code shows source</div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "var(--line-soft)" }}>
              <div className="text-[12px] text-[var(--cream)] truncate mono">{openFile.relPath}</div>
              <div className="flex items-center gap-2 shrink-0">
                {isHtml && (
                  <div className="flex rounded-md overflow-hidden border" style={{ borderColor: "var(--line-soft)" }}>
                    {(["preview", "source"] as const).map((m) => (
                      <button key={m} onClick={() => setPreviewMode(m)}
                        className="text-[10px] uppercase tracking-widest px-2 py-1"
                        style={{ background: previewMode === m ? `${ACCENT}1a` : "transparent", color: previewMode === m ? ACCENT : "var(--cream-mute)" }}>
                        {m}
                      </button>
                    ))}
                  </div>
                )}
                {previewUrl && (
                  <a href={previewUrl} target="_blank" rel="noopener noreferrer" title="Open in new tab"
                    className="text-[var(--cream-mute)] hover:text-[var(--cream)]"><ExternalLink size={13} /></a>
                )}
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto bg-[#0a070d]">
              {openFile.kind === "image" && previewUrl && (
                <div className="grid place-items-center h-full p-4"><img src={previewUrl} alt={openFile.name} className="max-w-full max-h-full object-contain" /></div>
              )}
              {openFile.kind === "video" && previewUrl && (
                <div className="grid place-items-center h-full p-4"><video src={previewUrl} controls className="max-w-full max-h-full" /></div>
              )}
              {openFile.kind === "audio" && previewUrl && (
                <div className="grid place-items-center h-full p-6"><audio src={previewUrl} controls /></div>
              )}
              {isHtml && previewMode === "preview" && previewUrl && (
                <iframe src={previewUrl} className="w-full h-full border-0 bg-white" title={openFile.name} allow="microphone; clipboard-write; pointer-lock; fullscreen; gamepad; autoplay" sandbox="allow-scripts allow-same-origin allow-popups allow-pointer-lock" />
              )}
              {(openFile.isText && (!isHtml || previewMode === "source")) && (
                <pre className="text-[11.5px] mono text-[var(--cream)] p-4 whitespace-pre-wrap leading-relaxed">{fileText}</pre>
              )}
              {openFile.kind === "binary" && (
                <div className="grid place-items-center h-full text-[12px] text-[var(--cream-mute)]">Binary file — <a href={previewUrl ?? "#"} target="_blank" rel="noopener noreferrer" className="underline ml-1" style={{ color: ACCENT }}>download</a></div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import {
  Film, Layers, Loader2, Send, Play, Download, ExternalLink,
  Wand2, User, FolderOpen, RefreshCw, Search, Radio, Clock, X as XIcon,
  CheckCircle2, AlertCircle, Code2, FileJson, FileText, Image as ImageIcon,
  Eye, Clapperboard,
} from "lucide-react";
import VideoDirector from "./VideoDirector";

// ─── VideoStudio — three sub-tabs ──────────────────────────────────────────
//   Create    : HyperFrames CLI render workflow
//   Avatar    : AI avatar video generator (provider hidden from UI on purpose)
//   Workspace : browse everything ever rendered (Agent OS + Hermes + Downloads)

const ACCENT = "#ef4444"; // red — matches sidebar item
type SubTool = "director" | "create" | "avatar" | "workspace";

function fmtAgo(ms: number): string {
  if (!ms) return "—";
  const d = Date.now() - ms;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}
function fmtBytes(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)}MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

// Classify by extension so the workspace preview can render the right element.
// HTML files render in an iframe (so the user can see the composition live),
// JSON / md / txt render as text, images inline, audio/video in the matching player.
type FKind = "video" | "audio" | "image" | "html" | "text" | "json" | "binary";
function fileKind(name: string): FKind {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (["mp4","webm","mov","m4v","mkv"].includes(ext)) return "video";
  if (["mp3","wav","m4a","ogg","aac","flac"].includes(ext)) return "audio";
  if (["png","jpg","jpeg","webp","gif","svg","avif","bmp"].includes(ext)) return "image";
  if (["html","htm"].includes(ext)) return "html";
  if (["json","jsonl","yaml","yml","toml"].includes(ext)) return "json";
  if (["md","markdown","txt","log","csv","tsv","ts","tsx","js","jsx","mjs","css","sh","py","xml"].includes(ext)) return "text";
  return "binary";
}
function fileIcon(kind: FKind, accent: string, size = 11) {
  const style = { color: accent };
  if (kind === "video") return <Film size={size} style={style} />;
  if (kind === "audio") return <Radio size={size} style={style} />;
  if (kind === "image") return <ImageIcon size={size} style={style} />;
  if (kind === "html") return <Code2 size={size} style={style} />;
  if (kind === "json") return <FileJson size={size} style={style} />;
  if (kind === "text") return <FileText size={size} style={style} />;
  return <FileText size={size} style={style} />;
}

export default function VideoStudio() {
  const [tool, setTool] = useState<SubTool>("director");
  return (
    <div className="space-y-4">
      {/* Hero strip */}
      <div className="relative overflow-hidden rounded-xl border p-4"
        style={{
          borderColor: `${ACCENT}40`,
          background:
            `radial-gradient(ellipse at 0% 0%, ${ACCENT}18, transparent 55%),` +
            `radial-gradient(ellipse at 100% 100%, rgba(212,165,116,0.10), transparent 55%),` +
            `linear-gradient(180deg, rgba(239,68,68,0.06), transparent)`,
        }}>
        <div className="flex items-center gap-3 mb-1">
          <div className="grid place-items-center w-9 h-9 rounded-lg"
            style={{ background: `${ACCENT}24`, color: ACCENT, boxShadow: `0 0 26px -10px ${ACCENT}` }}>
            <Film size={16} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest" style={{ color: ACCENT }}>Video</div>
            <div className="text-[15px] font-medium text-[var(--cream)]">The Video Director</div>
          </div>
          <div className="ml-auto text-[10.5px] uppercase tracking-widest text-[var(--cream-mute)]">
            research → script → avatar + b-roll → edit
          </div>
        </div>
        <p className="text-[12px] text-[var(--cream-dim)] max-w-[680px]">
          One topic in, a finished video out. The Director researches it, writes a script you can edit,
          films a presenter (HeyGen avatar), generates b-roll (MiniMax / Grok), then cuts it all together
          into one MP4. Everything saves locally and shows up in Workspace.
        </p>
      </div>

      {/* Sub-tool tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {([
          { key: "director",  label: "Director",  icon: <Clapperboard size={14} /> },
          { key: "create",    label: "Create",    icon: <Wand2 size={14} /> },
          { key: "avatar",    label: "Avatar",    icon: <User size={14} /> },
          { key: "workspace", label: "Workspace", icon: <Layers size={14} /> },
        ] as { key: SubTool; label: string; icon: React.ReactNode }[]).map((t) => {
          const active = tool === t.key;
          return (
            <button key={t.key} onClick={() => setTool(t.key)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-[12.5px] transition"
              style={{
                background: active ? `${ACCENT}1f` : "transparent",
                borderColor: active ? ACCENT : "var(--panel-border)",
                color: active ? "var(--cream)" : "var(--cream-dim)",
                boxShadow: active ? `0 0 22px -10px ${ACCENT}` : undefined,
              }}>
              {t.icon}{t.label}
            </button>
          );
        })}
      </div>

      {tool === "director" && <VideoDirector />}
      {tool === "create" && <CreateTab />}
      {tool === "avatar" && <AvatarTab />}
      {tool === "workspace" && <WorkspaceTab />}
    </div>
  );
}

// ─── CREATE (HyperFrames) ──────────────────────────────────────────────────
interface HFProject { slug: string; cwd: string; hasIndex: boolean; prompt?: string; renderCount: number; mtime: number; lastRender?: { url: string; bytes: number; mtime: number }; }
interface RenderJob { id: string; projectSlug: string; status: string; createdAt: number; startedAt?: number; finishedAt?: number; exitCode?: number | null; lastOutput?: string; }

function CreateTab() {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<HFProject[]>([]);
  const [active, setActive] = useState<HFProject | null>(null);
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [openJob, setOpenJob] = useState<{ job: RenderJob; log: string; outputUrl?: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function loadProjects() {
    try {
      const r = await fetch("/api/video/hyperframes/projects", { cache: "no-store" });
      const j = await r.json();
      setProjects(j.projects ?? []);
    } catch {}
  }
  async function loadJobs() {
    try {
      const r = await fetch("/api/video/hyperframes/render/status", { cache: "no-store" });
      const j = await r.json();
      setJobs(j.jobs ?? []);
    } catch {}
  }
  async function refreshOpenJob() {
    if (!openJob) return;
    try {
      const r = await fetch(`/api/video/hyperframes/render/status?id=${encodeURIComponent(openJob.job.id)}`, { cache: "no-store" });
      const j = await r.json();
      if (j.job) setOpenJob({ job: j.job, log: j.log ?? "", outputUrl: j.outputUrl });
    } catch {}
  }
  useEffect(() => { loadProjects(); loadJobs(); }, []);
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => { loadJobs(); loadProjects(); if (openJob) refreshOpenJob(); }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openJob?.job.id]);

  async function createAndRender() {
    if (!prompt.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const init = await fetch("/api/video/hyperframes/init", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      }).then((r) => r.json());
      if (!init.ok) { setError(init.error || "Init failed"); setBusy(false); return; }
      const r = await fetch("/api/video/hyperframes/render", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: init.slug }),
      }).then((x) => x.json());
      if (!r.ok) { setError(r.error || "Render failed"); setBusy(false); return; }
      setOpenJob({ job: r.job, log: "" });
      setPrompt("");
      loadProjects();
    } catch (e) { setError(String(e)); }
    setBusy(false);
  }

  async function reRender(slug: string) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/video/hyperframes/render", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      }).then((x) => x.json());
      if (r.ok) setOpenJob({ job: r.job, log: "" });
      else setError(r.error || "Render failed");
    } catch (e) { setError(String(e)); }
    setBusy(false);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4">
      <PromptCard title="Create video · HyperFrames" accent={ACCENT}>
        <label className="text-[10px] uppercase tracking-widest text-[var(--cream-mute)]">What video do you want?</label>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
          placeholder="A 10-second cinematic intro for Agent OS — fade in title, ambient particles, gold-on-aubergine palette"
          rows={5}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) createAndRender(); }}
          className="w-full p-2.5 rounded-md text-[12.5px] resize-none mt-1"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--panel-border)", color: "var(--cream)" }} />
        <div className="flex items-center justify-between mt-2">
          <div className="text-[10px] text-[var(--cream-mute)]">⌘+Enter to launch · scaffolds + renders</div>
          <button onClick={createAndRender} disabled={busy || !prompt.trim()}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-medium transition"
            style={{
              background: busy ? "rgba(239,68,68,0.15)" : ACCENT,
              color: busy ? ACCENT : "#1a0f20",
              border: `1px solid ${ACCENT}`,
              opacity: busy || !prompt.trim() ? 0.65 : 1,
              boxShadow: busy ? undefined : `0 6px 22px -8px ${ACCENT}`,
            }}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            {busy ? "Working…" : "Create + render"}
          </button>
        </div>
        {error && <div className="text-[11px] text-[var(--plum)] mt-2" title={error}>{error.slice(0, 220)}</div>}

        <div className="mt-auto pt-3 border-t" style={{ borderColor: "var(--line-soft)" }}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--cream-mute)" }}>Projects · {projects.length}</div>
            <button onClick={loadProjects} className="text-[var(--cream-mute)] hover:text-[var(--cream)]"><RefreshCw size={11} /></button>
          </div>
          <div className="max-h-[260px] overflow-y-auto scroll space-y-1">
            {projects.length === 0 && <div className="text-[11px] text-[var(--cream-mute)] italic">No projects yet — type a prompt above.</div>}
            {projects.map((p) => (
              <button key={p.slug} onClick={() => setActive(p)}
                className="w-full text-left p-2 rounded-md border transition hover:bg-[rgba(255,255,255,0.02)]"
                style={{ borderColor: active?.slug === p.slug ? `${ACCENT}66` : "var(--line-soft)", background: active?.slug === p.slug ? `${ACCENT}10` : "transparent" }}>
                <div className="text-[11.5px] text-[var(--cream)] truncate">{p.prompt ?? p.slug}</div>
                <div className="flex items-center justify-between text-[10px] mono mt-1" style={{ color: "var(--cream-mute)" }}>
                  <span>{p.renderCount} renders</span>
                  <span>{fmtAgo(p.lastRender?.mtime ?? p.mtime)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </PromptCard>

      <PreviewCard title={openJob ? `Render · ${openJob.job.status}` : (active ? active.slug : "Preview")} accent={ACCENT}>
        {openJob ? (
          <RenderJobView job={openJob.job} log={openJob.log} outputUrl={openJob.outputUrl} onClose={() => setOpenJob(null)} />
        ) : active ? (
          <ProjectView project={active} onReRender={() => reRender(active.slug)} busy={busy} />
        ) : (
          <EmptyState icon={<Film size={28} style={{ color: ACCENT }} />} title="Make a video"
            hint="Describe what you want on the left. Agent OS scaffolds an HTML composition + immediately runs `hyperframes render`. First render takes 30–90s depending on length." />
        )}
      </PreviewCard>

      <div className="lg:col-span-2">
        <RenderHistory jobs={jobs} onOpen={(j) => setOpenJob({ job: j, log: "" })} activeId={openJob?.job.id} />
      </div>
    </div>
  );
}

function ProjectView({ project, onReRender, busy }: { project: HFProject; onReRender: () => void; busy: boolean }) {
  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      {project.lastRender ? (
        <video src={project.lastRender.url} controls className="flex-1 min-h-0 w-full object-contain bg-black/40 rounded-md max-h-[440px]" />
      ) : (
        <div className="flex-1 grid place-items-center text-[12px] text-[var(--cream-mute)] italic p-4 bg-black/20 rounded-md">No renders yet.</div>
      )}
      <div className="flex items-center justify-between text-[10.5px] mono" style={{ color: "var(--cream-mute)" }}>
        <span>{project.slug} · {project.renderCount} renders</span>
        <div className="flex items-center gap-3">
          <button onClick={onReRender} disabled={busy}
            className="px-3 py-1 rounded-md border transition"
            style={{ borderColor: ACCENT, color: ACCENT, background: `${ACCENT}10`, opacity: busy ? 0.5 : 1 }}>
            {busy ? "…" : "Render again"}
          </button>
          {project.lastRender && (
            <a href={project.lastRender.url} download className="hover:text-[var(--cream)] flex items-center gap-1"><Download size={11} /> Download</a>
          )}
        </div>
      </div>
    </div>
  );
}

function RenderJobView({ job, log, outputUrl, onClose }: { job: RenderJob; log: string; outputUrl?: string; onClose: () => void }) {
  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2">
      <div className="flex items-center justify-between text-[11px]" style={{ color: "var(--cream-mute)" }}>
        <span className="font-medium" style={{ color: ACCENT }}>{job.projectSlug}</span>
        <button onClick={onClose} className="hover:text-[var(--cream)]"><XIcon size={12} /></button>
      </div>
      {outputUrl ? (
        <video src={outputUrl} controls autoPlay className="flex-1 min-h-0 w-full object-contain bg-black/40 rounded-md max-h-[440px]" />
      ) : (
        <div className="flex-1 grid place-items-center text-center p-6">
          <div>
            {job.status === "rendering" || job.status === "queued" ? (
              <Loader2 size={28} className="animate-spin mx-auto mb-2" style={{ color: ACCENT }} />
            ) : job.status === "completed" ? (
              <CheckCircle2 size={28} className="mx-auto mb-2" style={{ color: "var(--emerald)" }} />
            ) : (
              <AlertCircle size={28} className="mx-auto mb-2" style={{ color: "var(--plum)" }} />
            )}
            <div className="text-[13px] text-[var(--cream)] font-medium mb-1">
              {job.status === "rendering" ? "Rendering MP4…" : job.status === "queued" ? "Queued…" : job.status === "completed" ? "Render complete" : `Status: ${job.status}`}
            </div>
            {job.lastOutput && (
              <div className="text-[10.5px] mono text-[var(--cream-mute)] mt-2 max-w-[420px] truncate" title={job.lastOutput}>{job.lastOutput}</div>
            )}
          </div>
        </div>
      )}
      {log && (
        <pre className="max-h-[160px] overflow-auto scroll p-2 text-[10.5px] mono whitespace-pre-wrap rounded-md"
          style={{ background: "rgba(0,0,0,0.4)", color: "var(--cream-soft)", border: "1px solid var(--line-soft)" }}>
          {log.slice(-2500)}
        </pre>
      )}
    </div>
  );
}

function RenderHistory({ jobs, onOpen, activeId }: { jobs: RenderJob[]; onOpen: (j: RenderJob) => void; activeId?: string }) {
  if (jobs.length === 0) return null;
  return (
    <div className="panel p-4 mt-4">
      <div className="flex items-center gap-2 mb-3">
        <Clock size={13} style={{ color: ACCENT }} />
        <div className="action-tag" style={{ color: ACCENT }}>Render history</div>
        <span className="text-[10.5px] mono" style={{ color: "var(--cream-mute)" }}>· {jobs.length} jobs</span>
      </div>
      <div className="space-y-1.5">
        {jobs.slice(0, 10).map((j) => (
          <button key={j.id} onClick={() => onOpen(j)}
            className="w-full flex items-center justify-between p-2 rounded-md border transition hover:bg-[rgba(255,255,255,0.02)] text-left"
            style={{ borderColor: activeId === j.id ? `${ACCENT}66` : "var(--line-soft)", background: activeId === j.id ? `${ACCENT}10` : "transparent" }}>
            <div className="min-w-0 flex-1">
              <div className="text-[11.5px] text-[var(--cream)] truncate">{j.projectSlug}</div>
              {j.lastOutput && <div className="text-[10px] mono text-[var(--cream-mute)] truncate">↳ {j.lastOutput}</div>}
            </div>
            <div className="flex items-center gap-3 text-[10px] mono shrink-0 ml-2" style={{ color: "var(--cream-mute)" }}>
              <span>{fmtAgo(j.createdAt)}</span>
              <span style={{ color: j.status === "completed" ? "var(--emerald)" : j.status === "failed" ? "var(--plum)" : ACCENT }}>
                {j.status}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── AVATAR (AI talking-head generator, provider intentionally hidden) ──────
interface Avatar { avatar_id: string; avatar_name: string; preview_image_url?: string; }
interface Voice { voice_id: string; name: string; language?: string; gender?: string; }
interface AvatarJob { videoId: string; status: string; videoUrl?: string; thumbnailUrl?: string; startedAt: number; text: string; avatarName: string; }

function AvatarTab() {
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [avatarQuery, setAvatarQuery] = useState("");  // empty = show all your own avatars
  const [voiceQuery, setVoiceQuery] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState<Avatar | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<Voice | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<AvatarJob | null>(null);
  const [history, setHistory] = useState<AvatarJob[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/video/heygen/avatars?q=${encodeURIComponent(avatarQuery)}&limit=40`);
        const j = await r.json();
        setAvatars(j.avatars ?? []);
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [avatarQuery]);

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/video/heygen/voices?q=${encodeURIComponent(voiceQuery)}&limit=40`);
        const j = await r.json();
        setVoices(j.voices ?? []);
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [voiceQuery]);

  // Load history from localStorage so jobs survive a refresh
  useEffect(() => {
    try { const raw = localStorage.getItem("heygen-history"); if (raw) setHistory(JSON.parse(raw)); } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem("heygen-history", JSON.stringify(history.slice(0, 30))); } catch {}
  }, [history]);

  async function pollJob(videoId: string) {
    try {
      const r = await fetch(`/api/video/heygen/status?id=${encodeURIComponent(videoId)}`);
      const j = await r.json();
      if (j.ok) {
        setJob((prev) => prev ? { ...prev, status: j.status, videoUrl: j.video_url, thumbnailUrl: j.thumbnail_url } : prev);
        setHistory((prev) => prev.map((h) => h.videoId === videoId ? { ...h, status: j.status, videoUrl: j.video_url, thumbnailUrl: j.thumbnail_url } : h));
        if (j.status === "completed" || j.status === "failed") {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        }
      }
    } catch {}
  }

  async function generate() {
    if (!selectedAvatar || !selectedVoice || !text.trim() || busy) {
      setError(!selectedAvatar ? "Pick an avatar" : !selectedVoice ? "Pick a voice" : !text.trim() ? "Write what they should say" : null);
      return;
    }
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/video/heygen/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarId: selectedAvatar.avatar_id, voiceId: selectedVoice.voice_id, text }),
      }).then((x) => x.json());
      if (!r.ok) { setError(r.error || "Generation failed"); setBusy(false); return; }
      const newJob: AvatarJob = {
        videoId: r.videoId, status: "pending", startedAt: Date.now(),
        text, avatarName: selectedAvatar.avatar_name,
      };
      setJob(newJob);
      setHistory((prev) => [newJob, ...prev].slice(0, 30));
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => pollJob(r.videoId), 5000);
    } catch (e) { setError(String(e)); }
    setBusy(false);
  }

  function loadFromHistory(h: AvatarJob) {
    setJob(h);
    setText(h.text);
    if (h.status !== "completed" && h.status !== "failed") {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => pollJob(h.videoId), 5000);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-4">
      <PromptCard title="Avatar · AI Studio" accent={ACCENT}>
        {/* Avatar picker */}
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-widest text-[var(--cream-mute)]">Avatar</label>
          <div className="relative">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--cream-mute)]" />
            <input value={avatarQuery} onChange={(e) => setAvatarQuery(e.target.value)}
              placeholder="Search avatars…"
              className="w-full pl-7 pr-2 py-1.5 rounded-md text-[12px]"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--panel-border)", color: "var(--cream)" }} />
          </div>
          <div className="grid grid-cols-3 gap-1.5 max-h-[200px] overflow-y-auto scroll p-0.5">
            {avatars.map((a) => (
              <button key={a.avatar_id} onClick={() => setSelectedAvatar(a)}
                className="aspect-square rounded-md overflow-hidden border transition relative hover:scale-105"
                style={{ borderColor: selectedAvatar?.avatar_id === a.avatar_id ? ACCENT : "var(--line-soft)", boxShadow: selectedAvatar?.avatar_id === a.avatar_id ? `0 0 14px -2px ${ACCENT}` : undefined }}
                title={a.avatar_name}>
                {a.preview_image_url ? (
                  <img src={a.preview_image_url} alt={a.avatar_name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full grid place-items-center" style={{ background: `${ACCENT}10` }}>
                    <User size={20} style={{ color: ACCENT }} />
                  </div>
                )}
              </button>
            ))}
          </div>
          {selectedAvatar && (
            <div className="text-[10.5px] truncate" style={{ color: ACCENT }}>
              ✓ {selectedAvatar.avatar_name}
            </div>
          )}
        </div>

        {/* Voice picker */}
        <div className="space-y-2 mt-3">
          <label className="text-[10px] uppercase tracking-widest text-[var(--cream-mute)]">Voice</label>
          <div className="relative">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--cream-mute)]" />
            <input value={voiceQuery} onChange={(e) => setVoiceQuery(e.target.value)}
              placeholder="Search voices…"
              className="w-full pl-7 pr-2 py-1.5 rounded-md text-[12px]"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--panel-border)", color: "var(--cream)" }} />
          </div>
          <div className="max-h-[120px] overflow-y-auto scroll space-y-0.5">
            {voices.map((v) => (
              <button key={v.voice_id} onClick={() => setSelectedVoice(v)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition hover:bg-[rgba(255,255,255,0.03)]"
                style={{ background: selectedVoice?.voice_id === v.voice_id ? `${ACCENT}15` : "transparent" }}>
                <div className="text-[11px] text-[var(--cream)] truncate flex-1">{v.name}</div>
                <div className="text-[10px] mono shrink-0" style={{ color: "var(--cream-mute)" }}>
                  {v.language?.slice(0, 6)} · {v.gender?.slice(0, 1)}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Script */}
        <div className="space-y-2 mt-3">
          <label className="text-[10px] uppercase tracking-widest text-[var(--cream-mute)]">Script</label>
          <textarea value={text} onChange={(e) => setText(e.target.value)}
            placeholder="Hey everyone, welcome to my new Agent OS dashboard. This is the live AI-agent command centre I run my whole business through…"
            rows={3}
            className="w-full p-2 rounded-md text-[12px] resize-none"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--panel-border)", color: "var(--cream)" }} />
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-[var(--cream-mute)]">{text.length} / 8000 chars</div>
            <button onClick={generate} disabled={busy || !selectedAvatar || !selectedVoice || !text.trim()}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-medium transition"
              style={{
                background: busy ? "rgba(239,68,68,0.15)" : ACCENT,
                color: busy ? ACCENT : "#1a0f20",
                border: `1px solid ${ACCENT}`,
                opacity: busy || !selectedAvatar || !selectedVoice || !text.trim() ? 0.55 : 1,
                boxShadow: busy ? undefined : `0 6px 22px -8px ${ACCENT}`,
              }}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              {busy ? "Queueing…" : "Generate"}
            </button>
          </div>
          {error && <div className="text-[11px] text-[var(--plum)]">{error.slice(0, 220)}</div>}
        </div>
      </PromptCard>

      <PreviewCard title={job ? `Avatar video · ${job.status}` : "Preview"} accent={ACCENT}>
        {job ? (
          <div className="flex-1 min-h-0 flex flex-col gap-2">
            {job.videoUrl ? (
              <video src={job.videoUrl} controls autoPlay className="flex-1 min-h-0 w-full object-contain bg-black/40 rounded-md max-h-[440px]" />
            ) : (
              <div className="flex-1 grid place-items-center text-center p-6">
                <div>
                  {job.thumbnailUrl && (
                    <img src={job.thumbnailUrl} alt="preview" className="max-w-[300px] rounded-md mx-auto mb-3 opacity-50" />
                  )}
                  {job.status === "completed" ? (
                    <CheckCircle2 size={28} className="mx-auto mb-2" style={{ color: "var(--emerald)" }} />
                  ) : job.status === "failed" ? (
                    <AlertCircle size={28} className="mx-auto mb-2" style={{ color: "var(--plum)" }} />
                  ) : (
                    <Loader2 size={28} className="animate-spin mx-auto mb-2" style={{ color: ACCENT }} />
                  )}
                  <div className="text-[13px] text-[var(--cream)] font-medium mb-1">
                    {job.status === "pending" || job.status === "waiting" ? "Queued…" :
                     job.status === "processing" ? "Rendering avatar video…" :
                     job.status === "completed" ? "Done" : `Status: ${job.status}`}
                  </div>
                  <div className="text-[10.5px] text-[var(--cream-mute)] max-w-[400px]">{job.avatarName} · &ldquo;{job.text.slice(0, 80)}{job.text.length > 80 ? "…" : ""}&rdquo;</div>
                  <div className="text-[10px] mono text-[var(--cream-mute)] mt-3">id: {job.videoId} · {fmtAgo(job.startedAt)}</div>
                </div>
              </div>
            )}
            {job.videoUrl && (
              <div className="flex items-center justify-between text-[10.5px] mono" style={{ color: "var(--cream-mute)" }}>
                <span>{job.avatarName}</span>
                <a href={job.videoUrl} download className="hover:text-[var(--cream)] flex items-center gap-1"><Download size={11} /> Save</a>
              </div>
            )}
          </div>
        ) : (
          <EmptyState icon={<User size={28} style={{ color: ACCENT }} />} title="Pick an avatar + voice → script → Generate"
            hint="AI avatar renders typically take 30–120 seconds. Your own HeyGen avatars + ElevenLabs voices are listed. Status polls every 5s." />
        )}
      </PreviewCard>

      <div className="lg:col-span-2">
        <AvatarHistory items={history} onLoad={loadFromHistory} activeId={job?.videoId} />
      </div>
    </div>
  );
}

function AvatarHistory({ items, onLoad, activeId }: { items: AvatarJob[]; onLoad: (j: AvatarJob) => void; activeId?: string }) {
  if (items.length === 0) return null;
  return (
    <div className="panel p-4 mt-4">
      <div className="flex items-center gap-2 mb-3">
        <Clock size={13} style={{ color: ACCENT }} />
        <div className="action-tag" style={{ color: ACCENT }}>Avatar history</div>
        <span className="text-[10.5px] mono" style={{ color: "var(--cream-mute)" }}>· {items.length} videos</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
        {items.slice(0, 12).map((it) => (
          <button key={it.videoId} onClick={() => onLoad(it)}
            className="rounded-md overflow-hidden border transition hover:scale-[1.02] text-left"
            style={{ borderColor: activeId === it.videoId ? `${ACCENT}66` : "var(--line-soft)" }}>
            <div className="aspect-video bg-black/40">
              {it.thumbnailUrl ? (
                <img src={it.thumbnailUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full grid place-items-center" style={{ background: `${ACCENT}10` }}>
                  {it.status === "completed" ? <Play size={20} style={{ color: ACCENT }} /> : <Loader2 size={16} className="animate-spin" style={{ color: ACCENT }} />}
                </div>
              )}
            </div>
            <div className="p-2 space-y-0.5">
              <div className="text-[10.5px] text-[var(--cream-soft)] line-clamp-2">{it.text || "(no text)"}</div>
              <div className="flex items-center justify-between text-[9.5px] mono" style={{ color: "var(--cream-mute)" }}>
                <span>{it.avatarName.slice(0, 18)}</span>
                <span style={{ color: it.status === "completed" ? "var(--emerald)" : it.status === "failed" ? "var(--plum)" : ACCENT }}>{it.status}</span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── WORKSPACE ──────────────────────────────────────────────────────────────
interface WSBucket { id: string; label: string; description: string; fileCount: number; mtime: number; }
interface WSFile { name: string; relPath: string; absPath: string; bytes: number; mtime: number; url: string; }

function WorkspaceTab() {
  const [buckets, setBuckets] = useState<WSBucket[]>([]);
  const [selected, setSelected] = useState<WSBucket | null>(null);
  const [files, setFiles] = useState<WSFile[]>([]);
  const [open, setOpen] = useState<WSFile | null>(null);
  const [htmlMode, setHtmlMode] = useState<"preview" | "source">("preview");
  const [textContent, setTextContent] = useState<string>("");

  async function loadBuckets() {
    try {
      const r = await fetch("/api/video/workspace", { cache: "no-store" });
      const j = await r.json();
      setBuckets(j.buckets ?? []);
    } catch {}
  }
  async function loadFiles(id: string) {
    try {
      const r = await fetch(`/api/video/workspace?bucket=${encodeURIComponent(id)}`, { cache: "no-store" });
      const j = await r.json();
      const fs: WSFile[] = j.files ?? [];
      setFiles(fs);
      // Showcase: auto-feature the newest finished video in the preview pane.
      if (id === "finished" && fs.length > 0) setOpen(fs[0]);
    } catch { setFiles([]); }
  }
  useEffect(() => { loadBuckets(); }, []);
  useEffect(() => {
    if (!selected && buckets.length > 0) {
      const recent = buckets.find((b) => b.fileCount > 0) ?? buckets[0];
      setSelected(recent); loadFiles(recent.id);
    }
  }, [buckets, selected]);

  // Fetch text content when a text/json/html-source file is opened
  useEffect(() => {
    if (!open) { setTextContent(""); return; }
    const k = fileKind(open.name);
    if (k === "text" || k === "json") {
      fetch(open.url).then((r) => r.text()).then((t) => {
        // Cap at 200KB so a giant package-lock doesn't lock the UI
        setTextContent(t.length > 200_000 ? t.slice(0, 200_000) + "\n\n…(truncated)" : t);
      }).catch(() => setTextContent("(failed to load)"));
    } else {
      setTextContent("");
    }
    // Reset html mode for each new file
    setHtmlMode("preview");
  }, [open]);

  return (
    <div className={`grid grid-cols-1 ${open ? "lg:grid-cols-[260px_280px_1fr]" : "lg:grid-cols-[320px_1fr]"} gap-0 h-[calc(100vh-210px)] min-h-[520px] border rounded-md overflow-hidden`}
         style={{ borderColor: "var(--line-soft)" }}>
      {/* Buckets */}
      <aside className="border-r p-3 space-y-2 overflow-y-auto scroll" style={{ borderColor: "var(--line-soft)" }}>
        <div className="flex items-center justify-between mb-1">
          <div className="action-tag" style={{ color: ACCENT }}>Buckets · {buckets.length}</div>
          <button onClick={loadBuckets} className="text-[var(--cream-mute)] hover:text-[var(--cream)]"><RefreshCw size={11} /></button>
        </div>
        {buckets.length === 0 && <div className="text-[11px] text-[var(--cream-mute)] italic">Loading…</div>}
        {buckets.map((b) => (
          <button key={b.id} onClick={() => { setSelected(b); setOpen(null); loadFiles(b.id); }}
            className="block w-full text-left p-3 rounded-md border transition"
            style={{ borderColor: selected?.id === b.id ? `${ACCENT}66` : "var(--line-soft)", background: selected?.id === b.id ? `${ACCENT}10` : "transparent" }}>
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-[var(--cream)] font-medium">{b.label}</span>
              <span className="text-[10px] mono" style={{ color: "var(--cream-mute)" }}>{b.fileCount}</span>
            </div>
            <div className="text-[10px] text-[var(--cream-mute)] mt-1 leading-snug">{b.description}</div>
            <div className="text-[10px] mono mt-1" style={{ color: "var(--cream-mute)" }}>
              {b.fileCount > 0 ? fmtAgo(b.mtime) : "empty"}
            </div>
          </button>
        ))}
      </aside>

      {/* Files */}
      <main className="flex flex-col min-h-0 overflow-hidden">
        {!selected ? (
          <div className="p-6 text-[var(--cream-mute)] text-sm">Pick a bucket on the left.</div>
        ) : (
          <>
            <div className="px-4 py-2.5 border-b" style={{ borderColor: "var(--line-soft)" }}>
              <div className="text-[13px] text-[var(--cream)] flex items-center gap-2">
                <FolderOpen size={12} style={{ color: ACCENT }} />{selected.label}
                <span className="text-[10px] mono ml-1" style={{ color: "var(--cream-mute)" }}>· {files.length} files</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto scroll p-2 space-y-0.5">
              {files.length === 0 && <div className="text-[11px] text-[var(--cream-mute)] italic p-3">No files in this bucket.</div>}
              {files.map((f) => {
                const k = fileKind(f.name);
                return (
                <button key={f.absPath} onClick={() => setOpen(f)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-md text-left transition hover:bg-[rgba(255,255,255,0.02)]"
                  style={{ background: open?.absPath === f.absPath ? `${ACCENT}10` : "transparent" }}
                  title={f.relPath}>
                  <div className="flex items-center gap-2 min-w-0">
                    {fileIcon(k, ACCENT)}
                    <span className="text-[12px] mono truncate" style={{ color: "var(--cream)" }}>{f.relPath}</span>
                    <span className="text-[9.5px] uppercase tracking-widest shrink-0 ml-1 px-1.5 py-0.5 rounded"
                      style={{ background: `${ACCENT}14`, color: ACCENT }}>{k}</span>
                  </div>
                  <div className="text-[10px] mono shrink-0 ml-2" style={{ color: "var(--cream-mute)" }}>
                    {fmtBytes(f.bytes)} · {fmtAgo(f.mtime)}
                  </div>
                </button>
                );
              })}
            </div>
          </>
        )}
      </main>

      {/* Preview — kind-aware so HTML compositions iframe, images render inline, text shows source */}
      {selected && open && (() => {
        const k = fileKind(open.name);
        return (
        <section className="flex flex-col min-h-0 overflow-hidden border-l" style={{ borderColor: "var(--line-soft)" }}>
          <div className="flex items-center justify-between px-3 py-2 border-b"
            style={{ borderColor: `${ACCENT}30`, background: `${ACCENT}0c` }}>
            <div className="flex items-center gap-1.5 text-[11px] mono truncate" style={{ color: ACCENT }}>
              {fileIcon(k, ACCENT)}<span className="truncate">{open.name}</span>
              <span className="ml-1.5 text-[9.5px] uppercase tracking-widest px-1.5 py-0.5 rounded"
                style={{ background: `${ACCENT}14`, color: ACCENT }}>{k}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {k === "html" && (
                <div className="flex items-center rounded-md overflow-hidden border mr-1" style={{ borderColor: `${ACCENT}40` }}>
                  <button onClick={() => setHtmlMode("preview")}
                    className="text-[10px] uppercase tracking-widest px-2 py-1 transition flex items-center gap-1"
                    style={{ background: htmlMode === "preview" ? `${ACCENT}28` : "transparent", color: htmlMode === "preview" ? ACCENT : "var(--cream-dim)" }}>
                    <Eye size={10} /> Preview
                  </button>
                  <button onClick={() => setHtmlMode("source")}
                    className="text-[10px] uppercase tracking-widest px-2 py-1 transition flex items-center gap-1"
                    style={{ background: htmlMode === "source" ? `${ACCENT}28` : "transparent", color: htmlMode === "source" ? ACCENT : "var(--cream-dim)" }}>
                    <Code2 size={10} /> Source
                  </button>
                </div>
              )}
              <a href={open.url} target="_blank" rel="noopener noreferrer" className="text-[var(--cream-dim)] hover:text-[var(--cream)] flex items-center gap-1 text-[10px] uppercase tracking-widest"><ExternalLink size={10} /> New tab</a>
              <a href={open.url} download={open.name} className="text-[var(--cream-dim)] hover:text-[var(--cream)] flex items-center gap-1 text-[10px] uppercase tracking-widest"><Download size={10} /> Save</a>
              <button onClick={() => setOpen(null)} className="text-[var(--cream-dim)] hover:text-[var(--cream)]"><XIcon size={12} /></button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            {k === "video" && (
              <div className="flex-1 min-h-0 grid place-items-center bg-black/40 p-2">
                <video src={open.url} controls autoPlay className="max-w-full max-h-full object-contain" />
              </div>
            )}
            {k === "audio" && (
              <div className="flex-1 grid place-items-center bg-black/40 p-6">
                <div className="w-full max-w-[480px] space-y-3">
                  <div className="text-[10.5px] uppercase tracking-widest text-center" style={{ color: "var(--cream-mute)" }}>{open.name}</div>
                  <audio src={open.url} controls autoPlay className="w-full" />
                </div>
              </div>
            )}
            {k === "image" && (
              <a href={open.url} target="_blank" rel="noopener noreferrer" className="flex-1 grid place-items-center bg-black/40">
                <img src={open.url} alt={open.name} className="max-w-full max-h-full object-contain" />
              </a>
            )}
            {k === "html" && htmlMode === "preview" && (
              <iframe src={open.url} title={open.name} className="w-full h-full flex-1 bg-white border-0"
                sandbox="allow-scripts allow-forms allow-popups allow-modals allow-same-origin" />
            )}
            {k === "html" && htmlMode === "source" && (
              <pre className="flex-1 min-h-0 overflow-auto scroll p-3 text-[11.5px] leading-relaxed whitespace-pre-wrap"
                style={{ color: "var(--cream-soft)", background: "rgba(0,0,0,0.4)" }}>
                {textContent || "Loading source…"}
              </pre>
            )}
            {(k === "text" || k === "json") && (
              <pre className="flex-1 min-h-0 overflow-auto scroll p-3 text-[11.5px] leading-relaxed whitespace-pre-wrap"
                style={{ color: "var(--cream-soft)", background: "rgba(0,0,0,0.4)" }}>
                {textContent || "Loading…"}
              </pre>
            )}
            {k === "binary" && (
              <div className="flex-1 grid place-items-center p-6 text-[12px] text-[var(--cream-soft)]">
                <div className="text-center">
                  Binary file ({fmtBytes(open.bytes)}) — <a href={open.url} download={open.name} className="hover:underline" style={{ color: ACCENT }}>download to view</a>.
                </div>
              </div>
            )}
          </div>
        </section>
        );
      })()}
    </div>
  );
}

// ─── Shared ──────────────────────────────────────────────────────────────────

function PromptCard({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <div className="panel p-4 flex flex-col min-h-[460px]">
      <div className="action-tag mb-2" style={{ color: accent }}>{title}</div>
      {children}
    </div>
  );
}

function PreviewCard({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <div className="panel p-3 flex flex-col min-h-[460px]">
      <div className="action-tag mb-2 px-1" style={{ color: accent }}>{title}</div>
      {children}
    </div>
  );
}

function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div className="flex-1 grid place-items-center text-center p-6">
      <div className="max-w-[420px]">
        <div className="mb-3 grid place-items-center">{icon}</div>
        <div className="text-[14px] text-[var(--cream)] font-medium mb-1">{title}</div>
        <div className="text-[11.5px] text-[var(--cream-mute)] leading-relaxed">{hint}</div>
      </div>
    </div>
  );
}

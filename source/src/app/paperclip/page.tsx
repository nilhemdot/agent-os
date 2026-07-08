"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { ExternalLink, RotateCw, AlertTriangle, Play, ArrowUpRight, Hammer } from "lucide-react";

// Go STRAIGHT into the real Paperclip — plus a "Builds" gallery of everything
// the team has shipped, auto-updating as new builds land.
const BASE = "http://localhost:3100/GOLA";
const VIEWS = [
  { key: "builds",    label: "Builds",    path: "" },        // custom gallery (not an iframe)
  { key: "issues",    label: "Issues",    path: "/issues" },
  { key: "active",    label: "Active",    path: "/issues/active" },
  { key: "done",      label: "Done",      path: "/issues/done" },
  { key: "org",       label: "Org",       path: "/org" },
  { key: "dashboard", label: "Dashboard", path: "/dashboard" },
  { key: "costs",     label: "Costs",     path: "/costs" },
];

interface Build {
  issueId: string; identifier: string; title: string; status: string;
  agent: string | null; agentIcon: string; project: string; createdAt: string;
  liveUrl: string | null; previewUrl: string | null;
}

function timeAgo(iso: string): string {
  if (!iso) return "";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (isNaN(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function BuildsGallery() {
  const [builds, setBuilds] = useState<Build[] | null>(null);
  const [err, setErr] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/paperclip/builds", { cache: "no-store" });
      const j = await r.json();
      setBuilds(j.builds || []); setErr(false);
    } catch { setErr(true); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  return (
    <div className="h-full overflow-y-auto pr-1">
      {/* header */}
      <div className="flex items-end justify-between mb-5 px-1">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="grid place-items-center w-9 h-9 rounded-xl" style={{ background: "rgba(212,165,116,0.14)", border: "1px solid rgba(212,165,116,0.4)", color: "#d4a574" }}><Hammer size={17} /></div>
            <h2 className="text-[20px] font-semibold tracking-tight" style={{ color: "var(--cream,#f3ead9)" }}>Everything the team has built</h2>
          </div>
          <p className="text-[12.5px] mt-1.5" style={{ color: "var(--fg-dim)" }}>
            {builds ? `${builds.length} build${builds.length === 1 ? "" : "s"} shipped` : "Loading…"} · auto-updates as agents create more
          </p>
        </div>
        <button onClick={load} title="Refresh" className="p-2 rounded-lg border border-[var(--panel-border)] hover:border-[var(--panel-border-hot)]" style={{ color: "var(--fg-dim)" }}><RotateCw size={14} /></button>
      </div>

      {err && <div className="text-[13px] px-1" style={{ color: "var(--fg-dim)" }}>Couldn&apos;t reach Paperclip. Is it running on :3100?</div>}
      {builds && builds.length === 0 && !err && (
        <div className="rounded-2xl p-10 text-center" style={{ background: "rgba(255,255,255,0.02)", border: "1px dashed var(--panel-border)" }}>
          <Hammer size={26} className="mx-auto mb-3" style={{ color: "var(--fg-dim)" }} />
          <div className="text-[14px]" style={{ color: "var(--fg)" }}>No builds yet</div>
          <p className="text-[12.5px] mt-1.5 max-w-[420px] mx-auto" style={{ color: "var(--fg-dim)" }}>When an agent ships a build (an image + a <span className="font-mono">/builds/</span> link on the issue), it shows up here automatically.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {(builds ?? Array.from({ length: 3 })).map((b, idx) => {
          const build = b as Build | undefined;
          if (!build) return <div key={idx} className="rounded-2xl h-[300px] animate-pulse" style={{ background: "rgba(255,255,255,0.03)" }} />;
          return (
            <motion.div key={build.issueId} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="group rounded-2xl overflow-hidden flex flex-col" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid var(--panel-border)" }}>
              {/* preview */}
              <a href={build.liveUrl ?? "#"} target="_blank" rel="noopener noreferrer"
                className="relative block aspect-[16/10] overflow-hidden" style={{ background: "#05080d" }}>
                {build.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={build.previewUrl} alt={build.title} className="w-full h-full object-cover object-top transition duration-500 group-hover:scale-[1.04]" />
                ) : (
                  <div className="absolute inset-0 grid place-items-center" style={{ color: "var(--fg-dim)" }}><Hammer size={22} /></div>
                )}
                {build.liveUrl && (
                  <div className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition" style={{ background: "rgba(5,8,13,0.45)" }}>
                    <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold" style={{ background: "#d4a574", color: "#1a1206" }}><Play size={14} /> Open live build</div>
                  </div>
                )}
                <div className="absolute top-2.5 left-2.5 inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold tracking-wide" style={{ background: "rgba(52,211,153,0.16)", color: "#34d399", backdropFilter: "blur(6px)" }}>
                  ● {build.status === "done" ? "SHIPPED" : (build.status || "").toUpperCase()}
                </div>
              </a>
              {/* meta */}
              <div className="p-3.5 flex flex-col gap-2 flex-1">
                <div className="text-[14px] font-semibold leading-snug" style={{ color: "var(--cream,#f3ead9)" }}>{build.title}</div>
                <div className="flex items-center gap-2 text-[11.5px]" style={{ color: "var(--fg-dim)" }}>
                  {build.agent && <span className="inline-flex items-center gap-1">{build.agentIcon ? <span>{build.agentIcon}</span> : null}{build.agent}</span>}
                  {build.project && <><span>·</span><span className="truncate">{build.project}</span></>}
                  <span>·</span><span>{timeAgo(build.createdAt)}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  {build.liveUrl && (
                    <a href={build.liveUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium" style={{ background: "rgba(212,165,116,0.16)", color: "#d4a574" }}><Play size={12} /> View live</a>
                  )}
                  <a href={`${BASE}/issues/${build.issueId}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] border border-[var(--panel-border)]" style={{ color: "var(--fg-dim)" }}>
                    {build.identifier || "Issue"} <ArrowUpRight size={12} />
                  </a>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

export default function PaperclipRoute() {
  const [view, setView] = useState("builds");
  const [iframeKey, setIframeKey] = useState(0);
  const [errored, setErrored] = useState(false);
  const ref = useRef<HTMLIFrameElement>(null);

  const current = VIEWS.find((v) => v.key === view) ?? VIEWS[0];
  const isBuilds = view === "builds";
  const src = `${BASE}${current.path}`;

  return (
    <div className="flex flex-col h-[calc(100vh-92px)]">
      {/* toolbar */}
      <div className="flex items-center justify-between mb-2.5 shrink-0">
        <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--panel-border)" }}>
          {VIEWS.map((v) => (
            <button key={v.key} onClick={() => { setErrored(false); setView(v.key); }}
              className="px-3 py-1.5 rounded-lg text-[12.5px] font-medium transition flex items-center gap-1.5"
              style={view === v.key ? { background: "rgba(212,165,116,0.16)", color: "#d4a574" } : { color: "var(--fg-dim)" }}>
              {v.key === "builds" && <Hammer size={12} />}{v.label}
            </button>
          ))}
        </div>
        {!isBuilds && (
          <div className="flex items-center gap-1.5">
            <button onClick={() => { setErrored(false); setIframeKey((k) => k + 1); }} title="Reload"
              className="p-2 rounded-lg border border-[var(--panel-border)] hover:border-[var(--panel-border-hot)]" style={{ color: "var(--fg-dim)" }}><RotateCw size={15} /></button>
            <a href={src} target="_blank" rel="noopener noreferrer" title="Open in a new tab"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--panel-border)] hover:border-[var(--panel-border-hot)] text-[12.5px]" style={{ color: "var(--fg-dim)" }}><ExternalLink size={14} /> Open full</a>
          </div>
        )}
      </div>

      {/* body */}
      <div className="flex-1 min-h-0 rounded-2xl border border-[var(--panel-border)] overflow-hidden relative" style={{ background: isBuilds ? "transparent" : "rgba(0,0,0,0.3)" }}>
        {isBuilds ? (
          <div className="h-full p-4"><BuildsGallery /></div>
        ) : errored ? (
          <div className="absolute inset-0 grid place-items-center p-8 text-center">
            <div className="max-w-[440px]">
              <AlertTriangle size={26} className="mx-auto mb-3 text-amber-400" />
              <div className="text-[15px] mb-2" style={{ color: "var(--fg)" }}>Paperclip isn&apos;t responding on :3100</div>
              <code className="block text-[12.5px] font-mono bg-[var(--bg-mid)] border border-[var(--panel-border)] rounded-lg px-3 py-2 mt-3" style={{ color: "var(--fg-dim)" }}>cd ~/paperclip &amp;&amp; pnpm dev:once</code>
            </div>
          </div>
        ) : (
          <iframe key={`${view}-${iframeKey}`} ref={ref} src={src} title="Paperclip" className="w-full h-full border-0" onError={() => setErrored(true)} />
        )}
      </div>
    </div>
  );
}

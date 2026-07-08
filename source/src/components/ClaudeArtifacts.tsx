"use client";

// Artifacts — publish anything your agents built (Loop builds, Claude workspace
// HTML) to a shareable public link on the dedicated artifacts Netlify site.

import { useCallback, useEffect, useState } from "react";
import { Share2, Loader2, ExternalLink, Copy, Check, Trash2, RefreshCw, Sparkles, Globe } from "lucide-react";

const ACCENT = "#d97757"; // Claude rust

interface Publishable { id: string; title: string; source: string; mtime: number; bytes: number }
interface Published { slug: string; title: string; source: string; url: string; publishedAt: number; bytes: number }
interface Site { baseUrl: string; name: string }

function fmtAgo(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function ClaudeArtifacts() {
  const [site, setSite] = useState<Site | null>(null);
  const [publishable, setPublishable] = useState<Publishable[]>([]);
  const [published, setPublished] = useState<Published[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const j = await fetch("/api/claude/artifacts", { cache: "no-store" }).then((r) => r.json());
      setSite(j.site ?? null); setPublishable(j.publishable ?? []); setPublished(j.published ?? []);
    } catch { /* offline */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const publishedSources = new Set(published.map((p) => p.source));

  async function publish(id: string) {
    setBusyId(id); setErr(null);
    try {
      const j = await fetch("/api/claude/artifacts", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }),
      }).then((r) => r.json());
      if (!j.ok) setErr(j.error || "publish failed");
      await load();
    } catch (e) { setErr(String(e)); }
    setBusyId(null);
  }
  async function unpublish(slug: string) {
    if (!confirm("Take this artifact offline?")) return;
    setBusyId(slug); setErr(null);
    try {
      await fetch("/api/claude/artifacts", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug }) });
      await load();
    } catch (e) { setErr(String(e)); }
    setBusyId(null);
  }
  function copy(url: string) { navigator.clipboard?.writeText(url); setCopied(url); setTimeout(() => setCopied(null), 1600); }

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="rounded-xl border p-4" style={{ borderColor: `${ACCENT}40`, background: `radial-gradient(ellipse at 0% 0%, ${ACCENT}14, transparent 55%)` }}>
        <div className="flex items-center gap-3">
          <div className="grid place-items-center w-9 h-9 rounded-lg" style={{ background: `${ACCENT}24`, color: ACCENT }}><Share2 size={16} /></div>
          <div className="flex-1">
            <div className="text-[15px] font-medium" style={{ color: "var(--fg)" }}>Artifacts</div>
            <div className="text-[12px]" style={{ color: "var(--fg-dim)" }}>Publish anything your agents built to a shareable link — sent in seconds, no setup.</div>
          </div>
          {site && (
            <a href={site.baseUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[11.5px] px-3 py-1.5 rounded-full border" style={{ borderColor: "var(--panel-border)", color: "var(--fg-dim)" }}>
              <Globe size={12} /> Gallery
            </a>
          )}
        </div>
      </div>

      {err && <div className="text-[12px] px-3 py-2 rounded-lg" style={{ background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", color: "#f87171" }}>{err}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* publishable */}
        <div className="panel p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="inline-flex items-center gap-2 text-[12.5px] font-semibold" style={{ color: "var(--fg)" }}><Sparkles size={14} style={{ color: ACCENT }} /> Built by your agents <span style={{ color: "var(--fg-dimmer)", fontWeight: 400 }}>· {publishable.length}</span></span>
            <button onClick={load} className="text-[var(--fg-dimmer)] hover:text-[var(--fg)]"><RefreshCw size={12} /></button>
          </div>
          <div className="space-y-1.5 max-h-[460px] overflow-y-auto scroll">
            {loading && <div className="text-[12px] text-[var(--fg-dimmer)] italic">Loading…</div>}
            {!loading && publishable.length === 0 && <div className="text-[12px] text-[var(--fg-dimmer)] italic">Nothing to publish yet — build something in the Loop or Claude workspace.</div>}
            {publishable.map((p) => {
              const live = publishedSources.has(p.id);
              return (
                <div key={p.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg border" style={{ borderColor: "var(--panel-border)", background: "var(--bg)" }}>
                  <div className="min-w-0">
                    <div className="text-[12.5px] truncate" style={{ color: "var(--fg)" }}>{p.title}</div>
                    <div className="text-[10.5px] mono" style={{ color: "var(--fg-dimmer)" }}>{p.source} · {fmtAgo(p.mtime)}</div>
                  </div>
                  <button onClick={() => publish(p.id)} disabled={busyId === p.id}
                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11.5px] font-medium transition"
                    style={{ background: live ? "transparent" : ACCENT, color: live ? ACCENT : "#1a0f20", border: `1px solid ${ACCENT}`, opacity: busyId === p.id ? 0.6 : 1 }}>
                    {busyId === p.id ? <Loader2 size={12} className="animate-spin" /> : <Share2 size={12} />}
                    {busyId === p.id ? "Publishing…" : live ? "Update" : "Publish"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* published */}
        <div className="panel p-4">
          <div className="text-[12.5px] font-semibold mb-3 inline-flex items-center gap-2" style={{ color: "var(--fg)" }}><Globe size={14} style={{ color: ACCENT }} /> Live links <span style={{ color: "var(--fg-dimmer)", fontWeight: 400 }}>· {published.length}</span></div>
          <div className="space-y-1.5 max-h-[460px] overflow-y-auto scroll">
            {published.length === 0 && <div className="text-[12px] text-[var(--fg-dimmer)] italic">No published artifacts yet. Hit Publish on something on the left → you get a shareable link here.</div>}
            {published.map((p) => (
              <div key={p.slug} className="p-2.5 rounded-lg border" style={{ borderColor: `${ACCENT}40`, background: `${ACCENT}0a` }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[12.5px] truncate" style={{ color: "var(--fg)" }}>{p.title}</div>
                  <button onClick={() => unpublish(p.slug)} disabled={busyId === p.slug} title="Take offline" className="shrink-0 text-[var(--fg-dimmer)] hover:text-[#f87171]">
                    {busyId === p.slug ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-[11px] mono truncate flex-1 hover:underline" style={{ color: ACCENT }}>{p.url.replace(/^https?:\/\//, "")}</a>
                  <button onClick={() => copy(p.url)} className="shrink-0 inline-flex items-center gap-1 text-[10.5px] px-2 py-1 rounded border" style={{ borderColor: "var(--panel-border)", color: copied === p.url ? ACCENT : "var(--fg-dim)" }}>
                    {copied === p.url ? <Check size={11} /> : <Copy size={11} />}{copied === p.url ? "Copied" : "Copy"}
                  </button>
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="shrink-0 inline-flex items-center gap-1 text-[10.5px] px-2 py-1 rounded border" style={{ borderColor: "var(--panel-border)", color: "var(--fg-dim)" }}><ExternalLink size={11} /> Open</a>
                </div>
                <div className="text-[10px] mono mt-1" style={{ color: "var(--fg-dimmer)" }}>{p.source.replace(/^(loop|claude):/, "")} · {fmtAgo(p.publishedAt)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

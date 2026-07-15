"use client";

// Hermes MCP catalogue browser — Phase 1.
//
// Two columns:
//   • Catalog (left)   — Nous-approved MCPs from `hermes mcp catalog`. Read-only
//     in Phase 1. Each row has a "Copy install command" affordance and links to
//     the upstream repo when the manifest source is known.
//   • Installed (right) — MCPs from ~/.hermes/config.yaml mcp_servers section.
//     Toggle to enable/disable, button to uninstall.
//
// Phase 2 will add a one-click install flow (modal that collects API keys +
// runs `hermes mcp install <name>` non-interactively). Phase 3 adds the per-
// tool checkbox UI.

import { useEffect, useRef, useState } from "react";
import { Plug, RefreshCw, Trash2, ExternalLink, Power, PowerOff, Globe, Terminal, AlertCircle, CheckCircle2, Copy, Key, Shield, Lock, Download, Loader2, X as XIcon, Plus, Info, Settings2 } from "lucide-react";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import { MCP_PRESETS, presetById, type McpPreset } from "@/lib/hermesMcpPresets";

const SUPPORTED_MANIFEST_VERSION = 1;

const ACCENT = "#60a5fa"; // Hermes blue

interface CatalogEntry {
  name: string;
  status: string;
  description: string;
  source?: string;
  authType?: string;
  authProvider?: string;
  transportType?: string;
  manifestVersion?: number;
}
interface InstalledEntry {
  name: string;
  enabled: boolean;
  transport: "stdio" | "http" | "unknown";
  command?: string;
  url?: string;
  toolCount?: number;
  authType?: string;
}

export default function HermesMCPCatalog() {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [installed, setInstalled] = useState<InstalledEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null); // name being mutated
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [installTarget, setInstallTarget] = useState<string | null>(null);
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [toolsEditor, setToolsEditor] = useState<string | null>(null); // name of server being edited

  async function load() {
    try {
      const r = await fetch("/api/hermes/mcp", { cache: "no-store" });
      const j = await r.json();
      if (j.ok === false && j.error) setError(j.error);
      else setError(null);
      setCatalog(Array.isArray(j.catalog) ? j.catalog : []);
      setInstalled(Array.isArray(j.installed) ? j.installed : []);
    } catch (e) { setError(String(e)); }
  }

  // 15s poll is plenty — catalogue + installed list change manually
  usePollWhileVisible(load, 15000);

  async function toggle(name: string, next: boolean) {
    setBusy(name);
    try {
      await fetch("/api/hermes/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle", name, enabled: next }),
      });
      await load();
    } finally { setBusy(null); }
  }
  async function doUninstall(name: string) {
    if (!confirm(`Uninstall MCP "${name}"? This runs "hermes mcp remove ${name}".`)) return;
    setBusy(name);
    try {
      await fetch("/api/hermes/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "uninstall", name }),
      });
      await load();
    } finally { setBusy(null); }
  }
  async function copyInstall(name: string) {
    try {
      await navigator.clipboard.writeText(`hermes mcp install ${name}`);
      setCopied(name);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* clipboard blocked */ }
  }

  // Build a set of installed names so we can mark catalog rows that are
  // already installed (and avoid duplicating the row's UX).
  const installedSet = new Set(installed.map((i) => i.name));

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-xl border p-4"
           style={{ borderColor: `${ACCENT}33`, background: `linear-gradient(135deg, ${ACCENT}10, transparent)` }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="grid place-items-center w-10 h-10 rounded-lg"
                 style={{ background: `${ACCENT}1a`, color: ACCENT, border: `1px solid ${ACCENT}30` }}>
              <Plug size={18} />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-[0.25em] mb-1" style={{ color: ACCENT }}>
                Hermes · MCP Catalogue
              </div>
              <div className="text-[18px] font-semibold text-[var(--cream)] mb-1">
                Plug Hermes into anything
              </div>
              <div className="text-[12.5px] text-[var(--cream-mute)] max-w-[640px] leading-snug">
                Nous-approved MCP servers — GitHub, Linear, Stripe, n8n, filesystem, and more.
                Browse the catalogue, toggle what&apos;s installed, uninstall what you don&apos;t need.
                Phase 1 is read-only browse + manage; one-click install lands in Phase 2.
              </div>
            </div>
          </div>
          <button onClick={load} className="text-[11px] uppercase tracking-widest hover:underline flex items-center gap-1 shrink-0"
                  style={{ color: ACCENT }} title="Refresh">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-[12px] p-3 rounded-md border"
             style={{ borderColor: "var(--plum)", background: "rgba(196,96,126,0.08)", color: "var(--cream)" }}>
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <div className="font-mono break-all">{error}</div>
        </div>
      )}

      {/* Explainer — make the curation scope obvious so a small catalogue doesn't feel like a bug */}
      <div className="flex items-start gap-2 text-[11.5px] text-[var(--cream-mute)] px-1 leading-snug">
        <Info size={13} className="shrink-0 mt-0.5" style={{ color: ACCENT }} />
        <div>
          <span className="text-[var(--cream)] font-medium">Nous-approved catalogue is curated</span> — only servers PR-reviewed into{" "}
          <code className="mono text-[10.5px]">optional-mcps/</code> appear here. For the wider MCP ecosystem (GitHub, Filesystem, Slack, Postgres, custom internal servers…), use <strong>Add custom</strong> on the right.
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* CATALOG (left) */}
        <div className="panel p-3 flex flex-col min-h-[520px]">
          <div className="flex items-center justify-between px-1 mb-2">
            <div className="text-[11.5px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold">
              Catalogue · {catalog.length}
            </div>
            <div className="text-[10px] text-[var(--cream-mute)]">Nous-approved</div>
          </div>
          {catalog.length === 0 ? (
            <div className="flex-1 grid place-items-center text-center p-6">
              <div>
                <Plug size={20} style={{ color: ACCENT }} className="mx-auto mb-2 opacity-60" />
                <div className="text-[12px] text-[var(--cream)] mb-1">Catalogue is empty</div>
                <div className="text-[11px] text-[var(--cream-mute)]">
                  Either Hermes isn&apos;t installed, or <code className="mono text-[10.5px]">hermes mcp catalog</code> returned no entries.
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5 overflow-y-auto scroll max-h-[700px]">
              {catalog.map((c) => {
                const alreadyInstalled = installedSet.has(c.name);
                const incompatible = c.manifestVersion !== undefined && c.manifestVersion > SUPPORTED_MANIFEST_VERSION;
                return (
                  <div key={c.name}
                       className="p-3 rounded-md border transition"
                       style={{ borderColor: "var(--line-soft)", background: "transparent" }}>
                    <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <div className="text-[13px] text-[var(--cream)] font-medium truncate">{c.name}</div>
                        <StatusPill status={c.status} alreadyInstalled={alreadyInstalled} />
                        {c.transportType && <TransportPill transport={c.transportType as "stdio" | "http"} />}
                        {c.authType && <AuthPill type={c.authType} provider={c.authProvider} />}
                        {c.manifestVersion !== undefined && <ManifestPill version={c.manifestVersion} />}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {incompatible ? (
                          <span title={`Requires a newer Hermes — this entry uses manifest v${c.manifestVersion}, dashboard understands v${SUPPORTED_MANIFEST_VERSION}. Run \`hermes update\` first.`}
                                className="text-[10px] uppercase tracking-widest px-2 py-1 flex items-center gap-1"
                                style={{ color: "var(--gold)" }}>
                            <AlertCircle size={11} /> Needs Hermes update
                          </span>
                        ) : alreadyInstalled ? (
                          <span className="text-[10px] uppercase tracking-widest px-2 py-1 flex items-center gap-1"
                                style={{ color: "var(--emerald)" }}>
                            <CheckCircle2 size={11} /> Installed
                          </span>
                        ) : (
                          <>
                            <button onClick={() => copyInstall(c.name)}
                                    title={`Copy: hermes mcp install ${c.name}`}
                                    className="text-[10px] uppercase tracking-widest px-2 py-1 rounded hover:bg-[rgba(96,165,250,0.1)] flex items-center gap-1"
                                    style={{ color: copied === c.name ? "var(--emerald)" : "var(--cream-mute)" }}>
                              {copied === c.name ? <CheckCircle2 size={11} /> : <Copy size={11} />}
                              {copied === c.name ? "Copied" : "Copy cmd"}
                            </button>
                            <button onClick={() => setInstallTarget(c.name)}
                                    title="Install this MCP from the dashboard"
                                    className="text-[10px] uppercase tracking-widest px-2.5 py-1 rounded flex items-center gap-1 font-semibold"
                                    style={{ color: ACCENT, border: `1px solid ${ACCENT}55`, background: `${ACCENT}14` }}>
                              <Download size={11} /> Install
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="text-[11.5px] text-[var(--cream-mute)] leading-snug mb-1.5">{c.description}</div>
                    {c.source && (
                      <a href={c.source} target="_blank" rel="noopener noreferrer"
                         className="text-[10px] uppercase tracking-widest hover:underline inline-flex items-center gap-1"
                         style={{ color: ACCENT }}>
                        <ExternalLink size={10} /> Source
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* INSTALLED (right) */}
        <div className="panel p-3 flex flex-col min-h-[520px]">
          <div className="flex items-center justify-between px-1 mb-2 gap-2">
            <div className="text-[11.5px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold flex items-center gap-3">
              Installed · {installed.length}
              <span className="text-[10px] normal-case tracking-normal" style={{ color: "var(--cream-mute)" }}>
                {installed.filter((i) => i.enabled).length} enabled
              </span>
            </div>
            <button onClick={() => setShowAddCustom(true)}
                    title="Add an MCP server outside the Nous catalogue"
                    className="text-[10px] uppercase tracking-widest px-2.5 py-1 rounded flex items-center gap-1 font-semibold"
                    style={{ color: ACCENT, border: `1px solid ${ACCENT}55`, background: `${ACCENT}14` }}>
              <Plus size={11} /> Add custom
            </button>
          </div>
          {installed.length === 0 ? (
            <div className="flex-1 grid place-items-center text-center p-6">
              <div>
                <Power size={20} style={{ color: ACCENT }} className="mx-auto mb-2 opacity-60" />
                <div className="text-[12px] text-[var(--cream)] mb-1">No MCPs installed yet</div>
                <div className="text-[11px] text-[var(--cream-mute)] mb-3 leading-snug">
                  Install one from the terminal first:
                </div>
                <code className="mono text-[10.5px] px-3 py-1.5 rounded border block text-left"
                      style={{ borderColor: "var(--line-soft)", color: ACCENT, background: "rgba(96,165,250,0.05)" }}>
                  hermes mcp install &lt;name&gt;
                </code>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5 overflow-y-auto scroll max-h-[700px]">
              {installed.map((i) => (
                <div key={i.name}
                     className="p-3 rounded-md border transition"
                     style={{
                       borderColor: i.enabled ? `${ACCENT}55` : "var(--line-soft)",
                       background: i.enabled ? `${ACCENT}0a` : "transparent",
                     }}>
                  <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <div className="text-[13px] text-[var(--cream)] font-medium truncate">{i.name}</div>
                      <TransportPill transport={i.transport} />
                      {i.authType && <AuthPill type={i.authType} />}
                      {i.toolCount !== undefined && (
                        <span className="text-[10px] mono text-[var(--cream-mute)]">{i.toolCount} tool{i.toolCount === 1 ? "" : "s"}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => toggle(i.name, !i.enabled)} disabled={busy === i.name}
                              title={i.enabled ? "Disable" : "Enable"}
                              className="text-[10px] uppercase tracking-widest px-2 py-1 rounded hover:bg-[rgba(96,165,250,0.1)] disabled:opacity-50 flex items-center gap-1"
                              style={{ color: i.enabled ? "var(--emerald)" : "var(--cream-mute)" }}>
                        {i.enabled ? <Power size={11} /> : <PowerOff size={11} />}
                        {i.enabled ? "Enabled" : "Disabled"}
                      </button>
                      <button onClick={() => setToolsEditor(i.name)} disabled={busy === i.name}
                              title="Edit tools.include (prune the tools this server exposes to Hermes)"
                              className="text-[10px] uppercase tracking-widest px-2 py-1 rounded hover:bg-[rgba(96,165,250,0.1)] disabled:opacity-50 flex items-center gap-1"
                              style={{ color: "var(--cream-mute)" }}>
                        <Settings2 size={11} />
                      </button>
                      <button onClick={() => doUninstall(i.name)} disabled={busy === i.name}
                              title="Uninstall (hermes mcp remove)"
                              className="text-[10px] uppercase tracking-widest px-2 py-1 rounded hover:text-[var(--plum)] disabled:opacity-50">
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                  <div className="text-[11px] mono text-[var(--cream-mute)] truncate" title={i.url ?? i.command ?? ""}>
                    {i.url ?? i.command ?? "(unknown transport)"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="text-[11px] text-[var(--cream-mute)] px-1 leading-relaxed">
        <span className="font-semibold text-[var(--cream)]">Phase 3 (coming):</span> per-tool checklist UI · live reload via <code className="mono">/reload-mcp</code> · manifest-version compatibility warnings.
      </div>

      {installTarget && (
        <InstallModal
          name={installTarget}
          onClose={() => setInstallTarget(null)}
          onComplete={async () => { setInstallTarget(null); await load(); }}
        />
      )}

      {showAddCustom && (
        <AddCustomModal
          existingNames={installed.map((i) => i.name)}
          onClose={() => setShowAddCustom(false)}
          onComplete={async () => { setShowAddCustom(false); await load(); }}
        />
      )}

      {toolsEditor && (
        <ToolsEditorModal
          name={toolsEditor}
          onClose={() => setToolsEditor(null)}
          onComplete={async () => { setToolsEditor(null); await load(); }}
        />
      )}
    </div>
  );
}

// ─── InstallModal ───────────────────────────────────────────────────────────
// Two phases inside the modal:
//   1. Form — load manifest, show credential inputs (or just a "Confirm" for
//      oauth/none auth types), show trust details (source + bootstrap)
//   2. Live log — stream NDJSON from /api/hermes/mcp/install into a terminal
//      panel. Final state shows done + ok|fail.

interface ManifestEnvVar {
  name: string;
  prompt: string;
  default?: string;
  required?: boolean;
  secret?: boolean;
}
interface ManifestSummary {
  name: string;
  description?: string;
  source?: string;
  manifestVersion?: number;
  transportType?: string;
  authType?: string;
  authProvider?: string;
  envVars: ManifestEnvVar[];
  defaultEnabledTools?: string[];
  bootstrap?: string[];
  installUrl?: string;
  installRef?: string;
}

type LogEntry =
  | { type: "step"; label: string }
  | { type: "stdout" | "stderr"; text: string }
  | { type: "error"; text: string }
  | { type: "done"; ok: boolean; code: number };

function InstallModal({ name, onClose, onComplete }: { name: string; onClose: () => void; onComplete: () => Promise<void> | void }) {
  const [phase, setPhase] = useState<"loading" | "form" | "installing" | "done">("loading");
  const [manifest, setManifest] = useState<ManifestSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [log, setLog] = useState<LogEntry[]>([]);
  const [installOk, setInstallOk] = useState<boolean | null>(null);
  const logBoxRef = useRef<HTMLDivElement | null>(null);

  // Load manifest on open. If 404, present a graceful "missing manifest" state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/hermes/mcp/manifest?name=${encodeURIComponent(name)}`, { cache: "no-store" });
        const j = await r.json();
        if (cancelled) return;
        if (!j.ok || !j.manifest) {
          setLoadError(j.error || "manifest not found");
          setPhase("form"); // still show modal so user can dismiss
          return;
        }
        const m = j.manifest as ManifestSummary;
        setManifest(m);
        // Seed defaults
        const initial: Record<string, string> = {};
        for (const ev of m.envVars) initial[ev.name] = ev.default ?? "";
        setVals(initial);
        setPhase("form");
      } catch (e) {
        if (!cancelled) { setLoadError(String(e)); setPhase("form"); }
      }
    })();
    return () => { cancelled = true; };
  }, [name]);

  // Auto-scroll the log to the bottom on new entries.
  useEffect(() => {
    if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  }, [log]);

  const missingRequired = manifest?.envVars.some((ev) => ev.required !== false && !vals[ev.name]?.trim());

  async function startInstall() {
    setPhase("installing");
    setLog([]);
    setInstallOk(null);
    let r: Response;
    try {
      r = await fetch("/api/hermes/mcp/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, envVars: vals }),
      });
    } catch (e) {
      setLog((prev) => [...prev, { type: "error", text: String(e) }, { type: "done", ok: false, code: -1 }]);
      setInstallOk(false);
      setPhase("done");
      return;
    }
    if (!r.body) {
      setLog((prev) => [...prev, { type: "error", text: "no response body" }, { type: "done", ok: false, code: -1 }]);
      setInstallOk(false);
      setPhase("done");
      return;
    }
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
     
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const ev = JSON.parse(line) as LogEntry;
          setLog((prev) => [...prev, ev]);
          if (ev.type === "done") {
            setInstallOk(ev.ok);
            setPhase("done");
          }
        } catch { /* malformed line — ignore */ }
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: "rgba(10, 7, 13, 0.78)", backdropFilter: "blur(4px)" }}
         onClick={(e) => { if (e.target === e.currentTarget && phase !== "installing") onClose(); }}>
      <div className="panel w-full max-w-[720px] max-h-[90vh] flex flex-col overflow-hidden"
           style={{ border: `1px solid ${ACCENT}55`, boxShadow: `0 20px 60px rgba(0,0,0,0.6), 0 0 60px ${ACCENT}22` }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--line-soft)" }}>
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="grid place-items-center w-8 h-8 rounded-lg"
                 style={{ background: `${ACCENT}1a`, color: ACCENT, border: `1px solid ${ACCENT}40` }}>
              <Download size={14} />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)]">Install MCP</div>
              <div className="text-[15px] font-semibold text-[var(--cream)] truncate">{name}</div>
            </div>
          </div>
          <button onClick={onClose} disabled={phase === "installing"}
                  className="text-[var(--cream-mute)] hover:text-[var(--cream)] disabled:opacity-30 disabled:cursor-not-allowed"
                  title={phase === "installing" ? "Cannot close while installing" : "Close"}>
            <XIcon size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto scroll p-4 space-y-4">
          {phase === "loading" && (
            <div className="flex items-center gap-2 text-[12px] text-[var(--cream-mute)]">
              <Loader2 size={14} className="animate-spin" /> Loading manifest…
            </div>
          )}

          {loadError && (
            <div className="flex items-start gap-2 text-[12px] p-3 rounded-md border"
                 style={{ borderColor: "var(--plum)", background: "rgba(196,96,126,0.08)", color: "var(--cream)" }}>
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <div>
                <div className="font-medium mb-1">Couldn&apos;t load manifest</div>
                <div className="font-mono break-all text-[11px]">{loadError}</div>
                <div className="text-[11px] text-[var(--cream-mute)] mt-1">
                  Try running <code className="mono">hermes update</code> in a terminal to refresh the catalogue.
                </div>
              </div>
            </div>
          )}

          {manifest && phase === "form" && (
            <>
              {/* Description + trust panel */}
              {manifest.description && (
                <p className="text-[12.5px] text-[var(--cream-mute)] leading-snug">{manifest.description}</p>
              )}

              {(manifest.installUrl || manifest.bootstrap?.length) && (
                <div className="rounded-md border p-3 text-[11px] space-y-1.5"
                     style={{ borderColor: "var(--line-soft)", background: "rgba(243,235,218,0.03)" }}>
                  <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold mb-1">
                    What this install will do
                  </div>
                  {manifest.installUrl && (
                    <div className="text-[var(--cream)]">
                      git clone <span className="mono text-[var(--cream-mute)]">{manifest.installUrl}</span>
                      {manifest.installRef && <span className="mono text-[var(--cream-mute)]"> @ {manifest.installRef}</span>}
                    </div>
                  )}
                  {manifest.bootstrap?.map((cmd, i) => (
                    <div key={i} className="mono text-[var(--cream-mute)] text-[10.5px]">$ {cmd}</div>
                  ))}
                  {manifest.source && (
                    <a href={manifest.source} target="_blank" rel="noopener noreferrer"
                       className="text-[10px] uppercase tracking-widest hover:underline inline-flex items-center gap-1 mt-1"
                       style={{ color: ACCENT }}>
                      <ExternalLink size={10} /> View source
                    </a>
                  )}
                </div>
              )}

              {/* OAuth notice */}
              {manifest.authType === "oauth" && (
                <div className="rounded-md border p-3 text-[12px]"
                     style={{ borderColor: "#a855f755", background: "rgba(168,85,247,0.08)", color: "var(--cream)" }}>
                  <div className="flex items-center gap-2 mb-1 font-medium">
                    <Shield size={13} style={{ color: "#a855f7" }} /> OAuth required
                  </div>
                  <div className="text-[11.5px] text-[var(--cream-mute)] leading-snug">
                    On first connect, Hermes will open your browser to authenticate
                    {manifest.authProvider && <> with <strong>{manifest.authProvider}</strong></>}.
                    Complete the flow in the browser, then return here.
                  </div>
                </div>
              )}

              {/* api_key form */}
              {manifest.envVars.length > 0 && (
                <div className="space-y-3">
                  <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold">
                    Credentials
                  </div>
                  {manifest.envVars.map((ev) => (
                    <div key={ev.name}>
                      <label className="flex items-center justify-between mb-1">
                        <span className="text-[12px] text-[var(--cream)] font-medium">{ev.prompt}</span>
                        <span className="text-[10px] mono text-[var(--cream-mute)]">
                          {ev.name}{ev.required === false && " (optional)"}
                        </span>
                      </label>
                      <input
                        type={ev.secret ? "password" : "text"}
                        value={vals[ev.name] ?? ""}
                        onChange={(e) => setVals((prev) => ({ ...prev, [ev.name]: e.target.value }))}
                        placeholder={ev.default ? `default: ${ev.default}` : ""}
                        className="w-full px-3 py-2 text-[12px] rounded-md border bg-transparent text-[var(--cream)] mono"
                        style={{ borderColor: "var(--line-soft)" }}
                      />
                    </div>
                  ))}
                  <div className="text-[10px] text-[var(--cream-mute)] leading-snug">
                    Saved to <code className="mono">~/.hermes/.env</code> (mode 0600). Existing keys preserved.
                  </div>
                </div>
              )}

              {manifest.authType === "none" && manifest.envVars.length === 0 && (
                <div className="text-[12px] text-[var(--cream-mute)]">
                  No credentials needed — this server runs unauthenticated.
                </div>
              )}

              {/* Submit */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button onClick={onClose}
                        className="text-[11px] uppercase tracking-widest px-3 py-1.5 rounded hover:bg-[rgba(243,235,218,0.05)]"
                        style={{ color: "var(--cream-mute)" }}>
                  Cancel
                </button>
                <button onClick={startInstall}
                        disabled={missingRequired}
                        className="text-[11px] uppercase tracking-widest px-4 py-1.5 rounded flex items-center gap-1.5 font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ color: ACCENT, border: `1px solid ${ACCENT}`, background: `${ACCENT}1a` }}>
                  <Download size={11} /> Install {name}
                </button>
              </div>
            </>
          )}

          {(phase === "installing" || phase === "done") && (
            <>
              <div ref={logBoxRef}
                   className="rounded-md border p-3 mono text-[11px] space-y-0.5 overflow-y-auto scroll max-h-[420px] min-h-[200px]"
                   style={{ borderColor: "var(--line-soft)", background: "#0a070d", color: "var(--cream)" }}>
                {log.length === 0 && phase === "installing" && (
                  <div className="text-[var(--cream-mute)] flex items-center gap-2">
                    <Loader2 size={12} className="animate-spin" /> Starting…
                  </div>
                )}
                {log.map((ev, i) => {
                  if (ev.type === "step") return <div key={i} style={{ color: ACCENT }}>▸ {ev.label}</div>;
                  if (ev.type === "stdout") return <div key={i}>{ev.text}</div>;
                  if (ev.type === "stderr") return <div key={i} style={{ color: "#fbbf24" }}>{ev.text}</div>;
                  if (ev.type === "error") return <div key={i} style={{ color: "var(--plum)" }}>✗ {ev.text}</div>;
                  if (ev.type === "done") return (
                    <div key={i} style={{ color: ev.ok ? "var(--emerald)" : "var(--plum)" }}>
                      {ev.ok ? "✓" : "✗"} Install {ev.ok ? "completed" : "failed"} (exit {ev.code})
                    </div>
                  );
                  return null;
                })}
              </div>

              {phase === "done" && (
                <div className="flex items-center justify-end gap-2 pt-2">
                  {installOk === false && (
                    <button onClick={() => { setPhase("form"); setLog([]); setInstallOk(null); }}
                            className="text-[11px] uppercase tracking-widest px-3 py-1.5 rounded hover:bg-[rgba(243,235,218,0.05)]"
                            style={{ color: "var(--cream-mute)" }}>
                      Try again
                    </button>
                  )}
                  <button onClick={() => onComplete()}
                          className="text-[11px] uppercase tracking-widest px-4 py-1.5 rounded flex items-center gap-1.5 font-semibold"
                          style={{
                            color: installOk ? "var(--emerald)" : "var(--cream)",
                            border: `1px solid ${installOk ? "var(--emerald)" : "var(--cream-mute)"}55`,
                            background: installOk ? "rgba(90,184,150,0.1)" : "transparent",
                          }}>
                    {installOk ? <><CheckCircle2 size={11} /> Done</> : <>Close</>}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status, alreadyInstalled }: { status: string; alreadyInstalled: boolean }) {
  const isInstalled = /installed/i.test(status) || alreadyInstalled;
  const isEnabled = /enabled/i.test(status);
  const color = isEnabled ? "var(--emerald)" : isInstalled ? ACCENT : "var(--cream-mute)";
  const label = isEnabled ? "enabled" : isInstalled ? "installed" : "available";
  return (
    <span className="text-[9.5px] uppercase tracking-[0.2em] px-1.5 py-0.5 rounded shrink-0"
          style={{ color, border: `1px solid ${color}40`, background: `${color}10` }}>
      {label}
    </span>
  );
}

function TransportPill({ transport }: { transport: "stdio" | "http" | "unknown" | string }) {
  const isHttp = transport === "http";
  const Icon = isHttp ? Globe : Terminal;
  const color = isHttp ? "#a3e635" : "#fbbf24";
  return (
    <span className="text-[9.5px] uppercase tracking-[0.2em] px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0"
          style={{ color, border: `1px solid ${color}40`, background: `${color}10` }}>
      <Icon size={9} /> {transport}
    </span>
  );
}

// AuthPill — surfaces how a server authenticates (api_key / oauth / none).
// Matches Panel 5 of the architecture diagram where Card A is api_key (.env)
// and Card B is oauth 2.1 + DCR + PKCE.
function AuthPill({ type, provider }: { type: string; provider?: string }) {
  const isOauth = type === "oauth";
  const isNone = type === "none";
  const Icon = isOauth ? Shield : isNone ? Lock : Key;
  const color = isOauth ? "#a855f7" : isNone ? "#6b7280" : "#ec4899";
  const label = isOauth && provider ? `oauth · ${provider}` : type;
  return (
    <span className="text-[9.5px] uppercase tracking-[0.2em] px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0"
          style={{ color, border: `1px solid ${color}40`, background: `${color}10` }}>
      <Icon size={9} /> {label}
    </span>
  );
}

// ManifestPill — surfaces manifest_version so users know the catalogue API
// generation. Forward-compatibility warning surfaces in Phase 2 picker.
function ManifestPill({ version }: { version: number }) {
  return (
    <span className="text-[9.5px] uppercase tracking-[0.2em] px-1.5 py-0.5 rounded shrink-0 mono"
          style={{ color: "var(--cream-mute)", border: "1px solid var(--line-soft)", background: "rgba(243,235,218,0.04)" }}>
      manifest v{version}
    </span>
  );
}

// External link helper, unused in Phase 1 but kept for Phase 2 source-repo links.
export function _SourceLink({ url }: { url: string }) {
  return <a href={url} target="_blank" rel="noopener noreferrer"
            className="text-[10px] uppercase tracking-widest hover:underline flex items-center gap-1"
            style={{ color: ACCENT }}>
    <ExternalLink size={10} /> Source
  </a>;
}

// ─── AddCustomModal ─────────────────────────────────────────────────────────
// For MCPs outside the Nous-approved catalogue. Pick a preset (GitHub,
// Filesystem, etc) or roll your own with arbitrary command/args/url. Saves env
// vars to ~/.hermes/.env, then runs `hermes mcp add <name> ...` non-interactively.

function AddCustomModal({ existingNames, onClose, onComplete }: { existingNames: string[]; onClose: () => void; onComplete: () => Promise<void> | void }) {
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState(""); // space-separated; we split on submit
  const [url, setUrl] = useState("");
  const [auth, setAuth] = useState<"none" | "oauth" | "header">("none");
  const [headerKey, setHeaderKey] = useState("Authorization");
  const [headerValue, setHeaderValue] = useState("");
  const [envVarRows, setEnvVarRows] = useState<Array<{ name: string; value: string; secret: boolean; prompt?: string }>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; output: string; error?: string } | null>(null);
  const presetMeta = selectedPresetId === "_custom" ? null : presetById(selectedPresetId);

  // Apply preset → fill form fields with defaults
  function applyPreset(presetId: string) {
    setSelectedPresetId(presetId);
    setResult(null);
    if (presetId === "" || presetId === "_custom") {
      // Reset to a blank custom form
      setName("");
      setTransport("stdio");
      setCommand("");
      setArgsText("");
      setUrl("");
      setAuth("none");
      setEnvVarRows([]);
      return;
    }
    const p: McpPreset | undefined = presetById(presetId);
    if (!p) return;
    setName(p.name);
    setTransport(p.transport);
    if (p.command) setCommand(p.command);
    if (p.args) setArgsText(p.args.join(" "));
    if (p.url) setUrl(p.url);
    setAuth("none");
    setEnvVarRows((p.envVars ?? []).map((ev) => ({ name: ev.name, value: ev.default ?? "", secret: ev.secret === true, prompt: ev.prompt })));
  }

  function addEnvRow() {
    setEnvVarRows((rows) => [...rows, { name: "", value: "", secret: false }]);
  }
  function updateEnvRow(idx: number, patch: Partial<{ name: string; value: string; secret: boolean }>) {
    setEnvVarRows((rows) => rows.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }
  function removeEnvRow(idx: number) {
    setEnvVarRows((rows) => rows.filter((_, i) => i !== idx));
  }

  const nameClash = existingNames.includes(name);
  const nameValid = /^[a-zA-Z0-9_-]{1,64}$/.test(name);
  const stdioReady = transport === "stdio" && command.trim().length > 0;
  const httpReady = transport === "http" && url.trim().length > 0;
  const canSubmit = nameValid && !nameClash && (stdioReady || httpReady) && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setResult(null);
    // Build the env var map from the rows (drop empty rows + invalid names)
    const envVars: Record<string, string> = {};
    for (const row of envVarRows) {
      if (!row.name.trim()) continue;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(row.name)) continue;
      envVars[row.name] = row.value;
    }
    const spec: Record<string, unknown> = { name, transport };
    if (transport === "stdio") {
      spec.command = command.trim();
      const args = argsText.trim().length > 0 ? argsText.trim().split(/\s+/) : [];
      if (args.length > 0) spec.args = args;
    } else {
      spec.url = url.trim();
      if (auth === "header" && headerValue.trim()) {
        // The CLI's --auth header flag tells Hermes "this is a token-based HTTP
        // server"; we still need to express the header itself. Easiest path:
        // bake the header into a stdio-style fallback isn't right — the CLI
        // actually wants the header value as an env var the config can substitute.
        // For now we surface this as an env var named TOKEN and let the user
        // edit config.yaml afterwards for full header control.
        envVars["MCP_AUTH_TOKEN"] = headerValue.trim();
      }
    }
    if (auth !== "none") spec.auth = auth;
    if (Object.keys(envVars).length > 0) spec.envVars = envVars;

    try {
      const r = await fetch("/api/hermes/mcp/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(spec),
      });
      const j = await r.json();
      setResult(j);
      if (j.ok) {
        // Brief pause so user sees the success state, then refresh.
        setTimeout(() => onComplete(), 800);
      }
    } catch (e) {
      setResult({ ok: false, output: "", error: String(e) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: "rgba(10, 7, 13, 0.78)", backdropFilter: "blur(4px)" }}
         onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}>
      <div className="panel w-full max-w-[720px] max-h-[90vh] flex flex-col overflow-hidden"
           style={{ border: `1px solid ${ACCENT}55`, boxShadow: `0 20px 60px rgba(0,0,0,0.6), 0 0 60px ${ACCENT}22` }}>
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--line-soft)" }}>
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="grid place-items-center w-8 h-8 rounded-lg"
                 style={{ background: `${ACCENT}1a`, color: ACCENT, border: `1px solid ${ACCENT}40` }}>
              <Plus size={14} />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)]">Add custom MCP</div>
              <div className="text-[14px] font-semibold text-[var(--cream)]">Pick a preset or roll your own</div>
            </div>
          </div>
          <button onClick={onClose} disabled={submitting}
                  className="text-[var(--cream-mute)] hover:text-[var(--cream)] disabled:opacity-30">
            <XIcon size={18} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scroll p-4 space-y-4">
          {/* Preset dropdown */}
          <div>
            <label className="text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold mb-1.5 block">
              Preset · jumps to filled config
            </label>
            <select value={selectedPresetId}
                    onChange={(e) => applyPreset(e.target.value)}
                    className="w-full px-3 py-2 text-[12px] rounded-md border bg-transparent text-[var(--cream)]"
                    style={{ borderColor: "var(--line-soft)" }}>
              <option value="">Choose a preset…</option>
              <option value="_custom">— Custom (fill manually) —</option>
              {MCP_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.name} · {p.description.slice(0, 50)}{p.description.length > 50 ? "…" : ""}</option>
              ))}
            </select>
            {presetMeta?.argHint && (
              <div className="text-[10.5px] mt-1.5 text-[var(--gold)] flex items-start gap-1">
                <AlertCircle size={11} className="shrink-0 mt-0.5" /> {presetMeta.argHint}
              </div>
            )}
            {presetMeta?.source && (
              <a href={presetMeta.source} target="_blank" rel="noopener noreferrer"
                 className="text-[10px] uppercase tracking-widest hover:underline inline-flex items-center gap-1 mt-1.5"
                 style={{ color: ACCENT }}>
                <ExternalLink size={10} /> Preset source
              </a>
            )}
          </div>

          {/* Name */}
          <div>
            <label className="text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold mb-1.5 block">
              Name <span className="normal-case text-[10px] text-[var(--cream-mute)]">— config key, lowercase, no spaces</span>
            </label>
            <input value={name}
                   onChange={(e) => setName(e.target.value)}
                   placeholder="e.g. github"
                   className="w-full px-3 py-2 text-[12px] rounded-md border bg-transparent text-[var(--cream)] mono"
                   style={{ borderColor: nameClash ? "var(--plum)" : "var(--line-soft)" }} />
            {name && !nameValid && (
              <div className="text-[10.5px] mt-1 text-[var(--plum)]">Name must match {"[a-zA-Z0-9_-]{1,64}"}</div>
            )}
            {nameClash && (
              <div className="text-[10.5px] mt-1 text-[var(--plum)]">A server with this name is already installed.</div>
            )}
          </div>

          {/* Transport radio */}
          <div>
            <label className="text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold mb-1.5 block">Transport</label>
            <div className="flex gap-2">
              <button onClick={() => setTransport("stdio")}
                      className="flex-1 px-3 py-2 rounded-md border text-[12px] flex items-center justify-center gap-2 transition"
                      style={{
                        borderColor: transport === "stdio" ? "#fbbf24" : "var(--line-soft)",
                        background: transport === "stdio" ? "rgba(251,191,36,0.1)" : "transparent",
                        color: transport === "stdio" ? "#fbbf24" : "var(--cream-mute)",
                      }}>
                <Terminal size={12} /> stdio
              </button>
              <button onClick={() => setTransport("http")}
                      className="flex-1 px-3 py-2 rounded-md border text-[12px] flex items-center justify-center gap-2 transition"
                      style={{
                        borderColor: transport === "http" ? "#a3e635" : "var(--line-soft)",
                        background: transport === "http" ? "rgba(163,230,53,0.1)" : "transparent",
                        color: transport === "http" ? "#a3e635" : "var(--cream-mute)",
                      }}>
                <Globe size={12} /> http
              </button>
            </div>
          </div>

          {/* Stdio fields */}
          {transport === "stdio" && (
            <div className="space-y-3">
              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold mb-1.5 block">Command</label>
                <input value={command} onChange={(e) => setCommand(e.target.value)}
                       placeholder="e.g. npx"
                       className="w-full px-3 py-2 text-[12px] rounded-md border bg-transparent text-[var(--cream)] mono"
                       style={{ borderColor: "var(--line-soft)" }} />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold mb-1.5 block">Args <span className="normal-case text-[10px] text-[var(--cream-mute)]">— space-separated</span></label>
                <input value={argsText} onChange={(e) => setArgsText(e.target.value)}
                       placeholder="e.g. -y @modelcontextprotocol/server-github"
                       className="w-full px-3 py-2 text-[12px] rounded-md border bg-transparent text-[var(--cream)] mono"
                       style={{ borderColor: "var(--line-soft)" }} />
              </div>
            </div>
          )}

          {/* Http fields */}
          {transport === "http" && (
            <div className="space-y-3">
              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold mb-1.5 block">URL</label>
                <input value={url} onChange={(e) => setUrl(e.target.value)}
                       placeholder="https://mcp.example.com/mcp"
                       className="w-full px-3 py-2 text-[12px] rounded-md border bg-transparent text-[var(--cream)] mono"
                       style={{ borderColor: "var(--line-soft)" }} />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold mb-1.5 block">Authentication</label>
                <div className="flex gap-2">
                  {(["none", "oauth", "header"] as const).map((a) => (
                    <button key={a} onClick={() => setAuth(a)}
                            className="flex-1 px-3 py-1.5 rounded-md border text-[11px] uppercase tracking-widest"
                            style={{
                              borderColor: auth === a ? ACCENT : "var(--line-soft)",
                              background: auth === a ? `${ACCENT}14` : "transparent",
                              color: auth === a ? ACCENT : "var(--cream-mute)",
                            }}>
                      {a}
                    </button>
                  ))}
                </div>
              </div>
              {auth === "header" && (
                <div>
                  <label className="text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold mb-1.5 block">
                    Token value <span className="normal-case text-[10px] text-[var(--cream-mute)]">— saved as MCP_AUTH_TOKEN env var</span>
                  </label>
                  <input type="password" value={headerValue} onChange={(e) => setHeaderValue(e.target.value)}
                         placeholder="Bearer …"
                         className="w-full px-3 py-2 text-[12px] rounded-md border bg-transparent text-[var(--cream)] mono"
                         style={{ borderColor: "var(--line-soft)" }} />
                </div>
              )}
            </div>
          )}

          {/* Env vars */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold">Env vars <span className="normal-case text-[10px]">— saved to ~/.hermes/.env</span></label>
              <button onClick={addEnvRow}
                      className="text-[10px] uppercase tracking-widest hover:underline flex items-center gap-1"
                      style={{ color: ACCENT }}>
                <Plus size={10} /> Add
              </button>
            </div>
            <div className="space-y-2">
              {envVarRows.length === 0 && (
                <div className="text-[11px] text-[var(--cream-mute)] italic">
                  No env vars. Add one if your server needs an API token / endpoint URL.
                </div>
              )}
              {envVarRows.map((row, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <input value={row.name}
                           onChange={(e) => updateEnvRow(idx, { name: e.target.value })}
                           placeholder="KEY"
                           className="w-full px-2.5 py-1.5 text-[11.5px] rounded-md border bg-transparent text-[var(--cream)] mono mb-1"
                           style={{ borderColor: "var(--line-soft)" }} />
                    <input value={row.value}
                           onChange={(e) => updateEnvRow(idx, { value: e.target.value })}
                           type={row.secret ? "password" : "text"}
                           placeholder={row.prompt ?? "value"}
                           className="w-full px-2.5 py-1.5 text-[11.5px] rounded-md border bg-transparent text-[var(--cream)] mono"
                           style={{ borderColor: "var(--line-soft)" }} />
                  </div>
                  <button onClick={() => removeEnvRow(idx)}
                          className="text-[var(--cream-mute)] hover:text-[var(--plum)] mt-1.5 p-1"
                          title="Remove this env var">
                    <XIcon size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Result */}
          {result && (
            <div className="rounded-md border p-3 text-[11.5px] space-y-1"
                 style={{
                   borderColor: result.ok ? "var(--emerald)" : "var(--plum)",
                   background: result.ok ? "rgba(90,184,150,0.08)" : "rgba(196,96,126,0.08)",
                   color: "var(--cream)",
                 }}>
              <div className="flex items-center gap-2 font-medium">
                {result.ok ? <><CheckCircle2 size={13} style={{ color: "var(--emerald)" }} /> Added successfully</> : <><AlertCircle size={13} style={{ color: "var(--plum)" }} /> Add failed</>}
              </div>
              {result.error && <div className="mono break-all text-[10.5px]">{result.error}</div>}
              {result.output && <pre className="mono text-[10.5px] text-[var(--cream-mute)] whitespace-pre-wrap">{result.output}</pre>}
            </div>
          )}

          {/* Submit */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button onClick={onClose} disabled={submitting}
                    className="text-[11px] uppercase tracking-widest px-3 py-1.5 rounded hover:bg-[rgba(243,235,218,0.05)] disabled:opacity-50"
                    style={{ color: "var(--cream-mute)" }}>
              Cancel
            </button>
            <button onClick={submit} disabled={!canSubmit}
                    className="text-[11px] uppercase tracking-widest px-4 py-1.5 rounded flex items-center gap-1.5 font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ color: ACCENT, border: `1px solid ${ACCENT}`, background: `${ACCENT}1a` }}>
              {submitting ? <><Loader2 size={11} className="animate-spin" /> Adding…</> : <><Plus size={11} /> Add server</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ToolsEditorModal ───────────────────────────────────────────────────────
// Shows the current tools.include array as removable chips. Phase 3 minimum
// viable: prune. Adding tools by name (or running a probe to show the full
// available list) is a follow-up — current scope is "I installed everything,
// let me remove a few".

function ToolsEditorModal({ name, onClose, onComplete }: { name: string; onClose: () => void; onComplete: () => Promise<void> | void }) {
  const [tools, setTools] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newToolName, setNewToolName] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/hermes/mcp/tools?name=${encodeURIComponent(name)}`, { cache: "no-store" });
        const j = await r.json();
        if (cancelled) return;
        if (!j.ok) { setError(j.error || "failed to load"); return; }
        setTools(Array.isArray(j.tools) ? j.tools : null);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [name]);

  function removeTool(t: string) {
    setTools((cur) => (cur ?? []).filter((x) => x !== t));
  }
  function addTool() {
    const t = newToolName.trim();
    if (!t || !/^[A-Za-z0-9_.\-]+$/.test(t)) return;
    setTools((cur) => {
      const next = cur ? [...cur] : [];
      if (!next.includes(t)) next.push(t);
      return next;
    });
    setNewToolName("");
  }

  async function save() {
    setSaving(true);
    try {
      const r = await fetch("/api/hermes/mcp/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, tools: tools ?? [] }),
      });
      const j = await r.json();
      if (!j.ok) {
        setError(j.error || "save failed");
        setSaving(false);
        return;
      }
      onComplete();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: "rgba(10, 7, 13, 0.78)", backdropFilter: "blur(4px)" }}
         onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div className="panel w-full max-w-[560px] max-h-[90vh] flex flex-col overflow-hidden"
           style={{ border: `1px solid ${ACCENT}55`, boxShadow: `0 20px 60px rgba(0,0,0,0.6), 0 0 60px ${ACCENT}22` }}>
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--line-soft)" }}>
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="grid place-items-center w-8 h-8 rounded-lg"
                 style={{ background: `${ACCENT}1a`, color: ACCENT, border: `1px solid ${ACCENT}40` }}>
              <Settings2 size={14} />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)]">Tools · {name}</div>
              <div className="text-[14px] font-semibold text-[var(--cream)]">Prune the tools this server exposes</div>
            </div>
          </div>
          <button onClick={onClose} disabled={saving}
                  className="text-[var(--cream-mute)] hover:text-[var(--cream)] disabled:opacity-30">
            <XIcon size={18} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scroll p-4 space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-[12px] text-[var(--cream-mute)]">
              <Loader2 size={14} className="animate-spin" /> Reading config…
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 text-[12px] p-3 rounded-md border"
                 style={{ borderColor: "var(--plum)", background: "rgba(196,96,126,0.08)", color: "var(--cream)" }}>
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <div className="mono break-all">{error}</div>
            </div>
          ) : tools === null ? (
            <div className="text-[12px] text-[var(--cream-mute)] space-y-2">
              <div>
                <span className="text-[var(--cream)] font-medium">No filter set</span> — this server currently exposes <em>all</em> its tools to Hermes.
              </div>
              <div>
                Add specific tool names below to start filtering. Once you add the first one, only those tools will be enabled.
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-[11.5px] text-[var(--cream-mute)] leading-snug">
                <span className="text-[var(--cream)] font-medium">{tools.length} tool{tools.length === 1 ? "" : "s"} enabled.</span> Click × to remove a tool from <code className="mono">tools.include</code>.
                {tools.length === 0 && <> Empty list = filter removed (all tools enabled).</>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {tools.map((t) => (
                  <span key={t}
                        className="text-[11px] mono px-2 py-1 rounded inline-flex items-center gap-1.5 shrink-0"
                        style={{ color: "var(--cream)", border: `1px solid ${ACCENT}44`, background: `${ACCENT}10` }}>
                    {t}
                    <button onClick={() => removeTool(t)}
                            className="hover:text-[var(--plum)]" title={`Remove ${t}`}>
                      <XIcon size={11} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Add tool by name */}
          {!loading && !error && (
            <div>
              <label className="text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold mb-1.5 block">
                Add tool by name
              </label>
              <div className="flex gap-2">
                <input value={newToolName}
                       onChange={(e) => setNewToolName(e.target.value)}
                       onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTool(); } }}
                       placeholder="e.g. create_issue"
                       className="flex-1 px-3 py-1.5 text-[12px] rounded-md border bg-transparent text-[var(--cream)] mono"
                       style={{ borderColor: "var(--line-soft)" }} />
                <button onClick={addTool}
                        disabled={!newToolName.trim() || !/^[A-Za-z0-9_.\-]+$/.test(newToolName.trim())}
                        className="text-[10px] uppercase tracking-widest px-3 py-1.5 rounded flex items-center gap-1 font-semibold disabled:opacity-40"
                        style={{ color: ACCENT, border: `1px solid ${ACCENT}55`, background: `${ACCENT}14` }}>
                  <Plus size={11} /> Add
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button onClick={onClose} disabled={saving}
                    className="text-[11px] uppercase tracking-widest px-3 py-1.5 rounded hover:bg-[rgba(243,235,218,0.05)] disabled:opacity-50"
                    style={{ color: "var(--cream-mute)" }}>
              Cancel
            </button>
            <button onClick={save} disabled={saving || loading || !!error}
                    className="text-[11px] uppercase tracking-widest px-4 py-1.5 rounded flex items-center gap-1.5 font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ color: ACCENT, border: `1px solid ${ACCENT}`, background: `${ACCENT}1a` }}>
              {saving ? <><Loader2 size={11} className="animate-spin" /> Saving…</> : <><CheckCircle2 size={11} /> Save</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

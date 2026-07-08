"use client";

import { Fragment, createContext, useContext, useCallback, useEffect, useState } from "react";
import {
  Mail, Search, ShieldCheck, Send, Inbox, Users, AlertTriangle,
  Play, Pause, FileText, RefreshCw, Trash2, Plus, Zap, Building2, Sparkles, CornerDownRight,
  Settings as Cog, KeyRound, PauseCircle, PlayCircle, CheckCircle2, XCircle, ListChecks, X, Eye, EyeOff,
} from "lucide-react";
import type { Lead, Campaign, OutreachStats } from "@/lib/outreach";

// The mailbox every send goes out from (shown in the preview's To/From + opt-out).
// NOTE: keep this a client-safe local copy — never value-import from @/lib/outreach
// (it pulls node fs/path into the browser bundle). Mirrors appendOptOut() in the lib.
const SEND_FROM = "hermes@goldie.agency";
function appendOptOutPreview(body: string, from: string): string {
  return body.replace(/\s+$/, "") +
    `\n\n—\nNot interested? Just reply STOP and I won't email you again.` +
    `\nYou can also email ${from} with "unsubscribe" in the subject.`;
}

// Presenter mode — when on, email addresses are masked until clicked (so they
// don't show on screen during a recorded video tutorial).
const HideEmails = createContext(false);

function EmailText({ value, className }: { value?: string | null; className?: string }) {
  const hide = useContext(HideEmails);
  const [show, setShow] = useState(false);
  useEffect(() => { setShow(false); }, [hide]); // re-mask when presenter mode toggles
  if (!value) return <span className="text-[var(--fg-dimmer)]">—</span>;
  if (!hide || show) return <span className={className}>{value}</span>;
  return (
    <button onClick={(e) => { e.stopPropagation(); setShow(true); }} title="Click to reveal email"
      className="inline-flex items-center gap-1 text-[var(--fg-dimmer)] hover:text-[var(--fg-dim)] font-mono transition-colors">
      <EyeOff size={11} />•••••••@•••••
    </button>
  );
}

// Midnight Aubergine palette (matches the Agent OS design system).
const GOLD = "var(--gold)";
const GOLD_SOFT = "var(--gold-soft)";
const EMERALD = "var(--emerald)";
const PLUM = "var(--plum)";
const RUST = "var(--rust)";
type View = "dashboard" | "leads" | "campaigns" | "sent" | "inbox" | "settings";

interface SendLogRow { id: string; campaignId: string; leadId?: string; to: string; domain?: string; subject?: string; body?: string; step?: number; mode: string; at: string; detail?: string }
interface FullState {
  leads: Lead[];
  campaigns: Campaign[];
  sendLog: SendLogRow[];
  circuitBreaker: { state: string; openedAt?: string; reason?: string; bounceCount?: number };
  meta: { dailyCap: number; paused?: boolean };
  stats: OutreachStats;
}

const STATUS_COLORS: Record<string, string> = {
  new: "#a59783", enriched: GOLD, valid: EMERALD, risky: RUST,
  invalid: PLUM, queued: GOLD, contacted: GOLD_SOFT, replied: EMERALD, bounced: PLUM,
};
const SIZE_META: Record<string, { label: string; color: string }> = {
  small: { label: "Small", color: EMERALD },
  mid: { label: "Mid", color: GOLD },
  large: { label: "Too big", color: PLUM },
  unknown: { label: "Unsized", color: "#6e6353" },
};

function Chip({ label, color }: { label: string; color?: string }) {
  const c = color || STATUS_COLORS[label] || "#a59783";
  return <span className="text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap" style={{ color: c, borderColor: `${c}66`, background: `${c}1a` }}>{label}</span>;
}
function SizeChip({ size }: { size?: string }) {
  const m = SIZE_META[size || "unknown"] || SIZE_META.unknown;
  return <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap" style={{ color: m.color, borderColor: `${m.color}66`, background: `${m.color}14` }}><Building2 size={9} />{m.label}</span>;
}

// Local copy of the template renderer (server lib pulls node:fs, can't import here).
function render(tpl: string, l: { name?: string; domain?: string; reason?: string }): string {
  const first = (l.name || "").split(" ")[0] || "there";
  return tpl.replace(/\{\{\s*first_name\s*\}\}/g, first).replace(/\{\{\s*name\s*\}\}/g, l.name || "there")
    .replace(/\{\{\s*domain\s*\}\}/g, l.domain || "").replace(/\{\{\s*reason\s*\}\}/g, l.reason || "");
}

export default function HermesOutreach() {
  const [view, setView] = useState<View>("dashboard");
  const [s, setS] = useState<FullState | null>(null);
  const [busy, setBusy] = useState<string>("");
  const [toast, setToast] = useState<string>("");
  const [hideEmails, setHideEmails] = useState(true); // default safe for screen-sharing

  const refresh = useCallback(async () => {
    try { const r = await fetch("/api/outreach", { cache: "no-store" }); setS(await r.json()); } catch { /* */ }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { try { const v = localStorage.getItem("outreach.hideEmails"); if (v !== null) setHideEmails(v === "1"); } catch { /* */ } }, []);
  const togglePrivacy = () => setHideEmails((p) => { const n = !p; try { localStorage.setItem("outreach.hideEmails", n ? "1" : "0"); } catch { /* */ } return n; });

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 4500); };
  const act = async (body: Record<string, unknown>, label: string) => {
    setBusy(label);
    try { const r = await fetch("/api/outreach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json(); await refresh(); return j; }
    finally { setBusy(""); }
  };
  const post = async (url: string, body: Record<string, unknown>, label: string) => {
    setBusy(label);
    try { const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json(); await refresh(); return j; }
    finally { setBusy(""); }
  };

  if (!s) return <div className="panel p-6 text-sm text-[var(--fg-dim)]">Loading outreach…</div>;

  return (
    <HideEmails.Provider value={hideEmails}>
    <div className="space-y-5">
      {/* header strip */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="grid place-items-center w-9 h-9 rounded-xl shrink-0" style={{ background: `${GOLD}22`, color: GOLD, boxShadow: `0 0 26px -8px ${GOLD}` }}><Mail size={17} /></div>
        <div className="mr-auto">
          <div className="text-[15px] font-semibold tracking-tight" style={{ color: "var(--fg)" }}>Email Outreach</div>
          <div className="text-[11.5px] text-[var(--fg-dimmer)]">Find · enrich · validate · send — through hermes@goldie.agency</div>
        </div>
        {s.meta.paused && (
          <button onClick={() => act({ action: "set_paused", paused: false }, "resume")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[12px] font-medium" style={{ borderColor: `${RUST}66`, color: RUST, background: `${RUST}14` }}>
            <PauseCircle size={13} />Paused · resume
          </button>
        )}
        <div className="flex items-center gap-1.5 bg-[var(--bg-card)] rounded-full p-1 border" style={{ borderColor: "var(--panel-border)" }}>
          {([
            { k: "dashboard", label: "Dashboard", icon: <Sparkles size={13} /> },
            { k: "leads", label: "Leads", icon: <Users size={13} /> },
            { k: "campaigns", label: "Campaigns", icon: <Send size={13} /> },
            { k: "sent", label: "Sent", icon: <FileText size={13} /> },
            { k: "inbox", label: "Inbox", icon: <Inbox size={13} /> },
          ] as { k: View; label: string; icon: React.ReactNode }[]).map((t) => {
            const active = view === t.k;
            return (
              <button key={t.k} onClick={() => setView(t.k)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium transition"
                style={{ background: active ? `${GOLD}24` : "transparent", color: active ? GOLD_SOFT : "var(--fg-dim)", boxShadow: active ? `inset 0 0 0 1px ${GOLD}55` : "none" }}>
                {t.icon}{t.label}
              </button>
            );
          })}
        </div>
        <button onClick={togglePrivacy} title={hideEmails ? "Emails hidden (presenter mode) — click to show" : "Emails visible — click to hide for screen-sharing"}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[12px] font-medium transition"
          style={{ borderColor: hideEmails ? `${EMERALD}66` : "var(--panel-border)", color: hideEmails ? EMERALD : "var(--fg-dim)", background: hideEmails ? `${EMERALD}14` : "transparent" }}>
          {hideEmails ? <EyeOff size={13} /> : <Eye size={13} />}{hideEmails ? "Emails hidden" : "Emails shown"}
        </button>
        <button onClick={() => setView("settings")} title="Settings & API keys" className="grid place-items-center w-8 h-8 rounded-full border text-[var(--fg-dim)]" style={{ borderColor: view === "settings" ? GOLD : "var(--panel-border)", color: view === "settings" ? GOLD : "var(--fg-dim)" }}>
          <Cog size={14} />
        </button>
        <button onClick={refresh} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[12px] text-[var(--fg-dim)]" style={{ borderColor: "var(--panel-border)" }}>
          <RefreshCw size={13} className={busy ? "animate-spin" : ""} />{busy || "Refresh"}
        </button>
      </div>

      {toast && <div className="panel p-3 text-[12.5px] panel-hover" style={{ borderColor: `${GOLD}66`, color: "var(--fg)", background: `${GOLD}10` }}>{toast}</div>}

      {s.circuitBreaker.state === "open" && (
        <div className="rounded-2xl p-4 flex items-center gap-3 border" style={{ borderColor: `${PLUM}55`, background: `linear-gradient(180deg, ${PLUM}1c, ${PLUM}08)` }}>
          <div className="grid place-items-center w-9 h-9 rounded-xl shrink-0" style={{ background: `${PLUM}26`, color: PLUM }}><AlertTriangle size={17} /></div>
          <div className="flex-1 text-[12.5px]">
            <strong style={{ color: PLUM }}>Sending paused — circuit breaker open.</strong>{" "}
            <span className="text-[var(--fg-dim)]">{s.circuitBreaker.reason || "Bounces detected."} Validate addresses, then resume.</span>
          </div>
          <button onClick={() => act({ action: "reset_breaker" }, "reset")} className="px-3 py-1.5 rounded-lg border text-[12px] font-medium" style={{ borderColor: PLUM, color: PLUM }}>Reset breaker</button>
        </div>
      )}

      {view === "dashboard" && <Dashboard s={s} />}
      {view === "leads" && <Leads s={s} post={post} act={act} busy={busy} flash={flash} />}
      {view === "campaigns" && <Campaigns s={s} post={post} act={act} busy={busy} flash={flash} />}
      {view === "sent" && <SentView s={s} />}
      {view === "inbox" && <InboxView />}
      {view === "settings" && <SettingsView flash={flash} onChanged={refresh} />}
    </div>
    </HideEmails.Provider>
  );
}

// ─── Dashboard ──────────────────────────────────────────────────────
function Dashboard({ s }: { s: FullState }) {
  const st = s.stats;
  const cards = [
    { label: "Leads", value: st.leads, icon: <Users size={15} />, color: GOLD },
    { label: "Validated", value: st.validated, icon: <ShieldCheck size={15} />, color: EMERALD },
    { label: "Sendable", value: st.sendable, icon: <Zap size={15} />, color: EMERALD },
    { label: "Too big (skipped)", value: st.bigExcluded, icon: <Building2 size={15} />, color: PLUM },
    { label: "Sent", value: st.sent, icon: <Send size={15} />, color: GOLD_SOFT },
    { label: "Replied", value: st.replied, icon: <Inbox size={15} />, color: EMERALD },
  ];
  const recent = [...s.sendLog].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
  const capPct = Math.min(100, Math.round((st.sentToday / Math.max(1, s.meta.dailyCap)) * 100));
  const brPct = Math.round(st.bounceRate * 100);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl p-3.5 border panel-hover" style={{ borderColor: "var(--panel-border)", background: `linear-gradient(180deg, ${c.color}12, var(--bg-card))` }}>
            <div className="flex items-center gap-1.5 text-[9.5px] uppercase tracking-widest text-[var(--fg-dimmer)]"><span style={{ color: c.color }}>{c.icon}</span>{c.label}</div>
            <div className="metric text-[26px] leading-tight mt-1.5" style={{ color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* gauges */}
      <div className="grid md:grid-cols-2 gap-3">
        <Gauge label="Daily cap used" value={`${st.sentToday} / ${s.meta.dailyCap}`} pct={capPct} color={GOLD} hint={`${s.meta.dailyCap - st.sentToday} sends left today`} />
        <Gauge label="Bounce rate" value={`${brPct}%`} pct={brPct} color={brPct > 10 ? PLUM : EMERALD} hint={brPct > 10 ? "High — validate before sending" : "Healthy"} />
      </div>

      <div className="panel p-4">
        <div className="text-[11px] uppercase tracking-widest mb-3" style={{ color: GOLD }}>Recent activity</div>
        {recent.length === 0 ? <Empty icon={<Send size={20} />} text="No sends yet. Build a campaign to get going." /> : (
          <div className="space-y-1">
            {recent.map((e) => (
              <div key={e.id} className="flex items-center gap-2.5 text-[12px] py-1 border-b last:border-0" style={{ borderColor: "var(--line-deep)" }}>
                <Chip label={e.mode} />
                <span className="text-[var(--fg)] font-medium min-w-[130px]">{e.domain || e.to}</span>
                <span className="text-[var(--fg-dimmer)] truncate flex-1">{e.subject}</span>
                <span className="text-[var(--fg-dimmer)] tabular-nums">{e.at.slice(0, 10)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Gauge({ label, value, pct, color, hint }: { label: string; value: string; pct: number; color: string; hint: string }) {
  return (
    <div className="panel p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-widest text-[var(--fg-dimmer)]">{label}</span>
        <span className="metric text-[18px]" style={{ color }}>{value}</span>
      </div>
      <div className="h-2 rounded-full mt-2.5 overflow-hidden" style={{ background: "var(--bg-elev)" }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%`, background: `linear-gradient(90deg, ${color}, ${color}aa)`, boxShadow: `0 0 12px -2px ${color}` }} />
      </div>
      <div className="text-[11px] text-[var(--fg-dimmer)] mt-1.5">{hint}</div>
    </div>
  );
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <div className="grid place-items-center w-11 h-11 rounded-2xl" style={{ background: "var(--bg-elev)", color: "var(--fg-dimmer)" }}>{icon}</div>
      <div className="text-[12.5px] text-[var(--fg-dim)] max-w-[280px]">{text}</div>
    </div>
  );
}

// ─── Leads ──────────────────────────────────────────────────────────
function Leads({ s, post, act, busy, flash }: { s: FullState; post: (u: string, b: Record<string, unknown>, l: string) => Promise<Record<string, unknown>>; act: (b: Record<string, unknown>, l: string) => Promise<Record<string, unknown>>; busy: string; flash: (m: string) => void }) {
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [hideBig, setHideBig] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  let leads = s.leads.filter((l) => filter === "all" || l.status === filter);
  if (hideBig) leads = leads.filter((l) => l.companySize !== "large");

  const toggle = (id: string) => { const n = new Set(selected); if (n.has(id)) n.delete(id); else n.add(id); setSelected(n); };
  const allShownSelected = leads.length > 0 && leads.every((l) => selected.has(l.id));
  const toggleAll = () => setSelected(allShownSelected ? new Set() : new Set(leads.map((l) => l.id)));
  const delSelected = async () => { if (!selected.size) return; const n = selected.size; await act({ action: "delete_leads", ids: [...selected] }, "deleting"); setSelected(new Set()); flash(`Deleted ${n} lead(s).`); };
  const clearView = async () => { const ids = leads.map((l) => l.id); if (!ids.length) return; await act({ action: "delete_leads", ids }, "clearing"); setSelected(new Set()); flash(`Cleared ${ids.length} lead(s) from view.`); };

  const find = async () => {
    if (!query.trim()) return;
    const j = await post("/api/outreach/enrich", { search: query.trim(), limit: 8 }, "finding");
    flash(`Found ${j.found ?? 0} sites · enriched ${j.enriched ?? 0} · ${j.withEmail ?? 0} with an email.`);
  };
  const addManual = async () => {
    const rows = manual.split("\n").map((x) => x.trim()).filter(Boolean).map((line) => { const [domain, email, name] = line.split(",").map((p) => p?.trim()); return { domain, email, name }; });
    if (!rows.length) return;
    await act({ action: "add_leads", leads: rows }, "adding"); setManual(""); flash(`Added ${rows.length} lead(s).`);
  };
  const enrichMissing = async () => {
    const ids = s.leads.filter((l) => !l.email && l.companySize !== "large").map((l) => l.id).slice(0, 12);
    if (!ids.length) return flash("Nothing to enrich (all have emails or are too big).");
    const j = await post("/api/outreach/enrich", { leadIds: ids }, "enriching");
    flash(`Enriched ${j.enriched ?? 0} · ${j.withEmail ?? 0} got an email.`);
  };
  const validateAll = async () => { const j = await post("/api/outreach/validate", { all: false }, "validating"); flash(`Validated ${j.checked ?? 0} address(es).`); };

  const bigCount = s.leads.filter((l) => l.companySize === "large").length;

  return (
    <div className="space-y-4">
      <div className="panel p-4 space-y-3">
        <div className="text-[11px] uppercase tracking-widest" style={{ color: GOLD }}>Find leads</div>
        <div className="flex gap-2">
          <div className="flex items-center gap-2 flex-1 border rounded-xl px-3" style={{ borderColor: "var(--panel-border)", background: "var(--bg-card)" }}>
            <Search size={15} className="text-[var(--fg-dimmer)]" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. AI automation agency blogs that accept guest posts"
              className="flex-1 bg-transparent py-2.5 text-[13px] outline-none" onKeyDown={(e) => e.key === "Enter" && find()} />
          </div>
          <button onClick={find} disabled={!!busy} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12.5px] font-medium" style={{ background: `${GOLD}22`, color: GOLD_SOFT, boxShadow: `inset 0 0 0 1px ${GOLD}55` }}><Sparkles size={14} />Find + enrich</button>
        </div>
        <div className="flex gap-2 items-start">
          <textarea value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Or paste leads, one per line:  domain.com, name@domain.com, Jane Doe"
            rows={2} className="flex-1 bg-[var(--bg-card)] border rounded-xl px-3 py-2 text-[12.5px] outline-none" style={{ borderColor: "var(--panel-border)" }} />
          <button onClick={addManual} disabled={!!busy} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[12.5px] text-[var(--fg-dim)]" style={{ borderColor: "var(--panel-border)" }}><Plus size={14} />Add</button>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={enrichMissing} disabled={!!busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] text-[var(--fg-dim)]" style={{ borderColor: "var(--panel-border)" }}><Zap size={13} />Enrich missing</button>
          <button onClick={validateAll} disabled={!!busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px]" style={{ borderColor: `${EMERALD}66`, color: EMERALD }}><ShieldCheck size={13} />Validate addresses</button>
        </div>
      </div>

      {/* controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1.5 flex-wrap text-[11px]">
          {["all", "new", "enriched", "valid", "risky", "invalid", "contacted", "replied", "bounced", "suppressed"].map((f) => (
            <button key={f} onClick={() => setFilter(f)} className="px-2.5 py-1 rounded-full border capitalize" style={{ borderColor: filter === f ? GOLD : "var(--panel-border)", color: filter === f ? GOLD_SOFT : "var(--fg-dim)", background: filter === f ? `${GOLD}14` : "transparent" }}>{f}</button>
          ))}
        </div>
        <button onClick={() => setHideBig((v) => !v)} title="Filter out giant companies that won't reply"
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[12px] font-medium transition"
          style={{ borderColor: hideBig ? `${EMERALD}66` : "var(--panel-border)", color: hideBig ? EMERALD : "var(--fg-dim)", background: hideBig ? `${EMERALD}14` : "transparent" }}>
          <Building2 size={13} />{hideBig ? "Hiding big companies" : "Showing all sizes"}{bigCount > 0 && <span className="opacity-70">({bigCount} big)</span>}
        </button>
      </div>

      {/* bulk actions */}
      {leads.length > 0 && (
        <div className="flex items-center gap-2 text-[12px]">
          <button onClick={toggleAll} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[var(--fg-dim)]" style={{ borderColor: "var(--panel-border)" }}>
            <ListChecks size={13} />{allShownSelected ? "Deselect all" : "Select all"}
          </button>
          {selected.size > 0 && (
            <button onClick={delSelected} disabled={!!busy} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-medium" style={{ borderColor: PLUM, color: PLUM, background: `${PLUM}14` }}>
              <Trash2 size={13} />Delete selected ({selected.size})
            </button>
          )}
          <button onClick={clearView} disabled={!!busy} className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[var(--fg-dimmer)]" style={{ borderColor: "var(--panel-border)" }}>
            <Trash2 size={13} />Delete all in view ({leads.length})
          </button>
        </div>
      )}

      <div className="panel p-0 overflow-hidden">
        <div className="max-h-[420px] overflow-y-auto">
          {leads.length === 0 ? <Empty icon={<Users size={20} />} text={hideBig && s.leads.length ? "No realistic leads in this view. Find some, or toggle to show big companies." : "No leads yet — find or paste some above."} /> : (
            <table className="w-full text-[12px]">
              <thead className="text-[9.5px] uppercase tracking-widest text-[var(--fg-dimmer)] sticky top-0" style={{ background: "var(--bg-card)" }}>
                <tr className="border-b" style={{ borderColor: "var(--panel-border)" }}>
                  <th className="px-3 py-2.5"><input type="checkbox" checked={allShownSelected} onChange={toggleAll} /></th>
                  <th className="text-left px-3 py-2.5">Domain</th><th className="text-left px-3 py-2.5">Email</th><th className="text-left px-3 py-2.5">Size</th><th className="text-left px-3 py-2.5">Status</th><th className="text-left px-3 py-2.5">Notes</th><th></th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id} className="border-b hover:bg-[var(--bg-elev)] transition-colors" style={{ borderColor: "var(--line-deep)", background: selected.has(l.id) ? `${PLUM}0f` : undefined }}>
                    <td className="px-3 py-2.5"><input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} /></td>
                    <td className="px-3 py-2.5 text-[var(--fg)] font-medium">{l.domain}</td>
                    <td className="px-3 py-2.5 text-[var(--fg-dim)]"><EmailText value={l.email} /></td>
                    <td className="px-3 py-2.5"><SizeChip size={l.companySize} /></td>
                    <td className="px-3 py-2.5"><Chip label={l.status} /></td>
                    <td className="px-3 py-2.5 text-[var(--fg-dimmer)] max-w-[260px] truncate">{l.reason || l.title || l.sizeNote || ""}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {l.status === "suppressed"
                        ? <button title="Re-add (allow emailing again)" onClick={() => act({ action: "suppress_lead", id: l.id, suppressed: false }, "optin")} className="text-[var(--fg-dimmer)] hover:text-[color:var(--emerald)] transition-colors mr-3"><CheckCircle2 size={13} /></button>
                        : <button title="Opt out — never email this lead again" onClick={() => act({ action: "suppress_lead", id: l.id }, "optout")} className="text-[var(--fg-dimmer)] hover:text-[color:var(--rust)] transition-colors mr-3"><XCircle size={13} /></button>}
                      <button title="Delete lead" onClick={() => act({ action: "delete_lead", id: l.id }, "del")} className="text-[var(--fg-dimmer)] hover:text-[color:var(--plum)] transition-colors"><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Campaigns ──────────────────────────────────────────────────────
function Campaigns({ s, post, act, busy, flash }: { s: FullState; post: (u: string, b: Record<string, unknown>, l: string) => Promise<Record<string, unknown>>; act: (b: Record<string, unknown>, l: string) => Promise<Record<string, unknown>>; busy: string; flash: (m: string) => void }) {
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [writing, setWriting] = useState(false);
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [includeBig, setIncludeBig] = useState(false);

  // Ask what the campaign is about → the AI writes the actual email (real pitch, merge tags).
  const writeWithAI = async () => {
    if (!brief.trim() || writing) return;
    setWriting(true);
    try {
      const r = await fetch("/api/outreach/write", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brief }) });
      const j = await r.json();
      if (j.error) flash(j.error);
      else { if (j.subject) setSubject(j.subject); if (j.body) setBodyText(j.body); flash("Email written by AI — tweak it or preview below."); }
    } catch (e) { flash(String(e)); }
    finally { setWriting(false); }
  };

  let audience = s.leads.filter((l) => l.email && (l.status === "valid" || l.status === "risky" || l.status === "enriched"));
  if (!includeBig) audience = audience.filter((l) => l.companySize !== "large");

  const sample = (() => {
    const sel = s.leads.find((l) => picked.has(l.id));
    return sel
      ? { name: sel.name, domain: sel.domain, reason: sel.reason, email: sel.email || "", real: true }
      : { name: "Jane Doe", domain: "acme.io", reason: "you publish AI automation tutorials", email: "jane@acme.io", real: false };
  })();

  const create = async () => {
    const j = await act({ action: "create_campaign", name: name || "New campaign", steps: [{ subject, body: bodyText }], leadIds: Array.from(picked) }, "create");
    flash(`Campaign created with ${picked.size} lead(s). Create drafts to review before sending.`);
    setName(""); setPicked(new Set());
    void j;
  };
  const launch = async (id: string, mode: "draft" | "send") => {
    const j = await post("/api/outreach/send", { campaignId: id, mode }, mode === "draft" ? "drafting" : "sending");
    if (j.blocked) flash(`Blocked: ${j.reason}. ${j.detail || ""}`);
    else flash(`${mode === "draft" ? "Drafted" : "Sent"} ${j.succeeded ?? 0}/${j.attempted ?? 0}.`);
  };

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      {/* designer */}
      <div className="panel p-4 space-y-3">
        <div className="text-[11px] uppercase tracking-widest" style={{ color: GOLD }}>Design a campaign</div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign name" className="w-full bg-[var(--bg-card)] border rounded-xl px-3 py-2.5 text-[13px] outline-none" style={{ borderColor: "var(--panel-border)" }} />

        {/* What's the campaign about? → AI writes the actual email */}
        <div className="rounded-xl border p-2.5 space-y-2" style={{ borderColor: `${EMERALD}55`, background: `${EMERALD}0c` }}>
          <div className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: EMERALD }}><Sparkles size={13} />What's this campaign about?</div>
          <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={3}
            placeholder="Tell the AI what you're pitching — your offer, who it's for, and what you want them to do. e.g. 'I run a link-building agency; I want to offer these SEO firms white-label link building they can resell — goal: book a quick call.'"
            className="w-full bg-[var(--bg-card)] border rounded-lg px-3 py-2 text-[12.5px] outline-none" style={{ borderColor: "var(--panel-border)" }} />
          <button onClick={writeWithAI} disabled={writing || !brief.trim()}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12.5px] font-medium disabled:opacity-40"
            style={{ background: `${EMERALD}22`, color: EMERALD, boxShadow: `inset 0 0 0 1px ${EMERALD}66` }}>
            {writing ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />}{writing ? "Writing the email…" : (subject || bodyText) ? "Rewrite with AI" : "Write the email with AI"}
          </button>
        </div>

        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject — or let the AI write it above" className="w-full bg-[var(--bg-card)] border rounded-xl px-3 py-2 text-[12.5px] outline-none" style={{ borderColor: "var(--panel-border)" }} />
        <textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} rows={7} placeholder="The email body — describe your campaign above and hit “Write the email with AI”, or type your own. Use {{first_name}} {{domain}} {{reason}} to personalise." className="w-full bg-[var(--bg-card)] border rounded-xl px-3 py-2 text-[12.5px] font-mono outline-none" style={{ borderColor: "var(--panel-border)" }} />
        <div className="text-[10.5px] text-[var(--fg-dimmer)]">Variables: <code style={{ color: GOLD_SOFT }}>{"{{first_name}} {{name}} {{domain}} {{reason}}"}</code></div>

        {/* live preview — the EXACT email that gets sent (real recipient + opt-out footer) */}
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--panel-border)" }}>
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] border-b flex items-center justify-between" style={{ borderColor: "var(--line-deep)", background: "var(--bg-card)" }}>
            <span className="flex items-center gap-1.5"><Mail size={11} />Live preview — exactly what sends</span>
            <span className="normal-case tracking-normal text-[10px]" style={{ color: sample.real ? EMERALD : RUST }}>{sample.real ? "real recipient" : "sample — select a lead below"}</span>
          </div>
          <div className="p-3 space-y-1.5" style={{ background: "var(--bg-mid)" }}>
            <div className="text-[11px] text-[var(--fg-dimmer)] flex flex-wrap gap-x-4 gap-y-0.5 pb-1.5 mb-1 border-b" style={{ borderColor: "var(--line-deep)" }}>
              <span>From: <span className="text-[var(--fg-dim)]">{SEND_FROM}</span></span>
              <span>To: <EmailText value={sample.email || "(no address)"} className="text-[var(--fg-dim)]" /></span>
            </div>
            <div className="text-[12.5px] font-semibold text-[var(--fg)]">{render(subject, sample) || "(no subject)"}</div>
            <div className="text-[12px] text-[var(--fg-dim)] whitespace-pre-wrap leading-relaxed">{appendOptOutPreview(render(bodyText, sample), SEND_FROM)}</div>
            <div className="text-[10.5px] text-[var(--fg-dimmer)] pt-1.5 mt-1 border-t" style={{ borderColor: "var(--line-deep)" }}>+ one-click <span style={{ color: EMERALD }}>Unsubscribe</span> header attached (Gmail/Outlook show their button). Select a lead in the audience below to preview their exact email.</div>
          </div>
        </div>

        {/* audience */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-[var(--fg-dim)]">Audience — {picked.size} selected</span>
          <button onClick={() => setIncludeBig((v) => !v)} className="flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-full border" style={{ borderColor: includeBig ? `${PLUM}66` : `${EMERALD}66`, color: includeBig ? PLUM : EMERALD }}><Building2 size={11} />{includeBig ? "Including big cos" : "Realistic only"}</button>
        </div>
        <div className="max-h-[150px] overflow-y-auto border rounded-xl" style={{ borderColor: "var(--panel-border)" }}>
          {audience.length === 0 ? <div className="p-3 text-[12px] text-[var(--fg-dimmer)]">No emailable leads yet — find + validate some in the Leads tab.</div> :
            audience.map((l) => (
              <label key={l.id} className="flex items-center gap-2 px-3 py-1.5 text-[12px] cursor-pointer border-b last:border-0 hover:bg-[var(--bg-elev)]" style={{ borderColor: "var(--line-deep)" }}>
                <input type="checkbox" checked={picked.has(l.id)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(l.id); else n.delete(l.id); setPicked(n); }} />
                <span className="text-[var(--fg)]">{l.domain}</span>
                <span className="text-[var(--fg-dimmer)] truncate flex-1"><EmailText value={l.email} /></span>
                <SizeChip size={l.companySize} /><Chip label={l.status} />
              </label>
            ))}
        </div>
        <div className="flex gap-2 items-center">
          <button onClick={() => setPicked(new Set(audience.filter((l) => l.status === "valid").map((l) => l.id)))} className="px-2.5 py-1 rounded-lg border text-[11.5px] text-[var(--fg-dim)]" style={{ borderColor: "var(--panel-border)" }}>Select all valid</button>
          <button onClick={create} disabled={!!busy || !name} className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12.5px] font-medium ml-auto disabled:opacity-40" style={{ background: `${GOLD}22`, color: GOLD_SOFT, boxShadow: `inset 0 0 0 1px ${GOLD}55` }}><Plus size={14} />Create campaign</button>
        </div>
      </div>

      {/* list */}
      <div className="space-y-3">
        {s.campaigns.length === 0 ? <div className="panel p-4"><Empty icon={<Send size={20} />} text="No campaigns yet. Design one on the left." /></div> :
          s.campaigns.map((c) => {
            const sent = s.sendLog.filter((e) => e.campaignId === c.id && e.mode === "sent").length;
            const drafted = s.sendLog.filter((e) => e.campaignId === c.id && e.mode === "draft").length;
            const bounced = s.sendLog.filter((e) => e.campaignId === c.id && e.mode === "bounced").length;
            const archived = c.status === "cancelled" || c.id === "legacy-backlink-june";
            return (
              <div key={c.id} className="panel p-4 space-y-2.5 panel-hover">
                <div className="flex items-center gap-2">
                  <span className="text-[13.5px] text-[var(--fg)] font-semibold flex-1">{c.name}</span>
                  <Chip label={c.status} color={c.status === "active" ? EMERALD : c.status === "cancelled" ? PLUM : c.status === "paused" ? RUST : GOLD} />
                </div>
                <div className="flex items-center gap-3 text-[11px] text-[var(--fg-dim)]">
                  <span className="flex items-center gap-1"><Users size={11} />{c.leadIds.length}</span>
                  <span className="flex items-center gap-1" style={{ color: GOLD_SOFT }}><Send size={11} />{sent} sent</span>
                  <span className="flex items-center gap-1"><FileText size={11} />{drafted} drafts</span>
                  {bounced > 0 && <span className="flex items-center gap-1" style={{ color: PLUM }}><AlertTriangle size={11} />{bounced} bounced</span>}
                </div>
                {c.fromNote && <div className="text-[10.5px] text-[var(--fg-dimmer)] italic">{c.fromNote}</div>}
                {!archived && (
                  <div className="flex gap-1.5 flex-wrap pt-1">
                    <button onClick={() => launch(c.id, "draft")} disabled={!!busy} className="flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11.5px] text-[var(--fg-dim)]" style={{ borderColor: "var(--panel-border)" }}><FileText size={12} />Create drafts</button>
                    <button onClick={() => launch(c.id, "send")} disabled={!!busy} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] font-medium" style={{ background: `${GOLD}22`, color: GOLD_SOFT, boxShadow: `inset 0 0 0 1px ${GOLD}55` }}><Send size={12} />Send batch</button>
                    {c.status === "active"
                      ? <button onClick={() => act({ action: "set_status", id: c.id, status: "paused" }, "pause")} className="flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11.5px]" style={{ borderColor: `${RUST}66`, color: RUST }}><Pause size={12} />Pause</button>
                      : <button onClick={() => act({ action: "set_status", id: c.id, status: "active" }, "resume")} className="flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11.5px]" style={{ borderColor: `${EMERALD}66`, color: EMERALD }}><Play size={12} />Activate</button>}
                    <button onClick={() => act({ action: "delete_campaign", id: c.id }, "del")} className="px-2 py-1 rounded-lg border text-[11.5px] text-[var(--fg-dimmer)]" style={{ borderColor: "var(--panel-border)" }}><Trash2 size={12} /></button>
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

// ─── Inbox ──────────────────────────────────────────────────────────
function InboxView() {
  const [data, setData] = useState<{ source?: string; himalayaActive?: boolean; replies?: { id: string; from: string; subject: string; date: string }[]; bounces?: { id: string; from: string; subject: string; date: string }[] } | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => { setLoading(true); try { const r = await fetch("/api/outreach/inbox", { cache: "no-store" }); setData(await r.json()); } catch { /* */ } setLoading(false); })(); }, []);

  if (loading) return <div className="panel p-6 text-[12.5px] text-[var(--fg-dim)] flex items-center gap-2"><RefreshCw size={14} className="animate-spin" />Reading mailbox…</div>;
  return (
    <div className="space-y-3">
      <div className="panel p-3 text-[11.5px] text-[var(--fg-dim)] flex items-center gap-2 flex-wrap">
        <Inbox size={14} style={{ color: GOLD }} />
        Reading via <strong style={{ color: "var(--fg)" }}>{data?.source === "himalaya" ? "Himalaya (IMAP)" : "gmail_cli (service account)"}</strong>.
        {!data?.himalayaActive && <span className="text-[var(--fg-dimmer)] inline-flex items-center gap-1"><CornerDownRight size={11} />add <code style={{ color: GOLD_SOFT }}>~/.config/himalaya/goldie.pass</code> to switch reads to Himalaya.</span>}
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <Section title="Replies" color={EMERALD} items={data?.replies || []} />
        <Section title="Bounces" color={PLUM} items={data?.bounces || []} />
      </div>
    </div>
  );
}

function Section({ title, color, items }: { title: string; color: string; items: { id: string; from: string; subject: string; date: string }[] }) {
  return (
    <div className="panel p-4">
      <div className="text-[11px] uppercase tracking-widest mb-2.5 flex items-center gap-1.5" style={{ color }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />{title} ({items.length})</div>
      {items.length === 0 ? <div className="text-[12.5px] text-[var(--fg-dimmer)] py-2">None.</div> : (
        <div className="space-y-2">
          {items.map((m) => (
            <div key={m.id} className="rounded-lg px-3 py-2 border" style={{ borderColor: "var(--line-deep)", background: "var(--bg-card)" }}>
              <div className="text-[var(--fg)] text-[12px] truncate">{m.subject || "(no subject)"}</div>
              <div className="text-[var(--fg-dimmer)] text-[11px] truncate"><EmailText value={m.from} /> · {m.date?.slice(0, 16)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sent (who got what) ────────────────────────────────────────────
function SentView({ s }: { s: FullState }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [gmail, setGmail] = useState<{ from: string; subject: string; date: string; id: string }[] | null>(null);
  const [loadingGmail, setLoadingGmail] = useState(false);
  const campName = (id: string) => s.campaigns.find((c) => c.id === id)?.name || "—";

  const log = [...s.sendLog].sort((a, b) => b.at.localeCompare(a.at)).filter((e) => {
    if (!q.trim()) return true;
    const hay = `${e.to} ${e.domain} ${e.subject}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  const pullGmail = async () => {
    setLoadingGmail(true);
    try { const r = await fetch("/api/outreach/inbox?box=sent", { cache: "no-store" }); const j = await r.json(); setGmail(j.sent || []); } catch { setGmail([]); }
    setLoadingGmail(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-1 border rounded-xl px-3" style={{ borderColor: "var(--panel-border)", background: "var(--bg-card)" }}>
          <Search size={15} className="text-[var(--fg-dimmer)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by recipient, domain or subject…" className="flex-1 bg-transparent py-2.5 text-[13px] outline-none" />
        </div>
        <button onClick={pullGmail} disabled={loadingGmail} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[12.5px] text-[var(--fg-dim)]" style={{ borderColor: "var(--panel-border)" }}>
          <Inbox size={14} className={loadingGmail ? "animate-pulse" : ""} />Verify against Gmail Sent
        </button>
      </div>

      <div className="panel p-0 overflow-hidden">
        <div className="px-4 py-2.5 text-[11px] uppercase tracking-widest border-b" style={{ color: GOLD, borderColor: "var(--panel-border)" }}>Send log — {log.length} email(s)</div>
        <div className="max-h-[440px] overflow-y-auto">
          {log.length === 0 ? <Empty icon={<Send size={20} />} text="Nothing sent yet. Launch a campaign and sends will show here — recipient, subject and status." /> : (
            <table className="w-full text-[12px]">
              <thead className="text-[9.5px] uppercase tracking-widest text-[var(--fg-dimmer)] sticky top-0" style={{ background: "var(--bg-card)" }}>
                <tr className="border-b" style={{ borderColor: "var(--panel-border)" }}>
                  <th className="text-left px-4 py-2.5">To</th><th className="text-left px-3 py-2.5">Subject</th><th className="text-left px-3 py-2.5">Campaign</th><th className="text-left px-3 py-2.5">Status</th><th className="text-left px-3 py-2.5">Date</th>
                </tr>
              </thead>
              <tbody>
                {log.map((e) => (
                  <Fragment key={e.id}>
                    <tr onClick={() => setOpen(open === e.id ? null : e.id)} className="border-b hover:bg-[var(--bg-elev)] cursor-pointer transition-colors" style={{ borderColor: "var(--line-deep)" }}>
                      <td className="px-4 py-2.5 text-[var(--fg)]"><EmailText value={e.to} />{e.domain ? <span className="text-[var(--fg-dimmer)]"> · {e.domain}</span> : null}</td>
                      <td className="px-3 py-2.5 text-[var(--fg-dim)] max-w-[240px] truncate">{e.subject || "—"}</td>
                      <td className="px-3 py-2.5 text-[var(--fg-dimmer)] max-w-[160px] truncate">{campName(e.campaignId)}</td>
                      <td className="px-3 py-2.5"><Chip label={e.mode} color={e.mode === "sent" ? GOLD_SOFT : e.mode === "bounced" || e.mode === "failed" ? PLUM : e.mode === "draft" ? GOLD : EMERALD} /></td>
                      <td className="px-3 py-2.5 text-[var(--fg-dimmer)] tabular-nums">{e.at.slice(0, 10)}</td>
                    </tr>
                    {open === e.id && (
                      <tr>
                        <td colSpan={5} className="px-4 py-3" style={{ background: "var(--bg-mid)" }}>
                          <div className="text-[11px] text-[var(--fg-dimmer)] mb-1">{e.detail ? `Note: ${e.detail}` : "Email body:"}</div>
                          <div className="text-[12px] text-[var(--fg-dim)] whitespace-pre-wrap leading-relaxed">{e.body || "(body not stored for this entry)"}</div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {gmail && (
        <div className="panel p-4">
          <div className="text-[11px] uppercase tracking-widest mb-2.5" style={{ color: EMERALD }}>From Gmail Sent folder · {gmail.length}</div>
          {gmail.length === 0 ? <div className="text-[12.5px] text-[var(--fg-dimmer)]">No recent sent mail found.</div> : (
            <div className="space-y-2">
              {gmail.map((m) => (
                <div key={m.id} className="rounded-lg px-3 py-2 border" style={{ borderColor: "var(--line-deep)", background: "var(--bg-card)" }}>
                  <div className="text-[var(--fg)] text-[12px] truncate">{m.subject || "(no subject)"}</div>
                  <div className="text-[var(--fg-dimmer)] text-[11px] truncate"><EmailText value={m.from} /> · {m.date?.slice(0, 16)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Settings (API keys, cap, pause) ────────────────────────────────
interface KeyStatus { configured: boolean; masked: string; source: string }
interface SettingsData { firecrawl: KeyStatus; hunter: KeyStatus; gmail: { ready: boolean; mailbox: string }; himalaya: { ready: boolean }; dailyCap: number; paused: boolean }
function SettingsView({ flash, onChanged }: { flash: (m: string) => void; onChanged: () => void }) {
  const [d, setD] = useState<SettingsData | null>(null);
  const [key, setKey] = useState("");
  const [hkey, setHkey] = useState("");
  const [cap, setCap] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const r = await fetch("/api/outreach/settings", { cache: "no-store" }); const j = await r.json(); setD(j); setCap(String(j.dailyCap ?? 25)); } catch { /* */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (body: Record<string, unknown>, msg: string) => {
    setBusy(true);
    try { await fetch("/api/outreach/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); await load(); onChanged(); flash(msg); }
    finally { setBusy(false); }
  };

  if (!d) return <div className="panel p-6 text-sm text-[var(--fg-dim)]">Loading settings…</div>;

  const StatusRow = ({ ok, label, hint }: { ok: boolean; label: React.ReactNode; hint: string }) => (
    <div className="flex items-center gap-2.5 py-2 border-b last:border-0" style={{ borderColor: "var(--line-deep)" }}>
      {ok ? <CheckCircle2 size={16} style={{ color: EMERALD }} /> : <XCircle size={16} style={{ color: RUST }} />}
      <span className="text-[12.5px] text-[var(--fg)]">{label}</span>
      <span className="text-[11px] text-[var(--fg-dimmer)] ml-auto">{hint}</span>
    </div>
  );

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      {/* API keys */}
      <div className="space-y-4">
      <div className="panel p-4 space-y-3" style={{ boxShadow: `inset 0 0 0 1px ${d.hunter.configured ? EMERALD + "44" : "transparent"}` }}>
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest" style={{ color: GOLD }}><KeyRound size={13} />Hunter.io API key <span className="text-[9px] text-[var(--fg-dimmer)] normal-case tracking-normal">· preferred for find · verify · sizing</span></div>
        <div className="text-[11.5px] text-[var(--fg-dim)]">Real contacts, email verification & true company size. {d.hunter.configured
          ? <span style={{ color: EMERALD }}>Set ({d.hunter.masked}).</span>
          : <span style={{ color: RUST }}>Not set — using Firecrawl scrape only.</span>}</div>
        <div className="flex gap-2">
          <input value={hkey} onChange={(e) => setHkey(e.target.value)} type="password" placeholder="hunter api key…" className="flex-1 bg-[var(--bg-card)] border rounded-xl px-3 py-2 text-[12.5px] outline-none font-mono" style={{ borderColor: "var(--panel-border)" }} />
          <button onClick={() => { if (hkey.trim()) { save({ hunterKey: hkey.trim() }, "Hunter key saved."); setHkey(""); } }} disabled={busy || !hkey.trim()} className="px-3.5 py-2 rounded-xl text-[12.5px] font-medium disabled:opacity-40" style={{ background: `${GOLD}22`, color: GOLD_SOFT, boxShadow: `inset 0 0 0 1px ${GOLD}55` }}>Save key</button>
        </div>
        {d.hunter.configured && (
          <button onClick={() => save({ hunterKey: "" }, "Hunter key removed.")} disabled={busy} className="flex items-center gap-1.5 text-[11.5px] text-[var(--fg-dimmer)]"><X size={12} />Remove key</button>
        )}
      </div>

      <div className="panel p-4 space-y-3">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest" style={{ color: GOLD }}><KeyRound size={13} />Firecrawl API key</div>
        <div className="text-[11.5px] text-[var(--fg-dim)]">Fallback scraper for lead-finding + enrichment. {d.firecrawl.configured
          ? <span style={{ color: EMERALD }}>Set ({d.firecrawl.masked}, from {d.firecrawl.source}).</span>
          : <span style={{ color: RUST }}>Not configured — find/enrich won&apos;t work.</span>}</div>
        <div className="flex gap-2">
          <input value={key} onChange={(e) => setKey(e.target.value)} type="password" placeholder="fc-…" className="flex-1 bg-[var(--bg-card)] border rounded-xl px-3 py-2 text-[12.5px] outline-none font-mono" style={{ borderColor: "var(--panel-border)" }} />
          <button onClick={() => { if (key.trim()) { save({ firecrawlKey: key.trim() }, "API key saved."); setKey(""); } }} disabled={busy || !key.trim()} className="px-3.5 py-2 rounded-xl text-[12.5px] font-medium disabled:opacity-40" style={{ background: `${GOLD}22`, color: GOLD_SOFT, boxShadow: `inset 0 0 0 1px ${GOLD}55` }}>Save key</button>
        </div>
        {d.firecrawl.configured && d.firecrawl.source === "scoped" && (
          <button onClick={() => save({ firecrawlKey: "" }, "Custom key removed — back to default.")} disabled={busy} className="flex items-center gap-1.5 text-[11.5px] text-[var(--fg-dimmer)]"><X size={12} />Remove custom key</button>
        )}
        <div className="text-[10.5px] text-[var(--fg-dimmer)]">Stored at ~/.agentic-os/outreach/config.json (chmod 600) — scoped to this tool, never shown in full.</div>
      </div>
      </div>

      {/* controls + status */}
      <div className="space-y-4">
        <div className="panel p-4 space-y-3">
          <div className="text-[11px] uppercase tracking-widest" style={{ color: GOLD }}>Sending controls</div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[12.5px] text-[var(--fg)]">{d.paused ? "Outreach paused" : "Outreach active"}</div>
              <div className="text-[11px] text-[var(--fg-dimmer)]">{d.paused ? "No real sends will go out." : "Campaigns can send (subject to cap + breaker)."}</div>
            </div>
            <button onClick={() => save({ paused: !d.paused }, d.paused ? "Resumed." : "Paused — sending blocked.")} disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12.5px] font-medium"
              style={{ borderColor: d.paused ? `${EMERALD}66` : `${RUST}66`, color: d.paused ? EMERALD : RUST, background: d.paused ? `${EMERALD}14` : `${RUST}14` }}>
              {d.paused ? <><PlayCircle size={14} />Resume</> : <><PauseCircle size={14} />Pause all</>}
            </button>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[12px] text-[var(--fg-dim)]">Daily send cap</span>
            <input value={cap} onChange={(e) => setCap(e.target.value)} inputMode="numeric" className="w-20 bg-[var(--bg-card)] border rounded-lg px-2.5 py-1.5 text-[12.5px] outline-none" style={{ borderColor: "var(--panel-border)" }} />
            <button onClick={() => save({ dailyCap: Number(cap) }, `Daily cap set to ${cap}.`)} disabled={busy} className="px-3 py-1.5 rounded-lg border text-[12px] text-[var(--fg-dim)]" style={{ borderColor: "var(--panel-border)" }}>Save</button>
          </div>
        </div>

        <div className="panel p-4">
          <div className="text-[11px] uppercase tracking-widest mb-1" style={{ color: GOLD }}>Backends</div>
          <StatusRow ok={d.gmail.ready} label={<span className="flex items-center gap-1">Gmail send · <EmailText value={d.gmail.mailbox} /></span>} hint={d.gmail.ready ? "connected" : "sa-key missing"} />
          <StatusRow ok={d.hunter.configured} label="Hunter.io (find · verify · size)" hint={d.hunter.configured ? "key set" : "no key"} />
          <StatusRow ok={d.himalaya.ready} label="Himalaya inbox read" hint={d.himalaya.ready ? "active" : "add goldie.pass"} />
          <StatusRow ok={d.firecrawl.configured} label="Firecrawl enrichment" hint={d.firecrawl.configured ? "key set" : "no key"} />
        </div>
      </div>
    </div>
  );
}

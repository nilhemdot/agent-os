"use client";

import { useEffect, useState } from "react";
import {
  Users, Target, Search, Sparkles, Loader2, Download, Copy, Check, KeyRound,
  CheckCircle2, AlertCircle, Mail, Building2, MapPin, History as HistoryIcon, ArrowRight, Wand2, ExternalLink,
} from "lucide-react";

// Local copies of the lib types (never import the node lib into a client bundle).
interface ICP {
  brief: string; offer: string; titles: string[]; industries: string[];
  geos: string[]; keywords: string[]; companySize: string; notes: string;
}
interface Lead {
  id: string; name: string; firstName: string; title: string; company: string;
  domain: string; email: string; emailStatus: string; linkedin: string; location: string;
  source: string; score?: number; reason?: string; opener?: string; emailDraft?: string;
}
interface Company { name: string; domain: string }
interface Providers { hunter: boolean; apollo: boolean; model: boolean; modelId: string; hunterHint?: string; apolloHint?: string }
interface LeadRun { ts: number; source: string; brief: string; found: number; fresh: number; scored: number }
type Source = "auto" | "domains" | "csv" | "apollo";

const ACCENT = "#f59e0b";
const KEY_HELP: Record<"hunter" | "apollo", { name: string; url: string; where: string; cost: string }> = {
  hunter: { name: "Hunter.io", url: "https://hunter.io/api-keys", where: "Sign up → API Keys", cost: "Free tier ~25 searches/mo to test, then from ~$34/mo" },
  apollo: { name: "Apollo.io", url: "https://app.apollo.io/#/settings/integrations/api", where: "Settings → Integrations → API", cost: "Paid, from ~$49/mo" },
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string })?.error || `HTTP ${r.status}`);
  return j as T;
}

function scoreColor(s?: number): string {
  if (s == null) return "#64748b";
  if (s >= 75) return "#34d399";
  if (s >= 50) return "#fbbf24";
  return "#f87171";
}

function statusColor(s: string): string {
  if (s === "deliverable" || s === "verified") return "#34d399";
  if (s === "undeliverable") return "#f87171";
  return "#fbbf24"; // risky / guessed / unknown
}

export default function LeadsView() {
  const [providers, setProviders] = useState<Providers | null>(null);
  const [history, setHistory] = useState<LeadRun[]>([]);

  // ICP
  const [brief, setBrief] = useState("");
  const [offer, setOffer] = useState("");
  const [icp, setIcp] = useState<ICP | null>(null);
  const [icpLoading, setIcpLoading] = useState(false);

  // Find
  const [source, setSource] = useState<Source>("auto");
  const [csv, setCsv] = useState("");
  const [domains, setDomains] = useState("");
  const [finding, setFinding] = useState(false);
  const [candidates, setCandidates] = useState<Lead[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [needsHunter, setNeedsHunter] = useState(false);

  // Enrich + score
  const [working, setWorking] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [skipped, setSkipped] = useState(0);

  // Key entry
  const [keyForm, setKeyForm] = useState<"hunter" | "apollo" | null>(null);
  const [keyValue, setKeyValue] = useState("");
  const [savingKey, setSavingKey] = useState(false);

  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  function refreshStatus() {
    return fetch("/api/leads/status").then((r) => r.json()).then((d) => {
      setProviders(d.providers); setHistory(d.history || []); return d.providers as Providers;
    }).catch(() => null);
  }
  useEffect(() => { refreshStatus(); }, []);

  async function copy(text: string, key: string) {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1200); } catch {}
  }

  async function saveKey() {
    if (!keyForm) return;
    setSavingKey(true); setErr(null);
    try {
      const d = await postJson<{ providers: Providers }>("/api/leads/keys", { provider: keyForm, key: keyValue.trim() });
      setProviders(d.providers); setKeyForm(null); setKeyValue("");
      if (keyForm === "hunter") setNeedsHunter(false);
    } catch (e) { setErr((e as Error).message); }
    finally { setSavingKey(false); }
  }

  async function runIcp() {
    setErr(null); setIcpLoading(true);
    try { const d = await postJson<{ icp: ICP }>("/api/leads/icp", { brief, offer }); setIcp(d.icp); }
    catch (e) { setErr((e as Error).message); }
    finally { setIcpLoading(false); }
  }

  async function runFind() {
    setErr(null); setFinding(true); setCandidates([]); setLeads([]); setCompanies([]); setNeedsHunter(false);
    try {
      const d = await postJson<{ leads: Lead[]; count: number; companies?: Company[]; needsHunter?: boolean }>(
        "/api/leads/find", { source, icp, csv, domains });
      setCandidates(d.leads); setCompanies(d.companies || []);
      if (d.needsHunter) { setNeedsHunter(true); return; }
      if (!d.leads.length) setErr("No contacts found. Try a broader description or different domains/CSV.");
    } catch (e) { setErr((e as Error).message); }
    finally { setFinding(false); }
  }

  async function runEnrichScore() {
    setErr(null); setWorking(true);
    try {
      const en = await postJson<{ leads: Lead[]; skipped: number }>("/api/leads/enrich", { leads: candidates });
      setSkipped(en.skipped);
      if (!en.leads.length) { setErr(`All ${en.skipped} lead(s) were already pulled before (deduped).`); setLeads([]); return; }
      const sc = await postJson<{ leads: Lead[] }>("/api/leads/score", { icp, leads: en.leads });
      setLeads(sc.leads); refreshStatus();
    } catch (e) { setErr((e as Error).message); }
    finally { setWorking(false); }
  }

  async function exportCsv() {
    try {
      const r = await fetch("/api/leads/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leads }) });
      if (!r.ok) throw new Error("export failed");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `leads-${leads.length}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setErr((e as Error).message); }
  }

  const canFind =
    source === "auto" ? !!icp :
    source === "domains" ? domains.trim().length > 0 :
    source === "csv" ? csv.trim().length > 0 :
    !!icp && !!providers?.apollo;

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <div className="grid place-items-center w-9 h-9 rounded-xl" style={{ background: "rgba(245,158,11,0.16)" }}>
          <Users size={18} style={{ color: ACCENT }} />
        </div>
        <h1 className="text-xl font-semibold text-white">Leads</h1>
      </div>
      <p className="text-sm text-white/50 mb-5">Find → enrich → score → personalised outreach, in one pass.</p>

      {/* Provider status — click a pill to add a key, in-app */}
      {providers && (
        <div className="flex flex-wrap gap-2 mb-3 text-xs">
          <Pill ok={providers.model} label={providers.model ? `Model: ${providers.modelId}` : "Model: not connected"} />
          <Pill ok={providers.hunter} onClick={() => setKeyForm(keyForm === "hunter" ? null : "hunter")}
            label={providers.hunter ? `Hunter ${providers.hunterHint || "connected"}` : "+ Add Hunter key"} />
          <Pill ok={providers.apollo} dim={!providers.apollo} onClick={() => setKeyForm(keyForm === "apollo" ? null : "apollo")}
            label={providers.apollo ? `Apollo ${providers.apolloHint || "connected"}` : "+ Add Apollo key (paid)"} />
        </div>
      )}

      {/* In-app key entry */}
      {keyForm && (
        <div className="mb-5 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center gap-2 mb-1.5 text-sm font-medium text-white">
            <KeyRound size={15} style={{ color: ACCENT }} /> Connect {KEY_HELP[keyForm].name}
          </div>
          <p className="text-xs text-white/45 mb-2.5">
            {KEY_HELP[keyForm].cost} · get your key: {KEY_HELP[keyForm].where}.{" "}
            <a href={KEY_HELP[keyForm].url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline" style={{ color: "#fcd34d" }}>
              open {KEY_HELP[keyForm].name} <ExternalLink size={11} />
            </a>. Saved on this machine only — never shared.
          </p>
          <div className="flex gap-2">
            <input type="password" value={keyValue} onChange={(e) => setKeyValue(e.target.value)} placeholder="Paste your API key"
              onKeyDown={(e) => { if (e.key === "Enter") saveKey(); }}
              className="flex-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/25 font-mono" />
            <button onClick={saveKey} disabled={savingKey || keyValue.trim().length < 8}
              className="inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium text-black disabled:opacity-40" style={{ background: ACCENT }}>
              {savingKey ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Save
            </button>
          </div>
        </div>
      )}

      {err && (
        <div className="flex items-start gap-2 mb-5 p-3 rounded-lg text-sm" style={{ background: "rgba(248,113,113,0.1)", color: "#fca5a5" }}>
          <AlertCircle size={16} className="mt-0.5 shrink-0" /> <span>{err}</span>
        </div>
      )}

      {/* Step 1 — ICP */}
      <Section n={1} icon={<Target size={15} />} title="Define your ideal customer">
        <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={2}
          placeholder="e.g. Founders of small AI agencies in the US, 2–20 staff, doing client work"
          className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/25" />
        <input value={offer} onChange={(e) => setOffer(e.target.value)}
          placeholder="What you're offering them (e.g. the Agent OS to automate delivery)"
          className="w-full mt-2 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/25" />
        <button onClick={runIcp} disabled={icpLoading || brief.trim().length < 3}
          className="mt-3 inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium text-black disabled:opacity-40"
          style={{ background: ACCENT }}>
          {icpLoading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Parse ICP
        </button>
        {icp && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {[...icp.titles, ...icp.keywords].slice(0, 18).map((t, i) => (
              <span key={i} className="px-2 py-0.5 rounded-md text-xs border" style={{ background: "rgba(245,158,11,0.1)", color: "#fcd34d", borderColor: "rgba(245,158,11,0.25)" }}>{t}</span>
            ))}
            {icp.companySize && <span className="px-2 py-0.5 rounded-md text-xs border border-white/15 text-white/60">size: {icp.companySize}</span>}
          </div>
        )}
      </Section>

      {/* Step 2 — Find */}
      <Section n={2} icon={<Search size={15} />} title="Find candidates">
        <div className="flex flex-wrap gap-2 mb-3">
          {([
            ["auto", "✨ AI find (no list needed)"],
            ["domains", "Company domains"],
            ["csv", "Paste CSV"],
            ["apollo", "Apollo search"],
          ] as [Source, string][]).map(([s, label]) => (
            <button key={s} onClick={() => setSource(s)} disabled={s === "apollo" && !providers?.apollo}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border disabled:opacity-30"
              style={source === s ? { background: "rgba(245,158,11,0.15)", color: "#fcd34d", borderColor: "rgba(245,158,11,0.4)" } : { background: "transparent", color: "rgba(255,255,255,0.55)", borderColor: "rgba(255,255,255,0.12)" }}>
              {label}
            </button>
          ))}
        </div>
        {source === "auto" && (
          <div className="rounded-lg bg-white/[0.03] border border-white/8 p-3 text-sm text-white/55">
            <div className="flex items-center gap-1.5 text-white/80 font-medium mb-1"><Wand2 size={14} style={{ color: ACCENT }} /> Describe → discover</div>
            AI finds real companies matching your ICP above (free), then {providers?.hunter ? "Hunter pulls verified contacts." : "a connected provider pulls verified contacts (Hunter has a free tier to test)."} No list required.
            {!icp && <span className="block mt-1 text-amber-300/80">Parse your ICP in step 1 first.</span>}
          </div>
        )}
        {source === "domains" && (
          <textarea value={domains} onChange={(e) => setDomains(e.target.value)} rows={3}
            placeholder={"stripe.com\nvercel.com\nlinear.app   (one per line — Hunter returns people + emails)"}
            className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/25 font-mono" />
        )}
        {source === "csv" && (
          <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={4}
            placeholder={"name,company,domain,title,email\nJane Doe,Acme,acme.com,Founder,"}
            className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/25 font-mono" />
        )}
        {source === "apollo" && (
          <p className="text-sm text-white/50">Searches Apollo from your ICP above for net-new people.</p>
        )}
        <button onClick={runFind} disabled={finding || !canFind}
          className="mt-3 inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium text-black disabled:opacity-40"
          style={{ background: ACCENT }}>
          {finding ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Find leads
        </button>

        {/* AI-suggested companies */}
        {companies.length > 0 && (
          <div className="mt-3">
            <div className="text-xs text-white/40 mb-1.5">{companies.length} companies matched{candidates.length ? ` · ${candidates.length} contacts pulled` : ""}:</div>
            <div className="flex flex-wrap gap-1.5">
              {companies.map((c, i) => (
                <span key={i} className="px-2 py-0.5 rounded-md text-xs border border-white/12 text-white/55">{c.name}</span>
              ))}
            </div>
          </div>
        )}
        {needsHunter && (
          <div className="mt-3 flex items-center gap-2 text-sm rounded-lg p-2.5" style={{ background: "rgba(245,158,11,0.1)", color: "#fcd34d" }}>
            <AlertCircle size={15} /> Found {companies.length} companies — add a Hunter key to pull their contacts (free tier ~25/mo to test).
            <button onClick={() => setKeyForm("hunter")} className="ml-auto inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-black" style={{ background: ACCENT }}>
              <KeyRound size={12} /> Add key
            </button>
          </div>
        )}
        {candidates.length > 0 && (
          <div className="mt-3 flex items-center gap-2 text-sm text-white/60">
            <CheckCircle2 size={15} style={{ color: "#34d399" }} /> {candidates.length} candidate{candidates.length > 1 ? "s" : ""} ready
            <ArrowRight size={14} /> enrich &amp; score below
          </div>
        )}
      </Section>

      {/* Step 3 — Enrich + Score */}
      <Section n={3} icon={<Sparkles size={15} />} title="Enrich, dedupe & write outreach">
        <button onClick={runEnrichScore} disabled={working || candidates.length === 0}
          className="inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium text-black disabled:opacity-40"
          style={{ background: ACCENT }}>
          {working ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Enrich &amp; score {candidates.length || ""}
        </button>
        {skipped > 0 && <span className="ml-3 text-xs text-white/40">{skipped} duplicate(s) skipped</span>}
      </Section>

      {/* Results */}
      {leads.length > 0 && (
        <div className="mt-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white/80">{leads.length} scored lead{leads.length > 1 ? "s" : ""}</h2>
            <button onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-white/15 text-white/70 hover:bg-white/5">
              <Download size={14} /> Export CSV
            </button>
          </div>
          <div className="space-y-2">
            {leads.map((l) => (
              <div key={l.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                <div className="flex items-start gap-3">
                  <div className="grid place-items-center w-9 h-9 rounded-full text-xs font-bold shrink-0"
                    style={{ background: `${scoreColor(l.score)}22`, color: scoreColor(l.score) }}>{l.score ?? "–"}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-white">{l.name || "(no name)"}</span>
                      {l.title && <span className="text-xs text-white/50">{l.title}</span>}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-white/45 flex-wrap">
                      {l.company && <span className="inline-flex items-center gap-1"><Building2 size={12} />{l.company}</span>}
                      {l.email && <span className="inline-flex items-center gap-1"><Mail size={12} />{l.email}
                        <em className="not-italic" style={{ color: statusColor(l.emailStatus) }}>· {l.emailStatus || "?"}</em></span>}
                      {l.location && <span className="inline-flex items-center gap-1"><MapPin size={12} />{l.location}</span>}
                    </div>
                    {l.reason && <p className="mt-1.5 text-xs text-white/50 italic">{l.reason}</p>}
                    {l.opener && (
                      <div className="mt-2 rounded-lg bg-white/[0.04] border border-white/8 p-2.5">
                        <p className="text-sm text-white/80">{l.opener}</p>
                        {l.emailDraft && <p className="mt-2 text-xs text-white/55 whitespace-pre-wrap">{l.emailDraft}</p>}
                        <button onClick={() => copy(`${l.opener}\n\n${l.emailDraft || ""}`.trim(), l.id)}
                          className="mt-2 inline-flex items-center gap-1 text-xs text-white/50 hover:text-white">
                          {copied === l.id ? <Check size={12} style={{ color: "#34d399" }} /> : <Copy size={12} />} {copied === l.id ? "Copied" : "Copy outreach"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-white/40 uppercase tracking-wide">
            <HistoryIcon size={13} /> Recent runs
          </div>
          <div className="space-y-1">
            {history.slice(0, 6).map((h, i) => (
              <div key={i} className="flex items-center justify-between text-xs text-white/45 px-1 py-1.5 border-b border-white/5">
                <span className="truncate max-w-[60%]">{h.brief || "(no brief)"}</span>
                <span>{h.scored} scored · {h.source} · {new Date(h.ts).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Pill({ ok, label, dim, onClick }: { ok: boolean; label: string; dim?: boolean; onClick?: () => void }) {
  const style = ok
    ? { background: "rgba(52,211,153,0.12)", color: "#6ee7b7", borderColor: "rgba(52,211,153,0.3)" }
    : { background: dim ? "transparent" : "rgba(245,158,11,0.1)", color: dim ? "rgba(255,255,255,0.5)" : "#fcd34d", borderColor: "rgba(245,158,11,0.25)" };
  const Tag = onClick ? "button" : "span";
  return (
    <Tag onClick={onClick} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${onClick ? "hover:brightness-125 cursor-pointer" : ""}`} style={style}>
      {ok ? <CheckCircle2 size={12} /> : <KeyRound size={12} />} {label}
    </Tag>
  );
}

function Section({ n, icon, title, children }: { n: number; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 rounded-xl border border-white/8 bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="grid place-items-center w-5 h-5 rounded-full text-[11px] font-bold text-black" style={{ background: "#f59e0b" }}>{n}</span>
        <span className="text-white/40">{icon}</span>
        <h2 className="text-sm font-semibold text-white/85">{title}</h2>
      </div>
      {children}
    </div>
  );
}

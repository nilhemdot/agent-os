"use client";

// Ruflo — live swarm node-graph. Fire an SEO mission; agents register and fan
// out from the swarm core as labelled nodes, edges connect them, status drives
// colour (idle → working gold pulse → green). Polls Ruflo's JSON state while
// active. This is the "watch the swarm assemble" money shot.

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Network, Rocket, RefreshCw, Loader2, Users, Cpu, GitBranch, AlertCircle, Zap } from "lucide-react";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";

const GOLD = "#d4a574", PINK = "#f472b6", BLUE = "#60a5fa", EMERALD = "#5ab896", PLUM = "#c4607e", MUTE = "#a59783";

interface Agent { id: string; type: string; name?: string; status: string; health: number; taskCount: number; model?: string; domain?: string; createdAt?: string; }
interface Swarm { id: string; topology: string; maxAgents: number; status: string; strategy?: string; createdAt?: string; updatedAt?: string; }
interface State { installed: boolean; swarm: Swarm | null; agents: Agent[]; activity: { active: boolean; agentCount: number; coordinationActive: boolean } | null; }

function roleColor(s: string): string {
  const x = s.toLowerCase();
  if (/review|qa|audit/.test(x)) return PINK;
  if (/research|keyword|intent|serp|backlink/.test(x)) return BLUE;
  if (/seo|optim|schema|link/.test(x)) return GOLD;
  if (/architect|content/.test(x)) return PLUM;
  if (/front|web-vital|coder|dev/.test(x)) return EMERALD;
  return MUTE;
}
function statusColor(s: string): string {
  const x = s.toLowerCase();
  if (/complet|done|success/.test(x)) return EMERALD;
  if (/active|busy|running|working/.test(x)) return GOLD;
  if (/fail|error/.test(x)) return PLUM;
  return MUTE; // idle
}
function modelRing(m?: string): number { return m === "opus" ? 3 : m === "sonnet" ? 2 : 1; }

export default function RufloView() {
  const [state, setState] = useState<State | null>(null);
  const [objective, setObjective] = useState("Build a complete SEO strategy + content plan for an AI SaaS");
  const [launching, setLaunching] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const r = await fetch("/api/ruflo/swarm", { cache: "no-store" }); setState(await r.json()); }
    catch { /* ignore */ }
  }, []);
  usePollWhileVisible(load, 3000);

  async function launch() {
    if (launching || !objective.trim()) return;
    setLaunching(true); setNote("Initialising swarm + spawning agents…");
    try {
      const r = await fetch("/api/ruflo/swarm", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ objective }),
      });
      const j = await r.json();
      setNote(j.ok ? `Swarm live — ${j.spawned} agents spawned. Watch them fan out below.` : `Launched with ${j.spawned} agents (${(j.errors||[]).length} warnings).`);
      await load();
    } catch (e) { setNote(`Launch failed: ${e}`); }
    finally { setLaunching(false); setTimeout(load, 1500); }
  }

  const agents = state?.agents ?? [];
  const sw = state?.swarm;
  const active = agents.filter(a => /active|busy|working/.test(a.status)).length;
  const done = agents.filter(a => /complet|done|success/.test(a.status)).length;

  return (
    <div className="space-y-4">
      {/* Banner + launcher */}
      <div className="relative overflow-hidden rounded-xl border p-4"
           style={{ borderColor: `${GOLD}33`, background: `linear-gradient(135deg, ${GOLD}10, ${BLUE}08, transparent)` }}>
        <div className="flex items-start gap-3 mb-3">
          <div className="grid place-items-center w-10 h-10 rounded-lg" style={{ background: `${GOLD}1a`, color: GOLD, border: `1px solid ${GOLD}40` }}>
            <Network size={18} />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.25em] mb-1" style={{ color: GOLD }}>Ruflo · Multi-Agent Swarm</div>
            <div className="text-[18px] font-semibold text-[var(--cream)] mb-1">Fire a swarm. Watch it fan out.</div>
            <div className="text-[12.5px] text-[var(--cream-mute)] max-w-[680px] leading-snug">
              Launch a Ruflo SEO mission — specialised agents register and spread out from the swarm core as a live node graph. Each node is a real Ruflo agent (keyword research, competitor analysis, technical audit…), coloured by role and lit by status.
            </div>
          </div>
        </div>
        {state && !state.installed && (
          <div className="flex items-center gap-2 text-[12px] p-2.5 rounded-md border mb-2" style={{ borderColor: PLUM, background: "rgba(196,96,126,0.08)", color: "var(--cream)" }}>
            <AlertCircle size={14} /> Ruflo not detected at ~/.claude-flow — run <code className="mono">npx ruflo@latest init</code>.
          </div>
        )}
        <div className="flex items-center gap-2">
          <input value={objective} onChange={(e) => setObjective(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !launching) launch(); }}
            placeholder="Mission objective…"
            className="flex-1 px-3 py-2 text-[12.5px] rounded-md border bg-transparent text-[var(--cream)] placeholder:text-[var(--cream-mute)]"
            style={{ borderColor: "var(--line-soft)" }} />
          <button onClick={launch} disabled={launching || !objective.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-md text-[12px] uppercase tracking-widest font-semibold transition disabled:opacity-40"
            style={{ color: GOLD, border: `1px solid ${GOLD}`, background: `${GOLD}1a` }}>
            {launching ? <Loader2 size={13} className="animate-spin" /> : <Rocket size={13} />} Launch swarm
          </button>
          <button onClick={load} title="Refresh" className="p-2 text-[var(--cream-mute)] hover:text-[var(--cream)]"><RefreshCw size={14} /></button>
        </div>
        {note && <div className="text-[11px] mt-2" style={{ color: GOLD }}>{note}</div>}
      </div>

      {/* Stats */}
      <div className="flex items-center gap-2 flex-wrap">
        <Stat icon={<GitBranch size={11} />} label="topology" value={sw?.topology ?? "—"} color={GOLD} />
        <Stat icon={<Users size={11} />} label="agents" value={String(agents.length)} color={BLUE} />
        {active > 0 && <Stat icon={<Loader2 size={11} className="animate-spin" />} label="active" value={String(active)} color={GOLD} />}
        {done > 0 && <Stat icon={<Zap size={11} />} label="done" value={String(done)} color={EMERALD} />}
        <Stat icon={<Cpu size={11} />} label="swarm" value={sw?.status ?? "—"} color={sw?.status === "running" ? EMERALD : MUTE} />
      </div>

      {/* The graph */}
      <div className="panel p-0 overflow-hidden" style={{ minHeight: 540, background: "radial-gradient(ellipse at center, rgba(212,165,116,0.05), #0a070d)" }}>
        {agents.length === 0 ? (
          <div className="h-[540px] grid place-items-center text-center p-6">
            <div>
              <Network size={24} style={{ color: GOLD }} className="mx-auto mb-2 opacity-60" />
              <div className="text-[13px] text-[var(--cream)] mb-1">No agents in the swarm yet</div>
              <div className="text-[11px] text-[var(--cream-mute)]">Hit <strong style={{ color: GOLD }}>Launch swarm</strong> and watch the team fan out.</div>
            </div>
          </div>
        ) : (
          <SwarmGraph swarm={sw ?? null} agents={agents} />
        )}
      </div>
    </div>
  );
}

function Stat({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md" style={{ background: `${color}10`, border: `1px solid ${color}30` }}>
      <span style={{ color }}>{icon}</span>
      <span className="text-[12px] mono font-semibold text-[var(--cream)]">{value}</span>
      <span className="text-[9px] uppercase tracking-widest text-[var(--cream-mute)]">{label}</span>
    </div>
  );
}

function SwarmGraph({ swarm, agents }: { swarm: Swarm | null; agents: Agent[] }) {
  const W = 900, H = 540, cx = W / 2, cy = H / 2;
  const n = agents.length;
  // up to two rings
  const split = n > 8 ? Math.ceil(n / 2) : n;
  const pos = agents.map((a, i) => {
    const ring = i < split ? 0 : 1;
    const inRing = ring === 0 ? i : i - split;
    const count = ring === 0 ? split : n - split;
    const radius = ring === 0 ? 175 : 105;
    const ang = (inRing / Math.max(count, 1)) * Math.PI * 2 - Math.PI / 2 + (ring === 1 ? Math.PI / Math.max(count, 1) : 0);
    return { x: cx + Math.cos(ang) * radius, y: cy + Math.sin(ang) * radius };
  });
  const nodeR = (a: Agent) => 13 + modelRing(a.model) * 2 + Math.min(8, a.taskCount * 2);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      {/* edges core→agent */}
      {pos.map((p, i) => {
        const c = roleColor(agents[i].name ?? agents[i].type);
        return <motion.line key={`e${agents[i].id}`} x1={cx} y1={cy} x2={p.x} y2={p.y}
          stroke={c} strokeWidth={1.2} strokeOpacity={0.3}
          initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.5, delay: i * 0.04 }} />;
      })}
      {/* swarm core */}
      <circle cx={cx} cy={cy} r={30} fill={`${GOLD}22`} stroke={GOLD} strokeWidth={2} />
      <text x={cx} y={cy - 2} textAnchor="middle" fontSize="13" fontWeight="800" fill={GOLD}>RUFLO</text>
      <text x={cx} y={cy + 12} textAnchor="middle" fontSize="8" fill={MUTE}>{swarm?.topology ?? "swarm"}</text>
      {swarm?.status === "running" && (
        <circle cx={cx} cy={cy} r={30} fill="none" stroke={GOLD} strokeWidth={1.5} opacity={0.5}>
          <animate attributeName="r" values="30;46;30" dur="2.2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.5;0;0.5" dur="2.2s" repeatCount="indefinite" />
        </circle>
      )}
      {/* agent nodes */}
      {pos.map((p, i) => {
        const a = agents[i];
        const rc = roleColor(a.name ?? a.type);
        const sc = statusColor(a.status);
        const r = nodeR(a);
        const label = (a.name ?? a.type).replace(/-/g, " ");
        const lab = label.length > 18 ? label.slice(0, 17) + "…" : label;
        const working = /active|busy|working/.test(a.status.toLowerCase());
        const done = /complet|done|success/.test(a.status.toLowerCase());
        return (
          <motion.g key={`n${a.id}`} initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 16, delay: i * 0.05 }} style={{ transformOrigin: `${p.x}px ${p.y}px` }}>
            <circle cx={p.x} cy={p.y} r={r + 4} fill="none" stroke={rc} strokeWidth={1} strokeOpacity={0.45} />
            <circle cx={p.x} cy={p.y} r={r} fill={`${sc}26`} stroke={sc} strokeWidth={2} />
            {working && (
              <circle cx={p.x} cy={p.y} r={r} fill="none" stroke={sc} strokeWidth={1.5}>
                <animate attributeName="r" values={`${r};${r + 11};${r}`} dur="1.3s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.7;0;0.7" dur="1.3s" repeatCount="indefinite" />
              </circle>
            )}
            {done && <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="13" fill={sc}>✓</text>}
            <text x={p.x} y={p.y + r + 13} textAnchor="middle" fontSize="9.5" fill="#f3ebda">{lab}</text>
            <text x={p.x} y={p.y + r + 24} textAnchor="middle" fontSize="8" fill={MUTE}>{a.type}{a.model ? ` · ${a.model}` : ""}</text>
          </motion.g>
        );
      })}
    </svg>
  );
}

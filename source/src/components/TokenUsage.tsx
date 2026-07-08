"use client";

import { useEffect, useState } from "react";
import { Coins, RefreshCw } from "lucide-react";

interface AgentUsage {
  agent: string; calls: number; promptTokens: number; completionTokens: number;
  totalTokens: number; costUsd: number; todayTokens: number; models: string[]; lastTs: number;
}
interface Summary {
  agents: AgentUsage[];
  grand: { calls: number; promptTokens: number; completionTokens: number; totalTokens: number; costUsd: number; todayTokens: number };
  generatedAt: number;
}

// Per-agent accent (mirrors AgentAvatar). Anything unknown falls back to gold.
const COLOR: Record<string, string> = {
  claude: "#d97757", openclaw: "#f472b6", hermes: "#60a5fa", gemini: "#4285F4",
  antigravity: "#7c3aed", freeclaude: "#10b981", codex: "#22c55e", jarvis: "#e6c69a", n2: "#7c5cff",
};
const LABEL: Record<string, string> = {
  claude: "Claude", openclaw: "OpenClaw", hermes: "Hermes", gemini: "Gemini",
  antigravity: "Antigravity", freeclaude: "Free Claude · N2", codex: "Codex", jarvis: "Jarvis",
};
function col(a: string) { return COLOR[a] ?? "#d4a574"; }
function label(a: string) { return LABEL[a] ?? (a.charAt(0).toUpperCase() + a.slice(1)); }
function fmt(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
}
function cost(n: number): string {
  if (!n) return "free";
  if (n < 0.01) return "<$0.01";
  return "$" + n.toFixed(2);
}

export default function TokenUsage() {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => fetch("/api/tokens", { cache: "no-store" })
    .then((r) => r.json()).then((j) => { setData(j); setLoading(false); })
    .catch(() => setLoading(false));

  useEffect(() => { load(); const t = setInterval(load, 12000); return () => clearInterval(t); }, []);

  const agents = data?.agents ?? [];
  const max = Math.max(1, ...agents.map((a) => a.totalTokens));
  const g = data?.grand;

  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Coins size={16} style={{ color: "var(--gold)" }} />
          <h3 className="text-[15px] font-semibold text-[var(--cream)]">Token Usage</h3>
          <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--cream-mute)]">per agent</span>
        </div>
        <button onClick={load} className="text-[var(--cream-mute)] hover:text-[var(--cream)]" title="Refresh">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* totals row */}
      <div className="grid grid-cols-3 gap-2 my-3">
        <div className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--line-soft)" }}>
          <div className="text-[18px] font-semibold text-[var(--cream)] font-[var(--font-bricolage,inherit)]">{g ? fmt(g.totalTokens) : "—"}</div>
          <div className="text-[10px] uppercase tracking-widest text-[var(--cream-mute)]">total tokens</div>
        </div>
        <div className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--line-soft)" }}>
          <div className="text-[18px] font-semibold text-[var(--cream)]">{g ? fmt(g.todayTokens) : "—"}</div>
          <div className="text-[10px] uppercase tracking-widest text-[var(--cream-mute)]">today</div>
        </div>
        <div className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--line-soft)" }}>
          <div className="text-[18px] font-semibold" style={{ color: g && g.costUsd > 0 ? "var(--gold)" : "var(--emerald)" }}>{g ? cost(g.costUsd) : "—"}</div>
          <div className="text-[10px] uppercase tracking-widest text-[var(--cream-mute)]">spend</div>
        </div>
      </div>

      {/* per-agent bars */}
      <div className="space-y-2.5">
        {agents.length === 0 && (
          <div className="text-[12.5px] text-[var(--cream-mute)] py-3 text-center">
            No usage recorded yet. Chat with Claude, talk to Hermes, or build with N2 and it shows up here.
          </div>
        )}
        {agents.map((a) => (
          <div key={a.agent}>
            <div className="flex items-center justify-between text-[12px] mb-1">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: col(a.agent), boxShadow: `0 0 7px ${col(a.agent)}` }} />
                <span className="text-[var(--cream)] font-medium">{label(a.agent)}</span>
                <span className="text-[var(--cream-mute)] text-[10.5px]">· {a.calls} call{a.calls === 1 ? "" : "s"}</span>
              </div>
              <div className="flex items-center gap-2.5 text-[11px]">
                <span className="text-[var(--cream-soft)] font-medium">{fmt(a.totalTokens)} tok</span>
                <span style={{ color: a.costUsd > 0 ? "var(--gold)" : "var(--emerald)" }}>{cost(a.costUsd)}</span>
              </div>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
              <div className="h-full rounded-full" style={{ width: `${(a.totalTokens / max) * 100}%`, background: col(a.agent), opacity: 0.9 }} />
            </div>
          </div>
        ))}
      </div>

      <div className="text-[10.5px] text-[var(--cream-mute)] mt-3 leading-relaxed">
        Tracked where the model reports it: Claude, Hermes voice (MiniMax), Free Claude (N2). OpenClaw, Antigravity & the Hermes chat CLI don&apos;t expose token counts, so they stay off this chart rather than show guesses.
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Box, MessageSquare, Terminal, Layers, Sparkles } from "lucide-react";
import AgentRoom from "@/components/AgentRoom";
import UnifiedChat from "@/components/UnifiedChat";
import OpenClawWorkspace from "@/components/OpenClawWorkspace";
import OpenClawStudio from "@/components/OpenClawStudio";

type OcTab = "chat" | "studio" | "workspace" | "control";
interface OcVitals { ok: boolean; gateway: string; degraded: boolean; busy?: boolean; agents: string[]; sessions: number; }

export default function OpenClawRoute() {
  const [tab, setTab] = useState<OcTab>("chat");
  const [v, setV] = useState<OcVitals | null>(null);

  useEffect(() => {
    let stop = false;
    const fetchIt = async () => {
      try {
        const r = await fetch("/api/vitals", { cache: "no-store" });
        const j = await r.json();
        if (!stop) setV(j.openclaw);
      } catch { /* ignore */ }
    };
    fetchIt();
    const t = setInterval(fetchIt, 8000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        {([
          { key: "chat",      label: "Chat",         icon: <MessageSquare size={14} /> },
          { key: "studio",    label: "Studio",       icon: <Sparkles size={14} /> },
          { key: "workspace", label: "Workspace",    icon: <Layers size={14} /> },
          { key: "control",   label: "Control Room", icon: <Terminal size={14} /> },
        ] as { key: OcTab; label: string; icon: React.ReactNode }[]).map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-[12.5px] transition"
              style={{
                background: active ? "rgba(244,114,182,0.16)" : "transparent",
                borderColor: active ? "#f472b6" : "var(--panel-border)",
                color: active ? "var(--fg)" : "var(--fg-dim)",
              }}
            >
              {t.icon}{t.label}
            </button>
          );
        })}
      </div>

      {tab === "chat" ? (
        <UnifiedChat defaultAgent="openclaw" showAgentSwitcher={false} />
      ) : tab === "studio" ? (
        <OpenClawStudio />
      ) : tab === "workspace" ? (
        <OpenClawWorkspace />
      ) : (
        <AgentRoom
          agent="openclaw"
          accent="#f472b6"
          accentDim="rgba(244,114,182,0.12)"
          defaultTab="health"
          tabs={[
            { key: "health",  label: "Health",   action: "health",  hint: "gateway" },
            { key: "agents",  label: "Agents",   action: "agents",  hint: "list" },
            { key: "doctor",  label: "Doctor",   action: "doctor",  hint: "diag" },
            { key: "logs",    label: "Logs",     action: "logs",    hint: "tail" },
            { key: "cron",    label: "Cron",     action: "cron",    hint: "scheduler" },
            { key: "memory",  label: "Memory",   action: "memory",  hint: "store" },
          ]}
          vitals={
            v ? (
              <div className="panel p-4 space-y-3">
                <div className="flex items-center gap-2.5">
                  <div className="grid place-items-center w-10 h-10 rounded-xl"
                    style={{ background: "rgba(244,114,182,0.18)", color: "#f472b6", boxShadow: "0 0 22px -8px #f472b6" }}>
                    <Box size={18} />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">Gateway</div>
                    <div className="text-sm font-medium" style={{ color: "#f472b6" }}>
                      {v.degraded ? "Degraded" : v.busy ? "Busy" : v.ok ? "Nominal" : "Down"}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-[var(--panel-border)] px-2.5 py-1.5">
                    <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">Agents</div>
                    <div className="metric text-base">{v.agents.length}</div>
                  </div>
                  <div className="rounded-lg border border-[var(--panel-border)] px-2.5 py-1.5">
                    <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">Sessions</div>
                    <div className="metric text-base">{v.sessions}</div>
                  </div>
                </div>
                <div className="text-[11px] text-[var(--fg-dim)] leading-relaxed">
                  {v.agents.map((a) => (
                    <span key={a} className="inline-block mr-1 mb-1 px-2 py-0.5 rounded-md bg-[rgba(244,114,182,0.08)] border border-[rgba(244,114,182,0.18)]">
                      {a}
                    </span>
                  ))}
                </div>
              </div>
            ) : null
          }
        />
      )}
    </div>
  );
}

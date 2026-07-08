"use client";

import { useEffect, useState } from "react";
import { Cpu, MessageSquare, Terminal, Layers, Target, Plug, Sparkles, History, AudioLines, LayoutDashboard, Mic, Radar, Mail, Boxes} from "lucide-react";
import AgentRoom from "@/components/AgentRoom";
import HermesOutreach from "@/components/HermesOutreach";
import HermesMoA from "@/components/HermesMoA";
import RadarView from "@/components/RadarView";
import UnifiedChat from "@/components/UnifiedChat";
import HermesWorkspace from "@/components/HermesWorkspace";
import HermesGoals from "@/components/HermesGoals";
import HermesMCPCatalog from "@/components/HermesMCPCatalog";
import HermesStudio from "@/components/HermesStudio";
import MiniMaxVoiceAgent from "@/components/MiniMaxVoiceAgent";
import HermesManage from "@/components/HermesManage";
// Phone tab intentionally NOT mounted in the dashboard — the phone agent runs
// standalone (see ~/.agentic-os/phone-go-live.sh). Component kept on disk.
// import HermesPhone from "@/components/HermesPhone";
import JarvisView from "@/components/JarvisView";

type HermesTab = "chat" | "radar" | "talk" | "jarvis" | "studio" | "sessions" | "goals" | "workspace" | "mcps" | "manage" | "control" | "outreach" | "moa";
interface HmVitals { ok: boolean; model: string; provider: string; }


export default function HermesRoute() {
  const [tab, setTab] = useState<HermesTab>("chat");
  const [v, setV] = useState<HmVitals | null>(null);

  // Deep-link: /hermes?tab=manage opens that sub-tab directly.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab") as HermesTab | null;
    const valid: HermesTab[] = ["chat", "radar", "talk", "jarvis", "studio", "sessions", "goals", "workspace", "mcps", "manage", "control", "outreach", "moa"];
    if (t && valid.includes(t)) setTab(t);
  }, []);

  useEffect(() => {
    let stop = false;
    const fetchIt = async () => {
      try {
        const r = await fetch("/api/vitals", { cache: "no-store" });
        const j = await r.json();
        if (!stop) setV(j.hermes);
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
          { key: "talk",      label: "Talk",         icon: <AudioLines size={14} /> },
          { key: "jarvis",    label: "Hermes-Jarvis", icon: <Mic size={14} /> },
          { key: "radar",     label: "Hermes Oracle", icon: <Radar size={14} /> },
          { key: "studio",    label: "Studio",       icon: <Sparkles size={14} /> },
          { key: "sessions",  label: "Sessions",     icon: <History size={14} /> },
          { key: "outreach",  label: "Outreach",     icon: <Mail size={14} /> },
          { key: "moa",       label: "Mixture",      icon: <Boxes size={14} /> },
          { key: "workspace", label: "Workspace",    icon: <Layers size={14} /> },
          { key: "mcps",      label: "MCPs",         icon: <Plug size={14} /> },
          { key: "manage",    label: "Manage",       icon: <LayoutDashboard size={14} /> },
          { key: "control",   label: "Control Room", icon: <Terminal size={14} /> },
          { key: "goals",     label: "Goal Mode",    icon: <Target size={14} /> },
        ] as { key: HermesTab; label: string; icon: React.ReactNode }[]).map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-[12.5px] transition"
              style={{
                background: active ? "rgba(96,165,250,0.16)" : "transparent",
                borderColor: active ? "#60a5fa" : "var(--panel-border)",
                color: active ? "var(--fg)" : "var(--fg-dim)",
              }}
            >
              {t.icon}{t.label}
            </button>
          );
        })}
      </div>

      {tab === "chat" ? (
        <UnifiedChat defaultAgent="hermes" showAgentSwitcher={false} />
      ) : tab === "radar" ? (
        <RadarView />
      ) : tab === "talk" ? (
        <MiniMaxVoiceAgent accent="#60a5fa" />
      ) : tab === "jarvis" ? (
        <JarvisView />
      ) : tab === "studio" ? (
        <HermesStudio />
      ) : tab === "goals" ? (
        <HermesGoals />
      ) : tab === "outreach" ? (
        <HermesOutreach />
      ) : tab === "moa" ? (
        <HermesMoA />
      ) : tab === "workspace" ? (
        <HermesWorkspace />
      ) : tab === "mcps" ? (
        <HermesMCPCatalog />
      ) : tab === "manage" ? (
        <HermesManage />
      ) : (
        <AgentRoom
          key={tab}
          agent="hermes"
          accent="#60a5fa"
          accentDim="rgba(96,165,250,0.12)"
          defaultTab={tab === "sessions" ? "sessions" : "status"}
          tabs={[
            { key: "status",   label: "Status",   action: "status",   hint: "env" },
            { key: "sessions", label: "Sessions", action: "sessions", hint: "history" },
            { key: "skills",   label: "Skills",   action: "skills",   hint: "installed" },
            { key: "plugins",  label: "Plugins",  action: "plugins",  hint: "marketplace" },
            { key: "kanban",   label: "Kanban",   action: "kanban",   hint: "tasks" },
            { key: "doctor",   label: "Doctor",   action: "doctor",   hint: "check" },
            { key: "insights", label: "Insights", action: "insights", hint: "analytics" },
          ]}
          vitals={
            v ? (
              <div className="panel p-4 space-y-3">
                <div className="flex items-center gap-2.5">
                  <div className="grid place-items-center w-10 h-10 rounded-xl"
                    style={{ background: "rgba(96,165,250,0.18)", color: "#60a5fa", boxShadow: "0 0 22px -8px #60a5fa" }}>
                    <Cpu size={18} />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">State</div>
                    <div className="text-sm font-medium" style={{ color: "#60a5fa" }}>{v.ok ? "Online" : "Offline"}</div>
                  </div>
                </div>
                <div className="rounded-lg border border-[var(--panel-border)] px-2.5 py-2">
                  <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">Model</div>
                  <div className="metric text-sm truncate">{v.model}</div>
                </div>
                <div className="rounded-lg border border-[var(--panel-border)] px-2.5 py-2">
                  <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">Provider</div>
                  <div className="metric text-sm truncate">{v.provider}</div>
                </div>
              </div>
            ) : null
          }
        />
      )}
    </div>
  );
}

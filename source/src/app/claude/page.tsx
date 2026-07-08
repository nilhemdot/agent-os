"use client";

import { useState } from "react";
import { MessageSquare, Layers, Zap, Terminal, Cpu, Share2 } from "lucide-react";
import UnifiedChat from "@/components/UnifiedChat";
import ClaudeWorkspace from "@/components/ClaudeWorkspace";
import UltracodeView from "@/components/UltracodeView";
import ClaudeAnt from "@/components/ClaudeAnt";
import AntAgents from "@/components/AntAgents";
import ClaudeArtifacts from "@/components/ClaudeArtifacts";

type ClaudeTab = "chat" | "workspace" | "artifacts" | "ultracode" | "ant" | "agents";

export default function ClaudeRoute() {
  const [tab, setTab] = useState<ClaudeTab>("chat");

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        {([
          { key: "chat",      label: "Chat",      icon: <MessageSquare size={14} /> },
          { key: "workspace", label: "Workspace", icon: <Layers size={14} /> },
          { key: "artifacts", label: "Artifacts", icon: <Share2 size={14} /> },
          { key: "ultracode", label: "Ultracode", icon: <Zap size={14} /> },
          { key: "ant",       label: "Ant CLI",   icon: <Terminal size={14} /> },
          { key: "agents",    label: "Agents",    icon: <Cpu size={14} /> },
        ] as { key: ClaudeTab; label: string; icon: React.ReactNode }[]).map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-[12.5px] transition"
              style={{
                background: active ? "rgba(217,119,87,0.16)" : "transparent",
                borderColor: active ? "#d97757" : "var(--panel-border)",
                color: active ? "var(--fg)" : "var(--fg-dim)",
              }}
            >
              {t.icon}{t.label}
            </button>
          );
        })}
      </div>

      {tab === "chat" ? (
        <UnifiedChat defaultAgent="claude" showAgentSwitcher={false} />
      ) : tab === "workspace" ? (
        <ClaudeWorkspace />
      ) : tab === "artifacts" ? (
        <ClaudeArtifacts />
      ) : tab === "ultracode" ? (
        <UltracodeView />
      ) : tab === "ant" ? (
        <ClaudeAnt />
      ) : (
        <AntAgents />
      )}
    </div>
  );
}

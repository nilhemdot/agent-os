"use client";

import { useState } from "react";
import { Mic, MessageSquare } from "lucide-react";
import FreeClaudePanel from "@/components/FreeClaudePanel";
import SpeakBuild from "@/components/SpeakBuild";

export default function FreeClaudeRoute() {
  const [view, setView] = useState<"speak" | "panel">("speak");
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1.5 mb-4">
        {([
          { key: "speak", label: "Agent Factory", icon: <Mic size={14} /> },
          { key: "panel", label: "Chat & Workspace", icon: <MessageSquare size={14} /> },
        ] as { key: "speak" | "panel"; label: string; icon: React.ReactNode }[]).map((t) => {
          const active = view === t.key;
          return (
            <button key={t.key} onClick={() => setView(t.key)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-[12.5px] transition"
              style={{
                background: active ? "rgba(16,185,129,0.16)" : "transparent",
                borderColor: active ? "#10b981" : "var(--panel-border)",
                color: active ? "var(--fg)" : "var(--fg-dim)",
              }}>
              {t.icon}{t.label}
            </button>
          );
        })}
      </div>

      {/* Both stay MOUNTED — we only hide with CSS. Switching tabs no longer
          unmounts Speak & Build, so its history, gallery, and live preview all
          survive the switch. */}
      <div className={view === "speak" ? "" : "hidden"}>
        <SpeakBuild />
      </div>
      <div className={view === "panel" ? "flex flex-col h-[calc(100vh-180px)]" : "hidden"}>
        <FreeClaudePanel />
      </div>
    </div>
  );
}

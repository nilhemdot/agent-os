"use client";

import { useState } from "react";
import MemoryPanel from "@/components/MemoryPanel";
import MemoryTrustPanel from "@/components/MemoryTrustPanel";
import ContextWindowViewer from "@/components/ContextWindowViewer";

type MemoryTab = "graph" | "trust" | "resident";

export default function MemoryRoute() {
  const [tab, setTab] = useState<MemoryTab>("graph");

  return (
    <div className="min-h-[calc(100vh-220px)] space-y-4 px-4 py-4">
      {/* Tab selector */}
      <div className="flex gap-2">
        {(
          [
            { key: "graph", label: "Graph & Search" },
            { key: "trust", label: "Trust Surface" },
            { key: "resident", label: "Context Window" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium border transition ${
              tab === t.key
                ? "bg-purple-600/30 border-purple-600/50 text-purple-300"
                : "bg-[rgba(255,255,255,0.03)] border-[var(--line-soft)] text-[var(--cream-mute)] hover:text-[var(--cream)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === "graph" && <MemoryPanel />}
      {tab === "trust" && <MemoryTrustPanel />}
      {tab === "resident" && <ContextWindowViewer />}
    </div>
  );
}

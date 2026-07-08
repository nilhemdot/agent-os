"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Box, RefreshCw, Layers, Database, Terminal } from "lucide-react";
import Panel from "./Panel";

type Action = "health" | "agents" | "logs" | "doctor" | "cron";

interface OcVitals {
  ok: boolean;
  gateway: string;
  degraded: boolean;
  agents: string[];
  sessions: number;
  raw: string;
}

export default function OpenClawPanel({ vitals }: { vitals?: OcVitals | null }) {
  const [action, setAction] = useState<Action>("health");
  const [out, setOut] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function fetchAction(a: Action) {
    setBusy(true);
    setAction(a);
    try {
      const r = await fetch(`/api/openclaw?action=${a}`, { cache: "no-store" });
      const j = await r.json();
      setOut((j.stdout || "") + (j.stderr ? `\n${j.stderr}` : ""));
    } catch (e) { setOut(String(e)); }
    setBusy(false);
  }

  useEffect(() => { fetchAction("health"); }, []);

  const actions: { key: Action; label: string; icon: React.ReactNode }[] = [
    { key: "health", label: "Health", icon: <RefreshCw size={12} /> },
    { key: "agents", label: "Agents", icon: <Layers size={12} /> },
    { key: "doctor", label: "Doctor", icon: <Database size={12} /> },
    { key: "logs", label: "Logs", icon: <Terminal size={12} /> },
  ];

  return (
    <Panel
      title="OpenClaw — Gateway"
      accent="openclaw"
      icon={<Box size={14} />}
      actions={
        <span className={`pill ${vitals?.degraded ? "pill-warn" : vitals?.ok ? "pill-ok" : "pill-err"}`}>
          {vitals?.gateway ?? "…"}
        </span>
      }
      className="min-h-[460px]"
    >
      <div className="flex flex-col h-full min-h-0">
        {vitals && (
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="rounded-lg border border-[var(--panel-border)] px-3 py-2">
              <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">Agents</div>
              <div className="text-lg metric">{vitals.agents.length}</div>
              <div className="text-[11px] text-[var(--fg-dim)] truncate">
                {vitals.agents.join(" · ") || "—"}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--panel-border)] px-3 py-2">
              <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">Sessions</div>
              <div className="text-lg metric">{vitals.sessions}</div>
              <div className="text-[11px] text-[var(--fg-dim)]">
                {vitals.degraded ? "gateway degraded" : "gateway nominal"}
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5 mb-3">
          {actions.map((a) => (
            <button
              key={a.key}
              onClick={() => fetchAction(a.key)}
              className={`px-2.5 py-1 rounded-md text-[11px] flex items-center gap-1.5 border transition ${
                action === a.key
                  ? "bg-[rgba(244,114,182,0.15)] border-[rgba(244,114,182,0.5)] text-[var(--openclaw)]"
                  : "bg-[rgba(255,255,255,0.03)] border-[var(--panel-border)] text-[var(--fg-dim)] hover:text-[var(--fg)]"
              }`}
            >
              {a.icon}{a.label}
            </button>
          ))}
        </div>

        <motion.pre
          key={action + (busy ? "1" : "0")}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="scroll flex-1 min-h-0 overflow-auto text-[11.5px] leading-relaxed font-[var(--font-geist-mono)] bg-[rgba(0,0,0,0.35)] border border-[var(--panel-border)] rounded-lg p-3 text-[var(--fg-dim)] whitespace-pre"
        >
          {busy ? "running…" : out || "(no output)"}
        </motion.pre>
      </div>
    </Panel>
  );
}

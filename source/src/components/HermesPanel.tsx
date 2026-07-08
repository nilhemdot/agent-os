"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Cpu, RefreshCw, History, Stethoscope, Sparkles } from "lucide-react";
import Panel from "./Panel";

type Action = "status" | "sessions" | "doctor" | "insights" | "skills";

interface HmVitals { ok: boolean; model: string; provider: string; raw: string; }

export default function HermesPanel({ vitals }: { vitals?: HmVitals | null }) {
  const [action, setAction] = useState<Action>("status");
  const [out, setOut] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function fetchAction(a: Action) {
    setBusy(true);
    setAction(a);
    try {
      const r = await fetch(`/api/hermes?action=${a}`, { cache: "no-store" });
      const j = await r.json();
      setOut((j.stdout || "") + (j.stderr ? `\n${j.stderr}` : ""));
    } catch (e) { setOut(String(e)); }
    setBusy(false);
  }

  useEffect(() => { fetchAction("status"); }, []);

  const actions: { key: Action; label: string; icon: React.ReactNode }[] = [
    { key: "status", label: "Status", icon: <RefreshCw size={12} /> },
    { key: "sessions", label: "Sessions", icon: <History size={12} /> },
    { key: "doctor", label: "Doctor", icon: <Stethoscope size={12} /> },
    { key: "skills", label: "Skills", icon: <Sparkles size={12} /> },
  ];

  return (
    <Panel
      title="Hermes — Operator"
      accent="hermes"
      icon={<Cpu size={14} />}
      actions={
        <span className={`pill ${vitals?.ok ? "pill-ok" : "pill-err"}`}>
          {vitals?.ok ? "online" : "offline"}
        </span>
      }
      className="min-h-[460px]"
    >
      <div className="flex flex-col h-full min-h-0">
        {vitals && (
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="rounded-lg border border-[var(--panel-border)] px-3 py-2">
              <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">Model</div>
              <div className="text-sm metric truncate">{vitals.model}</div>
            </div>
            <div className="rounded-lg border border-[var(--panel-border)] px-3 py-2">
              <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">Provider</div>
              <div className="text-sm metric truncate">{vitals.provider}</div>
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
                  ? "bg-[rgba(96,165,250,0.15)] border-[rgba(96,165,250,0.5)] text-[var(--hermes)]"
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

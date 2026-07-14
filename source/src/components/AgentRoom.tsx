"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw } from "lucide-react";

interface Tab {
  key: string;
  label: string;
  action: string;
  hint?: string;
}

interface Props {
  agent: "openclaw" | "hermes";
  accent: string;
  accentDim: string;
  tabs: Tab[];
  vitals?: React.ReactNode;
  defaultTab: string;
}

export default function AgentRoom({ agent, accent, accentDim, tabs, vitals, defaultTab }: Props) {
  const [tab, setTab] = useState<string>(defaultTab);
  const [out, setOut] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [ts, setTs] = useState<number>(0);

  async function fetchAction(a: string) {
    setBusy(true);
    setTab(a);
    try {
      const r = await fetch(`/api/${agent}?action=${a}`, { cache: "no-store" });
      const j = await r.json();
      setOut((j.stdout || "") + (j.stderr ? `\n${j.stderr}` : ""));
      setTs(Date.now());
    } catch (e) { setOut(String(e)); }
    setBusy(false);
  }

  useEffect(() => { fetchAction(defaultTab);   }, []);

  const activeTab = tabs.find((t) => t.action === tab);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-5">
      {/* Left rail: tabs */}
      <aside className="space-y-1.5">
        {vitals && <div className="mb-4">{vitals}</div>}

        <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--fg-dimmer)] px-1 mb-1.5">
          Actions
        </div>
        {tabs.map((t) => {
          const active = tab === t.action;
          return (
            <button
              key={t.key}
              onClick={() => fetchAction(t.action)}
              className="w-full text-left flex items-center justify-between px-3 py-2.5 rounded-lg border transition"
              style={{
                borderColor: active ? accent : "var(--panel-border)",
                background: active ? accentDim : "transparent",
                color: active ? "var(--fg)" : "var(--fg-dim)",
              }}
            >
              <span className="text-[13px] font-medium">{t.label}</span>
              {t.hint && <span className="text-[10px] text-[var(--fg-dimmer)]">{t.hint}</span>}
            </button>
          );
        })}
      </aside>

      {/* Right: viewer */}
      <div className="panel flex flex-col min-h-[500px] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--panel-border)]">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--fg-dimmer)]">
              {agent} · {activeTab?.action ?? tab}
            </div>
            <div className="text-base font-medium mt-0.5" style={{ color: accent }}>
              {activeTab?.label ?? tab}
            </div>
          </div>
          <button
            onClick={() => fetchAction(tab)}
            disabled={busy}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] border border-[var(--panel-border)] hover:border-[var(--panel-border-hot)] text-[var(--fg-dim)] hover:text-[var(--fg)] disabled:opacity-40 transition"
          >
            <RefreshCw size={11} className={busy ? "animate-spin" : ""} />
            {busy ? "running" : "refresh"}
          </button>
        </div>

        <AnimatePresence mode="wait">
          <motion.pre
            key={tab + ts}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="scroll flex-1 min-h-0 overflow-auto p-5 text-[12px] leading-relaxed font-[var(--font-geist-mono)] text-[var(--fg-dim)] whitespace-pre"
          >
            {busy ? "running…" : out || "(no output)"}
          </motion.pre>
        </AnimatePresence>

        {ts > 0 && (
          <div className="px-5 py-2 border-t border-[var(--panel-border)] text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] flex justify-between">
            <span>Last run · {new Date(ts).toLocaleTimeString("en-GB", { hour12: false })}</span>
            <span>{out.length.toLocaleString()} chars</span>
          </div>
        )}
      </div>
    </div>
  );
}

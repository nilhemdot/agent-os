"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Radio } from "lucide-react";
import Panel from "./Panel";

interface Entry { ts: number; agent: string; text: string; level?: string; }

export default function ActivityStream() {
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    let stop = false;
    const fetchIt = async () => {
      try {
        const r = await fetch("/api/activity", { cache: "no-store" });
        const j = await r.json();
        if (!stop) setEntries(j.entries ?? []);
      } catch { /* ignore */ }
    };
    fetchIt();
    const t = setInterval(fetchIt, 8000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  const dot = (a: string) =>
    a === "openclaw" ? "text-[var(--openclaw)]" :
    a === "hermes" ? "text-[var(--hermes)]" :
    "text-[var(--claude)]";

  return (
    <Panel
      title="Activity Stream"
      accent="system"
      icon={<Radio size={14} />}
      actions={
        <span className="pill pill-info">
          <span className="heartbeat" /> {entries.length} events
        </span>
      }
      className="min-h-[460px]"
    >
      <div className="scroll stream-fade overflow-y-auto h-full min-h-0 pr-2">
        <AnimatePresence initial={false}>
          {entries.length === 0 && (
            <div className="text-sm text-[var(--fg-dim)]">
              No log activity yet. Streams from <code>~/.openclaw/logs</code> and <code>~/.hermes/cache</code> appear here.
            </div>
          )}
          {entries.map((e, i) => (
            <motion.div
              key={`${e.ts}-${i}`}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25, delay: Math.min(i * 0.01, 0.2) }}
              className="flex gap-2 py-1.5 text-[11.5px] font-[var(--font-geist-mono)] border-b border-[rgba(255,255,255,0.04)] last:border-0"
            >
              <span className={`${dot(e.agent)} shrink-0`}>●</span>
              <span className="text-[var(--fg-dimmer)] shrink-0">
                {new Date(e.ts).toLocaleTimeString("en-GB", { hour12: false })}
              </span>
              <span className="text-[var(--fg-dim)] uppercase shrink-0 w-16 truncate">{e.agent}</span>
              <span className={`${
                e.level === "err" ? "text-rose-300" :
                e.level === "warn" ? "text-amber-300" :
                "text-[var(--fg-dim)]"
              } truncate`}>
                {e.text}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Panel>
  );
}

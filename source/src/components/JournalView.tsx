"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, BookOpen, ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import VoiceButton from "./VoiceButton";

interface Entry { time: string; text: string; }

function todayISO(): string {
  const d = new Date();
  const tz = -d.getTimezoneOffset();
  const local = new Date(d.getTime() + tz * 60_000);
  return local.toISOString().slice(0, 10);
}

function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function JournalView() {
  const [date, setDate] = useState<string>(todayISO());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [days, setDays] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(d: string) {
    const r = await fetch(`/api/journal?date=${d}`, { cache: "no-store" });
    const j = await r.json();
    setEntries(j.entries ?? []);
    setDays(j.days ?? []);
  }

  useEffect(() => { load(date); }, [date]);

  async function add() {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/journal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, date }),
      });
      const j = await r.json();
      if (j.entries) setEntries(j.entries);
      setInput("");
    } finally { setBusy(false); }
  }

  const isToday = date === todayISO();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-5">
      {/* Sidebar — date list */}
      <aside className="space-y-2">
        <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] px-1 mb-2 flex items-center gap-1.5">
          <Calendar size={11} /> Recent entries
        </div>
        {days.length === 0 && (
          <div className="text-[12px] text-[var(--fg-dim)] px-1">No entries yet. Start writing →</div>
        )}
        {days.map((d) => {
          const active = d === date;
          return (
            <button
              key={d}
              onClick={() => setDate(d)}
              className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg border transition"
              style={{
                borderColor: active ? "#a855f7" : "var(--panel-border)",
                background: active ? "rgba(168,85,247,0.12)" : "transparent",
                color: active ? "var(--fg)" : "var(--fg-dim)",
              }}
            >
              <div className="flex-1 min-w-0">
                <div className="text-[13px]">{fmtDate(d)}</div>
                <div className="text-[10px] text-[var(--fg-dimmer)]">{d}</div>
              </div>
              {d === todayISO() && (
                <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-[rgba(168,85,247,0.18)] text-[#c4b5fd]">today</span>
              )}
            </button>
          );
        })}
      </aside>

      {/* Main */}
      <main className="space-y-5 min-w-0">
        {/* Date header w/ nav */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">
              {isToday ? "Today" : "Past day"}
            </div>
            <h2 className="text-2xl font-medium tracking-tight">{fmtDate(date)}</h2>
            <div className="text-[11px] text-[var(--fg-dim)] mt-0.5 font-[var(--font-geist-mono)]">{date}</div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setDate(shiftDate(date, -1))}
              className="grid place-items-center w-9 h-9 rounded-lg border border-[var(--panel-border)] hover:border-[var(--panel-border-hot)] text-[var(--fg-dim)] transition"
              title="Previous day"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={() => setDate(todayISO())}
              className="px-3 h-9 rounded-lg border border-[var(--panel-border)] hover:border-[var(--panel-border-hot)] text-[12px] text-[var(--fg-dim)] transition"
            >
              Today
            </button>
            <button
              onClick={() => setDate(shiftDate(date, 1))}
              disabled={isToday}
              className="grid place-items-center w-9 h-9 rounded-lg border border-[var(--panel-border)] hover:border-[var(--panel-border-hot)] text-[var(--fg-dim)] transition disabled:opacity-30"
              title="Next day"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>

        {/* Composer (only today) */}
        {isToday && (
          <div className="panel p-4">
            <div className="flex items-center gap-2 mb-3">
              <BookOpen size={16} className="text-[#a855f7]" />
              <h3 className="text-sm font-medium">New entry</h3>
            </div>
            <div className="flex items-end gap-2">
              <VoiceButton
                onTranscript={(t, o) => { if (o.final) setInput((v) => (v ? v + "\n" : "") + t); }}
                size={38}
              />
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); add(); }
                }}
                rows={3}
                placeholder="What happened? What's on your mind? (⌘+Enter to save)"
                className="flex-1 bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--panel-border-hot)] text-[var(--fg)] resize-none"
              />
              <button
                onClick={add}
                disabled={!input.trim() || busy}
                className="px-3 h-[38px] rounded-lg flex items-center gap-1.5 text-sm transition disabled:opacity-40"
                style={{
                  background: "rgba(168,85,247,0.2)",
                  border: "1px solid rgba(168,85,247,0.55)",
                  color: "#c4b5fd",
                }}
              >
                <Plus size={14} /> Save
              </button>
            </div>
            <div className="mt-2 text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">
              Saved to <code>Agentic OS/Journal/{date}.md</code>
            </div>
          </div>
        )}

        {/* Entries */}
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {entries.length === 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[var(--fg-dim)] text-sm py-8 text-center">
                {isToday ? "No entries today yet. Start writing above." : "No entries for this day."}
              </motion.div>
            )}
            {entries.slice().reverse().map((e, i) => (
              <motion.article
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: i * 0.02 }}
                className="panel p-4 panel-hover"
              >
                <div className="flex items-baseline justify-between mb-2">
                  <span className="font-[var(--font-geist-mono)] text-[12px] text-[#c4b5fd]">{e.time}</span>
                  <span className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">entry</span>
                </div>
                <div className="text-[14px] text-[var(--fg)] leading-relaxed whitespace-pre-wrap">{e.text}</div>
              </motion.article>
            ))}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

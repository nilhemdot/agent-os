"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

interface Props {
  href: string;
  title: string;
  tagline: string;
  icon: ReactNode;
  accent: string;
  metrics: { label: string; value: string }[];
  status: "ok" | "warn" | "err";
}

// AgentPortal — Mission Control "Agents" grid card.
// Aubergine background + gold-tinted border + Bricolage Grotesque title,
// Manrope tagline, JetBrains Mono metric values. Matches free-claude-code-elegant.html.
export default function AgentPortal({ href, title, tagline, icon, accent, metrics, status }: Props) {
  const statusLabel = status === "ok" ? "Online" : status === "warn" ? "Degraded" : "Offline";

  return (
    <Link href={href} className="block group">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ y: -3 }}
        transition={{ duration: 0.35 }}
        className="surface-card relative h-full overflow-hidden"
      >
        {/* Warm radial glow in the corner — keeps the agent colour cue */}
        <div
          className="pointer-events-none absolute -top-24 -right-24 w-64 h-64 rounded-full opacity-20 blur-3xl transition group-hover:opacity-40"
          style={{ background: accent }}
        />

        <div className="relative flex items-start justify-between mb-4">
          <div
            className="grid place-items-center w-11 h-11 rounded-lg"
            style={{
              background: `${accent}1a`,
              color: accent,
              boxShadow: `0 0 22px -10px ${accent}`,
              border: `1px solid ${accent}30`,
            }}
          >
            {icon}
          </div>
          <span className="flex items-center gap-1.5 action-tag" style={{ color: status === "ok" ? "var(--emerald)" : status === "warn" ? "var(--gold)" : "var(--plum)" }}>
            <span className={`status-dot ${status}`} /> {statusLabel}
          </span>
        </div>

        <div className="relative flex items-baseline justify-between gap-2">
          <h3 className="action-title">{title}</h3>
          <ArrowUpRight
            size={16}
            className="opacity-50 group-hover:opacity-100 transition"
            style={{ color: "var(--cream-dim)" }}
          />
        </div>
        <p className="mt-2 action-desc">{tagline}</p>

        <div className="mt-5 grid grid-cols-2 gap-3">
          {metrics.map((m, i) => (
            <div key={i} className="rounded-md border px-3 py-2"
                 style={{ borderColor: "var(--line-soft)", background: "rgba(243,235,218,0.02)" }}>
              <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: "var(--cream-mute)", fontFamily: "'Manrope', sans-serif", fontWeight: 700 }}>
                {m.label}
              </div>
              <div className="text-[15px] metric mt-1 truncate" style={{ color: "var(--cream)" }}>
                {m.value}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 action-tag flex items-center gap-1.5 group-hover:opacity-100 transition" style={{ opacity: 0.7 }}>
          Open control room <span className="hand text-[1.3em] leading-none ml-0.5">→</span>
        </div>
      </motion.div>
    </Link>
  );
}

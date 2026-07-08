"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

interface Props {
  title: string;
  accent?: "claude" | "openclaw" | "hermes" | "system";
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

const accents: Record<NonNullable<Props["accent"]>, { text: string; color: string }> = {
  claude:   { text: "glow-c", color: "var(--claude)" },
  openclaw: { text: "glow-o", color: "var(--openclaw)" },
  hermes:   { text: "glow-h", color: "var(--hermes)" },
  system:   { text: "", color: "var(--accent-cyan)" },
};

export default function Panel({ title, accent = "system", icon, actions, children, className = "" }: Props) {
  const a = accents[accent];
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
      className={`panel panel-hover flex flex-col ${className}`}
    >
      <header className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[var(--panel-border)]">
        <h2
          className={`heading-strip text-sm font-medium tracking-wide flex items-center gap-2 ${a.text}`}
          style={{ color: a.color }}
        >
          {icon}
          <span>{title}</span>
        </h2>
        <div className="flex items-center gap-2">{actions}</div>
      </header>
      <div className="flex-1 min-h-0 p-5">{children}</div>
    </motion.section>
  );
}

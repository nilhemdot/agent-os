"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import type { ReactNode } from "react";

// Section label + nav row, same markup as the non-customize rows in Sidebar.tsx.
export function SidebarSection({ children }: { children: ReactNode }) {
  return <div className="sidebar-section-label mt-5 mb-1.5 px-5">{children}</div>;
}

export default function SidebarItem({
  href, icon, label, active, badge,
}: {
  href: string;
  icon?: ReactNode;
  label: ReactNode;
  active?: boolean;
  badge?: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`sidebar-item relative group flex items-center gap-3 py-2.5 px-5 ${active ? "active" : ""}`}
    >
      {active && (
        <motion.span
          layoutId="nav-indicator"
          className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-[22px]"
          style={{ background: "var(--gold)", boxShadow: "0 0 10px var(--gold)" }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
        />
      )}
      <span
        className="shrink-0 grid place-items-center w-7 h-7 rounded-md transition"
        style={{ color: active ? "var(--gold)" : "var(--cream-dim)" }}
      >
        {icon}
      </span>
      <span className="flex-1">{label}</span>
      {badge !== undefined && <span className="sidebar-badge">{badge}</span>}
    </Link>
  );
}

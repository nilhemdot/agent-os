"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { LayoutGrid, Brain, Sparkles as SparklesIcon, TrendingUp, Columns3, NotebookText, Film, Building2, Workflow, MessagesSquare, Image as ImageIcon, Gamepad2, Music2, Network, Clapperboard, Repeat, Cpu, LayoutDashboard, Palette, GripVertical, Eye, EyeOff, SlidersHorizontal, Check, SquareTerminal } from "lucide-react";
import { useState, useEffect, type ReactNode } from "react";
import AgentAvatar from "./AgentAvatar";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  accent: string;
  dim: string;
}

const NAV: NavItem[] = [
  { href: "/",         label: "Mission Control", icon: <LayoutGrid size={16} />, accent: "#a855f7", dim: "rgba(168,85,247,0.16)" },
  { href: "/paperclip", label: "Paperclip", icon: <Building2 size={16} />, accent: "#d4a574", dim: "rgba(212,165,116,0.16)" },
  { href: "/room",     label: "AI Agent Mastermind", icon: <MessagesSquare size={16} />, accent: "#a855f7", dim: "rgba(168,85,247,0.16)" },
  { href: "/pipeline", label: "Pipeline", icon: <Workflow size={16} />, accent: "#34d399", dim: "rgba(52,211,153,0.16)" },
  // Agents — use real avatar logos
  { href: "/claude",   label: "Claude",   icon: <AgentAvatar agent="claude" size={22} />,   accent: "#d97757", dim: "rgba(217,119,87,0.16)" },
  { href: "/openclaw", label: "OpenClaw", icon: <AgentAvatar agent="openclaw" size={22} />, accent: "#f472b6", dim: "rgba(244,114,182,0.16)" },
  { href: "/hermes",   label: "Hermes",   icon: <AgentAvatar agent="hermes" size={22} />,   accent: "#60a5fa", dim: "rgba(96,165,250,0.16)" },
  // Gemini CLI removed 2026-06-23 — Google retired it (18 Jun 2026); Antigravity CLI (below) is its successor.
  { href: "/antigravity", label: "Antigravity", icon: <AgentAvatar agent="antigravity" size={22} />, accent: "#7c3aed", dim: "rgba(124,58,237,0.16)" },
  { href: "/codex",       label: "Codex",       icon: <AgentAvatar agent="codex" size={22} />,       accent: "#22c55e", dim: "rgba(34,197,94,0.16)" },
  { href: "/kimi",        label: "Kimi Code",   icon: <AgentAvatar agent="kimi" size={22} />,        accent: "#00CCFF", dim: "rgba(0,204,255,0.16)" },
  { href: "/glm",         label: "GLM 5.2",     icon: <AgentAvatar agent="glm" size={22} />,         accent: "#34E5B0", dim: "rgba(52,229,176,0.16)" },
  { href: "/glm-code",    label: "GLM Code",    icon: <SquareTerminal size={18} />,                  accent: "#34E5B0", dim: "rgba(52,229,176,0.16)" },
  { href: "/grok",        label: "Grok Build",  icon: <AgentAvatar agent="grok" size={22} />,        accent: "#cdd3f7", dim: "rgba(205,211,247,0.16)" },
  { href: "/freeclaude",  label: "Free Claude Code", icon: <AgentAvatar agent="fcc" size={22} />,    accent: "#10b981", dim: "rgba(16,185,129,0.16)" },
  { href: "/fusion",      label: "Fusion",      icon: <Network size={18} />,                         accent: "#d4a574", dim: "rgba(212,165,116,0.16)" },
  { href: "/sakana",      label: "Sakana Fugu", icon: <Network size={18} />,                         accent: "#ff5f9e", dim: "rgba(255,95,158,0.16)" },
  { href: "/local",       label: "Local",       icon: <Cpu size={18} />,                             accent: "#5eead4", dim: "rgba(94,234,212,0.16)" },
  { href: "/agent-kanban", label: "Agent Kanban", icon: <LayoutDashboard size={18} />,                accent: "#7dd3fc", dim: "rgba(125,211,252,0.16)" },
  // Personal
  { href: "/loop",     label: "Loop",     icon: <Repeat size={16} />,   accent: "#2dd4bf", dim: "rgba(45,212,191,0.16)" },
  { href: "/seo",      label: "SEO",      icon: <TrendingUp size={16} />, accent: "#a3e635", dim: "rgba(163,230,53,0.16)" },
  { href: "/opendesign", label: "Open Design", icon: <Palette size={16} />, accent: "#e879f9", dim: "rgba(232,121,249,0.16)" },
  { href: "/video",    label: "Video",    icon: <Film size={16} />,      accent: "#ef4444", dim: "rgba(239,68,68,0.16)" },
  { href: "/openmontage", label: "OpenMontage", icon: <Clapperboard size={16} />, accent: "#f0a868", dim: "rgba(240,168,104,0.16)" },
  { href: "/music",    label: "Music",    icon: <Music2 size={16} />,    accent: "#c084fc", dim: "rgba(192,132,252,0.16)" },
  { href: "/games",    label: "Game Studio", icon: <Gamepad2 size={16} />, accent: "#39ff8e", dim: "rgba(57,255,142,0.16)" },
  { href: "/thumbnails", label: "Thumbnails", icon: <ImageIcon size={16} />, accent: "#fb7185", dim: "rgba(251,113,133,0.16)" },
  { href: "/notebook", label: "Notebook", icon: <NotebookText size={16} />, accent: "#fde047", dim: "rgba(253,224,71,0.16)" },
  { href: "/kanban",   label: "Kanban",   icon: <Columns3 size={16} />,  accent: "#14b8a6", dim: "rgba(20,184,166,0.16)" },
  { href: "/memory",   label: "Memory",   icon: <Brain size={16} />,     accent: "#22d3ee", dim: "rgba(34,211,238,0.16)" },
  { href: "/guide",    label: "Build Guide", icon: <SparklesIcon size={16} />, accent: "#ec4899", dim: "rgba(236,72,153,0.16)" },
];

const DEFAULT_ORDER = NAV.map((n) => n.href);
const BY_HREF: Record<string, NavItem> = Object.fromEntries(NAV.map((n) => [n.href, n]));
const AGENT_ROUTES = new Set(["/claude", "/openclaw", "/hermes", "/antigravity", "/codex", "/kimi", "/glm", "/grok", "/freeclaude", "/fusion", "/sakana", "/local"]);
const LS_ORDER = "agentos.sidebar.order";
const LS_HIDDEN = "agentos.sidebar.hidden";

// Sidebar grouping. Mission Control sits under the top "Workspace" header;
// Paperclip + AI Agent Mastermind + Pipeline + Agent Kanban get their own "Agent Orchestration" group;
// the model agents under "Agents"; everything else under "Self".
const ORCHESTRATION_ROUTES = new Set(["/paperclip", "/room", "/pipeline", "/agent-kanban"]);
function sectionOf(href: string): string {
  if (href === "/") return "Workspace";
  if (ORCHESTRATION_ROUTES.has(href)) return "Agent Orchestration";
  if (AGENT_ROUTES.has(href)) return "Agents";
  return "Self";
}

export default function Sidebar() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [order, setOrder] = useState<string[]>(DEFAULT_ORDER);
  const [hidden, setHidden] = useState<string[]>([]);
  const [customize, setCustomize] = useState(false);
  const [dragHref, setDragHref] = useState<string | null>(null);
  const [overHref, setOverHref] = useState<string | null>(null);

  // load saved prefs (client only)
  useEffect(() => {
    setMounted(true);
    try {
      const o = JSON.parse(localStorage.getItem(LS_ORDER) || "null");
      const h = JSON.parse(localStorage.getItem(LS_HIDDEN) || "null");
      if (Array.isArray(o)) setOrder(o.filter((x) => typeof x === "string"));
      if (Array.isArray(h)) setHidden(h.filter((x) => typeof x === "string"));
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { if (mounted) try { localStorage.setItem(LS_ORDER, JSON.stringify(order)); } catch {} }, [order, mounted]);
  useEffect(() => { if (mounted) try { localStorage.setItem(LS_HIDDEN, JSON.stringify(hidden)); } catch {} }, [hidden, mounted]);

  // saved order + any NAV items not yet in it (e.g. new pages added later) appended in default position
  const fullOrder = [
    ...order.filter((h) => BY_HREF[h]),
    ...DEFAULT_ORDER.filter((h) => !order.includes(h)),
  ];
  const visible = customize ? fullOrder : fullOrder.filter((h) => !hidden.includes(h));
  // group by section so each header shows ONCE and all its items sit together,
  // no matter how the saved drag-order interleaves them (fixes duplicate section labels)
  const SECTION_ORDER = ["Workspace", "Agent Orchestration", "Agents", "Self"];
  const list = SECTION_ORDER.flatMap((sec) => visible.filter((h) => sectionOf(h) === sec));

  function move(from: string, to: string) {
    if (from === to) return;
    const next = fullOrder.filter((h) => h !== from);
    const idx = to === "__end__" ? next.length : next.indexOf(to);
    next.splice(idx < 0 ? next.length : idx, 0, from);
    setOrder(next);
  }
  function toggleHidden(href: string) {
    setHidden((h) => (h.includes(href) ? h.filter((x) => x !== href) : [...h, href]));
  }
  function reset() { setOrder(DEFAULT_ORDER); setHidden([]); }

  return (
    <aside className="hidden md:flex flex-col w-[244px] shrink-0 h-screen overflow-hidden py-6 border-r border-[var(--line-soft)]"
           style={{ background: "var(--bg-mid)" }}>
      <Link href="/" className="block mb-7 px-5 shrink-0">
        <div className="text-[10px] uppercase tracking-[0.25em] mb-1" style={{ color: "var(--cream-mute)", fontFamily: "'Manrope', sans-serif", fontWeight: 600 }}>
          Local · Studio
        </div>
        <div className="text-xl tracking-tight" style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 500, color: "var(--cream)" }}>
          Agentic <span className="hand text-[1.3em] ml-1">OS</span>
        </div>
      </Link>

      <div className="flex-1 min-h-0 overflow-y-auto sidebar-scroll">
      <div className="px-5 pb-1.5 flex items-center justify-between">
        <span className="sidebar-section-label">Workspace</span>
        <div className="flex items-center gap-2">
          {customize && (
            <button onClick={reset} title="Reset to default order" className="text-[9px] uppercase tracking-[0.15em] hover:opacity-100 opacity-70 transition" style={{ color: "var(--cream-dim)" }}>
              Reset
            </button>
          )}
          <button
            onClick={() => setCustomize((c) => !c)}
            title={customize ? "Done customizing" : "Customize sidebar — drag to reorder, hide items"}
            className="grid place-items-center w-6 h-6 rounded-md transition"
            style={{ color: customize ? "var(--gold)" : "var(--cream-dim)", background: customize ? "rgba(212,165,116,0.14)" : "transparent" }}
          >
            {customize ? <Check size={14} /> : <SlidersHorizontal size={14} />}
          </button>
        </div>
      </div>
      {customize && (
        <div className="px-5 pb-2 text-[10px] leading-snug" style={{ color: "var(--cream-mute)" }}>
          Drag <GripVertical size={10} className="inline -mt-0.5" /> to reorder · tap the eye to hide
        </div>
      )}

      <nav className="flex flex-col gap-0.5 relative">
        {list.map((href, i) => {
          const item = BY_HREF[href];
          if (!item) return null;
          const prevHref = i > 0 ? list[i - 1] : null;
          const sec = sectionOf(href);
          const prevSec = prevHref ? sectionOf(prevHref) : null;
          let sectionLabel: string | undefined = sec !== prevSec ? sec : undefined;
          // The top "Workspace" header already labels the first group — don't repeat it.
          if (i === 0 && sectionLabel === "Workspace") sectionLabel = undefined;

          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          const isHidden = hidden.includes(href);
          const isOver = overHref === href && dragHref !== href;

          return (
            <div key={href}>
              {sectionLabel && (
                <div className="sidebar-section-label mt-5 mb-1.5 px-5">
                  {sectionLabel}
                </div>
              )}

              {customize ? (
                <div
                  draggable
                  onDragStart={() => setDragHref(href)}
                  onDragEnter={() => setOverHref(href)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { if (dragHref) move(dragHref, href); setDragHref(null); setOverHref(null); }}
                  onDragEnd={() => { setDragHref(null); setOverHref(null); }}
                  className="sidebar-item relative group flex items-center gap-2 py-2.5 px-3 mx-2 rounded-lg cursor-grab active:cursor-grabbing"
                  style={{
                    opacity: dragHref === href ? 0.4 : isHidden ? 0.4 : 1,
                    borderTop: isOver ? "2px solid var(--gold)" : "2px solid transparent",
                    background: isOver ? "rgba(212,165,116,0.08)" : "transparent",
                  }}
                >
                  <GripVertical size={14} style={{ color: "var(--cream-mute)" }} className="shrink-0" />
                  <span className="shrink-0 grid place-items-center w-7 h-7 rounded-md" style={{ color: "var(--cream-dim)" }}>
                    {item.icon}
                  </span>
                  <span className="flex-1 truncate" style={{ textDecoration: isHidden ? "line-through" : "none" }}>{item.label}</span>
                  <button
                    onClick={() => toggleHidden(href)}
                    title={isHidden ? "Show" : "Hide"}
                    className="shrink-0 grid place-items-center w-6 h-6 rounded-md transition hover:bg-[rgba(255,255,255,0.06)]"
                    style={{ color: isHidden ? "var(--cream-mute)" : "var(--gold)" }}
                  >
                    {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              ) : (
                <Link
                  href={href}
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
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </Link>
              )}
            </div>
          );
        })}
        {customize && (
          <div
            onDragEnter={() => setOverHref("__end__")}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (dragHref) move(dragHref, "__end__"); setDragHref(null); setOverHref(null); }}
            className="h-6 mx-2 rounded-lg"
            style={{ borderTop: overHref === "__end__" ? "2px solid var(--gold)" : "2px solid transparent" }}
          />
        )}
      </nav>
      </div>

      <div className="shrink-0 pt-6 mx-5 border-t border-[var(--line-soft)]">
        <div className="sidebar-section-label mt-4 mb-2">Wired</div>
        <div className="text-[11px] leading-relaxed mono" style={{ color: "var(--cream-dim)" }}>
          claude · openclaw · hermes<br />
          <span className="hand text-[1.15em]">+</span> Obsidian vault
        </div>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const items = NAV.filter((_, i) => i !== 5 && i !== 6); // hide goals/journal/memory on mobile bar for space
  return (
    <nav className="md:hidden fixed bottom-3 left-1/2 -translate-x-1/2 z-40 panel panel-hot px-2 py-1.5 flex gap-1">
      {items.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className="grid place-items-center w-10 h-10 rounded-lg transition"
            style={{
              background: active ? item.dim : "transparent",
              color: active ? item.accent : "var(--fg-dim)",
            }}
          >
            {item.icon}
          </Link>
        );
      })}
    </nav>
  );
}

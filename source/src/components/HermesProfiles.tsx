"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Users, Brain, Clock, BadgeCheck } from "lucide-react";

const ACCENT = "#60a5fa";

interface HermesProfile {
  name: string;
  description: string;
  model: string;
  provider: string;
  soul: string;
  sessions: number;
  lastActive: number;
  active: boolean;
}

function ago(ms: number): string {
  if (!ms) return "never";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Role colors — the SEO team gets its own palette so it reads as a team.
function accent(name: string): string {
  if (name.startsWith("seo-keywords")) return "#fbbf24";
  if (name.startsWith("seo-outline")) return "#8b5cf6";
  if (name.startsWith("seo-writer")) return "#5ab896";
  if (name.startsWith("seo-links")) return "#f472b6";
  if (name === "julian") return "#d4a574";
  if (name.startsWith("swarm")) return "#475569";
  return ACCENT;
}

export default function HermesProfiles() {
  const [profiles, setProfiles] = useState<HermesProfile[]>([]);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const load = () =>
      fetch("/api/hermes/profiles", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => setProfiles(j.profiles ?? []))
        .catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  // The interesting staff first — hide the swarm drones behind "show all"
  const staff = profiles.filter((p) => !p.name.startsWith("swarm") || showAll);
  const hidden = profiles.length - staff.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Users size={15} style={{ color: ACCENT }} />
        <span className="text-[13.5px] font-medium" style={{ color: "var(--fg)" }}>
          Agent Profiles — your Hermes staff
        </span>
        <span className="text-[11px]" style={{ color: "var(--fg-dimmer)" }}>
          · {profiles.length} hired · each with its own brain, memory &amp; SOUL
        </span>
        {hidden > 0 && (
          <button onClick={() => setShowAll(true)} className="ml-auto text-[11px] underline" style={{ color: "var(--fg-dim)" }}>
            show {hidden} swarm workers
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {staff.map((p, i) => {
          const c = accent(p.name);
          return (
            <motion.div
              key={p.name}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.04, 0.4) }}
              className="rounded-xl border p-4 relative overflow-hidden"
              style={{ borderColor: `${c}40`, background: `linear-gradient(160deg, ${c}0d, transparent 55%)` }}
            >
              <div className="flex items-center gap-2.5 mb-2">
                <span className="grid place-items-center w-9 h-9 rounded-lg text-[15px] font-bold"
                  style={{ background: `${c}1f`, color: c, border: `1px solid ${c}45` }}>
                  {p.name.replace(/^seo-/, "").slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13.5px] font-semibold truncate" style={{ color: "var(--fg)" }}>{p.name}</span>
                    {p.active && <BadgeCheck size={13} style={{ color: c }} />}
                  </div>
                  <div className="text-[10px] font-mono" style={{ color: c }}>
                    <Brain size={9} className="inline mr-1" />{p.model}
                  </div>
                </div>
              </div>
              <p className="text-[11.5px] leading-relaxed mb-2.5 min-h-[32px]" style={{ color: "var(--fg-dim)" }}>
                {p.description || p.soul || "No description yet."}
              </p>
              <div className="flex items-center gap-3 text-[10px] font-mono" style={{ color: "var(--fg-dimmer)" }}>
                <span>{p.sessions} session{p.sessions === 1 ? "" : "s"}</span>
                <span className="flex items-center gap-1"><Clock size={9} />{ago(p.lastActive)}</span>
                {p.provider && <span className="ml-auto">{p.provider}</span>}
              </div>
            </motion.div>
          );
        })}
        {profiles.length === 0 && (
          <div className="col-span-3 text-center text-[12px] py-8" style={{ color: "var(--fg-dimmer)" }}>
            Loading profiles…
          </div>
        )}
      </div>
    </div>
  );
}

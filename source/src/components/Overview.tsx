"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Brain, Target, BookOpen, ArrowUpRight } from "lucide-react";
import AgentPortal from "./AgentPortal";
import AgentAvatar from "./AgentAvatar";
import Vitals from "./Vitals";
import TokenUsage from "./TokenUsage";
import ActivityStream from "./ActivityStream";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";

interface VitalsData {
  claude: { ok: boolean; version: string; latencyMs: number };
  openclaw: { ok: boolean; gateway: string; degraded: boolean; busy?: boolean; agents: string[]; sessions: number };
  hermes: { ok: boolean; model: string; provider: string };
}

export default function Overview() {
  const [v, setV] = useState<VitalsData | null>(null);
  const [recentCount, setRecentCount] = useState<number>(0);

  // Server-cached at 5s; poll at 10s; pause when tab hidden.
  usePollWhileVisible(async () => {
    try {
      const [r1, r2] = await Promise.all([
        fetch("/api/vitals", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/memory/recent", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      ]);
      setV(r1);
      if (r2?.recent) setRecentCount(r2.recent.length);
    } catch { /* ignore */ }
  }, 10000);

  const oc = v?.openclaw;
  const hm = v?.hermes;
  const cl = v?.claude;

  return (
    <div className="space-y-10">
      <Vitals />

      <div className="divider">
        <span className="rule" />
        <span className="ornament">✦</span>
        <span className="rule" />
      </div>

      <section>
        <div className="eyebrow mb-5">
          <span className="num">II.</span>
          <span className="line" />
          <span className="label">Agents · click to open control room</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <AgentPortal
            href="/claude"
            title="Claude"
            tagline="Direct streaming line to Claude Code. Full tool use, MCPs, plugins."
            icon={<AgentAvatar agent="claude" size={28} />}
            accent="#d97757"
            status={cl?.ok ? "ok" : "warn"}
            metrics={[
              { label: "Version", value: cl?.version?.split(" ")[0] ?? "—" },
              { label: "Latency", value: cl ? `${cl.latencyMs}ms` : "—" },
            ]}
          />
          <AgentPortal
            href="/openclaw"
            title="OpenClaw"
            tagline="Local agent gateway. Chat one-shot or open the control room."
            icon={<AgentAvatar agent="openclaw" size={28} />}
            accent="#f472b6"
            status={!oc?.ok ? "err" : oc.degraded ? "warn" : "ok"}
            metrics={[
              { label: "Agents", value: oc ? String(oc.agents.length) : "—" },
              { label: "Sessions", value: oc ? String(oc.sessions) : "—" },
            ]}
          />
          <AgentPortal
            href="/hermes"
            title="Hermes"
            tagline="Nous Research agent. Tool calls, kanban, skills, plugins."
            icon={<AgentAvatar agent="hermes" size={28} />}
            accent="#60a5fa"
            status={hm?.ok ? "ok" : "warn"}
            metrics={[
              { label: "Model", value: hm?.model?.split("/").pop() ?? "—" },
              { label: "Provider", value: hm?.provider ?? "—" },
            ]}
          />
        </div>
      </section>

      <div className="divider">
        <span className="rule" />
        <span className="ornament">✦</span>
        <span className="rule" />
      </div>

      <section>
        <div className="eyebrow mb-5">
          <span className="num">III.</span>
          <span className="line" />
          <span className="label">Token usage · what each agent is burning</span>
        </div>
        <TokenUsage />
      </section>

      <div className="divider">
        <span className="rule" />
        <span className="ornament">✦</span>
        <span className="rule" />
      </div>

      <section>
        <div className="eyebrow mb-5">
          <span className="num">IV.</span>
          <span className="line" />
          <span className="label">Self · grounded in your Obsidian vault</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SelfCard
            href="/goals"
            title="Goals"
            tagline="Set the targets, tick them off, see the % bar fill."
            icon={<Target size={20} />}
            accent="#fbbf24"
            stat={recentCount > 0 ? "Live · saved to vault" : "Live"}
          />
          <SelfCard
            href="/journal"
            title="Journal"
            tagline="Daily entries, voice or text, one file per day."
            icon={<BookOpen size={20} />}
            accent="#a3e635"
            stat="Daily files in vault"
          />
          <SelfCard
            href="/memory"
            title="Memory"
            tagline="Every chat auto-logged. Full vault search."
            icon={<Brain size={20} />}
            accent="#22d3ee"
            stat="1261 omi · 186 notes"
          />
        </div>
      </section>

      <div className="divider">
        <span className="rule" />
        <span className="ornament">✦</span>
        <span className="rule" />
      </div>

      <section>
        <div className="eyebrow mb-5">
          <span className="num">V.</span>
          <span className="line" />
          <span className="label">Live activity · combined log stream</span>
        </div>
        <ActivityStream />
      </section>
    </div>
  );
}

function SelfCard({
  href, title, tagline, icon, accent, stat,
}: { href: string; title: string; tagline: string; icon: React.ReactNode; accent: string; stat: string; }) {
  return (
    <Link href={href} className="block group">
      <motion.div
        whileHover={{ y: -3 }}
        transition={{ duration: 0.25 }}
        className="surface-card relative overflow-hidden h-full"
      >
        <div
          className="pointer-events-none absolute -bottom-16 -right-12 w-48 h-48 rounded-full blur-3xl opacity-15 group-hover:opacity-30 transition"
          style={{ background: accent }}
        />
        <div className="relative flex items-start justify-between mb-3">
          <div
            className="grid place-items-center w-10 h-10 rounded-md"
            style={{ background: `${accent}1a`, color: accent, border: `1px solid ${accent}30`, boxShadow: `0 0 18px -10px ${accent}` }}
          >
            {icon}
          </div>
          <ArrowUpRight size={14} className="opacity-50 group-hover:opacity-100 transition" style={{ color: "var(--cream-dim)" }} />
        </div>
        <div className="relative">
          <h3 className="action-title">{title}</h3>
          <p className="mt-1.5 action-desc">{tagline}</p>
          <div className="mt-4 action-tag">{stat}</div>
        </div>
      </motion.div>
    </Link>
  );
}

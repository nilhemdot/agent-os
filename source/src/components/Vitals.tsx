"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Activity, Box, Sparkles, Cpu, Zap, Route } from "lucide-react";
import type { ReactNode } from "react";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";

interface VitalsData {
  ts: number;
  claude: { ok: boolean; version: string; latencyMs: number };
  openclaw: { ok: boolean; gateway: string; degraded: boolean; busy?: boolean; agents: string[]; sessions: number; latencyMs: number };
  hermes: { ok: boolean; model: string; provider: string; latencyMs: number };
}
interface FccState { enabled: boolean; reachable: boolean; model: string | null; provider: string | null; }

// VitalTile — Midnight Aubergine card with small-caps label, Bricolage value,
// optional Caveat hand-script accent inside the value (use <em>…</em>), and a
// status dot in emerald / gold / plum / gold-soft.
function VitalTile({
  label, icon, primary, sub, status, href,
}: {
  label: string;
  icon: ReactNode;
  primary: ReactNode;
  sub?: string;
  status: "ok" | "warn" | "err" | "info";
  href?: string;
}) {
  const inner = (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="vital-tile"
    >
      <div className="flex items-center justify-between">
        <span className="k flex items-center gap-1.5">
          <span style={{ color: "var(--gold)" }}>{icon}</span>
          {label}
        </span>
        <span className={`status-dot ${status}`} />
      </div>
      <div className="v">{primary}</div>
      {sub && <div className="sub truncate">{sub}</div>}
    </motion.div>
  );
  if (href) return <a href={href} className="block">{inner}</a>;
  return inner;
}

export default function Vitals() {
  const [data, setData] = useState<VitalsData | null>(null);
  const [, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [fcc, setFcc] = useState<FccState | null>(null);

  // Pause-on-hidden polling. Server caches /api/vitals for 5s, so 10s here is
  // plenty for the freshness the user sees and dramatically cuts CLI spawns.
  usePollWhileVisible(async () => {
    try {
      const [vR, fR] = await Promise.all([
        fetch("/api/vitals", { cache: "no-store" }),
        fetch("/api/fcc", { cache: "no-store" }),
      ]);
      const v = await vR.json();
      const f = await fR.json();
      setData(v); setFcc(f); setErr(null);
      setTick((n) => n + 1);
    } catch (e) { setErr(String(e)); }
  }, 10000);

  // Quiet useEffect kept only for symmetry — was previously the polling setup.
  useEffect(() => { /* no-op: polling moved to usePollWhileVisible above */ }, []);

  const fccLabel = fcc?.model ? fcc.model.split("/").slice(-1)[0] : "—";
  const totalLatency = data ? data.claude.latencyMs + data.openclaw.latencyMs + data.hermes.latencyMs : 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <VitalTile
        label="Claude"
        icon={<Sparkles size={12} />}
        primary={data?.claude.ok ? "Online" : "…"}
        sub={data ? `${data.claude.version.split(" ")[0]} · ${data.claude.latencyMs}ms` : "checking…"}
        status={data?.claude.ok ? "ok" : "warn"}
      />
      <VitalTile
        label="OpenClaw"
        icon={<Box size={12} />}
        primary={data?.openclaw.ok ? (data.openclaw.degraded ? "Degraded" : data.openclaw.busy ? "Busy" : "Ready") : "…"}
        sub={data ? `${data.openclaw.agents.length} agents · ${data.openclaw.sessions} sessions` : "checking…"}
        status={!data?.openclaw.ok ? "err" : data.openclaw.degraded ? "warn" : "ok"}
      />
      <VitalTile
        label="Hermes"
        icon={<Cpu size={12} />}
        primary={data?.hermes.ok ? "Online" : "…"}
        sub={data ? `${data.hermes.model.split("/").pop()} · ${data.hermes.provider}` : "checking…"}
        status={data?.hermes.ok ? "ok" : "warn"}
      />
      <VitalTile
        label="Heartbeat"
        icon={<Activity size={12} />}
        primary={<><em>{tick}</em></>}
        sub="poll ticks · 4s"
        status="info"
      />
      <VitalTile
        label="Latency"
        icon={<Zap size={12} />}
        primary={data ? <>{totalLatency}<span className="text-[var(--cream-dim)] text-[0.7em] ml-0.5">ms</span></> : "…"}
        sub="combined p50"
        status="ok"
      />
      <VitalTile
        label="Free Claude"
        icon={<Route size={12} />}
        href="/freeclaude"
        primary={!fcc ? "…" : fcc.reachable ? "Live" : "Offline"}
        sub={!fcc ? "checking…" : fcc.reachable ? `${fccLabel} · ${fcc.provider ?? ""}` : "fcc-server down"}
        status={!fcc ? "info" : fcc.reachable ? "ok" : "err"}
      />
    </div>
  );
}

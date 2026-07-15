"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, AlertTriangle, RefreshCw } from "lucide-react";
import type { Memory, MemoryStats } from "@/lib/memoryStore";
import Panel from "./Panel";

interface MemoryTrustPanelProps {
  className?: string;
}

export default function MemoryTrustPanel({ className = "" }: MemoryTrustPanelProps) {
  const [trusted, setTrusted] = useState<Memory[]>([]);
  const [quarantined, setQuarantined] = useState<Memory[]>([]);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [demoting, setDemoting] = useState<Set<string>>(new Set());
  const [promoting, setPromoting] = useState<Set<string>>(new Set());
  const [confirmAction, setConfirmAction] = useState<{ type: "promote" | "demote"; id: string } | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, trustedRes, quarantinedRes] = await Promise.all([
        fetch("/api/memory/stats", { cache: "no-store" }),
        fetch("/api/memory/search?q=&includeQuarantined=false", { cache: "no-store" }),
        fetch("/api/memory/quarantine", { cache: "no-store" }),
      ]);

      if (!statsRes.ok || !trustedRes.ok || !quarantinedRes.ok) throw new Error("Failed to fetch");

      const statsData = await statsRes.json();
      const trustedData = await trustedRes.json();
      const quarantinedData = await quarantinedRes.json();

      setStats(statsData.data ?? null);
      setTrusted(trustedData.data?.trusted ?? []);
      setQuarantined(quarantinedData.data ?? []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  async function promoteRecord(id: string) {
    setPromoting((s) => new Set(s).add(id));
    try {
      const r = await fetch("/api/memory/promote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, actor: "user" }),
      });
      if (!r.ok) throw new Error("Promote failed");
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setPromoting((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
      setConfirmAction(null);
    }
  }

  async function demoteRecord(id: string) {
    setDemoting((s) => new Set(s).add(id));
    try {
      const r = await fetch("/api/memory/demote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, actor: "user" }),
      });
      if (!r.ok) throw new Error("Demote failed");
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setDemoting((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
      setConfirmAction(null);
    }
  }

  const originLabel = (o: string) => {
    const labels: Record<string, string> = {
      human: "👤",
      agent: "🤖",
      web: "🌐",
      repo: "📦",
    };
    return labels[o] ?? o;
  };

  const originName = (o: string) => o.charAt(0).toUpperCase() + o.slice(1);

  const renderMemoryBlock = (block: Memory, isTrusted: boolean) => {
    const isDemoting = demoting.has(block.id);
    const isPromoting = promoting.has(block.id);
    const isConfirming = confirmAction?.id === block.id;

    return (
      <motion.div
        key={block.id}
        initial={{ opacity: 0, x: -4 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 4 }}
        className={`rounded-lg border px-3 py-2.5 text-left transition ${
          isTrusted
            ? "border-[var(--line-soft)] bg-[rgba(34,197,94,0.05)] hover:bg-[rgba(34,197,94,0.08)]"
            : "border-amber-600/50 bg-[rgba(217,119,6,0.1)] hover:bg-[rgba(217,119,6,0.15)]"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm">{originLabel(block.origin)}</span>
              <span className="text-[10px] font-medium text-[var(--cream-mute)] bg-[rgba(0,0,0,0.3)] px-1.5 py-0.5 rounded">
                {originName(block.origin)}
              </span>
              <span
                className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                  isTrusted
                    ? "bg-green-600/20 text-green-300"
                    : "bg-amber-600/20 text-amber-300"
                }`}
              >
                {isTrusted ? "trusted" : "quarantined"}
              </span>
            </div>
            <div className="text-[12px] text-[var(--cream)] line-clamp-2">
              {block.content.slice(0, 120)}
              {block.content.length > 120 ? "…" : ""}
            </div>
          </div>

          {/* Action buttons */}
          {isConfirming ? (
            <div className="flex gap-1 shrink-0">
              <button
                onClick={() =>
                  confirmAction.type === "promote"
                    ? promoteRecord(block.id)
                    : demoteRecord(block.id)
                }
                disabled={isPromoting || isDemoting}
                className={`px-2 py-1 rounded text-[10px] font-medium transition disabled:opacity-50 ${
                  confirmAction.type === "promote"
                    ? "bg-green-600/30 hover:bg-green-600/40 border border-green-600/50 text-green-300"
                    : "bg-red-600/30 hover:bg-red-600/40 border border-red-600/50 text-red-300"
                }`}
              >
                {isPromoting || isDemoting ? "…" : "confirm"}
              </button>
              <button
                onClick={() => setConfirmAction(null)}
                className="px-2 py-1 rounded text-[10px] border border-[var(--line-soft)] hover:border-[var(--line-soft)] text-[var(--cream-mute)] transition"
              >
                cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() =>
                setConfirmAction({
                  type: isTrusted ? "demote" : "promote",
                  id: block.id,
                })
              }
              className="px-2 py-1 rounded text-[10px] border border-[var(--line-soft)] hover:bg-[rgba(255,255,255,0.05)] text-[var(--cream-mute)] hover:text-[var(--cream)] transition shrink-0"
            >
              {isTrusted ? "demote" : "promote"}
            </button>
          )}
        </div>
      </motion.div>
    );
  };

  return (
    <Panel
      title="Memory Trust Surface"
      accent="system"
      icon={<Shield size={14} />}
      actions={
        <button
          onClick={() => load()}
          disabled={loading}
          className="text-[var(--cream-mute)] hover:text-[var(--cream)] disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      }
      className={className}
    >
      <div className="space-y-4">
        {/* Stats header */}
        {stats && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--line-soft)" }}>
              <div className="text-[16px] font-semibold text-[var(--cream)]">{stats.total}</div>
              <div className="text-[10px] uppercase tracking-widest text-[var(--cream-mute)]">total</div>
            </div>
            <div className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--line-soft)" }}>
              <div className="text-[16px] font-semibold text-green-300">{stats.by_trust.trusted}</div>
              <div className="text-[10px] uppercase tracking-widest text-[var(--cream-mute)]">trusted</div>
            </div>
            <div className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--line-soft)" }}>
              <div className="text-[16px] font-semibold text-amber-300">{stats.by_trust.quarantined}</div>
              <div className="text-[10px] uppercase tracking-widest text-[var(--cream-mute)]">quarantined</div>
            </div>
            <div className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--line-soft)" }}>
              <div className="text-[16px] font-semibold text-[var(--cream)]">{stats.by_origin.human}</div>
              <div className="text-[10px] uppercase tracking-widest text-[var(--cream-mute)]">human</div>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-600/40 bg-[rgba(220,38,38,0.1)] px-3 py-2 text-[12px] text-red-300 flex items-start gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {loading && (
          <div className="text-[12.5px] text-[var(--cream-mute)] text-center py-6">Loading memory…</div>
        )}

        {!loading && trusted.length === 0 && quarantined.length === 0 && !error && (
          <div className="text-[12.5px] text-[var(--cream-mute)] text-center py-6">No memories yet.</div>
        )}

        {/* Trusted section */}
        {trusted.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-[11px] uppercase tracking-widest text-green-400 font-semibold flex items-center gap-2 px-1">
              <Shield size={12} /> Trusted ({trusted.length})
            </h4>
            <div className="space-y-1.5">
              <AnimatePresence>{trusted.map((b) => renderMemoryBlock(b, true))}</AnimatePresence>
            </div>
          </div>
        )}

        {/* Quarantined section */}
        {quarantined.length > 0 && (
          <div className="space-y-2 mt-4 pt-4 border-t border-[var(--line-soft)]">
            <h4 className="text-[11px] uppercase tracking-widest text-amber-400 font-semibold flex items-center gap-2 px-1">
              <AlertTriangle size={12} /> Quarantined ({quarantined.length})
            </h4>
            <div className="space-y-1.5">
              <AnimatePresence>{quarantined.map((b) => renderMemoryBlock(b, false))}</AnimatePresence>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

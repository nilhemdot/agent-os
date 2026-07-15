"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, ChevronDown, AlertCircle, Clock } from "lucide-react";
import type { Memory } from "@/lib/memoryStore";

// ponytail: chars/4 heuristic for token count
const TOKENS_PER_CHAR = 0.25;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ContextWindowViewerProps {}

export default function ContextWindowViewer({}: ContextWindowViewerProps) {
  const [blocks, setBlocks] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [demoting, setDemoting] = useState<Set<string>>(new Set());
  const [confirmDemote, setConfirmDemote] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/memory/resident", { cache: "no-store" });
      if (!r.ok) throw new Error("Failed to fetch resident context");
      const { ok, data, error: apiErr } = await r.json();
      if (!ok) throw new Error(apiErr || "Unknown error");
      setBlocks(data ?? []);
    } catch (err) {
      setError(String(err));
      setBlocks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  async function demoteBlock(id: string) {
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
      setConfirmDemote(null);
    }
  }

  const totalTokens = blocks.reduce(
    (sum, b) => sum + Math.ceil(b.content.length * TOKENS_PER_CHAR),
    0
  );

  const originLabel = (o: string) => {
    const labels: Record<string, string> = {
      human: "👤",
      agent: "🤖",
      web: "🌐",
      repo: "📦",
    };
    return labels[o] ?? o;
  };

  const originName = (o: string) => {
    return o.charAt(0).toUpperCase() + o.slice(1);
  };

  const tierColor = (t: string): string => {
    const colors: Record<string, string> = {
      core: "bg-[rgba(34,197,94,0.15)] border-green-600/40 text-green-300",
      recall: "bg-[rgba(59,130,246,0.15)] border-blue-600/40 text-blue-300",
      archival: "bg-[rgba(139,92,246,0.15)] border-purple-600/40 text-purple-300",
    };
    return colors[t] ?? "bg-[rgba(100,116,139,0.15)] border-slate-600/40 text-slate-300";
  };

  return (
    <div className="panel p-5 space-y-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Eye size={16} style={{ color: "var(--gold)" }} />
          <h3 className="text-[15px] font-semibold text-[var(--cream)]">Context Window</h3>
          <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--cream-mute)]">Resident Blocks</span>
        </div>
        <button
          onClick={() => load()}
          disabled={loading}
          className="text-[var(--cream-mute)] hover:text-[var(--cream)] disabled:opacity-50 text-xs"
          title="Refresh"
        >
          {loading ? "…" : "refresh"}
        </button>
      </div>

      {/* Total tokens header */}
      <div className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--line-soft)" }}>
        <div className="text-[18px] font-semibold text-[var(--cream)] font-[var(--font-bricolage,inherit)]">
          {totalTokens.toLocaleString()} tokens
        </div>
        <div className="text-[10px] uppercase tracking-widest text-[var(--cream-mute)] mt-0.5">
          {blocks.length} block{blocks.length !== 1 ? "s" : ""}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-600/40 bg-[rgba(220,38,38,0.1)] px-3 py-2 text-[12px] text-red-300 flex items-start gap-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {loading && (
        <div className="text-[12.5px] text-[var(--cream-mute)] text-center py-6">Loading resident context…</div>
      )}

      {!loading && blocks.length === 0 && !error && (
        <div className="text-[12.5px] text-[var(--cream-mute)] py-6 text-center">
          No records in resident context. Add human memories or promote quarantined items.
        </div>
      )}

      {/* Blocks list */}
      <div className="space-y-2">
        <AnimatePresence>
          {blocks.map((block) => {
            const tokenCount = Math.ceil(block.content.length * TOKENS_PER_CHAR);
            const isDemoting = demoting.has(block.id);
            const isConfirming = confirmDemote === block.id;

            return (
              <motion.div
                key={block.id}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                className="rounded-lg border border-[var(--line-soft)] bg-[rgba(0,0,0,0.15)] overflow-hidden"
              >
                <button
                  onClick={() => setExpandedId(expandedId === block.id ? null : block.id)}
                  className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-[rgba(255,255,255,0.03)] transition text-left"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-sm">{originLabel(block.origin)}</span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${tierColor(block.tier)}`}
                      >
                        {block.tier}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] text-[var(--cream)] truncate">
                        {block.content.slice(0, 60)}
                        {block.content.length > 60 ? "…" : ""}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <span className="text-[11px] text-[var(--cream-mute)]">{tokenCount} tok</span>
                    <ChevronDown
                      size={14}
                      className={`text-[var(--cream-mute)] transition ${expandedId === block.id ? "rotate-180" : ""}`}
                    />
                  </div>
                </button>

                {/* Expanded view */}
                {expandedId === block.id && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="border-t border-[var(--line-soft)] bg-[rgba(0,0,0,0.25)] px-3 py-2.5 space-y-2"
                  >
                    <div className="text-[11px] text-[var(--cream-soft)] leading-relaxed max-h-[120px] overflow-y-auto font-[var(--font-geist-sans)]">
                      {block.content}
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-[var(--cream-mute)]">
                      <div className="flex items-center gap-2">
                        <Clock size={12} />
                        <span>{new Date(block.created_at).toLocaleDateString()}</span>
                      </div>
                      <span className="text-[var(--cream-mute)]">{originName(block.origin)}</span>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-1.5 pt-2 border-t border-[var(--line-soft)]">
                      {isConfirming ? (
                        <>
                          <button
                            onClick={() => demoteBlock(block.id)}
                            disabled={isDemoting}
                            className="flex-1 px-2 py-1 rounded text-[10px] bg-red-600/30 hover:bg-red-600/40 border border-red-600/50 text-red-300 disabled:opacity-50 transition"
                          >
                            {isDemoting ? "…" : "confirm demote"}
                          </button>
                          <button
                            onClick={() => setConfirmDemote(null)}
                            className="flex-1 px-2 py-1 rounded text-[10px] bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.08)] border border-[var(--line-soft)] text-[var(--cream-soft)] transition"
                          >
                            cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setConfirmDemote(block.id)}
                          className="flex-1 px-2 py-1 rounded text-[10px] bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.08)] border border-[var(--line-soft)] text-[var(--cream-soft)] transition"
                        >
                          demote
                        </button>
                      )}
                    </div>
                  </motion.div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

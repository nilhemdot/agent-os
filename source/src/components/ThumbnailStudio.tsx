"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, Wand2, Download, X, Loader2, History, Clock } from "lucide-react";

const ACCENT = "#ef4444";

interface Session { folder: string; instructions: string; took?: string; inputFiles: string[]; outputs: string[]; }

function fileUrl(rel: string, w?: number) { const u = `/api/thumbnails/file?path=${encodeURIComponent(rel)}`; return w ? `${u}&w=${w}` : u; }

export default function ThumbnailStudio() {
  const [images, setImages] = useState<string[]>([]);
  const [instructions, setInstructions] = useState("");
  const [count, setCount] = useState(3);
  const [pro, setPro] = useState(false);      // off = faithful edit of your image (like ChatGPT); on = redesign from scratch
  const [single, setSingle] = useState(true); // anti-collage line ON by default → separate single images
  const [vary, setVary] = useState(false);    // off = clean consistent edits; on = redesign each differently
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [enlarged, setEnlarged] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [elapsed, setElapsed] = useState(0);          // live seconds while generating
  const [lastTime, setLastTime] = useState<number | null>(null); // final time of last run
  const fileRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadHistory = () => fetch("/api/thumbnails/history", { cache: "no-store" }).then((r) => r.json()).then((j) => setSessions(j.sessions || [])).catch(() => {});
  useEffect(() => { loadHistory(); return () => { if (timerRef.current) clearInterval(timerRef.current); }; }, []);

  function fmtTime(s: number) {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  function onFiles(files: FileList | File[] | null) {
    if (!files) return;
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    arr.forEach((f) => {
      const r = new FileReader();
      r.onload = () => setImages((prev) => (prev.length >= 6 ? prev : [...prev, r.result as string]));
      r.readAsDataURL(f);
    });
  }

  async function generate() {
    if (busy) return;
    if (!images.length && !instructions.trim()) { setError("Add a reference image or some instructions."); return; }
    setBusy(true); setError(null); setResults([]); setLastTime(null); setElapsed(0);
    const start = Date.now();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setElapsed((Date.now() - start) / 1000), 200);
    try {
      const r = await fetch("/api/thumbnails/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images, instructions, count, singleImage: single, vary, proMode: pro }),
      });
      const j = await r.json();
      if (j.error) setError(j.error);
      else { setResults(j.images || []); loadHistory(); }
    } catch (e) { setError(String(e)); }
    finally {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setLastTime((Date.now() - start) / 1000);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-5 items-start">
        {/* ── Input ── */}
        <div className="panel p-4 space-y-3.5">
          <div className="text-[11px] uppercase tracking-widest" style={{ color: ACCENT }}>1 · Reference images <span style={{ color: "var(--fg-dimmer)" }}>· optional</span></div>

          {images.length === 0 ? (
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }}
              className="relative aspect-video rounded-lg border-2 border-dashed grid place-items-center cursor-pointer overflow-hidden transition"
              style={{ borderColor: drag ? ACCENT : "var(--line-soft)", background: drag ? `${ACCENT}10` : "rgba(0,0,0,0.25)" }}
            >
              <div className="text-center px-4">
                <Upload size={22} style={{ color: ACCENT, margin: "0 auto 6px" }} />
                <div className="text-[12.5px]" style={{ color: "var(--fg-dim)" }}>Drop image(s) or click — screenshots, a logo, your photo…</div>
                <div className="text-[10.5px] mt-0.5" style={{ color: "var(--fg-dimmer)" }}>Add as many as you like, or skip it and just use a prompt</div>
              </div>
            </div>
          ) : (
            <div
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }}
              className="grid grid-cols-3 gap-2 p-2 rounded-lg border transition"
              style={{ borderColor: drag ? ACCENT : "var(--line-soft)", background: "rgba(0,0,0,0.25)" }}
            >
              {images.map((src, i) => (
                <div key={i} className="relative aspect-video rounded overflow-hidden border" style={{ borderColor: `${ACCENT}33` }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`ref ${i + 1}`} className="w-full h-full object-cover" />
                  <button onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))} className="absolute top-0.5 right-0.5 rounded-full p-0.5" style={{ background: "rgba(0,0,0,0.65)" }} aria-label="Remove"><X size={11} style={{ color: "#fff" }} /></button>
                </div>
              ))}
              {images.length < 6 && (
                <button onClick={() => fileRef.current?.click()} className="aspect-video rounded border-2 border-dashed grid place-items-center transition hover:brightness-125" style={{ borderColor: "var(--line-soft)", color: "var(--fg-dim)" }}>
                  <span className="text-[11px]">+ add</span>
                </button>
              )}
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { onFiles(e.target.files); e.currentTarget.value = ""; }} />

          <div className="text-[11px] uppercase tracking-widest pt-1" style={{ color: ACCENT }}>2 · Instructions</div>
          <textarea
            value={instructions} onChange={(e) => setInstructions(e.target.value)}
            placeholder="e.g. Make the text way bigger and bolder, add more contrast, put my shocked face on the right, brighter background…"
            rows={4}
            className="w-full rounded-lg px-3 py-2 text-[13px] resize-none outline-none"
            style={{ background: "rgba(0,0,0,0.25)", border: "1px solid var(--line-soft)", color: "var(--fg)" }}
          />

          <div className="flex items-center gap-2">
            <span className="text-[12px]" style={{ color: "var(--fg-dim)" }}>Versions</span>
            {[1, 2, 3, 4].map((n) => (
              <button key={n} onClick={() => setCount(n)}
                className="w-8 h-8 rounded-lg text-[13px] transition"
                style={{ background: count === n ? `${ACCENT}22` : "transparent", border: `1px solid ${count === n ? ACCENT : "var(--line-soft)"}`, color: count === n ? ACCENT : "var(--fg-dim)" }}>{n}</button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-[12.5px] cursor-pointer select-none" style={{ color: "var(--fg)" }}>
            <input type="checkbox" checked={pro} onChange={(e) => setPro(e.target.checked)} className="accent-[#fb7185]" />
            <span className="font-medium" style={{ color: ACCENT }}>Redesign from scratch</span>
            <span className="text-[10.5px]" style={{ color: "var(--fg-dimmer)" }}>(off = faithful edit of your image, like ChatGPT — keeps it clean)</span>
          </label>
          <label className="flex items-center gap-2 text-[12px] cursor-pointer select-none -mt-1.5" style={{ color: "var(--fg-dim)" }}>
            <input type="checkbox" checked={single} onChange={(e) => setSingle(e.target.checked)} className="accent-[#fb7185]" />
            Prevent 4-in-1 grid
            <span className="text-[10.5px]" style={{ color: "var(--fg-dimmer)" }}>(recommended · uncheck for 100% raw prompt)</span>
          </label>
          <label className="flex items-center gap-2 text-[12px] cursor-pointer select-none -mt-1.5" style={{ color: "var(--fg-dim)" }}>
            <input type="checkbox" checked={vary} onChange={(e) => setVary(e.target.checked)} className="accent-[#fb7185]" />
            Vary each version
            <span className="text-[10.5px]" style={{ color: "var(--fg-dimmer)" }}>(different layouts/colours/backgrounds, not all the same)</span>
          </label>

          <button
            onClick={generate} disabled={busy}
            className="w-full rounded-lg py-2.5 text-[13.5px] font-medium flex items-center justify-center gap-2 transition disabled:opacity-50"
            style={{ background: ACCENT, color: "#fff" }}
          >
            {busy ? <><Loader2 size={15} className="animate-spin" /> Generating… <span className="tabular-nums font-mono">{fmtTime(elapsed)}</span></> : <><Wand2 size={15} /> Generate better versions</>}
          </button>
          {error &&<div className="text-[12px] rounded-lg p-2" style={{ background: "rgba(239,68,68,0.1)", color: "#fca5a5" }}>{error}</div>}
        </div>

        {/* ── Results ── */}
        <div className="panel p-4 min-h-[320px]">
          {busy ? (
            <div className="h-full grid place-items-center py-14 text-center">
              <div>
                <div className="text-[44px] font-bold tabular-nums leading-none" style={{ color: ACCENT, fontFamily: "'Bricolage Grotesque', sans-serif" }}>{fmtTime(elapsed)}</div>
                <div className="text-[13px] mt-2 flex items-center justify-center gap-1.5" style={{ color: "var(--fg-dim)" }}>
                  <Loader2 size={13} className="animate-spin" /> Making {count} version{count > 1 ? "s" : ""} with gpt-image-2…
                </div>
                <div className="text-[11px] mt-1" style={{ color: "var(--fg-dimmer)" }}>usually ~2 min · saving to your Obsidian Thumbnails folder</div>
                <div className="mt-3 mx-auto w-[200px] h-[4px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.min(95, (elapsed / 150) * 100)}%`, background: ACCENT, transition: "width 0.3s linear" }} />
                </div>
              </div>
            </div>
          ) : results.length ? (
            <>
            {lastTime != null && (
              <div className="text-[11.5px] mb-3" style={{ color: "var(--fg-dim)" }}>
                <span style={{ color: ACCENT }}>✓ Done in {fmtTime(lastTime)}</span> · {results.length} version{results.length > 1 ? "s" : ""} · saved to your vault
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {results.map((src, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                  className="rounded-lg overflow-hidden border group relative" style={{ borderColor: "var(--line-soft)" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`version ${i + 1}`} className="w-full aspect-video object-cover cursor-zoom-in" onClick={() => setEnlarged(src)} />
                  <a href={src} download={`thumbnail-${i + 1}.png`}
                    className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-md px-2 py-1 text-[11px] opacity-0 group-hover:opacity-100 transition"
                    style={{ background: "rgba(0,0,0,0.7)", color: "#fff" }}><Download size={12} /> Save</a>
                </motion.div>
              ))}
            </div>
            </>
          ) : (
            <div className="h-full grid place-items-center py-16 text-center">
              <div className="text-[12.5px]" style={{ color: "var(--fg-dimmer)" }}>
                Upload a thumbnail, say what to improve, and hit generate.<br />Better versions appear here — and every round teaches it your taste.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── History (from Obsidian) ── */}
      {sessions.length > 0 && (
        <div className="panel p-4">
          <div className="flex items-center gap-2 mb-3">
            <History size={14} style={{ color: ACCENT }} />
            <span className="text-[13px] font-medium" style={{ color: "var(--fg)" }}>Past thumbnails</span>
            <span className="text-[11px]" style={{ color: "var(--fg-dimmer)" }}>· logged in your vault &rarr; Thumbnails</span>
          </div>
          <div className="space-y-3">
            {sessions.map((s) => (
              <div key={s.folder} className="rounded-lg border p-3" style={{ borderColor: "var(--line-soft)" }}>
                {s.took && (
                  <div className="inline-flex items-center gap-1 text-[10.5px] font-mono mb-2 px-2 py-0.5 rounded-full" style={{ background: `${ACCENT}1f`, color: ACCENT }}>
                    <Clock size={10} /> took {s.took}
                  </div>
                )}
                <div className="text-[12.5px] mb-2" style={{ color: "var(--fg-dim)" }}>&ldquo;{s.instructions}&rdquo;</div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {(s.inputFiles || []).map((inp) => (
                    <div key={inp} className="shrink-0 relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={fileUrl(inp, 480)} loading="lazy" decoding="async" alt="reference" className="h-20 aspect-video object-cover rounded border cursor-zoom-in" style={{ borderColor: "var(--line-soft)", opacity: 0.65 }} onClick={() => setEnlarged(fileUrl(inp))} />
                      <span className="absolute top-1 left-1 text-[8px] px-1 rounded" style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }}>REF</span>
                    </div>
                  ))}
                  {s.outputs.map((o) => (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img key={o} src={fileUrl(o, 480)} loading="lazy" decoding="async" alt="version" className="h-20 aspect-video object-cover rounded border shrink-0 cursor-zoom-in" style={{ borderColor: `${ACCENT}44` }} onClick={() => setEnlarged(fileUrl(o))} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* enlarge */}
      <AnimatePresence>
        {enlarged && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 grid place-items-center p-8" style={{ background: "rgba(0,0,0,0.8)" }} onClick={() => setEnlarged(null)}>
            { }
            <motion.img initial={{ scale: 0.96 }} animate={{ scale: 1 }} exit={{ scale: 0.96 }} src={enlarged} alt="" className="max-w-[90vw] max-h-[85vh] rounded-lg" onClick={(e) => e.stopPropagation()} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

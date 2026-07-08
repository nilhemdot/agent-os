"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";

// Memory Galaxy — the cinematic view of the Obsidian vault.
// Same force-settled 3D layout + perspective projection as VaultGraph3D, but the
// render is a glowing star map: notes = stars, links = constellations, and RECENT
// notes burn brighter/whiter/bigger (real mtime data the clean graph ignores).
// Additive blending + a seeded starfield + slow auto-flythrough. Pure canvas 2D.

interface RawNode { id: string; title: string; group: string; degree: number; mtime: number; }
interface GNode extends RawNode { x: number; y: number; z: number; vx: number; vy: number; vz: number; rec: number; phase: number; }
interface RawLink { source: string; target: string; }
interface GLink { source: GNode; target: GNode; }

const PARA_COLORS: Record<string, [number, number, number]> = {
  "00 Inbox": [244, 114, 182], "01 Daily": [251, 191, 36], "02 Projects": [96, 165, 250],
  "03 Areas": [52, 211, 153], "04 Resources": [167, 139, 250], "05 Memories": [251, 113, 133],
  "06 Archive": [148, 163, 184], "Agentic OS": [34, 211, 238], "Omi": [249, 115, 22],
  "Wiki": [216, 180, 254], "root": [226, 232, 240],
};
function rgbFor(group: string): [number, number, number] {
  if (PARA_COLORS[group]) return PARA_COLORS[group];
  let h = 0; for (let i = 0; i < group.length; i++) h = (h * 31 + group.charCodeAt(i)) >>> 0;
  // hsl-ish → rgb via a quick conversion at s=0.7 l=0.6
  const hue = (h % 360) / 360, s = 0.7, l = 0.6;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const hk = (t: number) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [Math.round(hk(hue + 1 / 3) * 255), Math.round(hk(hue) * 255), Math.round(hk(hue - 1 / 3) * 255)];
}

interface Props { onOpenNote: (relPath: string) => void; }

export default function MemoryGalaxy({ onOpenNote }: Props) {
  const [raw, setRaw] = useState<{ nodes: RawNode[]; links: RawLink[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<GNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number | null>(null);

  const camRef = useRef({ yaw: 0.4, pitch: -0.42, distance: 1000, targetDistance: 1000, autoRotate: true });
  const dragRef = useRef<{ kind: "rotate" | "node" | null; node?: GNode; sx: number; sy: number; origYaw: number; origPitch: number; movedPx: number }>({ kind: null, sx: 0, sy: 0, origYaw: 0, origPitch: 0, movedPx: 0 });
  const hoverRef = useRef<GNode | null>(null);
  const onOpenNoteRef = useRef(onOpenNote);
  useEffect(() => { onOpenNoteRef.current = onOpenNote; }, [onOpenNote]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/memory/graph")
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((j) => { if (!cancelled) setRaw(j); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  // Seeded starfield (screen-space background stars) — built once.
  const starfield = useMemo(() => {
    const rand = mulberry32(99);
    return Array.from({ length: 320 }, () => ({ x: rand(), y: rand(), r: rand() * 1.3 + 0.2, a: rand() * 0.5 + 0.1, tw: rand() * Math.PI * 2 }));
  }, []);

  const sim = useMemo(() => {
    if (!raw) return null;
    const rand = mulberry32(1234567);
    // recency 0..1 from mtime
    let minM = Infinity, maxM = -Infinity;
    for (const n of raw.nodes) { if (n.mtime < minM) minM = n.mtime; if (n.mtime > maxM) maxM = n.mtime; }
    const span = Math.max(1, maxM - minM);
    const nodes: GNode[] = raw.nodes.map((n) => {
      let x = 0, y = 0, z = 0, s = 2;
      while (s >= 1 || s === 0) { x = rand() * 2 - 1; y = rand() * 2 - 1; z = rand() * 2 - 1; s = x * x + y * y + z * z; }
      const r = 350 * Math.cbrt(rand());
      const scale = r / Math.sqrt(s);
      // recency curve — bias so only genuinely recent notes pop
      const rec = Math.pow((n.mtime - minM) / span, 1.6);
      return { ...n, x: x * scale, y: y * scale, z: z * scale, vx: 0, vy: 0, vz: 0, rec, phase: rand() * Math.PI * 2 };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links: GLink[] = raw.links.map((l) => ({ source: byId.get(l.source)!, target: byId.get(l.target)! })).filter((l) => l.source && l.target);

    // Pre-settle layout (force sim) so it's static from frame 1.
    const K_REPEL = 1500, REPEL_RANGE = 300, K_LINK = 0.014, L_LINK = 95, DAMP = 0.85, BOUND_R = 470, K_BOUND = 0.014;
    let alpha = 1;
    for (let t = 0; t < 500; t++) {
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > REPEL_RANGE * REPEL_RANGE || d2 < 0.01) continue;
          const d = Math.sqrt(d2), f = (K_REPEL / d2) * alpha;
          const fx = (dx / d) * f, fy = (dy / d) * f, fz = (dz / d) * f;
          a.vx -= fx; a.vy -= fy; a.vz -= fz; b.vx += fx; b.vy += fy; b.vz += fz;
        }
      }
      for (const l of links) {
        const dx = l.target.x - l.source.x, dy = l.target.y - l.source.y, dz = l.target.z - l.source.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01, f = K_LINK * (d - L_LINK) * alpha;
        const fx = (dx / d) * f, fy = (dy / d) * f, fz = (dz / d) * f;
        l.source.vx += fx; l.source.vy += fy; l.source.vz += fz; l.target.vx -= fx; l.target.vy -= fy; l.target.vz -= fz;
      }
      for (const n of nodes) {
        const r = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
        if (r > BOUND_R) { const f = K_BOUND * (r - BOUND_R); n.vx -= (n.x / r) * f; n.vy -= (n.y / r) * f; n.vz -= (n.z / r) * f; }
      }
      for (const n of nodes) { n.vx *= DAMP; n.vy *= DAMP; n.vz *= DAMP; n.x += n.vx; n.y += n.vy; n.z += n.vz; }
      if (t > 50) alpha *= 0.99;
    }
    // Shape into a flattened spiral disc — galaxy character + breaks up the central blob.
    for (const n of nodes) {
      n.y *= 0.42;
      const R = Math.sqrt(n.x * n.x + n.z * n.z);
      const a = R * 0.0035;
      const ca = Math.cos(a), sa = Math.sin(a);
      const nx = n.x * ca - n.z * sa, nz = n.x * sa + n.z * ca;
      n.x = nx; n.z = nz;
    }
    for (const n of nodes) { n.vx = 0; n.vy = 0; n.vz = 0; }
    const hubIds = new Set([...nodes].sort((a, b) => b.degree - a.degree).slice(0, 12).map((n) => n.id));
    return { nodes, links, hubIds };
  }, [raw]);

  useEffect(() => {
    if (!sim || !canvasRef.current || !wrapRef.current) return;
    const canvas = canvasRef.current, wrap = wrapRef.current;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;
    let w = 0, h = 0, dpr = 1;
    const fit = () => {
      const r = wrap.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(200, r.width); h = Math.max(200, r.height);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(wrap);

    const project = (x: number, y: number, z: number) => {
      const cam = camRef.current;
      const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      const x1 = x * cy + z * sy, z1 = -x * sy + z * cy, y1 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
      const vz = cam.distance - z2;
      if (vz < 1) return null;
      const fov = 620;
      return { sx: w / 2 + (x1 * fov) / vz, sy: h / 2 - (y1 * fov) / vz, depthScale: fov / vz, vz };
    };

    let time = 0;
    const render = () => {
      time += 0.016;
      // deep-space background
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const grad = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.max(w, h));
      grad.addColorStop(0, "#1b1130"); grad.addColorStop(0.45, "#120a20"); grad.addColorStop(1, "#05030a");
      ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
      // nebula blobs (additive)
      ctx.globalCompositeOperation = "lighter";
      const neb = (cx: number, cy: number, rr: number, col: string) => {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr); g.addColorStop(0, col); g.addColorStop(1, "transparent");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.fill();
      };
      neb(w * 0.22, h * 0.30, Math.max(w, h) * 0.40, "rgba(124,58,237,0.10)");
      neb(w * 0.80, h * 0.62, Math.max(w, h) * 0.36, "rgba(34,211,238,0.07)");
      neb(w * 0.55, h * 0.85, Math.max(w, h) * 0.34, "rgba(212,165,116,0.06)");
      // starfield (twinkle)
      for (const s of starfield) {
        const tw = 0.55 + 0.45 * Math.sin(time * 1.5 + s.tw);
        ctx.globalAlpha = s.a * tw;
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;

      // constellation links (additive, faint)
      ctx.lineWidth = 0.7;
      for (const l of sim.links) {
        const a = project(l.source.x, l.source.y, l.source.z), b = project(l.target.x, l.target.y, l.target.z);
        if (!a || !b) continue;
        const rec = Math.max(l.source.rec, l.target.rec);
        ctx.strokeStyle = `rgba(150,170,230,${0.05 + rec * 0.18})`;
        ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
      }

      // galactic core glow
      const coreP = project(0, 0, 0);
      if (coreP) {
        const cr2 = Math.min(w, h) * 0.30;
        const cg2 = ctx.createRadialGradient(coreP.sx, coreP.sy, 0, coreP.sx, coreP.sy, cr2);
        cg2.addColorStop(0, "rgba(222,205,255,0.10)"); cg2.addColorStop(0.5, "rgba(150,110,235,0.05)"); cg2.addColorStop(1, "transparent");
        ctx.fillStyle = cg2; ctx.beginPath(); ctx.arc(coreP.sx, coreP.sy, cr2, 0, Math.PI * 2); ctx.fill();
      }

      // stars (nodes) — depth sorted, additive glow, recency = brighter/whiter/bigger
      type P = { n: GNode; sx: number; sy: number; ds: number; vz: number };
      const proj: P[] = [];
      for (const n of sim.nodes) { const p = project(n.x, n.y, n.z); if (p) proj.push({ n, sx: p.sx, sy: p.sy, ds: p.depthScale, vz: p.vz }); }
      proj.sort((a, b) => b.vz - a.vz);
      for (const p of proj) {
        const n = p.n;
        const twinkle = 0.8 + 0.2 * Math.sin(time * 2 + n.phase);
        const baseR = Math.min((2.2 + Math.sqrt(n.degree) * 1.3) * p.ds, 9);
        const r = baseR * (1 + n.rec * 0.9);          // recent = bigger
        if (r < 0.4) continue;
        const [cr, cg, cb] = rgbFor(n.group);
        // recent stars shift toward white-hot
        const wr = Math.round(cr + (255 - cr) * n.rec), wg = Math.round(cg + (255 - cg) * n.rec), wb = Math.round(cb + (255 - cb) * n.rec);
        const haloR = r * (2.4 + n.rec * 3.2);
        const halo = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, haloR);
        halo.addColorStop(0, `rgba(${wr},${wg},${wb},${(0.07 + n.rec * 0.4) * twinkle})`);
        halo.addColorStop(1, "transparent");
        ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(p.sx, p.sy, haloR, 0, Math.PI * 2); ctx.fill();
        // bright core — only recent stars burn white-hot; the bulk stays soft
        ctx.fillStyle = `rgba(${wr},${wg},${wb},${(0.4 + n.rec * 0.5) * twinkle})`;
        ctx.beginPath(); ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(255,255,255,${(0.32 + n.rec * 0.6) * twinkle})`;
        ctx.beginPath(); ctx.arc(p.sx, p.sy, r * 0.4, 0, Math.PI * 2); ctx.fill();
      }

      // labels — top hubs only, with overlap avoidance (no more text mosaic)
      ctx.globalCompositeOperation = "source-over";
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      const placed: { x: number; y: number }[] = [];
      const labelCandidates = proj.filter((p) => sim.hubIds.has(p.n.id)).sort((a, b) => a.vz - b.vz);
      for (const p of labelCandidates) {
        const fs = Math.min(13, Math.max(10, 12 * p.ds));
        if (fs < 9) continue;
        if (placed.some((q) => Math.abs(q.x - p.sx) < 80 && Math.abs(q.y - p.sy) < 15)) continue;
        const r = Math.min((2.2 + Math.sqrt(p.n.degree) * 1.3) * p.ds, 9) * (1 + p.n.rec * 0.9);
        ctx.font = `${fs}px var(--font-geist-sans, system-ui)`;
        ctx.lineWidth = 2.5; ctx.strokeStyle = "rgba(0,0,0,0.8)"; ctx.fillStyle = "rgba(232,236,250,0.9)";
        ctx.strokeText(p.n.title, p.sx, p.sy + r + 4); ctx.fillText(p.n.title, p.sx, p.sy + r + 4);
        placed.push({ x: p.sx, y: p.sy });
      }

      // hover ring
      const hov = hoverRef.current;
      if (hov) { const p = project(hov.x, hov.y, hov.z); if (p) { const r = (4 + Math.sqrt(hov.degree) * 2) * p.depthScale; ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.sx, p.sy, r + 5, 0, Math.PI * 2); ctx.stroke(); } }
      ctx.restore();
    };

    const loop = () => {
      const cam = camRef.current;
      cam.distance += (cam.targetDistance - cam.distance) * 0.18;
      if (cam.autoRotate && dragRef.current.kind === null) { cam.yaw += 0.0009; cam.pitch = -0.18 + Math.sin(Date.now() * 0.00006) * 0.06; }
      render();
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    const pick = (sx: number, sy: number): GNode | null => {
      let best: GNode | null = null, bestD2 = Infinity;
      for (const n of sim.nodes) { const p = project(n.x, n.y, n.z); if (!p) continue; const r = (5 + Math.sqrt(n.degree) * 2) * p.depthScale; const dx = p.sx - sx, dy = p.sy - sy, d2 = dx * dx + dy * dy, hit = (r + 6) * (r + 6); if (d2 <= hit && d2 < bestD2) { bestD2 = d2; best = n; } }
      return best;
    };
    const onPointerDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect(), sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const node = pick(sx, sy);
      if (node) dragRef.current = { kind: "node", node, sx, sy, origYaw: 0, origPitch: 0, movedPx: 0 };
      else { camRef.current.autoRotate = false; dragRef.current = { kind: "rotate", sx, sy, origYaw: camRef.current.yaw, origPitch: camRef.current.pitch, movedPx: 0 }; }
      canvas.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect(), sx = e.clientX - rect.left, sy = e.clientY - rect.top, d = dragRef.current;
      if (d.kind === "rotate") {
        const dx = sx - d.sx, dy = sy - d.sy; d.movedPx = Math.max(d.movedPx, Math.abs(dx) + Math.abs(dy));
        camRef.current.yaw = d.origYaw + dx * 0.005;
        camRef.current.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, d.origPitch + dy * 0.005));
      } else if (d.kind === "node" && d.node) {
        d.movedPx = Math.max(d.movedPx, Math.abs(sx - d.sx) + Math.abs(sy - d.sy));
        const p = project(d.node.x, d.node.y, d.node.z);
        if (p) { const dxW = (sx - p.sx) / p.depthScale, dyW = -(sy - p.sy) / p.depthScale, cam = camRef.current, cy = Math.cos(cam.yaw), sy_ = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch); d.node.x += dxW * cy + dyW * (sy_ * sp); d.node.y += dyW * cp; d.node.z += dxW * -sy_ + dyW * (cy * sp); }
      } else {
        const n = pick(sx, sy);
        if (hoverRef.current !== n) { hoverRef.current = n; setHover(n); }
        canvas.style.cursor = n ? "pointer" : "grab";
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      const d = dragRef.current, wasClick = d.movedPx < 4, node = d.kind === "node" ? d.node : null;
      dragRef.current = { kind: null, sx: 0, sy: 0, origYaw: 0, origPitch: 0, movedPx: 0 };
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
      if (node && wasClick) onOpenNoteRef.current(node.id);
    };
    const onWheel = (e: WheelEvent) => { e.preventDefault(); camRef.current.targetDistance = Math.max(150, Math.min(2600, camRef.current.targetDistance * Math.pow(1.0015, e.deltaY))); };
    const onDouble = () => { camRef.current.autoRotate = !camRef.current.autoRotate; };
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", onDouble);
    canvas.style.cursor = "grab";
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", onDouble);
    };
  }, [sim, starfield]);

  const stats = useMemo(() => raw ? { nodes: raw.nodes.length, links: raw.links.length } : null, [raw]);

  if (error) return <div className="absolute inset-0 grid place-items-center text-center p-6"><div className="text-sm text-[var(--fg-dim)]">Galaxy failed: <code>{error}</code></div></div>;
  if (!raw) return <div className="absolute inset-0 grid place-items-center text-center p-6"><div><Loader2 size={20} className="mx-auto mb-2 animate-spin text-[var(--fg-dim)]" /><div className="text-[12px] text-[var(--fg-dim)]">Charting your memory galaxy…</div></div></div>;

  return (
    <div className="absolute inset-0" ref={wrapRef}>
      <canvas ref={canvasRef} className="absolute inset-0 block" />
      <div className="absolute top-3 left-3 pointer-events-none z-10">
        <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] flex items-center gap-1.5"><Sparkles size={11} /> Memory Galaxy</div>
        {stats && <div className="text-[11px] text-[var(--fg-dim)] mt-0.5"><span className="text-[var(--fg)] metric">{stats.nodes}</span> stars · <span className="text-[var(--fg)] metric">{stats.links}</span> links</div>}
        <div className="text-[10px] text-[var(--fg-dimmer)] mt-2">drag to orbit · scroll to zoom · click a star · double-click to pause flight</div>
        <div className="text-[10px] text-[var(--fg-dimmer)] mt-1">✦ brighter &amp; whiter = more recently touched</div>
      </div>
      {hover && (
        <div className="absolute bottom-3 right-3 pointer-events-none z-10 px-3 py-1.5 rounded-md bg-[rgba(0,0,0,0.7)] border border-[rgba(255,255,255,0.12)] max-w-[300px]">
          <div className="text-[12px] text-[var(--fg)] truncate flex items-center gap-1.5"><Sparkles size={11} className="text-[var(--fg-dim)]" />{hover.title}</div>
          <div className="text-[10px] text-[var(--fg-dimmer)] truncate">{hover.group} · {hover.degree} links</div>
        </div>
      )}
    </div>
  );
}

function mulberry32(seed: number): () => number {
  return function () { let t = (seed += 0x6D2B79F5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

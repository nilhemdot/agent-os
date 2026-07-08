"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";

// Self-contained 3D knowledge graph: a hand-rolled force simulation in 3D space,
// rendered to a 2D canvas via perspective projection. No external graph libs.
// Drag to rotate the camera, scroll to zoom, click a node to open it.

interface RawNode { id: string; title: string; group: string; degree: number; mtime: number; }
interface GNode extends RawNode {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
}
interface RawLink { source: string; target: string; }
interface GLink { source: GNode; target: GNode; }

const PARA_COLORS: Record<string, string> = {
  "00 Inbox":     "#f472b6",
  "01 Daily":     "#fbbf24",
  "02 Projects":  "#60a5fa",
  "03 Areas":     "#34d399",
  "04 Resources": "#a78bfa",
  "05 Memories":  "#fb7185",
  "06 Archive":   "#94a3b8",
  "Agentic OS":   "#22d3ee",
  "Omi":          "#f97316",
  "Wiki":         "#d8b4fe",
  "root":         "#e2e8f0",
};
function colorFor(group: string): string {
  if (PARA_COLORS[group]) return PARA_COLORS[group];
  let h = 0; for (let i = 0; i < group.length; i++) h = (h * 31 + group.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 70%, 60%)`;
}

interface Props { onOpenNote: (relPath: string) => void; }

export default function VaultGraph3D({ onOpenNote }: Props) {
  const [raw, setRaw] = useState<{ nodes: RawNode[]; links: RawLink[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<GNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number | null>(null);

  // Camera state — yaw rotates around Y axis, pitch around X axis.
  // distance controls zoom. autoRotate adds gentle idle rotation.
  const camRef = useRef({ yaw: 0.4, pitch: -0.2, distance: 900, targetDistance: 900, autoRotate: false });
  const dragRef = useRef<{ kind: "rotate" | "node" | null; node?: GNode; sx: number; sy: number; origYaw: number; origPitch: number; movedPx: number }>({ kind: null, sx: 0, sy: 0, origYaw: 0, origPitch: 0, movedPx: 0 });

  // Refs that mirror render-time state. Reading hover/onOpenNote through refs
  // means the main useEffect (which builds canvas listeners and the RAF loop)
  // can have `[sim]` as its only dep — no re-mount on hover, no canvas teardown
  // flash on mouse move. This is the root cause of the flicker the user reported.
  const hoverRef = useRef<GNode | null>(null);
  const onOpenNoteRef = useRef(onOpenNote);
  useEffect(() => { onOpenNoteRef.current = onOpenNote; }, [onOpenNote]);

  // Fetch graph data
  useEffect(() => {
    let cancelled = false;
    fetch("/api/memory/graph")
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((j) => { if (!cancelled) setRaw(j); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  // Build simulation nodes with random initial positions inside a sphere of radius 200.
  const sim = useMemo(() => {
    if (!raw) return null;
    const rand = mulberry32(1234567);
    const nodes: GNode[] = raw.nodes.map((n) => {
      // Marsaglia sphere sample so positions are evenly distributed
      let x = 0, y = 0, z = 0, s = 2;
      while (s >= 1 || s === 0) {
        x = rand() * 2 - 1; y = rand() * 2 - 1; z = rand() * 2 - 1;
        s = x * x + y * y + z * z;
      }
      const r = 350 * Math.cbrt(rand()); // wider initial spawn for more breathing room
      const scale = r / Math.sqrt(s);
      return { ...n, x: x * scale, y: y * scale, z: z * scale, vx: 0, vy: 0, vz: 0 };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links: GLink[] = raw.links
      .map((l) => ({ source: byId.get(l.source)!, target: byId.get(l.target)! }))
      .filter((l) => l.source && l.target);

    // Pre-settle the layout synchronously so the graph appears static from frame 1.
    // 500 ticks × ~19k ops each = ~100ms on modern hardware. Acceptable one-off cost
    // in exchange for "no visible motion ever" = no flicker.
    const K_REPEL = 1200, REPEL_RANGE = 250, K_LINK = 0.015, L_LINK = 60;
    const DAMP = 0.85, BOUND_R = 400, K_BOUND = 0.015;
    let alpha = 1;
    for (let t = 0; t < 500; t++) {
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > REPEL_RANGE * REPEL_RANGE || d2 < 0.01) continue;
          const d = Math.sqrt(d2);
          const f = (K_REPEL / d2) * alpha;
          const fx = (dx / d) * f, fy = (dy / d) * f, fz = (dz / d) * f;
          a.vx -= fx; a.vy -= fy; a.vz -= fz;
          b.vx += fx; b.vy += fy; b.vz += fz;
        }
      }
      for (const l of links) {
        const dx = l.target.x - l.source.x, dy = l.target.y - l.source.y, dz = l.target.z - l.source.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
        const f = K_LINK * (d - L_LINK) * alpha;
        const fx = (dx / d) * f, fy = (dy / d) * f, fz = (dz / d) * f;
        l.source.vx += fx; l.source.vy += fy; l.source.vz += fz;
        l.target.vx -= fx; l.target.vy -= fy; l.target.vz -= fz;
      }
      for (const n of nodes) {
        const r = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
        if (r > BOUND_R) {
          const f = K_BOUND * (r - BOUND_R);
          n.vx -= (n.x / r) * f; n.vy -= (n.y / r) * f; n.vz -= (n.z / r) * f;
        }
      }
      for (const n of nodes) {
        n.vx *= DAMP; n.vy *= DAMP; n.vz *= DAMP;
        n.x += n.vx; n.y += n.vy; n.z += n.vz;
      }
      if (t > 50) alpha *= 0.99;
    }
    // Zero velocities so nothing drifts after we hand off to the render loop
    for (const n of nodes) { n.vx = 0; n.vy = 0; n.vz = 0; }

    return { nodes, links };
  }, [raw]);

  // Render + simulation loop
  useEffect(() => {
    if (!sim || !canvasRef.current || !wrapRef.current) return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
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

    // Layout is pre-settled in useMemo above. The runtime sim is only used to
    // absorb perturbations from user node-drag, then immediately re-freezes.
    const K_REPEL = 1200, REPEL_RANGE = 250, K_LINK = 0.015, L_LINK = 60;
    const DAMP = 0.85, BOUND_R = 400, K_BOUND = 0.015;

    let alpha = 0;        // 0 = sim contributes no force → no movement
    let tickCount = 1000; // start above the freeze threshold
    let frozen = true;    // graph is static from the very first paint

    const tickSim = () => {
      const nodes = sim.nodes; const links = sim.links;
      // Repulsion (O(n²) — fine for ~200 nodes)
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > REPEL_RANGE * REPEL_RANGE || d2 < 0.01) continue;
          const d = Math.sqrt(d2);
          const f = (K_REPEL / d2) * alpha;
          const fx = (dx / d) * f, fy = (dy / d) * f, fz = (dz / d) * f;
          a.vx -= fx; a.vy -= fy; a.vz -= fz;
          b.vx += fx; b.vy += fy; b.vz += fz;
        }
      }
      // Link springs
      for (const l of links) {
        const dx = l.target.x - l.source.x, dy = l.target.y - l.source.y, dz = l.target.z - l.source.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
        const f = K_LINK * (d - L_LINK) * alpha;
        const fx = (dx / d) * f, fy = (dy / d) * f, fz = (dz / d) * f;
        l.source.vx += fx; l.source.vy += fy; l.source.vz += fz;
        l.target.vx -= fx; l.target.vy -= fy; l.target.vz -= fz;
      }
      // Soft spherical bound — only kicks in for stragglers outside BOUND_R.
      // Replaces the buggy center-force that caused the previous collapse.
      for (const n of nodes) {
        const r = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
        if (r > BOUND_R) {
          const f = K_BOUND * (r - BOUND_R);
          n.vx -= (n.x / r) * f; n.vy -= (n.y / r) * f; n.vz -= (n.z / r) * f;
        }
      }
      // Integrate
      const heldNode = dragRef.current.kind === "node" ? dragRef.current.node : null;
      for (const n of nodes) {
        if (n === heldNode) { n.vx = 0; n.vy = 0; n.vz = 0; continue; }
        n.vx *= DAMP; n.vy *= DAMP; n.vz *= DAMP;
        n.x += n.vx; n.y += n.vy; n.z += n.vz;
      }
      tickCount++;
      if (tickCount > 50) alpha *= 0.99;
      // Once the layout settles, freeze positions completely so additive-blended
      // halos don't shimmer from sub-pixel node motion every frame. User drags
      // un-freeze automatically (see onPointerMove/onPointerDown).
      if (tickCount > 500 || alpha < 0.05) {
        frozen = true;
        // Zero velocities so re-thawing doesn't suddenly launch nodes
        for (const n of sim.nodes) { n.vx = 0; n.vy = 0; n.vz = 0; }
      }
    };

    // Project a world point through the camera onto the 2D canvas.
    // Yaw rotates around Y, pitch around X. Then a perspective divide.
    const project = (x: number, y: number, z: number) => {
      const cam = camRef.current;
      const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
      const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      // Rotate around Y (yaw)
      const x1 = x * cy + z * sy;
      const z1 = -x * sy + z * cy;
      // Rotate around X (pitch)
      const y1 = y * cp - z1 * sp;
      const z2 = y * sp + z1 * cp;
      // Camera sits at +distance along Z; subtract to get view-space Z
      const vz = cam.distance - z2;
      if (vz < 1) return null; // behind camera
      const fov = 600; // focal length in pixels — bigger = less distortion
      const sx = w / 2 + (x1 * fov) / vz;
      const screenY = h / 2 - (y1 * fov) / vz;
      // depth scale 0..1 (closer = bigger)
      const depthScale = fov / vz;
      return { sx, sy: screenY, depthScale, vz };
    };

    const render = () => {
      // Background — radial gradient painted directly so we don't need any DOM overlay
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const grad = ctx.createRadialGradient(w / 2, h * 0.4, 0, w / 2, h * 0.4, Math.max(w, h));
      grad.addColorStop(0, "#1a0f3d");
      grad.addColorStop(0.5, "#0a0518");
      grad.addColorStop(1, "#000000");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Project every node up-front so we can depth-sort.
      type Projected = { n: GNode; sx: number; sy: number; ds: number; vz: number };
      const proj: (Projected | null)[] = sim.nodes.map((n) => {
        const p = project(n.x, n.y, n.z);
        return p ? { n, sx: p.sx, sy: p.sy, ds: p.depthScale, vz: p.vz } : null;
      });

      // Links — thin, subtle, single-pass (no additive blending, no glow blobs).
      // This is what gives Obsidian its clean look.
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = "rgba(150,160,200,0.18)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (const l of sim.links) {
        const a = project(l.source.x, l.source.y, l.source.z);
        const b = project(l.target.x, l.target.y, l.target.z);
        if (!a || !b) continue;
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
      }
      ctx.stroke();

      // Depth-sort projected nodes: paint far ones first so near ones overlap correctly
      const sortedIdx = proj
        .map((p, i) => ({ p, i }))
        .filter((o): o is { p: Projected; i: number } => o.p !== null)
        .sort((a, b) => b.p.vz - a.p.vz);

      // Solid dots — capped at 10px so zooming in doesn't turn them into blobs.
      // This is the key to clean Obsidian-style visuals at any zoom level.
      const MAX_R = 10;
      for (const { p } of sortedIdx) {
        const raw = (3 + Math.sqrt(p.n.degree) * 1.6) * p.ds;
        const r = Math.min(raw, MAX_R);
        if (r < 0.4) continue;
        ctx.fillStyle = colorFor(p.n.group);
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Labels: ONLY hubs (degree ≥ 5). Capped at 13px so zooming in keeps them
      // readable instead of swallowing the screen. Thin 1px outline for legibility
      // without the blocky text-mosaic look.
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (const { p } of sortedIdx) {
        if (p.n.degree < 5) continue;
        const fontSize = Math.min(13, Math.max(9, 11 * p.ds));
        if (fontSize < 8) continue; // skip when zoomed way out
        const r = Math.min((3 + Math.sqrt(p.n.degree) * 1.6) * p.ds, MAX_R);
        ctx.font = `${fontSize}px var(--font-geist-sans, system-ui)`;
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(0,0,0,0.9)";
        ctx.fillStyle = "rgba(230,235,255,0.95)";
        ctx.strokeText(p.n.title, p.sx, p.sy + r + 4);
        ctx.fillText(p.n.title, p.sx, p.sy + r + 4);
      }

      // Hover ring — read through ref so the effect doesn't depend on `hover` state
      const hov = hoverRef.current;
      if (hov) {
        const p = project(hov.x, hov.y, hov.z);
        if (p) {
          const r = (4 + Math.sqrt(hov.degree) * 2) * p.depthScale;
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, r + 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    };

    const loop = () => {
      if (!frozen) tickSim();
      // Smooth zoom: gently lerp distance toward targetDistance each frame.
      // This turns 10 wheel events fired in 50ms into a smooth ~400ms zoom
      // instead of an instant jump, eliminating the "flashing" perception.
      const cam = camRef.current;
      cam.distance += (cam.targetDistance - cam.distance) * 0.18;
      if (cam.autoRotate && dragRef.current.kind === null) cam.yaw += 0.0005;
      render();
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    // Re-heat the simulation when the user grabs a node so neighbours can adjust.
    const thaw = () => { frozen = false; alpha = Math.max(alpha, 0.4); tickCount = 50; };

    // Pick a node by screen-space distance to projected position.
    const pick = (sx: number, sy: number): GNode | null => {
      let best: GNode | null = null;
      let bestD2 = Infinity;
      for (const n of sim.nodes) {
        const p = project(n.x, n.y, n.z);
        if (!p) continue;
        const r = (4 + Math.sqrt(n.degree) * 2) * p.depthScale;
        const dx = p.sx - sx, dy = p.sy - sy;
        const d2 = dx * dx + dy * dy;
        const hit = (r + 5) * (r + 5);
        if (d2 <= hit && d2 < bestD2) { bestD2 = d2; best = n; }
      }
      return best;
    };

    const onPointerDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const node = pick(sx, sy);
      if (node) {
        dragRef.current = { kind: "node", node, sx, sy, origYaw: 0, origPitch: 0, movedPx: 0 };
        thaw();
      } else {
        camRef.current.autoRotate = false; // user took over
        dragRef.current = { kind: "rotate", sx, sy, origYaw: camRef.current.yaw, origPitch: camRef.current.pitch, movedPx: 0 };
      }
      canvas.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const d = dragRef.current;
      if (d.kind === "rotate") {
        const dx = sx - d.sx, dy = sy - d.sy;
        d.movedPx = Math.max(d.movedPx, Math.abs(dx) + Math.abs(dy));
        camRef.current.yaw = d.origYaw + dx * 0.005;
        camRef.current.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, d.origPitch + dy * 0.005));
      } else if (d.kind === "node" && d.node) {
        d.movedPx = Math.max(d.movedPx, Math.abs(sx - d.sx) + Math.abs(sy - d.sy));
        // Drag the node along the camera plane — convert screen Δ back to world
        const p = project(d.node.x, d.node.y, d.node.z);
        if (p) {
          const dxW = (sx - p.sx) / p.depthScale;
          const dyW = -(sy - p.sy) / p.depthScale;
          // Convert from camera-space dx/dy to world-space using inverse rotation
          const cam = camRef.current;
          const cy = Math.cos(cam.yaw), sy_ = Math.sin(cam.yaw);
          const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
          // Camera basis vectors in world space:
          // right = (cos yaw, 0, -sin yaw)
          // up    = (sin yaw * sin pitch, cos pitch, cos yaw * sin pitch)
          d.node.x += dxW * cy + dyW * (sy_ * sp);
          d.node.y += dyW * cp;
          d.node.z += dxW * -sy_ + dyW * (cy * sp);
          thaw();
        }
      } else {
        const n = pick(sx, sy);
        // Update ref unconditionally (cheap), but only call setHover when the
        // hovered node actually changes — avoids per-pixel React re-renders.
        if (hoverRef.current !== n) {
          hoverRef.current = n;
          setHover(n);
        }
        canvas.style.cursor = n ? "pointer" : "grab";
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      const d = dragRef.current;
      const wasClick = d.movedPx < 4;
      const node = d.kind === "node" ? d.node : null;
      dragRef.current = { kind: null, sx: 0, sy: 0, origYaw: 0, origPitch: 0, movedPx: 0 };
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
      if (node && wasClick) onOpenNoteRef.current(node.id);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.pow(1.0015, e.deltaY);
      camRef.current.targetDistance = Math.max(150, Math.min(2500, camRef.current.targetDistance * factor));
    };
    const onDoubleClick = () => { camRef.current.autoRotate = !camRef.current.autoRotate; };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", onDoubleClick);
    canvas.style.cursor = "grab";

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", onDoubleClick);
    };
    // CRITICAL: only `sim` in deps. hover & onOpenNote are read via refs above
    // so this effect runs exactly once per layout — no canvas teardown on hover.
  }, [sim]);

  const stats = useMemo(() => {
    if (!raw) return null;
    const groups = new Map<string, number>();
    for (const n of raw.nodes) groups.set(n.group, (groups.get(n.group) ?? 0) + 1);
    return {
      nodes: raw.nodes.length, links: raw.links.length,
      groups: Array.from(groups.entries()).sort((a, b) => b[1] - a[1]),
    };
  }, [raw]);

  if (error) {
    return (
      <div className="absolute inset-0 grid place-items-center text-center p-6">
        <div className="text-sm text-[var(--fg-dim)]">Graph failed: <code>{error}</code></div>
      </div>
    );
  }
  if (!raw) {
    return (
      <div className="absolute inset-0 grid place-items-center text-center p-6">
        <div>
          <Loader2 size={20} className="mx-auto mb-2 animate-spin text-[var(--fg-dim)]" />
          <div className="text-[12px] text-[var(--fg-dim)]">Building knowledge graph…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0" ref={wrapRef}>
      <canvas ref={canvasRef} className="absolute inset-0 block" />
      <div className="absolute top-3 left-3 pointer-events-none z-10">
        <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">Knowledge Graph · 3D</div>
        {stats && (
          <div className="text-[11px] text-[var(--fg-dim)] mt-0.5">
            <span className="text-[var(--fg)] metric">{stats.nodes}</span> notes ·
            <span className="text-[var(--fg)] metric"> {stats.links}</span> links
          </div>
        )}
        <div className="text-[10px] text-[var(--fg-dimmer)] mt-2">drag to rotate · scroll to zoom · click a node · double-click to auto-spin</div>
      </div>
      {stats && (
        <div className="absolute bottom-3 left-3 pointer-events-none z-10 flex flex-wrap gap-1.5 max-w-[60%]">
          {stats.groups.slice(0, 10).map(([g, c]) => (
            <div key={g} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[rgba(0,0,0,0.5)] border border-[rgba(255,255,255,0.08)]">
              <span className="w-2 h-2 rounded-full" style={{ background: colorFor(g), boxShadow: `0 0 6px ${colorFor(g)}` }} />
              <span className="text-[10px] text-[var(--fg-dim)]">{g}</span>
              <span className="text-[10px] text-[var(--fg-dimmer)] metric">{c}</span>
            </div>
          ))}
        </div>
      )}
      {hover && (
        <div className="absolute bottom-3 right-3 pointer-events-none z-10 px-3 py-1.5 rounded-md bg-[rgba(0,0,0,0.7)] border border-[rgba(255,255,255,0.12)] max-w-[300px]">
          <div className="text-[12px] text-[var(--fg)] truncate flex items-center gap-1.5">
            <Sparkles size={11} className="text-[var(--fg-dim)]" />
            {hover.title}
          </div>
          <div className="text-[10px] text-[var(--fg-dimmer)] truncate">{hover.group} · {hover.degree} links</div>
        </div>
      )}
    </div>
  );
}

// Seeded PRNG so node positions are deterministic across reloads — same vault → same layout.
function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexWithAlpha(color: string, a: number): string {
  if (color.startsWith("#") && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  if (color.startsWith("hsl(")) return color.replace("hsl(", "hsla(").replace(")", `,${a})`);
  return color;
}

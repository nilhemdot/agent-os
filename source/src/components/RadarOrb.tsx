"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

// A living, ominous particle orb for The Radar oracle: ~12k glowing points that hold the
// HERMES GOD face (sampled from the oracle image) staring out, then dissolve to a turbulent
// sphere and reform. Bright core + dim halo for glow, red embers, brightness flicker, and a
// drifting amber/cyan ember field behind it. Spins up + reddens when sweeping. Pure three.js.

const N = 12000;
const AMB = 360;

function fib(i: number, n: number, r: number): [number, number, number] {
  const phi = Math.acos(1 - (2 * (i + 0.5)) / n);
  const theta = Math.PI * (1 + Math.sqrt(5)) * i;
  return [r * Math.cos(theta) * Math.sin(phi), r * Math.sin(theta) * Math.sin(phi), r * Math.cos(phi)];
}

function sampleFace(img: HTMLImageElement, count: number, r: number): Float32Array | null {
  const W = 240, H = 240;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d", { willReadFrequently: true }); if (!ctx) return null;
  ctx.drawImage(img, 0, 0, W, H);
  let data: Uint8ClampedArray;
  try { data = ctx.getImageData(0, 0, W, H).data; } catch { return null; }
  const bright: [number, number, number][] = [];
  // sample only the well-lit FACE features (eyes, helmet, outline) so particles read as a face, not a glow blob
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const idx = (y * W + x) * 4;
    const b = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
    // sample the whole lit face (incl. the dimmer interior fill) so it's SOLID, not a hollow outline
    if (b > 26) bright.push([(x / W - 0.5) * 2 * r * 1.3, -(y / H - 0.5) * 2 * r * 1.3, (b / 255 - 0.5) * r * 0.22]);
  }
  if (bright.length < 50) return null;
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const p = bright[(Math.random() * bright.length) | 0];
    out[i * 3] = p[0] + (Math.random() - 0.5) * 0.025;
    out[i * 3 + 1] = p[1] + (Math.random() - 0.5) * 0.025;
    out[i * 3 + 2] = p[2] + (Math.random() - 0.5) * 0.025;
  }
  return out;
}

function glowSprite(): THREE.Texture {
  const s = 64; const cv = document.createElement("canvas"); cv.width = cv.height = s;
  const ctx = cv.getContext("2d")!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.22, "rgba(190,248,255,0.95)");
  g.addColorStop(0.5, "rgba(34,211,238,0.4)");
  g.addColorStop(1, "rgba(34,211,238,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  const t = new THREE.Texture(cv); t.needsUpdate = true; return t;
}

export default function RadarOrb({ image, sweeping = false }: { image: string; sweeping?: boolean }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sweepRef = useRef(sweeping);
  useEffect(() => { sweepRef.current = sweeping; }, [sweeping]);

  useEffect(() => {
    const mount = mountRef.current; if (!mount) return;
    const DPR = Math.min(2, window.devicePixelRatio || 1);
    const SIZE = 340;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }); }
    catch { return; }
    renderer.setPixelRatio(DPR); renderer.setSize(SIZE, SIZE, false);
    renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%";
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100); camera.position.z = 3.3;

    const R = 1.18;
    const sphere = new Float32Array(N * 3);
    const colors = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    const cCy = new THREE.Color("#22d3ee"), cWhite = new THREE.Color("#ecffff"), cRed = new THREE.Color("#ff3b5c"), cAmb = new THREE.Color("#ffb454");
    for (let i = 0; i < N; i++) {
      const [x, y, z] = fib(i, N, R);
      sphere[i * 3] = x; sphere[i * 3 + 1] = y; sphere[i * 3 + 2] = z;
      const rnd = Math.random();
      let c: THREE.Color;
      if (rnd < 0.07) c = cRed.clone();                 // ominous red embers
      else if (rnd < 0.12) c = cAmb.clone();            // amber sparks
      else if (rnd < 0.32) c = cWhite.clone();          // hot highlights
      else c = cCy.clone().lerp(cWhite, Math.random() * 0.4);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      seed[i] = Math.random() * Math.PI * 2;
    }
    const cur = sphere.slice();
    let face: Float32Array | null = null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(cur, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const sprite = glowSprite();
    const matCore = new THREE.PointsMaterial({ size: 0.026, map: sprite, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, opacity: 1 });
    const matHalo = new THREE.PointsMaterial({ size: 0.055, map: sprite, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, opacity: 0.16 });
    const halo = new THREE.Points(geo, matHalo); scene.add(halo);
    const core = new THREE.Points(geo, matCore); scene.add(core);

    // inner glow
    const glowMesh = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(glowMesh);

    // drifting ember field behind
    const ambPos = new Float32Array(AMB * 3); const ambCol = new Float32Array(AMB * 3); const ambSeed = new Float32Array(AMB);
    for (let i = 0; i < AMB; i++) {
      ambPos[i * 3] = (Math.random() - 0.5) * 5; ambPos[i * 3 + 1] = (Math.random() - 0.5) * 5; ambPos[i * 3 + 2] = (Math.random() - 0.5) * 2 - 1;
      const c = Math.random() < 0.5 ? cCy.clone() : cAmb.clone(); ambCol[i * 3] = c.r; ambCol[i * 3 + 1] = c.g; ambCol[i * 3 + 2] = c.b;
      ambSeed[i] = Math.random() * 6.28;
    }
    const ambGeo = new THREE.BufferGeometry();
    ambGeo.setAttribute("position", new THREE.BufferAttribute(ambPos, 3));
    ambGeo.setAttribute("color", new THREE.BufferAttribute(ambCol, 3));
    const ambMat = new THREE.PointsMaterial({ size: 0.05, map: sprite, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 });
    const amb = new THREE.Points(ambGeo, ambMat); scene.add(amb);

    // crackling lightning arcs across the orb (electric, alive)
    const ARCS = 8, SEG = 10, VPA = (SEG - 1) * 2;
    const arcPos = new Float32Array(ARCS * VPA * 3);
    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute("position", new THREE.BufferAttribute(arcPos, 3));
    const arcMat = new THREE.LineBasicMaterial({ color: 0xbdf7ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const arcs = new THREE.LineSegments(arcGeo, arcMat); scene.add(arcs);
    const surfPt = (rr: number): THREE.Vector3 => {
      const u = Math.random(), v = Math.random();
      const th = 2 * Math.PI * u, ph = Math.acos(2 * v - 1);
      return new THREE.Vector3(Math.cos(th) * Math.sin(ph), Math.sin(th) * Math.sin(ph), Math.cos(ph)).multiplyScalar(rr);
    };
    const regenArcs = (rr: number, hot: boolean) => {
      const tmp: number[][] = [];
      for (let k = 0; k < ARCS; k++) {
        const A = surfPt(rr), B = surfPt(rr);
        const pts: THREE.Vector3[] = [];
        for (let s = 0; s < SEG; s++) {
          const f = s / (SEG - 1);
          const p = A.clone().lerp(B, f);
          if (s > 0 && s < SEG - 1) p.add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5));
          pts.push(p);
        }
        for (let s = 0; s < SEG - 1; s++) { tmp.push([pts[s].x, pts[s].y, pts[s].z]); tmp.push([pts[s + 1].x, pts[s + 1].y, pts[s + 1].z]); }
      }
      for (let i = 0; i < tmp.length && i < ARCS * VPA; i++) { arcPos[i * 3] = tmp[i][0]; arcPos[i * 3 + 1] = tmp[i][1]; arcPos[i * 3 + 2] = tmp[i][2]; }
      (arcGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      arcMat.color.setHex(hot ? 0xff6b8a : 0xbdf7ff);
    };
    let lastArc = -1;

    const im = new Image(); im.crossOrigin = "anonymous";
    im.onload = () => { face = sampleFace(im, N, R); };
    im.src = image;

    let raf = 0; const t0 = performance.now();
    const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;
    const ambAttr = ambGeo.getAttribute("position") as THREE.BufferAttribute;

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const t = (performance.now() - t0) / 1000;
      const sw = sweepRef.current;
      // the HERMES GOD FACE is the default, persistent state — it breathes and only briefly
      // swirls out toward a sphere, so the god is always recognizable staring out of the orb
      const breath = (Math.sin(t * (sw ? 0.4 : 0.2)) + 1) / 2;
      // mostly the solid face, but every ~10s it swirls out toward a sphere and reforms (dramatic, alive)
      const dissolve = Math.pow(Math.max(0, Math.sin(t * 0.3 - 1.2)), 8);
      const m = face ? Math.max(0.2, 0.97 - dissolve * 0.72) + 0.03 * breath : 0;
      const turb = (sw ? 0.045 : 0.012 + dissolve * 0.06) * (1 + 0.3 * Math.sin(t * 0.7));
      for (let i = 0; i < N; i++) {
        const j = i * 3;
        const sx = sphere[j], sy = sphere[j + 1], sz = sphere[j + 2];
        let tx = sx, ty = sy, tz = sz;
        if (face) { tx = sx + (face[j] - sx) * m; ty = sy + (face[j + 1] - sy) * m; tz = sz + (face[j + 2] - sz) * m; }
        const s = seed[i];
        cur[j] = tx + Math.sin(t * 1.6 + s) * turb + Math.sin(t * 0.5 + s * 2.3) * turb * 0.6;
        cur[j + 1] = ty + Math.cos(t * 1.3 + s * 1.7) * turb + Math.cos(t * 0.6 + s) * turb * 0.5;
        cur[j + 2] = tz + Math.sin(t * 1.1 + s * 0.7) * turb;
      }
      posAttr.needsUpdate = true;

      for (let i = 0; i < AMB; i++) {
        const j = i * 3; const s = ambSeed[i];
        ambPos[j + 1] += 0.0015 + 0.001 * Math.sin(t + s);
        if (ambPos[j + 1] > 2.6) ambPos[j + 1] = -2.6;
        ambPos[j] += Math.sin(t * 0.3 + s) * 0.0008;
      }
      ambAttr.needsUpdate = true;

      // the face turns + drifts so it's alive, but stays mostly toward the viewer (a full spin would hide it)
      const ry = Math.sin(t * (sw ? 0.5 : 0.3)) * 0.5 + Math.sin(t * 0.13) * 0.12;
      const rx = Math.sin(t * 0.21) * 0.14;
      const fx = Math.cos(t * 0.34) * 0.06, fy = Math.sin(t * 0.5) * 0.07;
      core.rotation.set(rx, ry, 0); halo.rotation.set(rx, ry, 0);
      core.position.set(fx, fy, 0); halo.position.set(fx, fy, 0); glowMesh.position.set(fx, fy, 0);
      glowMesh.rotation.y = -t * 0.1;

      // brightness pulse + occasional sharp flicker (unsettling)
      const flick = Math.sin(t * 47) > 0.985 ? 0.5 : 0;
      matCore.size = 0.038 + Math.sin(t * 2) * 0.006 + (sw ? 0.014 : 0) + flick * 0.02;
      matHalo.opacity = 0.24 + Math.sin(t * 1.7) * 0.06 + (sw ? 0.1 : 0);
      // redden when sweeping (alarm)
      (glowMesh.material as THREE.MeshBasicMaterial).color.setHex(sw ? 0xff3b5c : 0x22d3ee);
      (glowMesh.material as THREE.MeshBasicMaterial).opacity = 0.08 + Math.sin(t * 1.6) * 0.04 + (sw ? 0.08 : 0);

      // lightning: re-strike on an interval, flash bright then fade out before the next strike
      const interval = sw ? 0.24 : 0.45;
      const strike = Math.floor(t / interval);
      if (strike !== lastArc) { lastArc = strike; regenArcs(R * 1.03, sw); }
      const ph = (t % interval) / interval;
      arcMat.opacity = (1 - ph) * (sw ? 0.95 : 0.7) * (Math.random() > 0.25 ? 1 : 0.45);
      arcs.rotation.copy(core.rotation); arcs.position.copy(core.position);

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      geo.dispose(); ambGeo.dispose(); arcGeo.dispose(); matCore.dispose(); matHalo.dispose(); ambMat.dispose(); arcMat.dispose(); sprite.dispose();
      glowMesh.geometry.dispose(); (glowMesh.material as THREE.Material).dispose();
      renderer.dispose();
      try { mount.removeChild(renderer.domElement); } catch { /* gone */ }
    };
  }, [image]);

  return <div ref={mountRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />;
}

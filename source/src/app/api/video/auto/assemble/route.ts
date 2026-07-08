import { NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createProject } from "@/lib/videoProjects";
import { probeDuration, downloadTo, estimateNarrationSec } from "@/lib/videoAuto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/video/auto/assemble
// Stage 4 of the Director: take the generated assets and stitch them into a
// HyperFrames project, then return the slug so the caller can POST the existing
// /api/video/hyperframes/render { slug }.
//
// Body:
//   { title, brand?, mode: "avatar"|"voiceover",
//     narrationUrl,            // avatar mp4 (avatar mode) OR voiceover audio (voiceover mode)
//     avatarUrl?,              // avatar mp4 for the picture-in-picture bug (avatar mode)
//     scenes: [{ caption, narration_line, brollUrl? }] }
//
// Layout: intro card → b-roll sequence (looped to narration length) full-bleed,
// captions lower-third synced to narration, avatar PiP bottom-right, continuous
// narration audio, outro card. Everything saved to the project's assets/.

const INTRO = 1.8;
const OUTRO = 2.6;
const DEFAULT_BROLL = 6;

interface SceneIn { caption?: string; narration_line?: string; brollUrl?: string }

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function r2(n: number): number { return Math.round(n * 100) / 100; }

interface BrollClip { src: string; dur: number }
interface SceneTimed { caption: string; start: number; dur: number }

function buildHtml(opts: {
  title: string; brand: string; total: number; narrDur: number;
  hasAudio: boolean; audioSrc: string; pipSrc: string | null;
  broll: BrollClip[]; scenes: SceneTimed[];
}): string {
  const { title, brand, total, narrDur, hasAudio, audioSrc, pipSrc, broll, scenes } = opts;

  // ---- b-roll placements: loop the available clips back-to-back across the body ----
  const bodyStart = INTRO, bodyEnd = INTRO + narrDur;
  const placements: { src: string; start: number; dur: number; i: number }[] = [];
  if (broll.length) {
    let t = bodyStart, k = 0;
    while (t < bodyEnd - 0.05) {
      const clip = broll[k % broll.length];
      const dur = Math.min(clip.dur, bodyEnd - t);
      placements.push({ src: clip.src, start: r2(t), dur: r2(dur), i: placements.length });
      t += dur; k++;
      if (placements.length > 200) break; // safety
    }
  }

  const brollEls = placements.map((p) =>
    `  <video class="bg" src="${p.src}" muted playsinline data-start="${p.start}" data-duration="${p.dur}" data-track-index="1"></video>`
  ).join("\n");

  const captionEls = scenes.map((s, i) =>
    `  <div class="clip cap" id="cap-${i}" data-start="${r2(s.start)}" data-duration="${r2(s.dur)}" data-track-index="4"><span>${esc(s.caption)}</span></div>`
  ).join("\n");

  const pipEl = pipSrc
    ? `  <div class="pip" id="pip"><video src="${pipSrc}" muted playsinline data-start="${r2(INTRO)}" data-duration="${r2(narrDur)}" data-track-index="2"></video></div>`
    : "";

  const audioEl = hasAudio
    ? `  <audio src="${audioSrc}" data-start="${r2(INTRO)}" data-duration="${r2(narrDur)}" data-track-index="3" data-volume="1"></audio>`
    : "";

  // ---- caption GSAP (slide up in, fade out) ----
  const capTweens = scenes.map((s, i) => {
    const at = r2(s.start + 0.08);
    const out = r2(s.start + s.dur - 0.35);
    return `  tl.fromTo("#cap-${i}", { y: 56, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "back.out(1.6)" }, ${at});\n` +
           `  tl.to("#cap-${i}", { opacity: 0, duration: 0.3, ease: "power1.in" }, ${out});`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${esc(title).slice(0, 70)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
  * { box-sizing: border-box; }
  body { margin: 0; background: #07020f; font-family: 'Inter', system-ui, sans-serif; }
  #stage { position: relative; width: 1920px; height: 1080px; overflow: hidden; background: #07020f; }
  .bg { position: absolute; inset: 0; width: 1920px; height: 1080px; object-fit: cover; z-index: 1; }
  /* aurora fallback bg sits under broll so silent gaps are never black */
  #aura { position:absolute; inset:0; z-index:0;
    background:
      radial-gradient(60% 50% at 25% 20%, rgba(168,85,247,.30), transparent 60%),
      radial-gradient(55% 45% at 80% 75%, rgba(0,240,255,.22), transparent 60%),
      linear-gradient(135deg, #0a0118, #160a2b); }
  #vignette { position: absolute; inset: 0; z-index: 2; pointer-events: none;
    background: radial-gradient(ellipse at center, transparent 52%, rgba(7,2,15,.66) 100%); }
  #duotone { position:absolute; inset:0; z-index:2; pointer-events:none; mix-blend-mode:soft-light;
    background: linear-gradient(120deg, rgba(255,43,214,.16), rgba(0,240,255,.16)); }
  /* caption safe zone — never overlaps the presenter PiP (right) and wraps
     instead of running off-frame. Extra right padding reserved when a PiP exists. */
  .cap { position: absolute; left: 0; right: 0; bottom: 150px; z-index: 6; text-align: center;
    padding-left: 160px; padding-right: ${pipSrc ? 480 : 160}px; }
  .cap span { display: inline-block; font-weight: 900; font-size: 70px; line-height: 1.06; letter-spacing: -0.02em;
    max-width: 100%; overflow-wrap: break-word; color: #fff; text-transform: uppercase;
    text-shadow: 0 4px 28px rgba(0,0,0,.85), 0 0 50px rgba(0,240,255,.45); }
  .pip { position: absolute; right: 64px; bottom: 64px; z-index: 8; width: 360px; height: 360px; border-radius: 50%;
    overflow: hidden; border: 4px solid #00f0ff; box-shadow: 0 0 0 4px rgba(7,2,15,.9), 0 0 46px rgba(0,240,255,.6); }
  .pip video { width: 100%; height: 100%; object-fit: cover; }
  .card { position: absolute; inset: 0; z-index: 20; display: grid; place-items: center; text-align: center; padding: 120px;
    background: radial-gradient(70% 60% at 50% 35%, rgba(168,85,247,.22), transparent 60%), linear-gradient(160deg, #0a0118, #07020f); }
  .card h1 { margin: 0 0 22px; font-weight: 900; font-size: 132px; line-height: 0.96; letter-spacing: -0.03em; color: #fff;
    text-shadow: 0 0 60px rgba(0,240,255,.45); max-width: 1500px; }
  .card .kicker { font-weight: 900; font-size: 30px; letter-spacing: .32em; text-transform: uppercase; color: #00f0ff; margin-bottom: 30px; }
  .card .brand { margin-top: 34px; font-size: 34px; font-weight: 700; color: #d4a574; }
  .card .cta span { display:inline-block; font-weight:900; font-size:40px; color:#07020f; background:#39ff14; padding:16px 40px;
    transform: skewX(-6deg); box-shadow: 8px 8px 0 rgba(0,0,0,.6); text-transform:uppercase; letter-spacing:.02em; }
</style>
</head>
<body>
<div id="stage" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="${r2(total)}" data-fps="30">
  <div id="aura"></div>
${brollEls}
  <div id="vignette"></div>
  <div id="duotone"></div>
${captionEls}
${pipEl}
${audioEl}
  <div class="card clip" id="intro" data-start="0" data-duration="${r2(INTRO + 0.5)}" data-track-index="5">
    <div>
      <div class="kicker" id="intro-k">${esc(brand)}</div>
      <h1 id="intro-h">${esc(title)}</h1>
    </div>
  </div>
  <div class="card clip" id="outro" data-start="${r2(total - OUTRO)}" data-duration="${r2(OUTRO)}" data-track-index="5">
    <div>
      <h1 id="outro-h" style="font-size:104px">${esc(brand)}</h1>
      <div class="cta" id="outro-c"><span>${esc(opts.scenes.length ? "Subscribe for more" : "")}</span></div>
    </div>
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  var tl = gsap.timeline({ paused: true });
  // intro
  tl.fromTo("#intro-k", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, 0.2);
  tl.fromTo("#intro-h", { opacity: 0, y: 50, scale: 0.94 }, { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: "back.out(1.5)" }, 0.35);
  tl.to("#intro", { opacity: 0, duration: 0.45, ease: "power2.in" }, ${r2(INTRO)});
  // pip entrance
${pipSrc ? `  tl.fromTo("#pip", { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(1.7)" }, ${r2(INTRO + 0.1)});` : ""}
  // captions
${capTweens}
  // outro
  tl.fromTo("#outro", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power2.out" }, ${r2(total - OUTRO)});
  tl.fromTo("#outro-h", { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.6, ease: "back.out(1.5)" }, ${r2(total - OUTRO + 0.15)});
  tl.fromTo("#outro-c", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, ${r2(total - OUTRO + 0.5)});
  window.__timelines["main"] = tl;
</script>
</body>
</html>
`;
}

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const body = await req.json().catch(() => ({}));
  const title = String(body.title ?? "").trim() || "Untitled video";
  const brand = String(body.brand ?? "Agent OS").slice(0, 40);
  const mode = body.mode === "voiceover" ? "voiceover" : "avatar";
  const narrationUrl = String(body.narrationUrl ?? "").trim();
  const avatarUrl = String(body.avatarUrl ?? "").trim();
  const scenesIn: SceneIn[] = Array.isArray(body.scenes) ? body.scenes.slice(0, 12) : [];
  if (!scenesIn.length) return NextResponse.json({ error: "scenes required" }, { status: 400 });

  const { slug, cwd } = await createProject(title);
  const assets = path.join(cwd, "assets");
  await mkdir(assets, { recursive: true });

  // ---- pull narration audio + avatar PiP down to disk ----
  let hasAudio = false, audioSrc = "", pipSrc: string | null = null;
  if (mode === "avatar" && (avatarUrl || narrationUrl)) {
    const src = avatarUrl || narrationUrl;
    if (await downloadTo(src, path.join(assets, "avatar.mp4"), origin)) {
      hasAudio = true; audioSrc = "assets/avatar.mp4"; pipSrc = "assets/avatar.mp4";
    }
  } else if (mode === "voiceover" && narrationUrl) {
    const ext = /\.mp4(\?|$)/i.test(narrationUrl) ? "mp4" : "mp3";
    if (await downloadTo(narrationUrl, path.join(assets, `voiceover.${ext}`), origin)) {
      hasAudio = true; audioSrc = `assets/voiceover.${ext}`;
    }
  }

  // ---- pull b-roll clips down + probe durations ----
  const broll: BrollClip[] = [];
  for (let i = 0; i < scenesIn.length; i++) {
    const url = scenesIn[i].brollUrl;
    if (!url) continue;
    const file = path.join(assets, `broll-${i}.mp4`);
    if (await downloadTo(url, file, origin)) {
      const d = (await probeDuration(file)) ?? DEFAULT_BROLL;
      broll.push({ src: `assets/broll-${i}.mp4`, dur: r2(Math.max(1.5, Math.min(20, d))) });
    }
  }

  // ---- narration duration ----
  const fullNarration = scenesIn.map((s) => s.narration_line ?? "").join(" ");
  let narrDur: number | null = null;
  if (hasAudio) narrDur = await probeDuration(path.join(assets, audioSrc.replace("assets/", "")));
  if (!narrDur) narrDur = estimateNarrationSec(fullNarration);
  narrDur = r2(Math.max(6, Math.min(900, narrDur)));

  // ---- caption time slices proportional to narration_line length ----
  const weights = scenesIn.map((s) => Math.max(1, (s.narration_line ?? "").trim().split(/\s+/).filter(Boolean).length));
  const wsum = weights.reduce((a, b) => a + b, 0) || scenesIn.length;
  let acc = INTRO;
  const scenesTimed: SceneTimed[] = scenesIn.map((s, i) => {
    const dur = (weights[i] / wsum) * narrDur!;
    const seg = { caption: s.caption ?? "", start: r2(acc), dur: r2(dur) };
    acc += dur;
    return seg;
  });

  const total = r2(INTRO + narrDur + OUTRO);
  const html = buildHtml({ title, brand, total, narrDur, hasAudio, audioSrc, pipSrc, broll, scenes: scenesTimed });

  await writeFile(path.join(cwd, "index.html"), html);
  await writeFile(path.join(cwd, "hyperframes.json"), JSON.stringify({
    name: slug, composition: "index.html", width: 1920, height: 1080, fps: 30, duration: total,
  }, null, 2));

  return NextResponse.json({
    ok: true, slug, cwd, duration: total,
    brollCount: broll.length, hasAudio, mode,
    indexUrl: `/api/video/preview/project/${encodeURIComponent(slug)}/index.html`,
    renderUrl: "/api/video/hyperframes/render",
  });
}

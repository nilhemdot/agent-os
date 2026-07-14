import { NextResponse } from "next/server";
import { spawnStream } from "@/lib/runner";
import { writeFile, mkdir, readdir, stat, copyFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createProject } from "@/lib/videoProjects";
import { CLAUDE_MODEL } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/video/hyperframes/init
// Body: { prompt: string, slug?: string, quick?: boolean }
//
// v2: the composition is AUTHORED by Claude (the model writes a real multi-scene
// HyperFrames piece that follows the prompt) instead of a static title card.
// Real screenshots from ~/Guides/images are copied into assets/ so the video can
// showcase actual builds. `quick: true` (or any authoring failure) falls back to
// the simple starter so the feature never hard-fails.

const GUIDE_IMAGES = path.join(os.homedir(), "Guides", "images");
const MAX_ASSETS = 14;

// ── fallback starter (now lint-clean: registers a paused GSAP timeline) ──
const STARTER_INDEX_HTML = (prompt: string) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${prompt.replace(/</g, "&lt;").slice(0, 60)}</title>
<style>
  body { margin: 0; background: #15101a; color: #f3ebda; font-family: 'Inter', system-ui, sans-serif; }
  #stage { position: relative; width: 1920px; height: 1080px; overflow: hidden;
    background: linear-gradient(135deg, #15101a, #2e2436); }
  .title { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; padding: 80px; }
  .title h1 { font-size: 96px; font-weight: 700; letter-spacing: -0.03em; line-height: 1.05; margin: 0 0 24px; }
  .title p { font-size: 32px; color: #d4a574; }
</style>
</head>
<body>
<div id="stage" data-composition-id="agent-os-starter" data-start="0" data-width="1920" data-height="1080" data-duration="5" data-fps="30">
  <div class="title">
    <h1 id="t1">${prompt.replace(/</g, "&lt;").slice(0, 200)}</h1>
    <p id="t2">Made with Agent OS · HyperFrames</p>
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  var tl = gsap.timeline({ paused: true });
  tl.fromTo("#t1", { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.9, ease: "power3.out" }, 0.4);
  tl.fromTo("#t2", { opacity: 0 }, { opacity: 1, duration: 0.7, ease: "sine.out" }, 1.2);
  window.__timelines["agent-os-starter"] = tl;
</script>
</body>
</html>
`;

const HYPERFRAMES_JSON = (slug: string, duration: number) => JSON.stringify({
  name: slug,
  composition: "index.html",
  width: 1920,
  height: 1080,
  fps: 30,
  duration,
}, null, 2);

// ── FX library written into every project (fx.js) ──────────────────────────
// Deterministic, GSAP-driven visual primitives so every authored video gets
// signature "dopamine" effects without the model re-inventing them each time.
const FX_JS = `// Agent OS video FX library — deterministic GSAP helpers. Load AFTER gsap.
(function () {
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function el(sel) { return typeof sel === "string" ? document.querySelector(sel) : sel; }

  var FX = {
    rng: mulberry32,

    // Drifting ambient particle field. Call once per scene host; fade the host in yourself.
    particles: function (hostSel, opts) {
      opts = opts || {};
      var host = el(hostSel); if (!host) return;
      var rnd = mulberry32(opts.seed || 7);
      var colors = opts.colors || ["#00f0ff", "#ff2bd6", "#39ff14", "#ffe600", "#ffffff"];
      var n = opts.count || 50;
      for (var i = 0; i < n; i++) {
        var d = document.createElement("span");
        var sz = (opts.min || 2) + rnd() * ((opts.max || 6) - (opts.min || 2));
        d.style.cssText = "position:absolute;border-radius:50%;pointer-events:none;" +
          "width:" + sz + "px;height:" + sz + "px;" +
          "left:" + (rnd() * 100) + "%;top:" + (rnd() * 100) + "%;" +
          "background:" + colors[i % colors.length] + ";" +
          "opacity:" + (0.1 + rnd() * 0.5).toFixed(2) + ";" +
          "filter:blur(" + (rnd() < 0.3 ? 1.5 : 0) + "px)";
        host.appendChild(d);
      }
    },

    // Aurora glow blobs — premium animated background. Creates 3 huge blurred orbs.
    aurora: function (hostSel, opts) {
      opts = opts || {};
      var host = el(hostSel); if (!host) return;
      var rnd = mulberry32(opts.seed || 11);
      var colors = opts.colors || ["rgba(255,43,214,.20)", "rgba(0,240,255,.16)", "rgba(168,85,247,.16)"];
      for (var i = 0; i < colors.length; i++) {
        var b = document.createElement("div");
        b.className = "fx-aurora-blob";
        b.style.cssText = "position:absolute;width:900px;height:900px;border-radius:50%;pointer-events:none;" +
          "left:" + (10 + rnd() * 60) + "%;top:" + (rnd() * 50 - 20) + "%;" +
          "background:radial-gradient(circle," + colors[i] + ", transparent 65%);";
        host.appendChild(b);
      }
    },
    // Slow blob drift across a scene's duration. Call after aurora().
    auroraDrift: function (tl, hostSel, at, dur) {
      var host = el(hostSel); if (!host) return;
      var blobs = host.querySelectorAll(".fx-aurora-blob");
      for (var i = 0; i < blobs.length; i++) {
        tl.fromTo(blobs[i], { x: 0, y: 0 }, { x: (i % 2 ? -1 : 1) * (60 + i * 30), y: (i % 2 ? 40 : -40), duration: dur, ease: "sine.inOut" }, at);
      }
    },

    // Light sweep — a shine band crossing a headline. The signature premium move.
    sweep: function (tl, targetSel, at) {
      var t = el(targetSel); if (!t) return;
      if (getComputedStyle(t).position === "static") t.style.position = "relative";
      var wrap = document.createElement("div");
      wrap.style.cssText = "position:absolute;inset:-10%;overflow:hidden;pointer-events:none;";
      var band = document.createElement("div");
      band.style.cssText = "position:absolute;top:-20%;bottom:-20%;width:34%;left:0;transform:skewX(-18deg);" +
        "background:linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.55), rgba(255,255,255,0));";
      wrap.appendChild(band); t.appendChild(wrap);
      tl.fromTo(band, { xPercent: -160 }, { xPercent: 420, duration: 0.9, ease: "power2.inOut" }, at);
    },

    // Shockwave ring from the center of a container — for the biggest beat.
    ring: function (tl, containerSel, at, color) {
      var c = el(containerSel); if (!c) return;
      var r = document.createElement("div");
      r.style.cssText = "position:absolute;left:50%;top:50%;width:320px;height:320px;margin:-160px 0 0 -160px;" +
        "border:4px solid " + (color || "#00f0ff") + ";box-shadow:0 0 30px " + (color || "#00f0ff") + ";border-radius:50%;pointer-events:none;opacity:0;";
      c.appendChild(r);
      tl.fromTo(r, { scale: 0.15, opacity: 0.95 }, { scale: 7, opacity: 0, duration: 1.1, ease: "power2.out" }, at);
    },

    // Spark burst — celebratory but finite. Use on reveals and wins.
    burst: function (tl, containerSel, at, opts) {
      opts = opts || {};
      var c = el(containerSel); if (!c) return;
      var rnd = mulberry32(opts.seed || 23);
      var colors = opts.colors || ["#00f0ff", "#ff2bd6", "#39ff14", "#ffe600"];
      var n = opts.count || 26;
      for (var i = 0; i < n; i++) {
        var s = document.createElement("span");
        var sz = 4 + rnd() * 7;
        s.style.cssText = "position:absolute;left:50%;top:55%;width:" + sz + "px;height:" + sz + "px;border-radius:2px;" +
          "background:" + colors[i % colors.length] + ";pointer-events:none;opacity:0;";
        c.appendChild(s);
        var ang = (i / n) * Math.PI * 2 + rnd() * 0.5;
        var dist = 180 + rnd() * 420;
        tl.fromTo(s, { x: 0, y: 0, opacity: 1, rotation: 0 },
          { x: Math.cos(ang) * dist, y: Math.sin(ang) * dist * 0.7 - 60, opacity: 0, rotation: 200 + rnd() * 300,
            duration: 1.0 + rnd() * 0.5, ease: "power2.out" }, at + rnd() * 0.08);
      }
    },

    // Count-up number with a scale pop at the end.
    countUp: function (tl, sel, to, at, opts) {
      opts = opts || {};
      var node = el(sel); if (!node) return;
      var proxy = { v: opts.from || 0 };
      tl.fromTo(proxy, { v: opts.from || 0 }, { v: to, duration: opts.dur || 1.4, ease: "power2.inOut",
        onUpdate: function () { node.textContent = proxy.v.toFixed(opts.decimals == null ? 0 : opts.decimals) + (opts.suffix || ""); } }, at);
      tl.fromTo(node, { scale: 1 }, { scale: 1.12, duration: 0.18, ease: "back.out(3)", yoyo: true, repeat: 1 }, at + (opts.dur || 1.4) - 0.1);
    },

    // Word-by-word kinetic slam. Splits target text into word spans.
    wordSlam: function (tl, sel, at, opts) {
      opts = opts || {};
      var node = el(sel); if (!node) return;
      var words = node.textContent.trim().split(/\\s+/);
      node.innerHTML = words.map(function (w) { return '<span style="display:inline-block;white-space:pre">' + w + " </span>"; }).join("");
      var spans = node.querySelectorAll("span");
      for (var i = 0; i < spans.length; i++) {
        tl.fromTo(spans[i], { y: 70, opacity: 0, rotationZ: 4 },
          { y: 0, opacity: 1, rotationZ: 0, duration: 0.45, ease: "back.out(1.6)" }, at + i * (opts.stagger || 0.09));
      }
    },

    // 3D tilt-in entrance for screenshot cards.
    tiltIn: function (tl, sel, at) {
      var node = el(sel); if (!node) return;
      var parent = node.parentElement;
      if (parent) parent.style.perspective = "1400px";
      tl.fromTo(node, { rotationY: 16, z: -120, opacity: 0, transformOrigin: "50% 50%" },
        { rotationY: 0, z: 0, opacity: 1, duration: 0.8, ease: "power3.out" }, at);
    }
  };
  window.FX = FX;
})();
`;

// ── the authoring brief Claude receives alongside the user's prompt ──
function authorSystem(assets: string[]): string {
  return `You are a senior motion designer writing a HyperFrames video composition (HTML that renders to MP4).
Output ONLY a complete HTML file — no markdown fences, no commentary. Start with <!DOCTYPE html>.

HARD REQUIREMENTS (the renderer breaks if violated):
- One root: <div data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="<TOTAL_SECONDS>" data-fps="30"> directly in <body>.
- Every timed element (each scene div) has class="clip" plus data-start (seconds), data-duration, data-track-index. Clips on the SAME track must never overlap in time — alternate tracks 1/2 for overlapping scene transitions.
- Animate with GSAP from the CDN (https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js). ONE timeline: gsap.timeline({ paused: true }), positioned tweens at absolute seconds, registered as: window.__timelines = window.__timelines || {}; window.__timelines["main"] = tl;
- Use gsap.fromTo() ONLY (never .from/.set on scene content). Build timelines synchronously (no async/setTimeout).
- DETERMINISTIC: no Math.random(), no Date.now(), no new Date(). For particles use a seeded PRNG (mulberry32) with a fixed seed. No repeat:-1 anywhere — compute finite repeat counts.
- Scenes are absolutely-positioned divs covering the stage with explicit background colors; later scenes get higher z-index. Transition = the INCOMING scene animates in over the outgoing (push-slide via xPercent, zoom-in via scale+opacity, or crossfade via opacity). NEVER animate a scene out before its transition — exits only on the final scene (fade to black allowed there).
- Every scene's content elements get entrance tweens (staggered, varied eases: power3.out, back.out, sine.out). Nothing pops in fully formed. First tween at 0.2s+, not 0.

DESIGN SYSTEM — NEON ENERGY (attention-grabbing, fun, loud):
- Backgrounds: near-black with deep violet tint (#0a0118, #0d0221, #120433) — never grey, never flat (aurora over everything).
- NEON PALETTE (rotate ONE dominant neon per scene): electric cyan #00f0ff → hot magenta #ff2bd6 → acid green #39ff14 → laser yellow #ffe600 → hot orange #ff6b35 → violet #a855f7. White #ffffff for base headline fill.
- Font: 'Inter', system-ui, weight 900, UPPERCASE headlines 110-200px, tight line-height (0.95), letter-spacing -0.02em. Energy via skew: hero words/chips at skewX(-6deg). Slight italic on punch words.
- NEON TEXT TREATMENTS (use on every scene's hero word — pick per scene):
  a) Glow stack: color:#fff; text-shadow: 0 0 14px NEON, 0 0 50px NEON, 0 0 110px NEON;
  b) Outline ghost: color:transparent; -webkit-text-stroke: 3px NEON; (pair next to a filled word)
  c) Gradient fill: background:linear-gradient(95deg, NEON1, NEON2); -webkit-background-clip:text; color:transparent; (NEON1≠NEON2 — e.g. cyan→magenta)
  d) Chromatic ghost on slams: text-shadow: -4px 0 0 rgba(255,43,214,.8), 4px 0 0 rgba(0,240,255,.8); for 0.3s after impact (tween the shadow offsets to 0).
- Chips/badges: skewed (-6deg) solid NEON background, black 900-weight text, hard offset shadow (6px 6px 0 rgba(0,0,0,.6)) — sticker energy.
- Screenshots: 2-3px solid NEON border + box-shadow 0 0 40px NEON-at-40%; add a duotone overlay div (linear-gradient(120deg, rgba(255,43,214,.18), rgba(0,240,255,.18)) with mix-blend-mode:screen).
- Scene cuts get a FLASH: a full-screen div tweened opacity 0→0.5→0 in 0.18s (white or the incoming scene's neon) right at each transition — the beat-hit feel. ONE flash per cut, never strobing.

DOPAMINE VISUAL LANGUAGE — this is what separates a great video from a boring one. A local FX library exists at fx.js; load it AFTER gsap:
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <script src="fx.js"></script>
It exposes window.FX with deterministic helpers (call them while building the timeline):
  FX.aurora("#scene", {seed:11})                          → 3 huge drifting glow blobs (call per scene host)
  FX.auroraDrift(tl, "#scene", atSeconds, durSeconds)     → animates those blobs across the scene
  FX.particles("#scene-host", {seed:7, count:50})         → ambient particle field
  FX.sweep(tl, "#headline", at)                            → light-shine sweep across a headline
  FX.ring(tl, "#scene", at, "#d4a574")                    → shockwave ring on the biggest beat
  FX.burst(tl, "#scene", at, {seed:23, count:26})         → finite spark burst for reveals/wins
  FX.countUp(tl, "#num", 95, at, {decimals:1, suffix:"%"})→ counting number with end pop
  FX.wordSlam(tl, "#headline", at, {stagger:0.09})        → word-by-word kinetic slam (splits text itself)
  FX.tiltIn(tl, "#screenshot-img", at)                     → 3D perspective tilt-in for screenshot cards

MANDATORY per video (non-negotiable — a video missing these reads as boring):
1. HOOK: the first 3 seconds get the biggest moment — FX.wordSlam or scale-slam headline + FX.ring + particles. Never open quiet.
2. Every scene gets FX.aurora + auroraDrift (no flat backgrounds) and at least ONE signature effect (sweep, burst, tiltIn, countUp).
3. Every major headline gets FX.sweep shortly after it lands.
4. Every number on screen counts up via FX.countUp — never static digits — styled with a neon glow stack and 140px+ size.
5. Screenshots: FX.tiltIn entrance OR push-slide, then Ken Burns (scale 1.0→1.07, ease:"none") for the whole scene; give cards a resting micro-tilt (rotate alternating -1.2deg / 1.2deg) and deep shadows.
6. Parallax: captions animate in slightly later and slower than their backing image (depth).
7. Gradient text on the single most important word per scene: background:linear-gradient(...); -webkit-background-clip:text; color:transparent.
8. A vignette overlay div on screenshot scenes (radial-gradient transparent center → rgba(13,9,17,.55) edges) so captions pop.
9. Every scene transition fires the FLASH div (0.18s neon/white blink at the cut).
10. The final scene earns a FX.burst + a glow-stack brand line, then fades to black.

CAPTIONS / TEXT SAFE ZONE (non-negotiable — overlapping text reads as broken):
- Keep ALL headlines, captions and lower-thirds inside a safe area: at least 96px from every frame edge. Text must NEVER run off-frame — cap line width (max-width) and let it wrap to 2 lines instead of overflowing.
- Reserve the BOTTOM-RIGHT corner (a ~480x480px region) as a presenter zone — never place captions or important text there; a talking-head/PiP may be composited over it later.
- Bottom captions sit no lower than ~140px from the bottom edge so descenders + a 2nd line never clip.
- One caption on screen at a time; center it in the clear area, not under other elements.

CONTENT RULES:
- Follow the user's brief faithfully — its subject IS the video. 25-45 seconds total, 5-9 scenes, varied pacing (quick hits + one slow hold).
- SHOWCASE REAL WORK: these screenshot files exist in this project at assets/<name> — use the relevant ones as <img> in scenes (full-bleed with Ken Burns, or framed cards with captions). Available assets:
${assets.length ? assets.map((a) => `  - assets/${a}`).join("\n") : "  (none — use typography, shapes and stat animations only)"}
- Big readable captions over screenshots (text-shadow for contrast). End with a branded outro scene.
- No external resources besides the GSAP CDN. No web fonts. No <video>/<audio>.`;
}

function runClaude(system: string, prompt: string, cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const child = spawnStream("claude", ["-p", "--model", CLAUDE_MODEL, "--append-system-prompt", system, prompt], { cwd });
    let out = "";
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} resolve(out); }, timeoutMs);
    child.stdout.on("data", (d) => { out += String(d); });
    child.on("close", () => { clearTimeout(timer); resolve(out); });
    child.on("error", () => { clearTimeout(timer); resolve(out); });
  });
}

function extractHtml(raw: string): string | null {
  const fence = raw.match(/```html\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : raw;
  const start = body.indexOf("<!DOCTYPE");
  const end = body.lastIndexOf("</html>");
  if (start === -1 || end === -1) return null;
  return body.slice(start, end + 7);
}

function validate(html: string): string[] {
  const problems: string[] = [];
  if (!/data-composition-id="main"/.test(html)) problems.push("missing composition id 'main'");
  if (!/__timelines\[["']main["']\]/.test(html)) problems.push("timeline not registered under 'main'");
  if (/Math\.random\(/.test(html)) problems.push("Math.random used");
  if (/Date\.now\(|new Date\(\)/.test(html)) problems.push("wall clock used");
  if (/repeat:\s*-1/.test(html)) problems.push("infinite repeat");
  if (!/class="[^"]*clip/.test(html)) problems.push("no clips");
  return problems;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const prompt = String(body.prompt ?? "").trim();
  const customSlug = typeof body.slug === "string" ? body.slug : undefined;
  const quick = body.quick === true;
  if (!prompt) return NextResponse.json({ error: "prompt required" }, { status: 400 });
  if (prompt.length > 2000) return NextResponse.json({ error: "prompt too long" }, { status: 413 });

  const { slug, cwd } = await createProject(prompt, customSlug);
  await mkdir(path.join(cwd, "out"), { recursive: true });
  // The FX library every composition can rely on (dopamine primitives).
  await writeFile(path.join(cwd, "fx.js"), FX_JS);

  // Copy the newest curated screenshots in as usable assets.
  let assets: string[] = [];
  try {
    const entries = await readdir(GUIDE_IMAGES);
    const pngs = await Promise.all(entries.filter((f) => f.endsWith(".png")).map(async (f) => {
      const st = await stat(path.join(GUIDE_IMAGES, f));
      return { f, m: st.mtimeMs, size: st.size };
    }));
    const picked = pngs.filter((p) => p.size < 3_000_000).sort((a, b) => b.m - a.m).slice(0, MAX_ASSETS);
    if (picked.length) {
      await mkdir(path.join(cwd, "assets"), { recursive: true });
      for (const p of picked) await copyFile(path.join(GUIDE_IMAGES, p.f), path.join(cwd, "assets", p.f));
      assets = picked.map((p) => p.f);
    }
  } catch { /* no assets — fine */ }

  // Author with Claude unless quick mode; fall back to the starter on any failure.
  let html: string | null = null;
  let authored = false;
  let authorProblems: string[] = [];
  if (!quick) {
    // Fable 5 takes 3-6 min to author a full multi-scene composition — give it room.
    const raw = await runClaude(authorSystem(assets), prompt, cwd, 480_000);
    const candidate = extractHtml(raw);
    if (candidate) {
      authorProblems = validate(candidate);
      if (authorProblems.length === 0) { html = candidate; authored = true; }
    } else {
      authorProblems = ["no html in model output"];
    }
  }
  if (!html) html = STARTER_INDEX_HTML(prompt);

  // Duration from the generated stage (fallback 5s starter).
  const durM = html.match(/data-duration="([0-9.]+)"/);
  const duration = durM ? Math.max(1, Math.min(120, parseFloat(durM[1]))) : 5;

  await writeFile(path.join(cwd, "index.html"), html);
  await writeFile(path.join(cwd, "hyperframes.json"), HYPERFRAMES_JSON(slug, duration));

  return NextResponse.json({
    ok: true,
    slug,
    cwd,
    authored,
    duration,
    assets,
    ...(authored ? {} : { authorFallback: authorProblems }),
    indexUrl: `/api/video/preview/project/${encodeURIComponent(slug)}/index.html`,
    nextSteps: [
      "Edit index.html — change the animation, add clips, swap text",
      "POST /api/video/hyperframes/render { slug } to render an MP4",
    ],
  });
}

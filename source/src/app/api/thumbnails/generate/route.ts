import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { saveThumbnailSession } from "@/lib/thumbnailLog";
import { enhancePrompt } from "@/lib/thumbnailPrompt";

const exec = promisify(execFile);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Proven generator: gpt-image-2, /edits when a ref is given, 1280×720 JPGs.
const SCRIPT = path.join(homedir(), ".claude/skills/youtube-thumbnails/scripts/generate.py");

function dataUrlToBuf(dataUrl: string): { buf: Buffer; ext: string } | null {
  const m = dataUrl.match(/^data:image\/([a-z0-9.+-]+);base64,(.+)$/i);
  if (!m) return null;
  return { buf: Buffer.from(m[2], "base64"), ext: m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase() };
}

export async function POST(req: Request) {
  let body: { image?: string; images?: string[]; instructions?: string; count?: number; singleImage?: boolean; vary?: boolean; proMode?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const instructions = (body.instructions || "").trim();
  const count = Math.min(4, Math.max(1, Number(body.count) || 3));
  const singleImage = body.singleImage === true; // OFF by default = your prompt, verbatim
  const vary = body.vary !== false;              // ON by default — make each version distinct
  const redesign = body.proMode === true;        // "Redesign from scratch" toggle. Off (default) = faithful edit of your image, like ChatGPT.
  // Optional reference images — none, one, or several (screenshots, logos, photo…).
  const imageList = (Array.isArray(body.images) ? body.images : body.image ? [body.image] : []).filter(Boolean).slice(0, 6);
  if (!instructions && !imageList.length) return NextResponse.json({ error: "Add a reference image or some instructions." }, { status: 400 });

  const work = path.join(tmpdir(), `thumb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const out = path.join(work, "out");
  await mkdir(out, { recursive: true });

  const refPaths: string[] = [];
  const inputs: { buf: Buffer; ext: string }[] = [];
  for (let i = 0; i < imageList.length; i++) {
    const dec = dataUrlToBuf(imageList[i]);
    if (dec) { inputs.push(dec); const p = path.join(work, `ref${i}.${dec.ext}`); await writeFile(p, dec.buf); refPaths.push(p); }
  }

  const env = { ...process.env, PATH: `${process.env.PATH || ""}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin` };
  // Your prompt is sent VERBATIM. The only optional addition is the anti-collage
  // line, and only when you tick "Prevent 4-in-1 grid" (singleImage). Default: off.
  const SINGLE = " (Render as ONE single full-frame thumbnail — not a grid, collage, contact sheet, split-screen, or multiple thumbnails combined into one image.)";
  // gpt-image-2 only renders 3:2, so the output is fitted to 16:9 afterwards. If
  // the model jams the title against the top of its frame, it ends up flush to
  // (or clipped at) the top edge. Tell it to leave real breathing room — a
  // generous TOP margin especially — so nothing touches an edge.
  const SAFE_MARGINS = " Compose this as a 16:9 YouTube thumbnail with clear breathing room inside every edge: keep the title and all key elements within a safe central zone, and leave a GENEROUS margin above the top line of text. No text or important element may touch, overlap, or run off the top, bottom, or side edges.";
  // Each parallel call is independent and can't "see" the others, so a generic
  // "be different" line produces identical results. Give each version a DISTINCT,
  // concrete direction instead — that's the only way to force real variation.
  const VARIATIONS = [
    "",
    " For THIS version specifically: use a dark background instead of white, with bright contrasting text.",
    " For THIS version specifically: use a bold coloured background (e.g. deep blue, purple or orange) and a noticeably different layout.",
    " For THIS version specifically: a clean, minimal alternative with a fresh colour scheme and different composition.",
  ];
  // Default = FAITHFUL EDIT: describe the reference precisely + apply only the
  // requested change (what ChatGPT does → clean, true-to-original). Redesign
  // toggle = art-direct a brand-new thumbnail from the style guide.
  const artDirected = await enhancePrompt(instructions, imageList[0] || null, redesign ? "redesign" : "edit");
  const base = (artDirected || "Make a cleaner, higher-quality version of this thumbnail.") + (singleImage ? SINGLE : "") + SAFE_MARGINS;
  const prompts = Array.from({ length: count }, (_, i) => base + (vary && count > 1 ? VARIATIONS[i % VARIATIONS.length] : ""));

  // Run the variants in PARALLEL — each is its own gpt-image-2 call, so the
  // total wait ≈ the slowest single render instead of the sum of all of them.
  const t0 = Date.now();
  const jobs = prompts.map(async (prompt, i): Promise<Buffer> => {
    const sub = path.join(out, `v${i}`);
    await mkdir(sub, { recursive: true });
    const a = [SCRIPT, "--prompt", prompt];
    for (const rp of refPaths) a.push("--ref", rp);
    // gpt-image-2 renders NATIVE 16:9 (GEN_SIZE=2048x1152 in generate.py) — it
    // supports flexible custom sizes, so there's nothing to crop or pad. `cover` is
    // just a clean resize to 1920x1080 (aspect already matches → no crop, no bars).
    // This is how ChatGPT does it: ask for 16:9 directly. 1920x1080 PNG.
    a.push("--out", sub, "--slug", "thumb", "--fit", "cover", "--out-size", "1920x1080", "--format", "png");
    await exec("python3", a, { timeout: 285_000, maxBuffer: 32 * 1024 * 1024, env });
    const f = (await readdir(sub)).find((x) => /\.(jpe?g|png)$/i.test(x));
    if (!f) throw new Error("no image produced");
    return readFile(path.join(sub, f));
  });
  const settled = await Promise.allSettled(jobs);
  const durationMs = Date.now() - t0;

  const outputs: { name: string; buf: Buffer }[] = [];
  let firstErr = "";
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") outputs.push({ name: `thumb-${i + 1}.png`, buf: s.value });
    else if (!firstErr) { const e = s.reason as { stderr?: string; message?: string }; firstErr = e?.stderr || e?.message || "generation failed"; }
  });

  if (!outputs.length) {
    await rm(work, { recursive: true, force: true }).catch(() => {});
    const raw = firstErr || "No images were produced.";
    let msg = raw.slice(-400);
    if (/insufficient_quota|exceeded your current quota/i.test(raw))
      msg = "Your OpenAI API account is out of credits. The API is prepaid and SEPARATE from ChatGPT Plus — add a payment method + credits at platform.openai.com → Settings → Billing (same account your API key belongs to), then try again.";
    else if (/billing_hard_limit|billing limit/i.test(raw))
      msg = "Your OpenAI org has hit its monthly hard limit. Raise it at platform.openai.com → Settings → Limits, then try again.";
    else if (/invalid_api_key|incorrect api key|401/i.test(raw))
      msg = "OpenAI key rejected — check OPENAI_API_KEY in ~/.claude/skills/youtube-thumbnails/.env.";
    else if (/rate.?limit|429/i.test(raw))
      msg = "OpenAI rate-limited the request — try fewer versions, or wait a moment and retry.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const session = await saveThumbnailSession({ instructions: instructions || "(no instructions)", inputs, outputs, durationMs });
  const images = outputs.map((o) => `data:image/png;base64,${o.buf.toString("base64")}`);
  await rm(work, { recursive: true, force: true }).catch(() => {});

  return NextResponse.json({ ok: true, images, savedTo: session ? `Thumbnails/${session.folder}` : null });
}

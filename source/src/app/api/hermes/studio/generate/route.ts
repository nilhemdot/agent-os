import { NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { run } from "@/lib/runner";
import { studioDirs, minimaxToken, slugify, MINIMAX_BASE, PREVIEW_BUCKET } from "@/lib/hermesStudio";
import { elevenTtsToFile } from "@/lib/elevenlabs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/hermes/studio/generate
//   { kind: "image"|"voice"|"video", prompt, voiceId?, provider?: "minimax"|"grok" }
//
// One Studio, two engines:
//   • minimax → MiniMax APIs (image-01, Hailuo, speech-02). Video is async → returns { taskId } to poll.
//   • grok    → `openclaw infer …` (xAI Grok). All synchronous → returns the finished { url }.
// Both save into the SAME Hermes typed dirs (images / videos / audio_cache) so the
// gallery + Workspace buckets show every generation regardless of engine.
const XAI_VOICES = new Set(["eve", "ara", "rex", "sal", "leo", "una"]);

function parseOpenclawFile(stdout: string): string | null {
  const i = stdout.indexOf("{");
  if (i === -1) return null;
  try {
    const j = JSON.parse(stdout.slice(i)) as { outputs?: { path: string }[] };
    return j.outputs?.[0]?.path ?? null;
  } catch { return null; }
}

export async function POST(req: Request) {
  const { kind, prompt, voiceId, provider } = await req.json();
  if (typeof prompt !== "string" || !prompt.trim()) return NextResponse.json({ error: "missing prompt" }, { status: 400 });
  // image/b-roll prompts stay short; voice narration can be long (a 6-min script ≈ 6k chars).
  if (prompt.length > (kind === "voice" ? 12000 : 2000)) return NextResponse.json({ error: "prompt too long" }, { status: 413 });

  // ───────────────────────── ELEVENLABS (voice only) ─────────────────────────
  if (provider === "elevenlabs" && kind === "voice") {
    try {
      const { name, url } = await elevenTtsToFile(prompt, typeof voiceId === "string" ? voiceId : undefined);
      return NextResponse.json({ ok: true, kind, provider: "elevenlabs", name, prompt, url });
    } catch (e) {
      return NextResponse.json({ error: `ElevenLabs voice failed: ${String(e)}` }, { status: 502 });
    }
  }

  const eng = provider === "grok" ? "grok" : "minimax";
  const dirs = studioDirs();
  const ts = Date.now();
  const slug = slugify(prompt);

  // ───────────────────────── GROK (via OpenClaw) ─────────────────────────
  if (eng === "grok") {
    try {
      if (kind === "image") {
        await mkdir(dirs.image, { recursive: true });
        const outPath = path.join(dirs.image, `${ts}-grok-${slug}.jpg`);
        const out = await run("openclaw", ["infer", "image", "generate", "--model", "xai/grok-imagine-image", "--prompt", prompt, "--output", outPath, "--json", "--aspect-ratio", "16:9"], { cwd: process.cwd(), timeoutMs: 120_000 });
        const f = parseOpenclawFile(out.stdout) ?? (existsSync(outPath) ? outPath : null);
        if (!f) return NextResponse.json({ error: "Grok image failed", detail: (out.stderr || out.stdout).slice(-400) }, { status: 502 });
        const name = path.basename(f);
        return NextResponse.json({ ok: true, kind, provider: eng, name, prompt, url: `/api/hermes/preview/${PREVIEW_BUCKET.image}/${encodeURIComponent(name)}` });
      }
      if (kind === "video") {
        await mkdir(dirs.video, { recursive: true });
        const outPath = path.join(dirs.video, `${ts}-grok-${slug}.mp4`);
        const out = await run("openclaw", ["infer", "video", "generate", "--model", "xai/grok-imagine-video", "--prompt", prompt, "--output", outPath, "--json"], { cwd: process.cwd(), timeoutMs: 240_000 });
        const f = parseOpenclawFile(out.stdout) ?? (existsSync(outPath) ? outPath : null);
        if (!f) return NextResponse.json({ error: "Grok video failed", detail: (out.stderr || out.stdout).slice(-400) }, { status: 502 });
        const name = path.basename(f);
        // synchronous — return the finished video directly (no polling)
        return NextResponse.json({ ok: true, kind, provider: eng, status: "done", name, prompt, url: `/api/hermes/preview/${PREVIEW_BUCKET.video}/${encodeURIComponent(name)}` });
      }
      if (kind === "voice") {
        const v = typeof voiceId === "string" && XAI_VOICES.has(voiceId) ? voiceId : "eve";
        await mkdir(dirs.voice, { recursive: true });
        const outPath = path.join(dirs.voice, `${ts}-grok-${v}-${slug}.mp3`);
        const out = await run("openclaw", ["infer", "tts", "convert", "--text", prompt, "--voice", v, "--output", outPath, "--json"], { cwd: process.cwd(), timeoutMs: 60_000 });
        const f = parseOpenclawFile(out.stdout) ?? (existsSync(outPath) ? outPath : null);
        if (!f) return NextResponse.json({ error: "Grok voice failed", detail: (out.stderr || out.stdout).slice(-400) }, { status: 502 });
        const name = path.basename(f);
        return NextResponse.json({ ok: true, kind, provider: eng, name, prompt, url: `/api/hermes/preview/${PREVIEW_BUCKET.voice}/${encodeURIComponent(name)}` });
      }
      return NextResponse.json({ error: "bad kind" }, { status: 400 });
    } catch (e) {
      return NextResponse.json({ error: `Grok generation failed: ${String(e)}` }, { status: 500 });
    }
  }

  // ───────────────────────── MINIMAX (via API) ─────────────────────────
  const tok = minimaxToken();
  if (!tok) return NextResponse.json({ error: "MiniMax not connected. Run `hermes auth add minimax-oauth` in a terminal." }, { status: 400 });
  const H = { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" };

  try {
    if (kind === "image") {
      const r = await fetch(`${MINIMAX_BASE}/image_generation`, { method: "POST", headers: H, body: JSON.stringify({ model: "image-01", prompt, aspect_ratio: "16:9", response_format: "url", n: 1 }) });
      const j = await r.json();
      const src = j?.data?.image_urls?.[0];
      if (!src) return NextResponse.json({ error: "no image returned", detail: j?.base_resp ?? j }, { status: 502 });
      const buf = Buffer.from(await (await fetch(src)).arrayBuffer());
      await mkdir(dirs.image, { recursive: true });
      const name = `${ts}-${slug}.png`;
      await writeFile(path.join(dirs.image, name), buf);
      return NextResponse.json({ ok: true, kind, provider: eng, name, prompt, url: `/api/hermes/preview/${PREVIEW_BUCKET.image}/${encodeURIComponent(name)}` });
    }
    if (kind === "voice") {
      const vid = typeof voiceId === "string" && /^[a-z0-9-]+$/i.test(voiceId) ? voiceId : "male-qn-qingse";
      const r = await fetch(`${MINIMAX_BASE}/t2a_v2`, { method: "POST", headers: H, body: JSON.stringify({ model: "speech-02-hd", text: prompt, stream: false, voice_setting: { voice_id: vid, speed: 1, vol: 1, pitch: 0 }, audio_setting: { format: "mp3", sample_rate: 32000, bitrate: 128000 } }) });
      const j = await r.json();
      const hex = j?.data?.audio;
      if (!hex) return NextResponse.json({ error: "no audio returned", detail: j?.base_resp ?? j }, { status: 502 });
      await mkdir(dirs.voice, { recursive: true });
      const name = `${ts}-${slug}.mp3`;
      await writeFile(path.join(dirs.voice, name), Buffer.from(hex, "hex"));
      return NextResponse.json({ ok: true, kind, provider: eng, name, prompt, url: `/api/hermes/preview/${PREVIEW_BUCKET.voice}/${encodeURIComponent(name)}` });
    }
    if (kind === "video") {
      const r = await fetch(`${MINIMAX_BASE}/video_generation`, { method: "POST", headers: H, body: JSON.stringify({ model: "MiniMax-Hailuo-2.3", prompt, duration: 6, resolution: "768P" }) });
      const j = await r.json();
      const taskId = j?.task_id;
      if (!taskId) return NextResponse.json({ error: "no task_id returned", detail: j?.base_resp ?? j }, { status: 502 });
      return NextResponse.json({ ok: true, kind, provider: eng, status: "processing", taskId: String(taskId), slug, prompt });
    }
    return NextResponse.json({ error: "bad kind" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

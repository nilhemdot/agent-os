import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { agentEnv } from "@/lib/runner";
import { createWriteStream } from "node:fs";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { config } from "@/lib/config";
import {
  createRenderJob, updateRenderJob, nextRenderOutputPath, VIDEO_ROOT,
} from "@/lib/videoProjects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/video/hyperframes/render
// Body: { slug: string }
// Spawns `hyperframes render --output <out>` in the background, streams log,
// returns the job id. Poll /api/video/hyperframes/render/status?id=<id>.

const HYPERFRAMES_BIN = path.join(os.homedir(), "local", "node", "bin", "hyperframes");

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug ?? "").trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(slug)) {
    return NextResponse.json({ error: "invalid slug" }, { status: 400 });
  }
  const cwd = path.join(VIDEO_ROOT, slug);
  if (!existsSync(cwd)) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  if (!existsSync(path.join(cwd, "index.html"))) {
    return NextResponse.json({ error: "project missing index.html" }, { status: 400 });
  }
  if (!existsSync(HYPERFRAMES_BIN)) {
    return NextResponse.json({ error: "hyperframes CLI not found at " + HYPERFRAMES_BIN }, { status: 503 });
  }

  // Pick the output filename + ensure out dir exists
  const outputPath = nextRenderOutputPath(cwd);
  mkdirSync(path.dirname(outputPath), { recursive: true });

  const job = await createRenderJob(slug, cwd, outputPath);

  // Open log file (createWriteStream auto-creates)
  const log = createWriteStream(job.logFile, { flags: "a" });
  log.write(`=== START ${new Date().toISOString()} · job ${job.id} · slug ${slug} ===\n`);
  log.write(`cwd: ${cwd}\noutput: ${outputPath}\n\n`);

  // hyperframes render [DIR] --output <path>
  // The first arg is the project DIRECTORY (default index.html composition).
  // Quiet flag = less spammy logs; --workers=2 caps RAM for safety.
  const child = spawn(HYPERFRAMES_BIN, [
    "render",
    cwd,
    "--output", outputPath,
    "--workers", "2",
  ], {
    cwd,
    env: agentEnv(),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (b: Buffer) => {
    log.write(b);
    const line = b.toString().split("\n").filter((l) => l.trim()).pop();
    if (line) updateRenderJob(job.id, { lastOutput: line.slice(0, 200) }).catch(() => {});
  });
  child.stderr.on("data", (b: Buffer) => {
    log.write(`[stderr] ${b}`);
  });
  child.on("close", (code) => {
    log.write(`\n=== END ${new Date().toISOString()} · exit ${code} ===\n`);
    log.end();
    updateRenderJob(job.id, {
      status: code === 0 ? "completed" : "failed",
      finishedAt: Date.now(),
      exitCode: code,
      pid: undefined,
    }).catch(() => {});
  });
  child.unref();

  await updateRenderJob(job.id, {
    status: "rendering",
    startedAt: Date.now(),
    pid: child.pid,
  });

  return NextResponse.json({
    ok: true,
    job: { ...job, status: "rendering", pid: child.pid },
    pollUrl: `/api/video/hyperframes/render/status?id=${encodeURIComponent(job.id)}`,
  });
}

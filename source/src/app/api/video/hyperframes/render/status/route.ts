import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import path from "node:path";
import { getRenderJob, listRenderJobs, readRenderLog } from "@/lib/videoProjects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/video/hyperframes/render/status?id=<jobId>  — single job + log tail
// GET /api/video/hyperframes/render/status              — list all jobs
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const job = await getRenderJob(id);
    if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
    const log = await readRenderLog(id);
    // If completed, attach the output URL the browser can play
    let outputUrl: string | undefined;
    if (job.status === "completed" && existsSync(job.outputPath)) {
      outputUrl = `/api/video/preview/project/${encodeURIComponent(job.projectSlug)}/out/${encodeURIComponent(path.basename(job.outputPath))}`;
    }
    return NextResponse.json({ job, log, outputUrl });
  }
  const jobs = await listRenderJobs();
  return NextResponse.json({ count: jobs.length, jobs });
}

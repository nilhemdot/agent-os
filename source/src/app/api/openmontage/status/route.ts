import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { hermesHome } from "@/lib/config";

// GET ?id=<jobId> → current job status (status, progress, message, title, video URL).
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!/^om-[a-z0-9]+$/i.test(id)) {
    return Response.json({ error: "bad id" }, { status: 400 });
  }
  const jobFile = path.join(hermesHome(), "profiles", "openmontage", "workspace", "jobs", `${id}.json`);
  if (!existsSync(jobFile)) {
    return Response.json({ status: "starting", progress: 0, message: "Starting…" });
  }
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(readFileSync(jobFile, "utf8")); } catch { /* mid-write */ }
  if (data.status === "done" && data.video) {
    data.videoUrl = `/openmontage/generated/${data.video}`;
  }
  return Response.json(data, { headers: { "cache-control": "no-store" } });
}

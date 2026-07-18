import { spawnSubprocess } from "@/lib/runner";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { hermesHome } from "@/lib/config";

// POST { prompt, shots? } → starts a cinematic generation job, returns { jobId }.
// The Python pipeline (OpenRouter cinematic images → ffmpeg Ken Burns + grade) runs
// detached and writes live progress to a job json that /api/openmontage/status reads.
export async function POST(req: Request) {
  const { prompt, shots, mode } = await req.json().catch(() => ({}));
  if (!prompt || typeof prompt !== "string" || prompt.trim().length < 4) {
    return Response.json({ error: "Describe the video you want (a few words)." }, { status: 400 });
  }
  const isMovie = mode === "movie";
  const n = Math.max(2, Math.min(Number(shots) || (isMovie ? 2 : 6), isMovie ? 4 : 10));
  const jobId = "om-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const ws = path.join(hermesHome(), "profiles", "openmontage", "workspace");
  // movie_om.py  = Veo 3.1 motion clips → CinematicRenderer (real movie, costs ~$2-3, ~8 min)
  // cinematic_om.py = gpt-image-2 stills → CinematicRenderer (film trailer, ~$0.30, ~5 min)
  const script = path.join(ws, "scripts", isMovie ? "movie_om.py" : "cinematic_om.py");
  const countFlag = isMovie ? "--clips" : "--shots";
  const jobsDir = path.join(ws, "jobs");
  const outDir = path.join(process.cwd(), "public", "openmontage", "generated");
  mkdirSync(jobsDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  const jobFile = path.join(jobsDir, `${jobId}.json`);
  const outFile = path.join(outDir, `${jobId}.mp4`);

  const child = spawnSubprocess(
    "python3",
    [script, "--prompt", prompt.trim().slice(0, 600), countFlag, String(n),
      "--out", outFile, "--job", jobFile],
    { detached: true, stdio: "ignore", cwd: ws }
  );
  child.unref();

  return Response.json({ jobId, status: "planning" });
}

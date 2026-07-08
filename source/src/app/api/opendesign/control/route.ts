import { NextResponse } from "next/server";
import { exec } from "node:child_process";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Open Design runs on the HOST (Node 24 via mise) so it can drive the user's CLIs
// (claude / hermes / codex) on PATH. These wrappers handle mise + PATH + fixed ports.
const HOME = os.homedir();
const START = path.join(HOME, "open-design", "od-host-start.sh");
const STOP = path.join(HOME, "open-design", "od-host-stop.sh");
const PATH_EXTRA = ["/opt/homebrew/bin", "/usr/local/bin", `${HOME}/.local/bin`].join(":");

function sh(script: string, timeoutMs: number): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    exec(`bash ${JSON.stringify(script)}`, { timeout: timeoutMs, env: { ...process.env, PATH: `${PATH_EXTRA}:${process.env.PATH ?? ""}` } },
      (err, stdout, stderr) => resolve({ ok: !err, out: (stdout + stderr).trim().slice(-700) }));
  });
}

// POST { action: "start" | "stop" }
export async function POST(req: Request) {
  const { action } = await req.json().catch(() => ({}));
  if (action !== "start" && action !== "stop") return NextResponse.json({ error: "action must be start|stop" }, { status: 400 });
  const res = action === "start" ? await sh(START, 120_000) : await sh(STOP, 40_000);
  return NextResponse.json({ ok: res.ok, action, log: res.out }, { status: res.ok ? 200 : 500 });
}

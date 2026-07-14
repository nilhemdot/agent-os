import { NextResponse } from "next/server";
import { run } from "@/lib/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMMANDS = {
  health: ["health"],
  agents: ["agents", "list"],
  logs: ["logs"],
  doctor: ["doctor"],
  memory: ["memory", "--help"],
  cron: ["cron", "list"],
} as const;

type Action = keyof typeof COMMANDS;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const action = (url.searchParams.get("action") ?? "health") as Action;
  const args = COMMANDS[action];
  if (!args) return NextResponse.json({ error: "unknown action" }, { status: 400 });
  const out = await run("openclaw", args, { cwd: process.cwd(), timeoutMs: 8000 });
  return NextResponse.json({ action, ...out });
}

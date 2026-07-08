import { NextResponse } from "next/server";
import { readGlmHistory, obsidianLogPath } from "@/lib/glmCodeHistory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const history = await readGlmHistory(40);
  return NextResponse.json({ history, obsidian: obsidianLogPath() });
}

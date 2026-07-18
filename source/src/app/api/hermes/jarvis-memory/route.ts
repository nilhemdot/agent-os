import { NextResponse } from "next/server";
import { appendMemory, listResidentMemories } from "@/lib/jarvisMemory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET → everything Jarvis has been told to remember (newest first).
export async function GET() {
  try {
    return NextResponse.json({ memories: await listResidentMemories(50) });
  } catch (e) {
    return NextResponse.json({ memories: [], error: String(e) }, { status: 200 });
  }
}

// POST { text } → save a new memory to disk + the Obsidian vault.
export async function POST(req: Request) {
  let body: { text?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  const text = (body.text ?? "").toString().trim();
  if (!text) return NextResponse.json({ ok: false }, { status: 400 });
  const row = await appendMemory(text);
  return NextResponse.json({ ok: true, ...row });
}

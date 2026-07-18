import { NextResponse } from "next/server";
import * as memoryStore from "@/lib/memoryStore";
import * as vaultWriter from "@/lib/vaultWriter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// R3.5: Migrated from jarvisMemory to memoryStore canonical module.
// GET → Resident context only (human-origin + promoted non-human).
export async function GET() {
  try {
    const memories = memoryStore.getResidentContext();
    return NextResponse.json({ memories });
  } catch (e) {
    return NextResponse.json({ memories: [], error: String(e) }, { status: 200 });
  }
}

// POST { text } → Save vocal memory (human origin) to DB + vault.
export async function POST(req: Request) {
  let body: { text?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  const text = (body.text ?? "").toString().trim();
  if (!text) return NextResponse.json({ ok: false }, { status: 400 });

  // Vocal memory is user-dictated, so origin='human' and trust='trusted' by default
  const mem = memoryStore.addMemory({
    tier: "recall",
    origin: "human",
    content: text.slice(0, 1000),
  });

  // Write to vault (best-effort) with memory ID for safe removal
  await vaultWriter.appendMemory({
    agent: "user",
    kind: "note",
    text: mem.content,
    memoryId: mem.id,
  });

  return NextResponse.json({ ok: true, ...mem });
}

import { listConversations, saveConversation, deleteConversation, type RoomConvo } from "@/lib/agentRoom";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET → all saved group-chat conversations (durable, from the vault)
export async function GET() {
  return Response.json({ conversations: await listConversations() });
}

// POST { id, title, ts, msgs } → save/update one conversation
export async function POST(req: Request) {
  const convo = (await req.json().catch(() => null)) as RoomConvo | null;
  if (!convo || !convo.id) return Response.json({ ok: false, error: "bad payload" }, { status: 400 });
  return Response.json({ ok: await saveConversation(convo) });
}

// DELETE ?id=... → remove one conversation
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return Response.json({ ok: false, error: "no id" }, { status: 400 });
  return Response.json({ ok: await deleteConversation(id) });
}

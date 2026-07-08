import fs from "node:fs";
import { hermesHome } from "@/lib/config";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-side chat history for the Fusion Boardroom, so it survives refreshes,
// restarts and different browsers (localStorage in the view is just a fast cache).
const FILE = path.join(hermesHome(), "profiles", "fusion", "chat-history.json");

interface Msg { role: "user" | "assistant"; text: string; }

export async function GET() {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    const msgs = JSON.parse(raw);
    return Response.json({ msgs: Array.isArray(msgs) ? msgs : [] });
  } catch {
    return Response.json({ msgs: [] });
  }
}

export async function POST(req: Request) {
  try {
    const { msgs } = (await req.json()) as { msgs: Msg[] };
    if (!Array.isArray(msgs)) return Response.json({ ok: false, error: "msgs must be an array" }, { status: 400 });
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(msgs.slice(-200)), "utf8");
    return Response.json({ ok: true, saved: msgs.length });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

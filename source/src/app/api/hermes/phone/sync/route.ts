import { NextResponse } from "next/server";
import { syncAgent } from "@/lib/hermesPhone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let phoneNumberId: string | undefined;
  try { phoneNumberId = (await req.json())?.phoneNumberId; } catch { /* optional */ }
  try {
    const r = await syncAgent(phoneNumberId);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 200 });
  }
}

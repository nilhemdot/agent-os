import { NextResponse } from "next/server";
import { getState, setEnabled } from "@/lib/fcc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const state = await getState();
  return NextResponse.json(state);
}

// Toggle routing on/off — { enabled: true | false }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled (boolean) required" }, { status: 400 });
  }
  await setEnabled(body.enabled);
  return NextResponse.json(await getState());
}

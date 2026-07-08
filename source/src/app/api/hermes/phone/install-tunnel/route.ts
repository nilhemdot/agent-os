import { NextResponse } from "next/server";
import { installCloudflared, installerRunning } from "@/lib/hermesPhone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json({ ...installCloudflared(), installing: installerRunning() });
}

import { NextResponse } from "next/server";
import { apiServerUp, tunnelStatus, elevenStatus, readHermesEnv } from "@/lib/hermesPhone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const env = readHermesEnv();
  const [api, tunnel] = await Promise.all([apiServerUp(), tunnelStatus()]);
  let eleven: Awaited<ReturnType<typeof elevenStatus>> | { configured: false; error: string } = { configured: false, numbers: [], hermesAgentId: null };
  try { eleven = await elevenStatus(); } catch (e) { eleven = { configured: false, error: String(e) } as never; }
  return NextResponse.json({
    apiServer: { up: api, port: 8642, keySet: !!env.API_SERVER_KEY },
    elevenKeySet: !!env.ELEVENLABS_API_KEY,
    tunnel,
    eleven,
  });
}

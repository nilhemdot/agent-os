import { providerStatus, getHistory } from "@/lib/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    { providers: providerStatus(), history: await getHistory() },
    { headers: { "cache-control": "no-store" } },
  );
}

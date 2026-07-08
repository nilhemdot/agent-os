import { saveProviderKey, providerStatus } from "@/lib/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST {provider:"hunter"|"apollo", key} → save the member's key into their own
// active Hermes profile .env (chmod 600). The key is NEVER returned to the client.
export async function POST(req: Request) {
  const { provider, key } = await req.json().catch(() => ({}));
  const res = saveProviderKey(String(provider || ""), String(key || ""));
  if (!res.ok) return Response.json({ error: res.error || "Could not save key." }, { status: 400 });
  // Echo back only the connection booleans + a masked hint, never the raw key.
  return Response.json({ ok: true, providers: providerStatus() }, { headers: { "cache-control": "no-store" } });
}

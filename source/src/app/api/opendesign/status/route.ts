export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Open Design runs on the host: web UI on :7456 (the iframe), daemon API on :7455.
// We health-check the DAEMON (lighter + stays responsive even while the web is busy
// generating) with a generous timeout, so a busy-but-alive studio isn't marked dead.
const WEB = "http://127.0.0.1:7456";
const DAEMON = "http://127.0.0.1:7455";

export async function GET() {
  let healthy = false;
  try {
    const r = await fetch(`${DAEMON}/api/health`, { signal: AbortSignal.timeout(6000), cache: "no-store" });
    healthy = r.ok;
  } catch { /* not running */ }
  return Response.json({ healthy, url: WEB }, { headers: { "cache-control": "no-store" } });
}

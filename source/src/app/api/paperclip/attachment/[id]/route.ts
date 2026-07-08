export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Proxies a Paperclip attachment's image bytes so the browser can render it
// from the Agent OS origin (no CORS, no direct :3100 dependency in the client).

const PAPERCLIP_BASE = process.env.PAPERCLIP_BASE || "http://localhost:3100";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return new Response("bad id", { status: 400 });
  try {
    const r = await fetch(`${PAPERCLIP_BASE}/api/attachments/${id}/content`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok || !r.body) return new Response("not found", { status: 404 });
    const ct = r.headers.get("content-type") || "image/png";
    const buf = await r.arrayBuffer();
    return new Response(buf, { headers: { "content-type": ct, "cache-control": "public, max-age=120" } });
  } catch {
    return new Response("upstream error", { status: 502 });
  }
}

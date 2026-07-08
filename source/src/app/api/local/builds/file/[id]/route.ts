import { readBuildHtml } from "@/lib/localBuilds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/local/builds/file/<id> → serve a build's HTML (for the preview iframe,
// open-in-tab, and download). Served same-origin so it renders cleanly.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const html = await readBuildHtml(id);
  if (html == null) return new Response("build not found", { status: 404 });
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

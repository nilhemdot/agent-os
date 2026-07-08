import { readBuild } from "@/lib/moaWorkspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serve a single build HTML from the MoA workspace so the tab can preview / open it.
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const html = readBuild(name);
  if (html === null) return new Response("Not found", { status: 404 });
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

import { stat, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { buildPath } from "@/lib/kanbanStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serve a card's built HTML (from the durable workspace) for live iframe preview.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return new Response("bad id", { status: 400 });
  const abs = buildPath(id);
  if (!existsSync(abs)) return new Response("not built yet", { status: 404 });
  const s = await stat(abs);
  if (!s.isFile()) return new Response("not a file", { status: 400 });
  const html = await readFile(abs, "utf8");
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

import { listBuilds, saveBuild, deleteBuild } from "@/lib/localBuilds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET    /api/local/builds          → list every server-side build (newest first)
// POST   /api/local/builds {title,prompt,html,model} → save a build
// DELETE /api/local/builds?id=<id>  → remove a build
export async function GET() {
  return Response.json({ builds: await listBuilds() }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { title, prompt, html, model } = body as { title?: string; prompt?: string; html?: string; model?: string };
  if (!html || typeof html !== "string") return Response.json({ error: "html required" }, { status: 400 });
  const build = await saveBuild({ title: title ?? "Untitled build", prompt: prompt ?? "", html, model });
  return Response.json(build);
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  await deleteBuild(id);
  return Response.json({ ok: true });
}

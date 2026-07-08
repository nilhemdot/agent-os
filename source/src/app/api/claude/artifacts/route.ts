import { NextResponse } from "next/server";
import { listPublishable, listPublished, publish, unpublish, artifactSite } from "@/lib/claudeArtifacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET    /api/claude/artifacts          → { site, publishable[], published[] }
// POST   /api/claude/artifacts { id, title? } → publish a build → { ok, item }
// DELETE /api/claude/artifacts { slug }       → unpublish
export async function GET() {
  const [publishable, published] = await Promise.all([listPublishable(), listPublished()]);
  return NextResponse.json({ site: artifactSite(), publishable, published });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : undefined;
  const res = await publish(id, title);
  return NextResponse.json(res, { status: res.ok ? 200 : 502 });
}

export async function DELETE(req: Request) {
  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug ?? "").trim();
  if (!slug) return NextResponse.json({ ok: false, error: "slug required" }, { status: 400 });
  const res = await unpublish(slug);
  return NextResponse.json(res, { status: res.ok ? 200 : 502 });
}

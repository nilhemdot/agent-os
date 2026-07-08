import { NextResponse } from "next/server";
import { uniqueSlug, writeItem, PIPELINE_AVAILABLE, type PipelineItem } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!PIPELINE_AVAILABLE) return NextResponse.json({ ok: false, error: "Vault not configured." }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const idea = String(body.idea || "").trim();
  if (!idea) return NextResponse.json({ ok: false, error: "Empty idea." }, { status: 400 });
  const title = idea.split("\n")[0].slice(0, 80);
  const slug = await uniqueSlug(title);
  const item: PipelineItem = { slug, title, stage: "inbox", created: new Date().toISOString(), idea };
  await writeItem(item);
  return NextResponse.json({ ok: true, slug });
}

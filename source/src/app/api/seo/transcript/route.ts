import { NextResponse } from "next/server";
import { readTranscript } from "@/lib/seoPipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");
  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });
  const content = await readTranscript(slug);
  if (content === null) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ slug, content, bytes: content.length });
}

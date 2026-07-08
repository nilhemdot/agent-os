import { NextResponse } from "next/server";
import { readBucketFile } from "@/lib/openclawWorkspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/openclaw/workspace/file?bucket=<id>&path=<rel> — text content for the file.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const bucket = url.searchParams.get("bucket") ?? "";
  const rel = url.searchParams.get("path") ?? "";
  if (!bucket || !rel) return NextResponse.json({ error: "bucket and path required" }, { status: 400 });
  const res = await readBucketFile(bucket, rel);
  if (!res) return NextResponse.json({ error: "file not found" }, { status: 404 });
  return NextResponse.json(res);
}

import { NextResponse } from "next/server";
import { listBuckets, listBucketFiles } from "@/lib/hermesWorkspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/hermes/workspace                — list all virtual buckets (Images / Audio / Pastes / Workspace / Sandboxes)
// GET /api/hermes/workspace?bucket=<id>    — list files inside one bucket
export async function GET(req: Request) {
  const url = new URL(req.url);
  const bucket = url.searchParams.get("bucket");
  if (bucket) {
    const res = await listBucketFiles(bucket);
    if (!res) return NextResponse.json({ error: "bucket not found" }, { status: 404 });
    return NextResponse.json(res);
  }
  const buckets = await listBuckets();
  return NextResponse.json({ buckets });
}

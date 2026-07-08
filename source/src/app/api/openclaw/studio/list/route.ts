import { NextResponse } from "next/server";
import { listBucketFiles, resolveBucketFile } from "@/lib/openclawWorkspace";
import { readMeta, type StudioMeta } from "@/lib/studioHistory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/openclaw/studio/list?kind=images|videos|audio
// Returns the most recent N artefacts of that type, with preview URLs +
// the original prompt/settings from the sidecar metadata file (if present).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "images";
  const bucketId = `studio-${kind}`;
  const res = await listBucketFiles(bucketId, 80);
  if (!res) return NextResponse.json({ error: "bucket not found", kind }, { status: 404 });

  // Filter out sidecar .meta.json files — they're metadata, not artefacts.
  const artefacts = res.files.filter((f) => !f.name.endsWith(".meta.json"));

  // Resolve each artefact's absolute path so we can load its sidecar.
  const items = await Promise.all(artefacts.map(async (f) => {
    const abs = resolveBucketFile(bucketId, f.relPath);
    const meta: StudioMeta | null = abs ? await readMeta(abs) : null;
    return {
      name: f.name,
      relPath: f.relPath,
      bytes: f.bytes,
      mtime: f.mtime,
      kind: f.kind,
      url: `/api/openclaw/preview/${bucketId}/${encodeURIComponent(f.relPath)}`,
      // Metadata sidecar — null for artefacts created before the sidecar pattern.
      meta,
    };
  }));

  return NextResponse.json({ kind, count: items.length, items });
}

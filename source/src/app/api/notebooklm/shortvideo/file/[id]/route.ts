import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { SHORTS_CACHE } from "@/lib/nlm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serve a cached short video mp4 (with range support so it scrubs/plays inline).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return new Response("bad id", { status: 400 });
  const file = path.join(SHORTS_CACHE, `${id}.mp4`);
  if (!existsSync(file)) return new Response("not found", { status: 404 });

  const size = statSync(file).size;
  const range = req.headers.get("range");
  const baseHeaders: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  };

  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    const start = m ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : size - 1;
    const stream = createReadStream(file, { start, end });
    return new Response(stream as unknown as ReadableStream, {
      status: 206,
      headers: { ...baseHeaders, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  const stream = createReadStream(file);
  return new Response(stream as unknown as ReadableStream, { headers: { ...baseHeaders, "Content-Length": String(size) } });
}

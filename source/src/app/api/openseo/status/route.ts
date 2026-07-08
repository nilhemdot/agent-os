import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Is the local OpenSEO container responding on :3001?
// OpenSEO runs via Docker (~/open-seo, `docker compose up -d`). The SEO → OpenSEO
// tab pings this to show a running/not-running badge and a help panel when it's down.
export async function GET() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1500);
  try {
    const r = await fetch("http://127.0.0.1:3001/", { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    return NextResponse.json({ running: r.ok, status: r.status });
  } catch {
    clearTimeout(t);
    return NextResponse.json({ running: false });
  }
}

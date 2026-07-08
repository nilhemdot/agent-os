import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serve the SEO content pipeline setup guide.
// Used by the /seo-guide page + the SEO panel header "Setup Guide" link.
export async function GET() {
  try {
    const file = path.resolve(process.cwd(), "SEO-SETUP.md");
    const content = await readFile(file, "utf8");
    return new Response(content, {
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

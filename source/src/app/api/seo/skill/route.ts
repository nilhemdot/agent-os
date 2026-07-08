import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { BLOG_POST_SKILL } from "@/lib/seoPipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!existsSync(BLOG_POST_SKILL)) {
    return new Response(
      `# blog-post skill not found\n\nLooked at: \`${BLOG_POST_SKILL}\``,
      { status: 404, headers: { "Content-Type": "text/markdown; charset=utf-8" } }
    );
  }
  const content = await readFile(BLOG_POST_SKILL, "utf8");
  return new Response(content, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}

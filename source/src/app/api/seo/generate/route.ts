import { spawnStream } from "@/lib/runner";
import { readFile } from "node:fs/promises";
import { BLOG_POST_SKILL, readTranscript, SITES } from "@/lib/seoPipeline";
import { startSession, appendArticle, finishSession, type ArticleWritten } from "@/lib/seoHistory";
import { CLAUDE_MODEL } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Map an absolute file path Claude wrote to its site + live URL so we can log it.
function articleFromPath(filePath: string, slug: string): ArticleWritten | null {
  for (const site of SITES) {
    if (filePath.startsWith(site.postsDir)) {
      return {
        siteId: site.id,
        filePath,
        liveUrl: `${site.url}/blog/${slug}/`,
      };
    }
  }
  return null;
}

export async function POST(req: Request) {
  const { keyword, transcriptSlug, transcriptText, slug } = await req.json();
  if (typeof keyword !== "string" || !keyword.trim()) {
    return new Response("missing keyword", { status: 400 });
  }
  if (typeof slug !== "string" || !/^[a-z0-9-]{3,80}$/.test(slug)) {
    return new Response("invalid slug (use lowercase letters, numbers and dashes only)", { status: 400 });
  }

  const skillBody = await readFile(BLOG_POST_SKILL, "utf8").catch(() => "");
  if (!skillBody) return new Response("blog-post skill missing", { status: 500 });

  let transcriptBody = "";
  let transcriptSource = "(none)";
  if (typeof transcriptText === "string" && transcriptText.trim().length > 0) {
    transcriptBody = transcriptText.slice(0, 500_000);
    transcriptSource = "(pasted)";
  } else if (transcriptSlug && typeof transcriptSlug === "string") {
    const t = await readTranscript(transcriptSlug);
    if (t) { transcriptBody = t; transcriptSource = transcriptSlug; }
  }

  // Log session start
  const session = await startSession({ keyword: keyword.trim(), slug: slug.trim(), transcriptSource });

  const prompt = [
    `You are operating the "blog-post" skill defined below. Read it carefully and follow it exactly.`,
    ``,
    `<skill>`,
    skillBody,
    `</skill>`,
    ``,
    `## Inputs for this run`,
    ``,
    `**Target keyword:** ${keyword.trim()}`,
    `**File slug:** ${slug}`,
    transcriptSource !== "(none)" ? `**Transcript:** ${transcriptSource}\n` : "**Transcript:** (none provided — ask before writing, or rely on existing research if explicitly told to)",
    transcriptBody ? `\n<transcript>\n${transcriptBody}\n</transcript>\n` : "",
    ``,
    `## What to do now`,
    ``,
    `1. Use the Write tool to create 5 unique long-form SEO articles at these exact paths:`,
    `   - /Users/juliangoldie/AIProfitBoardroom.com/src/blog/posts/${slug}.md`,
    `   - /Users/juliangoldie/AIProfitBoardroom-main/src/blog/posts/${slug}.md`,
    `   - /Users/juliangoldie/juliangoldieaiautomation/src/blog/posts/${slug}.md`,
    `   - /Users/juliangoldie/aisuccesslab/src/blog/posts/${slug}.md`,
    `   - /Users/juliangoldie/aimoneylab/src/blog/posts/${slug}.md`,
    `2. Each article must follow the skill: unique CTR-optimised title, unique opening, unique structure, frontmatter, multi-video embeds, 4 CTAs, schema markup, author bio, comparison tables. UK English.`,
    `3. Do NOT run any deploy commands — the dashboard handles deploy. Just write the 5 files.`,
    `4. When finished, print a short summary listing each path you wrote and its title.`,
    ``,
    `Begin now.`,
  ].join("\n");

  const child = spawnStream("claude", [
    "-p",
    "--model", CLAUDE_MODEL,
    "--output-format=stream-json",
    "--include-partial-messages",
    "--verbose",
    "--dangerously-skip-permissions",
  ], { input: prompt });

  // Sniff Claude's NDJSON for Write tool calls so we can log which articles landed.
  let buf = "";
  function sniff(chunk: string) {
    buf += chunk;
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const evt = JSON.parse(line);
        if (evt.type === "assistant" && evt.message?.content) {
          for (const part of evt.message.content) {
            if (part.type === "tool_use" && part.name === "Write" && typeof part.input?.file_path === "string") {
              const article = articleFromPath(part.input.file_path, slug.trim());
              if (article) appendArticle(session.id, article).catch(() => {});
            }
          }
        }
      } catch { /* not JSON */ }
    }
  }

  const encoder = new TextEncoder();
  // If the viewer navigates away / reloads, the run KEEPS GOING server-side.
  // (Claude 5 thinks silently for a minute-plus; killing on disconnect turned
  // every tab-switch into a "failed" run. exit 143 in history = that old bug.)
  let detached = false;
  const stream = new ReadableStream({
    start(controller) {
      const enqueue = (s: string) => {
        if (detached) return;
        try { controller.enqueue(encoder.encode(s)); } catch { detached = true; }
      };
      // Always sniff + drain stdout/stderr so the child never blocks on a full
      // pipe after the viewer disconnects — articles still land + get recorded.
      child.stdout.on("data", (b: Buffer) => { const t = b.toString(); sniff(t); enqueue(t); });
      child.stderr.on("data", (b: Buffer) => {
        enqueue(JSON.stringify({ type: "stderr", text: b.toString() }) + "\n");
      });
      child.on("close", async (code) => {
        await finishSession(session.id, code === 0 ? "completed" : "failed", code ?? undefined);
        enqueue(JSON.stringify({ type: "done", code, sessionId: session.id }) + "\n");
        if (!detached) { try { controller.close(); } catch {} }
      });
      child.on("error", async (e) => {
        await finishSession(session.id, "failed");
        enqueue(JSON.stringify({ type: "error", message: String(e) }) + "\n");
        if (!detached) { try { controller.close(); } catch {} }
      });
    },
    cancel() {
      // Viewer left — detach the stream but let the run finish in the background.
      detached = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

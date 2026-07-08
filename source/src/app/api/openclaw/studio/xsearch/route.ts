import { NextResponse } from "next/server";
import { run } from "@/lib/runner";
import { saveSearch } from "@/lib/studioHistory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/openclaw/studio/xsearch
// Body: { query: string, limit?: number }
// Wraps `openclaw infer web search --provider grok` — Grok's live X-search.
// "grok" is the provider id (not "xai"). Returns structured results.
export async function POST(req: Request) {
  const { query, limit } = await req.json();
  if (typeof query !== "string" || query.length === 0) {
    return NextResponse.json({ error: "missing query" }, { status: 400 });
  }
  if (query.length > 500) {
    return NextResponse.json({ error: "query too long" }, { status: 413 });
  }

  const args = [
    "infer", "web", "search",
    "--provider", "grok",
    "--query", query,
    "--json",
  ];
  if (typeof limit === "number" && limit >= 1 && limit <= 50) {
    args.push("--limit", String(limit));
  } else {
    args.push("--limit", "15");
  }

  const out = await run("openclaw", args, { timeoutMs: 60_000 });
  const firstBrace = out.stdout.indexOf("{");
  // Grok shape (from `openclaw infer web search --provider grok --json`):
  //   { ok, outputs: [ { result: { query, provider, model, tookMs, content, citations: string[] } } ] }
  // The `content` is a synthesized markdown answer with [[N]](url) inline cites
  // wrapped in `<<<EXTERNAL_UNTRUSTED_CONTENT>>>` markers. We strip the markers
  // and pass the rest verbatim — the component renders markdown.
  let rawPayload: { outputs?: { result?: { query?: string; provider?: string; model?: string; tookMs?: number; content?: string; citations?: string[] } }[] } = {};
  if (firstBrace !== -1) {
    try { rawPayload = JSON.parse(out.stdout.slice(firstBrace)); } catch {}
  }
  const result = rawPayload.outputs?.[0]?.result ?? {};
  const rawContent = result.content ?? "";
  // Strip the EXTERNAL_UNTRUSTED_CONTENT wrapper + the "Source: Web Search" preamble.
  const content = rawContent
    .replace(/<<<EXTERNAL_UNTRUSTED_CONTENT[^>]*>>>/g, "")
    .replace(/<<<END_EXTERNAL_UNTRUSTED_CONTENT[^>]*>>>/g, "")
    .replace(/^\s*Source:\s*Web Search\s*---\s*/m, "")
    .trim();
  const citations = result.citations ?? [];

  // Persist successful searches so they show up in the Studio history.
  let savedId: string | undefined;
  if (out.ok && content.length > 0) {
    try {
      const rec = await saveSearch({
        query: result.query ?? query,
        answer: content,
        citations,
        model: result.model,
        provider: result.provider ?? "grok",
        tookMs: result.tookMs,
        createdAt: Date.now(),
      });
      savedId = rec.id;
    } catch { /* non-fatal — history just won't include this run */ }
  }

  return NextResponse.json({
    ok: out.ok && content.length > 0,
    durationMs: out.durationMs,
    provider: result.provider ?? "grok",
    model: result.model,
    query: result.query ?? query,
    tookMs: result.tookMs,
    answer: content,
    citations,
    id: savedId,
    stderr: out.ok ? undefined : out.stderr.slice(0, 800),
  });
}

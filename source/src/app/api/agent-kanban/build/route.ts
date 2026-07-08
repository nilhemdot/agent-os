import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveModel, localChat, extractHtml } from "@/lib/localOllama";
import { recordBuild } from "@/lib/kanbanStore";
import { SITES } from "@/lib/seoPipeline";
import { hermesOneShot, seoWriterPrompt, extractMarkdownArticle, slugify, frontMatterField, mdArticleToPreviewHtml } from "@/lib/kanbanSeo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Builder agent — turns one card into a complete single-file HTML, offline.
const SYS =
  "You are the Builder on a small team. Build EXACTLY what the card asks as ONE complete, self-contained HTML document. " +
  "Inline all CSS in <style> and all JS in <script>. It must run on its own with no build step and no external local files " +
  "(CDN <script src> is fine). Make it look good — dark background, a bold accent colour, clean layout. " +
  "Output ONLY the HTML in a single ```html code block. No explanation.";

export async function POST(req: Request) {
  const { id, title, brief, goal, engine, mode, profile, siteId } = await req.json();
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  if (typeof title !== "string" || !title.trim()) return NextResponse.json({ error: "missing title" }, { status: 400 });

  // ── Hermes SEO mode: a cloud Hermes profile writes a real SEO article, saves the
  //    markdown into the site's posts dir, and renders a styled preview for the board ──
  if (engine === "hermes" && mode === "seo") {
    const prof = typeof profile === "string" ? profile : "content-writer";
    const label = `Hermes · ${prof}`;
    const site = SITES.find((s) => s.id === siteId);
    if (!site) return NextResponse.json({ ok: false, model: label, verdict: "error", note: `unknown siteId '${siteId}'` }, { status: 400 });
    const today = new Date().toISOString().slice(0, 10);
    try {
      const raw = await hermesOneShot(prof, seoWriterPrompt(title, brief || "", site.name, today), 220_000);
      const md = extractMarkdownArticle(raw);
      if (!md) {
        return NextResponse.json({ ok: false, model: label, bytes: 0, verdict: "rejected", note: "Hermes didn't return a usable markdown article (no front matter) — re-run this card" });
      }
      // unique slug in the site's posts dir (never overwrite an existing post)
      let slug = slugify(frontMatterField(md, "title") || title);
      await mkdir(site.postsDir, { recursive: true });
      if (existsSync(path.join(site.postsDir, `${slug}.md`))) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
      const mdPath = path.join(site.postsDir, `${slug}.md`);
      await writeFile(mdPath, md, "utf8");

      // styled HTML preview into the Kanban workspace so the card renders the article
      const previewHtml = mdArticleToPreviewHtml(md, site.name);
      const bytes = Buffer.byteLength(md);
      const liveUrl = `${site.url}/blog/${slug}/`;
      await recordBuild(
        { id, title: String(frontMatterField(md, "title") || title).slice(0, 80), brief: String(brief ?? "").slice(0, 240), goal: String(goal ?? "").slice(0, 160), model: label, bytes, createdAt: Date.now() },
        previewHtml,
      );
      return NextResponse.json({ ok: true, model: label, bytes, verdict: "approved", note: `article saved → ${slug}.md (${Math.round(bytes / 1024)}kb)`, slug, liveUrl, mdPath });
    } catch (e) {
      return NextResponse.json({ ok: false, model: label, bytes: 0, verdict: "error", note: String(e).slice(0, 200) }, { status: 502 });
    }
  }

  const model = await resolveModel();
  const prompt = `Card: ${title}\nBuild: ${brief || title}`;
  try {
    const raw = await localChat(model, SYS, prompt, { temperature: 0.5 });
    const html = extractHtml(raw);
    // The Reviewer: verify a real, renderable HTML artifact actually came out.
    const ok = !!html && /<(html|body|canvas|svg|div|style)/i.test(html) && html.length > 120;
    if (!ok) {
      return NextResponse.json({ ok: false, model, bytes: 0, verdict: "rejected", note: "no usable HTML came back — the local model may have rambled instead of building" });
    }
    const bytes = Buffer.byteLength(html!);
    // Save into the durable workspace (survives reload + reboot, unlike /tmp).
    await recordBuild({ id, title: String(title).slice(0, 80), brief: String(brief ?? "").slice(0, 240), goal: String(goal ?? "").slice(0, 160), model, bytes, createdAt: Date.now() }, html!);
    return NextResponse.json({ ok: true, model, bytes, verdict: "approved", note: "real HTML in your workspace — verified" });
  } catch (e) {
    return NextResponse.json({ ok: false, model, bytes: 0, verdict: "error", note: String(e).slice(0, 160) }, { status: 502 });
  }
}

import { NextResponse } from "next/server";
import { readItem, writeItem, classifyIdea, draftPlan } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Agents shape the idea: classify → route → (for projects) draft a proposed plan.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug || "");
  const item = await readItem(slug);
  if (!item) return NextResponse.json({ ok: false, error: "Item not found." }, { status: 404 });

  try {
    const cls = await classifyIdea(item.idea, req.signal);
    item.route = cls.route;
    item.title = cls.title || item.title;
    item.confidence = cls.confidence;
    item.tags = cls.tags;
    const pct = `${(cls.confidence * 100).toFixed(0)}%`;
    if (cls.route === "project") {
      item.classification = `Routed to **project** · confidence ${pct} · tags: ${cls.tags.join(", ") || "—"}. A multi-step undertaking — drafting a plan for your review.`;
      item.plan = await draftPlan(item.idea, item.title, item.tags, req.signal);
      item.stage = "review";
    } else if (cls.route === "escalate") {
      item.classification = `Classifier wasn't confident (${pct}). Escalated for your call.`;
      item.stage = "review";
    } else {
      const filed = cls.route === "action" ? "a GTD action" : cls.route === "idea" ? "a parked idea" : "reference";
      item.classification = `Routed to **${cls.route}** · confidence ${pct} · filed as ${filed}.`;
      item.stage = "shipped";
    }
    await writeItem(item);
    return NextResponse.json({ ok: true, item });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e).slice(0, 200) }, { status: 502 });
  }
}

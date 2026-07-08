import { NextResponse } from "next/server";
import { resolveModel, localChat } from "@/lib/localOllama";
import { hermesOneShot, seoPlannerPrompt, parsePlannerJson } from "@/lib/kanbanSeo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Planner agent — decomposes a goal into 3–5 small, buildable cards. Offline.
const SYS =
  "You are the Planner on a small build team. Break the user's goal into 3 to 5 SMALL, concrete build tasks — " +
  "each one a single self-contained visual web thing (a page, widget, toy, animation, calculator, mini-game) that one developer can build as ONE HTML file. " +
  'Return STRICT JSON only: {"cards":[{"title":"short name","brief":"one sentence of exactly what to build"}]}. ' +
  "No prose, no markdown. Keep titles under 5 words. Make the set varied and genuinely useful or fun.";

export async function POST(req: Request) {
  const { goal, engine, profile } = await req.json();
  if (typeof goal !== "string" || !goal.trim()) return NextResponse.json({ error: "missing goal" }, { status: 400 });

  // ── Hermes SEO mode: a cloud Hermes profile plans an SEO article cluster ──
  if (engine === "hermes") {
    const prof = typeof profile === "string" ? profile : "kimi-highspeed";
    const label = `Hermes · ${prof}`;
    try {
      const raw = await hermesOneShot(prof, seoPlannerPrompt(goal.trim()), 120_000);
      const parsed = parsePlannerJson(raw);
      const cards = parsed.map((c, i) => ({ id: `c${Date.now().toString(36)}${i}`, title: c.title, brief: c.brief }));
      if (!cards.length) return NextResponse.json({ error: "the planner returned no cards — try rephrasing the goal", model: label }, { status: 502 });
      return NextResponse.json({ cards, model: label });
    } catch (e) {
      return NextResponse.json({ error: `planner failed: ${String(e).slice(0, 200)}`, model: label }, { status: 502 });
    }
  }

  const model = await resolveModel();
  try {
    const raw = await localChat(model, SYS, `Goal: ${goal.trim()}`, { format: "json", temperature: 0.5 });
    let parsed: { cards?: { title?: string; brief?: string }[] };
    try { parsed = JSON.parse(raw); } catch { parsed = { cards: [] }; }
    const cards = (parsed.cards || [])
      .filter((c) => c && typeof c.title === "string")
      .slice(0, 6)
      .map((c, i) => ({ id: `c${Date.now().toString(36)}${i}`, title: String(c.title).slice(0, 60), brief: String(c.brief ?? "").slice(0, 240) }));
    if (!cards.length) return NextResponse.json({ error: "the planner returned no cards — try rephrasing the goal", model }, { status: 502 });
    return NextResponse.json({ cards, model });
  } catch (e) {
    return NextResponse.json({ error: `planner failed: ${String(e).slice(0, 160)}`, model }, { status: 502 });
  }
}

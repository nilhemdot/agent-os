import { NextResponse } from "next/server";
import { readGoals, writeGoals, type Goal } from "@/lib/vaultWriter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function newId(): string { return Math.random().toString(36).slice(2, 10); }

export async function GET() {
  const goals = await readGoals();
  return NextResponse.json({ goals });
}

export async function POST(req: Request) {
  const body = await req.json();
  const text = String(body.text ?? "").slice(0, 500).trim();
  const category = body.category ? String(body.category).slice(0, 30).trim() : undefined;
  if (!text) return NextResponse.json({ error: "empty text" }, { status: 400 });
  const goals = await readGoals();
  const goal: Goal = {
    id: newId(),
    text, category,
    done: false,
    createdAt: new Date().toISOString(),
  };
  goals.unshift(goal);
  await writeGoals(goals);
  return NextResponse.json({ goal, total: goals.length });
}

export async function PATCH(req: Request) {
  const body = await req.json();
  const id = String(body.id ?? "");
  const goals = await readGoals();
  const g = goals.find((x) => x.id === id);
  if (!g) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (typeof body.done === "boolean") g.done = body.done;
  if (typeof body.text === "string" && body.text.trim()) g.text = body.text.slice(0, 500).trim();
  if (typeof body.category === "string") g.category = body.category.slice(0, 30).trim() || undefined;
  await writeGoals(goals);
  return NextResponse.json({ goal: g });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const goals = await readGoals();
  const next = goals.filter((g) => g.id !== id);
  await writeGoals(next);
  return NextResponse.json({ ok: true, total: next.length });
}

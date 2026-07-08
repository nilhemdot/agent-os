import { NextResponse } from "next/server";
import { readItem, writeItem, breakIntoTasks } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// The one human checkpoint: approve → PM breaks the plan into subagent tasks and
// the project moves to Execute. Reject → archived.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug || "");
  const approve = body.approve !== false;
  const item = await readItem(slug);
  if (!item) return NextResponse.json({ ok: false, error: "Item not found." }, { status: 404 });

  if (!approve) {
    item.stage = "rejected";
    await writeItem(item);
    return NextResponse.json({ ok: true, item });
  }

  try {
    if (item.plan && !item.tasks) item.tasks = await breakIntoTasks(item.title, item.plan, req.signal);
  } catch { /* tasks are best-effort */ }
  item.stage = "building";
  await writeItem(item);
  return NextResponse.json({ ok: true, item });
}

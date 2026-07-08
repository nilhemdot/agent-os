import { NextResponse } from "next/server";
import { generateMusic, type SunoModel } from "@/lib/suno";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODELS = new Set<SunoModel>(["V5", "V4_5PLUS", "V4_5", "V4", "V3_5"]);

// POST /api/music/generate
//   { description, title?, instrumental?, model? }  →  { ok, taskId }
// Kicks off a Suno generation. The UI then polls /api/music/status?taskId=.
export async function POST(req: Request) {
  let payload: { description?: string; title?: string; instrumental?: boolean; model?: string };
  try { payload = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const description = (payload.description ?? "").trim();
  if (!description) return NextResponse.json({ error: "Describe the style you want first." }, { status: 400 });
  if (description.length > 3000) return NextResponse.json({ error: "Description too long (3000 char max)." }, { status: 413 });

  const model = (typeof payload.model === "string" && MODELS.has(payload.model as SunoModel))
    ? (payload.model as SunoModel) : "V4_5";

  try {
    const { taskId } = await generateMusic({
      description,
      title: typeof payload.title === "string" ? payload.title : undefined,
      instrumental: payload.instrumental !== false,
      model,
    });
    return NextResponse.json({ ok: true, taskId, model });
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    const notConfigured = /not configured/.test(msg);
    return NextResponse.json(
      { error: notConfigured ? "Suno isn't connected. Add your key to ~/.agentic-os/suno.env" : msg },
      { status: notConfigured ? 400 : 502 },
    );
  }
}

import { resolveModel } from "@/lib/localModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/local/model — the model the Local agent will actually use right now
// (follows whatever's pinned warm in Ollama). Drives the live UI label.
export async function GET() {
  const { model, warm } = await resolveModel();
  return Response.json({ model, warm }, { headers: { "cache-control": "no-store" } });
}

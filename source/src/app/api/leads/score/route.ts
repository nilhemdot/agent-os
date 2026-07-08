import { scoreAndPersonalize, logRun, type ICP, type Lead } from "@/lib/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST {icp, leads} → leads scored 0-100 + a personalised opener & email draft each.
export async function POST(req: Request) {
  const { icp, leads } = await req.json().catch(() => ({}));
  if (!icp || typeof icp !== "object") return Response.json({ error: "Run the ICP step first." }, { status: 400 });
  if (!Array.isArray(leads) || !leads.length) return Response.json({ error: "No leads to score." }, { status: 400 });
  try {
    const scored = await scoreAndPersonalize(icp as ICP, (leads as Lead[]).slice(0, 100));
    await logRun({
      ts: Date.now(),
      source: scored[0]?.source || "mixed",
      brief: (icp as ICP).brief || "",
      found: leads.length, fresh: leads.length, scored: scored.length,
    });
    return Response.json({ leads: scored }, { headers: { "cache-control": "no-store" } });
  } catch (e: unknown) {
    return Response.json({ error: (e as Error)?.message || "Scoring failed" }, { status: 502 });
  }
}

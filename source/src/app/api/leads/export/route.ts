import { leadsToCsv, type Lead } from "@/lib/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST {leads} → text/csv download of the current list.
export async function POST(req: Request) {
  const { leads } = await req.json().catch(() => ({}));
  if (!Array.isArray(leads) || !leads.length) return Response.json({ error: "No leads to export." }, { status: 400 });
  const csv = leadsToCsv(leads as Lead[]);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="leads-${leads.length}.csv"`,
      "cache-control": "no-store",
    },
  });
}

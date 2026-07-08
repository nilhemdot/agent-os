import { parseICP } from "@/lib/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST {brief, offer} → structured ICP filters.
export async function POST(req: Request) {
  const { brief, offer } = await req.json().catch(() => ({}));
  if (!brief || typeof brief !== "string" || brief.trim().length < 3) {
    return Response.json({ error: "Describe your target customer (a sentence is enough)." }, { status: 400 });
  }
  try {
    const icp = await parseICP(brief.slice(0, 2000), typeof offer === "string" ? offer.slice(0, 1000) : "");
    return Response.json({ icp }, { headers: { "cache-control": "no-store" } });
  } catch (e: unknown) {
    return Response.json({ error: (e as Error)?.message || "ICP parse failed" }, { status: 502 });
  }
}

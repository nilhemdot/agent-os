import { leadsFromCsv, hunterDomainSearch, apolloSearch, suggestCompanies, hunterKey, type ICP, type Lead, type Company } from "@/lib/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST {source, icp?, csv?, domains?} → candidate leads (not yet deduped/scored).
//   source "auto"    → AI suggests real companies from the ICP, Hunter pulls people
//   source "csv"     → parse pasted CSV
//   source "domains" → Hunter Domain Search over pasted domains (free tier)
//   source "apollo"  → Apollo people search from the ICP (needs APOLLO_API_KEY)
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const source = String(body?.source || "");
  try {
    let leads: Lead[] = [];
    let companies: Company[] = [];
    if (source === "auto") {
      const icp = body?.icp as ICP | undefined;
      if (!icp || typeof icp !== "object" || !icp.brief) return Response.json({ error: "Run the ICP step first — describe your customer." }, { status: 400 });
      companies = await suggestCompanies(icp, 12);
      if (!companies.length) return Response.json({ error: "Couldn't suggest companies — try a more specific customer description." }, { status: 502 });
      if (!hunterKey()) {
        return Response.json({ companies, leads: [], count: 0, needsHunter: true }, { headers: { "cache-control": "no-store" } });
      }
      for (const c of companies) {
        try { leads.push(...await hunterDomainSearch(c.domain, 6)); } catch { /* skip */ }
      }
      return Response.json({ companies, leads, count: leads.length }, { headers: { "cache-control": "no-store" } });
    } else if (source === "csv") {
      if (typeof body.csv !== "string" || !body.csv.trim()) return Response.json({ error: "Paste a CSV with a header row." }, { status: 400 });
      leads = leadsFromCsv(body.csv.slice(0, 500_000));
    } else if (source === "domains") {
      const domains = String(body?.domains || "").split(/[\s,]+/).map((d) => d.trim()).filter(Boolean).slice(0, 25);
      if (!domains.length) return Response.json({ error: "Paste one or more company domains." }, { status: 400 });
      for (const d of domains) {
        try { leads.push(...await hunterDomainSearch(d, 10)); } catch { /* skip a failed domain */ }
      }
    } else if (source === "apollo") {
      const icp = body?.icp as ICP | undefined;
      if (!icp || typeof icp !== "object") return Response.json({ error: "Run the ICP step first." }, { status: 400 });
      leads = await apolloSearch(icp, 15);
    } else {
      return Response.json({ error: "Unknown source." }, { status: 400 });
    }
    return Response.json({ leads, count: leads.length }, { headers: { "cache-control": "no-store" } });
  } catch (e: unknown) {
    return Response.json({ error: (e as Error)?.message || "Find failed" }, { status: 502 });
  }
}

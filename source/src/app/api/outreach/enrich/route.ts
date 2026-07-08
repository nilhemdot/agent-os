import { NextResponse } from "next/server";
import { readState, writeState, newId, domainSize, type Lead } from "@/lib/outreach";
import { enrichDomain, firecrawlSearch } from "@/lib/outreachBackends";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST { search?: string, limit?, domains?: string[], leadIds?: string[] }
//  - search: Firecrawl search → new leads (then enriched)
//  - domains: enrich these raw domains as new leads
//  - leadIds: (re)enrich existing leads missing an email
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const state = await readState();
  const out: { found: number; enriched: number; withEmail: number; leads: Lead[] } = { found: 0, enriched: 0, withEmail: 0, leads: [] };

  // 1. Collect the set of domains to work on, creating lead shells as needed.
  const work: Lead[] = [];

  if (typeof body.search === "string" && body.search.trim()) {
    const results = await firecrawlSearch(body.search.trim(), Math.min(Number(body.limit) || 8, 15));
    out.found = results.length;
    for (const r of results) {
      if (state.leads.some((l) => l.domain === r.domain)) continue;
      const lead: Lead = {
        id: newId(), domain: r.domain, email: null,
        title: r.title, reason: r.description?.slice(0, 280),
        companySize: domainSize(r.domain),
        source: "firecrawl-search", status: "new",
        createdAt: new Date().toISOString(), campaignId: body.campaignId || null,
      };
      state.leads.unshift(lead);
      work.push(lead);
    }
  }

  for (const d of Array.isArray(body.domains) ? body.domains : []) {
    const domain = String(d).replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").trim();
    if (!domain) continue;
    let lead = state.leads.find((l) => l.domain === domain);
    if (!lead) {
      lead = { id: newId(), domain, email: null, companySize: domainSize(domain), source: "manual", status: "new", createdAt: new Date().toISOString(), campaignId: body.campaignId || null };
      state.leads.unshift(lead);
    }
    work.push(lead);
  }

  for (const id of Array.isArray(body.leadIds) ? body.leadIds : []) {
    const lead = state.leads.find((l) => l.id === id);
    if (lead) work.push(lead);
  }

  // 2. Enrich each (cap to keep the request bounded).
  const capped = work.slice(0, 12);
  for (const lead of capped) {
    if (lead.email) { out.leads.push(lead); continue; }
    const res = await enrichDomain(lead.domain);
    out.enriched++;
    lead.companySize = res.size;
    lead.sizeNote = res.sizeNote;
    if (res.email) {
      lead.email = res.email;
      lead.source = res.source;
      if (res.name) lead.name = res.name;
      if (res.position) lead.title = res.position;
      lead.status = "enriched";
      lead.enrichedAt = new Date().toISOString();
      if (res.isRole) lead.reason = (lead.reason ? lead.reason + " · " : "") + "⚠ role address";
      out.withEmail++;
    } else {
      lead.reason = (lead.reason ? lead.reason + " · " : "") + (res.note || "no email found");
    }
    out.leads.push(lead);
  }

  await writeState(state);
  return NextResponse.json(out);
}

import { NextResponse } from "next/server";
import {
  readState, writeState, computeStats, newId, domainSize,
  type Campaign, type CampaignStep, type Lead,
} from "@/lib/outreach";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const state = await readState();
  return NextResponse.json({ ...state, stats: computeStats(state) });
}

// Action-dispatch POST so the whole tool talks to one endpoint for state ops.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  const state = await readState();

  switch (action) {
    case "create_campaign": {
      const steps: CampaignStep[] = Array.isArray(body.steps) && body.steps.length
        ? body.steps.map((s: CampaignStep) => ({ subject: String(s.subject || "").slice(0, 300), body: String(s.body || "").slice(0, 8000), afterDays: s.afterDays }))
        : [{ subject: "", body: "" }];
      const camp: Campaign = {
        id: newId(),
        name: String(body.name || "Untitled campaign").slice(0, 120),
        status: "draft",
        steps,
        leadIds: Array.isArray(body.leadIds) ? body.leadIds.map(String) : [],
        dailyCap: typeof body.dailyCap === "number" ? body.dailyCap : undefined,
        createdAt: new Date().toISOString(),
      };
      state.campaigns.unshift(camp);
      await writeState(state);
      return NextResponse.json({ campaign: camp });
    }
    case "update_campaign": {
      const c = state.campaigns.find((x) => x.id === body.id);
      if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
      if (typeof body.name === "string") c.name = body.name.slice(0, 120);
      if (Array.isArray(body.steps)) c.steps = body.steps.map((s: CampaignStep) => ({ subject: String(s.subject || "").slice(0, 300), body: String(s.body || "").slice(0, 8000), afterDays: s.afterDays }));
      if (Array.isArray(body.leadIds)) c.leadIds = body.leadIds.map(String);
      if (typeof body.dailyCap === "number") c.dailyCap = body.dailyCap;
      await writeState(state);
      return NextResponse.json({ campaign: c });
    }
    case "set_status": {
      const c = state.campaigns.find((x) => x.id === body.id);
      if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
      const allowed = ["draft", "active", "paused", "done", "cancelled"];
      if (allowed.includes(body.status)) c.status = body.status;
      await writeState(state);
      return NextResponse.json({ campaign: c });
    }
    case "delete_campaign": {
      state.campaigns = state.campaigns.filter((x) => x.id !== body.id);
      await writeState(state);
      return NextResponse.json({ ok: true });
    }
    case "add_leads": {
      // Manual add: [{domain,email?,name?,reason?}]
      const incoming = Array.isArray(body.leads) ? body.leads : [];
      const added: Lead[] = [];
      for (const l of incoming) {
        const domain = String(l.domain || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").trim();
        if (!domain) continue;
        const lead: Lead = {
          id: newId(),
          domain,
          email: l.email ? String(l.email).toLowerCase().trim() : null,
          name: l.name ? String(l.name).slice(0, 120) : undefined,
          reason: l.reason ? String(l.reason).slice(0, 300) : undefined,
          companySize: domainSize(domain),
          source: "manual",
          status: "new",
          createdAt: new Date().toISOString(),
          campaignId: body.campaignId || null,
        };
        state.leads.unshift(lead);
        added.push(lead);
      }
      await writeState(state);
      return NextResponse.json({ added });
    }
    case "delete_lead": {
      state.leads = state.leads.filter((x) => x.id !== body.id);
      await writeState(state);
      return NextResponse.json({ ok: true });
    }
    case "suppress_lead": {
      // opt a lead out (or back in). Suppressed leads are never emailed again.
      const ids = new Set((Array.isArray(body.ids) ? body.ids : [body.id]).filter(Boolean).map(String));
      const on = body.suppressed !== false; // default: suppress
      let n = 0;
      for (const l of state.leads) {
        if (!ids.has(l.id)) continue;
        if (on && l.status !== "suppressed") { l.status = "suppressed"; n++; }
        else if (!on && l.status === "suppressed") { l.status = l.validation ? "valid" : "enriched"; n++; }
      }
      await writeState(state);
      return NextResponse.json({ ok: true, changed: n });
    }
    case "delete_leads": {
      const ids = new Set((Array.isArray(body.ids) ? body.ids : []).map(String));
      const before = state.leads.length;
      state.leads = state.leads.filter((x) => !ids.has(x.id));
      await writeState(state);
      return NextResponse.json({ ok: true, deleted: before - state.leads.length });
    }
    case "clear_leads": {
      // Optionally scope to a status (e.g. wipe only "bounced" or "invalid").
      const status = body.status ? String(body.status) : null;
      const before = state.leads.length;
      state.leads = status ? state.leads.filter((x) => x.status !== status) : [];
      await writeState(state);
      return NextResponse.json({ ok: true, deleted: before - state.leads.length });
    }
    case "set_paused": {
      state.meta.paused = Boolean(body.paused);
      await writeState(state);
      return NextResponse.json({ ok: true, paused: state.meta.paused });
    }
    case "reset_breaker": {
      state.circuitBreaker = { state: "closed" };
      await writeState(state);
      return NextResponse.json({ ok: true, circuitBreaker: state.circuitBreaker });
    }
    case "set_cap": {
      const cap = Math.max(1, Math.min(500, Number(body.dailyCap) || 25));
      state.meta.dailyCap = cap;
      await writeState(state);
      return NextResponse.json({ ok: true, dailyCap: cap });
    }
    default:
      return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
  }
}

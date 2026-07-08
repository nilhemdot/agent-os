import { NextResponse } from "next/server";
import { readState, writeState, type LeadValidation } from "@/lib/outreach";
import { validateEmail, hunterVerify } from "@/lib/outreachBackends";
import { getHunterKey } from "@/lib/outreachConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST { leadIds?: string[], all?: boolean }
// Verifies each lead's email and updates status to valid/risky/invalid. Prefers
// Hunter's verifier when a key is set (more reliable, won't get SMTP-blocked),
// falling back to the MX+SMTP probe. This gate exists because the first campaign
// bounced 9x on guessed role addresses.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const state = await readState();
  const useHunter = Boolean(await getHunterKey());

  let targets = state.leads.filter((l) => l.email);
  if (Array.isArray(body.leadIds) && body.leadIds.length) {
    const set = new Set(body.leadIds.map(String));
    targets = targets.filter((l) => set.has(l.id));
  } else if (!body.all) {
    // default: only the not-yet-validated ones
    targets = targets.filter((l) => !l.validation);
  }
  targets = targets.slice(0, 15); // bound per request

  const results: { id: string; email: string | null; status: string; reason: string; via: string }[] = [];
  for (const lead of targets) {
    if (!lead.email) continue;
    let v: LeadValidation | null = null;
    let via = "smtp-probe";

    if (useHunter) {
      const h = await hunterVerify(lead.email);
      if (h) {
        via = "hunter";
        v = { ok: h.ok, reason: `${h.result}${h.score != null ? ` (${h.score})` : ""}`, smtp: h.result, roleWarning: h.result === "risky" ? "risky" : null, checkedAt: new Date().toISOString() };
        if (h.result === "risky") v.ok = false; // treat risky as not-yet-valid
      }
    }
    if (!v) v = await validateEmail(lead.email);

    lead.validation = v;
    if (v.ok && !v.roleWarning) lead.status = "valid";
    else if (via === "hunter" && v.reason.startsWith("risky")) lead.status = "risky";
    else if (v.ok && v.roleWarning) lead.status = "risky";
    else lead.status = "invalid";
    results.push({ id: lead.id, email: lead.email, status: lead.status, reason: v.reason, via });
  }

  await writeState(state);
  return NextResponse.json({ checked: results.length, results, via: useHunter ? "hunter" : "smtp-probe" });
}

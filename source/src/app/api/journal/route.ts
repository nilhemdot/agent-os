import { NextResponse } from "next/server";
import { appendJournalEntry, readJournal, listJournalDays, todayISO } from "@/lib/vaultWriter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? todayISO();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "bad date" }, { status: 400 });
  }
  const [entries, days] = await Promise.all([readJournal(date), listJournalDays(30)]);
  return NextResponse.json({ date, entries, days });
}

export async function POST(req: Request) {
  const body = await req.json();
  const text = String(body.text ?? "").trim();
  const date = body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : todayISO();
  if (!text) return NextResponse.json({ error: "empty text" }, { status: 400 });
  if (text.length > 10_000) return NextResponse.json({ error: "too long" }, { status: 413 });
  const res = await appendJournalEntry(date, text);
  const entries = await readJournal(date);
  return NextResponse.json({ ...res, date, entries });
}

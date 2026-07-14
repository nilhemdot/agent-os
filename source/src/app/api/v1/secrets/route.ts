import { NextResponse } from "next/server";
import { credentialBackend, listSecretRefs, storeSecret } from "@/lib/credentialBroker";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ backend: credentialBackend(), secrets: listSecretRefs() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.id !== "string" || typeof body.value !== "string") return NextResponse.json({ error: "id and value required" }, { status: 400 });
  try { storeSecret(body.id, body.value); }
  catch (error) { return NextResponse.json({ error: String(error) }, { status: 503 }); }
  return NextResponse.json({ stored: true, id: body.id, backend: credentialBackend() }, { status: 201 });
}

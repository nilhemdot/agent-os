import { NextResponse } from "next/server";
import { callTool } from "@/lib/notebooklmClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await callTool("notebook_get", { notebook_id: id });
    return NextResponse.json(result);
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  try {
    if (typeof body.new_title === "string" || typeof body.title === "string") {
      const result = await callTool("notebook_rename", { notebook_id: id, new_title: body.new_title ?? body.title });
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: "no patchable field" }, { status: 400 });
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await callTool("notebook_delete", { notebook_id: id, confirm: true });
    return NextResponse.json(result);
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}

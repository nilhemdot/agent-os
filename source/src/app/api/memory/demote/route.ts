import { NextResponse } from "next/server";
import { demoteMemory, getMemoryById } from "@/lib/memoryStore";
import * as vaultWriter from "@/lib/vaultWriter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const id = body.id ? String(body.id).trim() : "";
    const actor = body.actor ? String(body.actor).trim() : "";

    if (!id) {
      return NextResponse.json(
        { ok: false, error: "id required" } as ApiResponse<never>,
        { status: 400 }
      );
    }

    if (!actor) {
      return NextResponse.json(
        { ok: false, error: "actor required" } as ApiResponse<never>,
        { status: 400 }
      );
    }

    // Validate actor is an allowed human marker
    if (actor !== "user") {
      return NextResponse.json(
        { ok: false, error: "invalid actor" } as ApiResponse<never>,
        { status: 400 }
      );
    }

    // H2: Validate id format before DB/vault operations
    if (!vaultWriter.isValidMemoryId(id)) {
      return NextResponse.json(
        { ok: false, error: "invalid id format" } as ApiResponse<never>,
        { status: 400 }
      );
    }

    // R3-O8 residual: explicit 404 on missing id (parity with promote route)
    // instead of a 500 from demoting a non-existent row.
    if (!getMemoryById(id)) {
      return NextResponse.json(
        { ok: false, error: "Memory not found" } as ApiResponse<never>,
        { status: 404 }
      );
    }

    const mem = demoteMemory(id, actor);

    // R3.3: On successful demotion, remove from vault by stable ID (best-effort)
    const removeResult = await vaultWriter.removeMemory(id);
    if (!removeResult.ok) {
      // Log the error but don't fail the demotion (best-effort vault removal)
      console.warn(`Failed to remove memory ${id} from vault:`, removeResult.error);
    }

    return NextResponse.json(
      { ok: true, data: mem } as ApiResponse<typeof mem>,
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) } as ApiResponse<never>,
      { status: 500 }
    );
  }
}

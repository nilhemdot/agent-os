import { NextResponse } from "next/server";
import { promoteMemory } from "@/lib/memoryStore";
import { promoteToVault } from "@/lib/vaultGate";

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

    // Promote in memory store
    const mem = promoteMemory(id, actor);

    // Attempt to write to vault
    const vaultRes = await promoteToVault(id, actor);

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

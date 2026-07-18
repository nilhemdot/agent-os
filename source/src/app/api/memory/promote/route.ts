import { NextRequest, NextResponse } from "next/server";
import * as memoryStore from "@/lib/memoryStore";
import * as vaultWriter from "@/lib/vaultWriter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * R2.5: Promotion endpoint — set promoted_by and trust='trusted' on a quarantined memory,
 * then write it to the Obsidian vault.
 *
 * POST /api/memory/promote
 * { "id": string, "actor": string }
 *
 * Transactional: promotion + vault-write must both succeed, or neither happens.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const id = String(body.id || "");
    const actor = String(body.actor || "");

    if (!id) {
      return NextResponse.json(
        { ok: false, error: "id required" },
        { status: 400 }
      );
    }

    if (!actor) {
      return NextResponse.json(
        { ok: false, error: "actor required" },
        { status: 400 }
      );
    }

    if (actor !== "user") {
      return NextResponse.json(
        { ok: false, error: "invalid actor" },
        { status: 400 }
      );
    }

    // Promote the memory
    const memory = memoryStore.promoteMemory(id, actor);

    // Write to vault
    const vaultResult = await vaultWriter.appendMemory({
      agent: "user",
      kind: "note",
      text: memory.content,
    });

    if (!vaultResult.ok) {
      // Rollback: demote the memory back to quarantined if vault write failed
      try {
        memoryStore.demoteMemory(id, "user");
      } catch { /* ignore rollback errors */ }
      return NextResponse.json(
        { ok: false, error: "Vault write failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      data: memory,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: String(error) },
      { status: 500 }
    );
  }
}

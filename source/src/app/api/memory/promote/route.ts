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

    // H2: Validate id format before DB/vault operations
    if (!vaultWriter.isValidMemoryId(id)) {
      return NextResponse.json(
        { ok: false, error: "invalid id format" },
        { status: 400 }
      );
    }

    // ponytail: R3.2 CRITICAL — Reorder to vault-first pattern (Spec §4.3 line 487).
    // Vault write first: if it fails, memory stays quarantined (no promote, no rollback).
    // DB promote second: if vault succeeds but promote fails, vault entry orphaned but
    // acceptable (human consent already recorded in vault write).

    // Get memory content for vault write (needed early). Lookup is O(1) via direct DB query,
    // unaffected by pagination, and works for both resident and quarantined memories.
    let resident;
    try {
      resident = memoryStore.getMemoryById(id);
      if (!resident) {
        return NextResponse.json(
          { ok: false, error: "Memory not found" },
          { status: 404 }
        );
      }
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: `Failed to fetch memory: ${String(err)}` },
        { status: 500 }
      );
    }

    // Step 1: Write to vault FIRST (with memory ID for safe removal)
    const vaultResult = await vaultWriter.appendMemory({
      agent: "user",
      kind: "note",
      text: resident.content,
      memoryId: id,
    });

    if (!vaultResult.ok) {
      // Vault write failed → memory stays quarantined, no promotion
      return NextResponse.json(
        { ok: false, error: "Vault write failed" },
        { status: 500 }
      );
    }

    // Step 2: Vault succeeded → promote in DB
    // If promote fails, vault entry is orphaned (acceptable per spec)
    try {
      const memory = memoryStore.promoteMemory(id, actor);
      return NextResponse.json({
        ok: true,
        data: memory,
      });
    } catch (promoteErr) {
      // DB promote failed after vault write: return 500 with detail
      return NextResponse.json(
        { ok: false, error: `Promotion failed: ${String(promoteErr)}` },
        { status: 500 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: String(error) },
      { status: 500 }
    );
  }
}

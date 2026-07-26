import { Origin } from "./memoryStore";
import * as vaultWriter from "./vaultWriter";
import * as memoryStore from "./memoryStore";

/**
 * Gate for vault writes: non-human origin routes to quarantine; human writes pass through.
 * ponytail: single gate in shared path, not per-caller patches
 */

export interface GateOptions {
  origin: Origin;
  actor?: string;
}

export async function gateMemory(
  entry: Parameters<typeof vaultWriter.appendMemory>[0],
  opts: GateOptions
): Promise<{ path: string; ok: boolean; quarantined?: string }> {
  if (opts.origin === "human") {
    // Human writes pass through to vault
    return await vaultWriter.appendMemory(entry);
  }

  // Non-human writes: route to memoryStore quarantine (tier: archival, origin, trust: quarantined)
  const content = [
    entry.user ? `User: ${entry.user}` : "",
    entry.reply ? `${entry.agent}: ${entry.reply}` : "",
    entry.text ? entry.text : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const mem = memoryStore.addMemory({
    tier: "archival",
    origin: opts.origin,
    content,
    sourcePath: `${entry.agent}/${entry.kind}`,
  });

  return { path: "", ok: true, quarantined: mem.id };
}

export async function promoteToVault(
  id: string,
  actor: string,
  content?: string
): Promise<{ ok: boolean; path?: string; error?: string; data?: memoryStore.Memory }> {
  try {
    const mem = memoryStore.promoteMemory(id, actor);

    // Write promoted content to vault
    const res = await vaultWriter.appendMemory({
      agent: "system",
      kind: "note",
      text: content || mem.content,
    });

    if (!res.ok) {
      // ponytail: M3-O2 compensation idempotent — if row is already gone (concurrent deletion),
      // that's the state we wanted anyway. Swallow demotion failure to prevent divergence.
      try {
        memoryStore.demoteMemory(id, actor); // rollback to keep DB/vault consistent
      } catch (rollbackErr) {
        // Reaching here means promoteMemory already passed the actor and human-origin
        // guards, so the only reachable throws are "row gone" variants — the end state
        // rollback wanted. Anything else (DB busy/IO) leaves the row promoted with no
        // vault entry, so surface it rather than losing the invariant violation.
        console.warn("[vault] promotion rollback failed:", id, rollbackErr);
      }

      return { ok: false, error: "Vault write failed; promotion rolled back" };
    }

    return { ok: true, path: res.path, data: mem };
  } catch (err) {
    // Same reasoning as the rollback above: "row gone" is the state we wanted, but a
    // DB/IO failure here leaves the row promoted with no vault entry. Surface it.
    try {
      memoryStore.demoteMemory(id, actor);
    } catch (rollbackErr) {
      console.warn("[vault] promotion rollback failed:", id, rollbackErr);
    }
    return { ok: false, error: String(err) };
  }
}

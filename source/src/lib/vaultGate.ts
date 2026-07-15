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
      memoryStore.demoteMemory(id, actor); // rollback to keep DB/vault consistent
      return { ok: false, error: "Vault write failed; promotion rolled back" };
    }

    return { ok: true, path: res.path, data: mem };
  } catch (err) {
    try { memoryStore.demoteMemory(id, actor); } catch { /* already unpromoted */ }
    return { ok: false, error: String(err) };
  }
}

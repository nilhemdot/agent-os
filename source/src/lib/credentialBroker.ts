import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Transform, type TransformCallback } from "node:stream";
import { ledgerDb } from "./ledger";

const powershell = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";
const secretDir = () => process.env.AGENTOS_SECRET_DIR || path.join(os.homedir(), ".agentic-os", "secrets");
const validId = (id: string) => /^[A-Za-z0-9_.-]{1,128}$/.test(id);
const psProtect = `Add-Type -AssemblyName System.Security;$p=[Console]::In.ReadToEnd();$b=[Text.Encoding]::UTF8.GetBytes($p);$e=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($e))`;
const psUnprotect = `Add-Type -AssemblyName System.Security;$p=[Console]::In.ReadToEnd();$b=[Convert]::FromBase64String($p);$e=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Text.Encoding]::UTF8.GetString($e))`;

export function credentialBackend(): "dpapi" | "libsecret" | null {
  if (existsSync(powershell)) return "dpapi";
  return spawnSync("sh", ["-c", "command -v secret-tool"], { encoding: "utf8" }).status === 0 ? "libsecret" : null;
}

export function storeSecret(id: string, value: string): void {
  if (!validId(id) || !value) throw new Error("valid secret id and non-empty value required");
  const backend = credentialBackend(); if (!backend) throw new Error("OS keychain unavailable; refusing plaintext secret storage");
  if (backend === "dpapi") {
    const result = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-Command", psProtect], { input: value, encoding: "utf8", timeout: 10_000 });
    if (result.status !== 0 || !result.stdout) throw new Error("Windows DPAPI failed");
    mkdirSync(secretDir(), { recursive: true, mode: 0o700 });
    const file = path.join(secretDir(), `${id}.dpapi`); writeFileSync(file, result.stdout, { mode: 0o600 }); chmodSync(file, 0o600);
  } else {
    const result = spawnSync("secret-tool", ["store", "--label=AgentOS", "service", "agentos", "id", id], { input: value, encoding: "utf8", timeout: 10_000 });
    if (result.status !== 0) throw new Error("libsecret store failed");
  }
  ledgerDb().prepare("INSERT INTO secret_refs(id,backend,created_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET backend=excluded.backend")
    .run(id, backend, new Date().toISOString());
}

export function loadSecret(id: string): string {
  if (!validId(id)) throw new Error("invalid secret id");
  const backend = credentialBackend(); if (!backend) throw new Error("OS keychain unavailable");
  if (backend === "dpapi") {
    const file = path.join(secretDir(), `${id}.dpapi`); if (!existsSync(file)) throw new Error(`secret not found: ${id}`);
    const result = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-Command", psUnprotect], { input: readFileSync(file, "utf8"), encoding: "utf8", timeout: 10_000 });
    if (result.status !== 0) throw new Error("Windows DPAPI read failed"); return result.stdout;
  }
  const result = spawnSync("secret-tool", ["lookup", "service", "agentos", "id", id], { encoding: "utf8", timeout: 10_000 });
  if (result.status !== 0 || !result.stdout) throw new Error(`secret not found: ${id}`); return result.stdout.trimEnd();
}

export function listSecretRefs(): Array<Record<string, unknown>> {
  return ledgerDb().prepare("SELECT id,backend,created_at FROM secret_refs ORDER BY id").all() as Array<Record<string, unknown>>;
}

export interface SecretRef { id: string; env: string }
export function resolveSecretRefs(value: unknown): { env: Record<string, string>; values: string[]; refs: SecretRef[] } {
  if (value === undefined) return { env: {}, values: [], refs: [] };
  if (!Array.isArray(value)) throw new Error("secretRefs must be an array");
  const refs = value.map((item) => {
    const ref = item as Partial<SecretRef>;
    if (!ref || typeof ref.id !== "string" || typeof ref.env !== "string" || !validId(ref.id) || !/^[A-Z][A-Z0-9_]{1,127}$/.test(ref.env)) throw new Error("invalid secret reference");
    return ref as SecretRef;
  });
  const env: Record<string, string> = {}, values: string[] = [];
  for (const ref of refs) { const secret = loadSecret(ref.id); env[ref.env] = secret; values.push(secret); }
  return { env, values, refs };
}

export function canaryForRun(runId: string): string {
  return `agentos_canary_${createHash("sha256").update(runId).digest("hex").slice(0, 24)}`;
}
const variants = (value: string) => [value, Buffer.from(value).toString("base64"), Buffer.from(value).toString("base64url"),
  encodeURIComponent(value), Buffer.from(value).toString("hex"), Buffer.from(value).toString("hex").toUpperCase()];
export function containsSecret(text: string, values: string[]): boolean { return values.some((value) => variants(value).some((variant) => text.includes(variant))); }
export function redactText(text: string, values: string[]): string {
  let redacted = text;
  for (const value of values) for (const variant of variants(value)) redacted = redacted.split(variant).join("[REDACTED]");
  return redacted;
}

export class RedactTransform extends Transform {
  private carry = ""; private readonly keep: number;
  constructor(private readonly secrets: string[]) { super(); this.keep = Math.max(0, ...secrets.flatMap(variants).map((value) => value.length - 1)); }
  _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback) {
    const combined = this.carry + chunk.toString("utf8"), cut = Math.max(0, combined.length - this.keep);
    this.push(redactText(combined.slice(0, cut), this.secrets)); this.carry = combined.slice(cut); done();
  }
  _flush(done: TransformCallback) { this.push(redactText(this.carry, this.secrets)); done(); }
}

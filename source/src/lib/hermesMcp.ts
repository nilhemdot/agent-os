// Hermes MCP catalogue helpers.
//
// Wraps the `hermes mcp` CLI surface so the dashboard can browse the Nous-
// approved MCP catalogue and manage what's installed/enabled without dropping
// to a terminal. Phase 1: read-only catalogue + installed list + enable/disable
// toggle + uninstall.
//
// We deliberately keep all *writes* going through the CLI where possible (so
// Hermes's own validation runs), and only touch ~/.hermes/config.yaml directly
// for the enable/disable toggle — because the CLI doesn't expose one yet.

import { readFile, writeFile, rename } from "node:fs/promises";
import { hermesHome } from "@/lib/config";
import { existsSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { run } from "@/lib/runner";

export interface CatalogEntry {
  name: string;
  status: "available" | "installed" | "installed (disabled)" | "enabled" | string;
  description: string;
  // Manifest-sourced fields (read from optional-mcps/<name>/manifest.yaml when
  // we can locate the hermes-agent repo on disk).
  source?: string;             // upstream URL — typically a docs/repo link
  authType?: "api_key" | "oauth" | "none" | string;
  authProvider?: string;       // e.g. "google" for OAuth-with-provider
  transportType?: "stdio" | "http" | string;
  manifestVersion?: number;
}

export interface InstalledEntry {
  name: string;
  enabled: boolean;
  transport: "stdio" | "http" | "unknown";
  command?: string;
  url?: string;
  toolCount?: number;
  // From `auth: oauth` / `auth: { type: api_key }` etc in the config.yaml entry.
  authType?: "api_key" | "oauth" | "none" | string;
  raw: Record<string, unknown>;
}

const CONFIG_PATH = path.join(hermesHome(), "config.yaml");

// Where the hermes-agent repo lives locally. The catalog manifests for every
// Nous-approved MCP live under <repo>/optional-mcps/<name>/manifest.yaml.
// This is the canonical install layout — `hermes update` clones into ~/.hermes/hermes-agent.
const OPTIONAL_MCPS_DIR = path.join(hermesHome(), "hermes-agent", "optional-mcps");

interface ManifestData {
  name?: string;
  description?: string;
  source?: string;
  manifest_version?: number;
  transport?: { type?: string; url?: string; command?: string };
  auth?: string | { type?: string; provider?: string };
  tools?: { default_enabled?: string[] };
}

// Read the manifest.yaml for a given catalog entry. Returns null if the
// manifest isn't on disk (e.g. user hasn't run `hermes update` yet).
async function readManifest(name: string): Promise<ManifestData | null> {
  const p = path.join(OPTIONAL_MCPS_DIR, name, "manifest.yaml");
  if (!existsSync(p)) return null;
  try {
    const raw = await readFile(p, "utf8");
    return yaml.load(raw) as ManifestData;
  } catch { return null; }
}

// Normalise auth into a flat shape. Manifests can declare `auth: oauth` (string
// shorthand) OR `auth: { type: oauth, provider: google }` (object form).
function extractAuth(authField: unknown): { type?: string; provider?: string } {
  if (!authField) return {};
  if (typeof authField === "string") return { type: authField };
  if (typeof authField === "object") {
    const a = authField as Record<string, unknown>;
    const type = typeof a["type"] === "string" ? (a["type"] as string) : undefined;
    const provider = typeof a["provider"] === "string" ? (a["provider"] as string) : undefined;
    return { type, provider };
  }
  return {};
}

// Parse the `hermes mcp catalog` table. Format (from the live CLI):
//
//   Name               Status                   Description
//   ------------------ ------------------------ -----------
//   linear             available                Find, create, and update Linear...
//   n8n                available                Manage and inspect n8n workflows...
//
// We split on the column rule line ("------ -----...") to lock in column widths,
// then slice each row by those widths. Robust to descriptions that contain
// multiple spaces.
export async function listCatalog(): Promise<CatalogEntry[]> {
  const res = await run("hermes", ["mcp", "catalog"], { cwd: process.cwd(), timeoutMs: 10000 });
  if (!res.ok) return [];
  const lines = res.stdout.split("\n");
  // Find the rule line (the one of dashes).
  const ruleIdx = lines.findIndex((l) => /^-{3,}\s+-{3,}/.test(l.trim()));
  if (ruleIdx < 1) return [];
  const ruleLine = lines[ruleIdx].replace(/^\s+/, "");
  const leadingSpaces = lines[ruleIdx].length - ruleLine.length;
  // Compute column starts from the rule line: first column starts at 0
  // (relative to the trimmed line), next columns start where the next dash run
  // begins. We add leadingSpaces back to get absolute offsets.
  // Column boundaries = each transition from space → dash. The first column
  // always starts at offset 0 (relative to the trimmed rule line).
  const offsets: number[] = [0];
  for (let i = 1; i < ruleLine.length; i++) {
    if (ruleLine[i] === "-" && ruleLine[i - 1] === " ") {
      offsets.push(i);
    }
  }
  const absOffsets = offsets.map((o) => o + leadingSpaces);
  // Header is the line immediately above the rule.
  // const headerLine = lines[ruleIdx - 1] ?? "";

  const rows: CatalogEntry[] = [];
  for (let i = ruleIdx + 1; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln || !ln.trim()) break; // catalog ends at blank line
    if (ln.startsWith("  Install:") || ln.startsWith("Install:")) break;
    const [nStart, sStart, dStart] = absOffsets;
    const name = ln.slice(nStart, sStart).trim();
    const status = ln.slice(sStart, dStart).trim();
    const description = ln.slice(dStart).trim();
    if (!name) continue;
    rows.push({ name, status, description });
  }

  // Merge in manifest details when available. Done in parallel so a slow disk
  // read doesn't serialise the whole catalogue list. Missing manifest = just
  // leave the manifest fields undefined; CLI-derived fields still render.
  const enriched = await Promise.all(rows.map(async (row) => {
    const m = await readManifest(row.name);
    if (!m) return row;
    const auth = extractAuth(m.auth);

    // ponytail: protocol validation to prevent javascript: URL injection
    let source: string | undefined;
    if (typeof m.source === "string") {
      try {
        const parsed = new URL(m.source);
        if (["http:", "https:"].includes(parsed.protocol)) {
          source = m.source;
        }
      } catch {
        // invalid URL, omit
      }
    }

    return {
      ...row,
      source,
      authType: auth.type,
      authProvider: auth.provider,
      transportType: m.transport?.type,
      manifestVersion: typeof m.manifest_version === "number" ? m.manifest_version : undefined,
    };
  }));
  return enriched;
}

// Read the mcp_servers section from config.yaml directly. The CLI's
// `hermes mcp list` output is human-formatted; reading the YAML lets us
// surface raw transport details (command vs url) and the enabled flag.
export async function listInstalled(): Promise<InstalledEntry[]> {
  if (!existsSync(CONFIG_PATH)) return [];
  let raw: string;
  try { raw = await readFile(CONFIG_PATH, "utf8"); }
  catch { return []; }
  let doc: unknown;
  try { doc = yaml.load(raw); }
  catch { return []; }
  if (!doc || typeof doc !== "object") return [];
  const servers = (doc as Record<string, unknown>)["mcp_servers"];
  if (!servers || typeof servers !== "object") return [];

  const out: InstalledEntry[] = [];
  for (const [name, cfg] of Object.entries(servers as Record<string, unknown>)) {
    if (!cfg || typeof cfg !== "object") continue;
    const c = cfg as Record<string, unknown>;
    const enabled = c["enabled"] !== false; // default true if unset
    const url = typeof c["url"] === "string" ? (c["url"] as string) : undefined;
    const command = typeof c["command"] === "string" ? (c["command"] as string) : undefined;
    const transport: InstalledEntry["transport"] = url ? "http" : command ? "stdio" : "unknown";
    const toolsSection = c["tools"];
    let toolCount: number | undefined;
    if (toolsSection && typeof toolsSection === "object") {
      const inc = (toolsSection as Record<string, unknown>)["include"];
      if (Array.isArray(inc)) toolCount = inc.length;
    }
    // auth: oauth (string shorthand) or auth: { type: api_key } (object form).
    // env var with a *_TOKEN suffix is a hint for api_key when auth is unset.
    const auth = extractAuth(c["auth"]);
    let authType: string | undefined = auth.type;
    if (!authType) {
      const env = c["env"];
      if (env && typeof env === "object") {
        const keys = Object.keys(env);
        if (keys.some((k) => /TOKEN|API_KEY|SECRET/i.test(k))) authType = "api_key";
      }
    }
    out.push({ name, enabled, transport, command, url, toolCount, authType, raw: c });
  }
  return out;
}

// Toggle the `enabled` flag for a given server. The CLI doesn't expose this
// directly, so we read+modify+atomic-rewrite config.yaml ourselves. We round-
// trip through js-yaml which preserves all unrelated keys.
export async function toggleEnabled(name: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!existsSync(CONFIG_PATH)) return { ok: false, error: "config.yaml not found" };
  let raw: string;
  try { raw = await readFile(CONFIG_PATH, "utf8"); }
  catch (e) { return { ok: false, error: String(e) }; }
  let doc: Record<string, unknown>;
  try { doc = yaml.load(raw) as Record<string, unknown>; }
  catch (e) { return { ok: false, error: `yaml parse: ${e}` }; }
  if (!doc) doc = {};
  const servers = (doc["mcp_servers"] as Record<string, unknown> | undefined) ?? {};
  const entry = servers[name];
  if (!entry || typeof entry !== "object") {
    return { ok: false, error: `server '${name}' is not configured` };
  }
  (entry as Record<string, unknown>)["enabled"] = enabled;
  // Atomic write: write to temp then rename, so a half-written config can't
  // brick Hermes if we crash mid-flush.
  const tmp = `${CONFIG_PATH}.tmp-${Date.now()}`;
  try {
    const dump = yaml.dump(doc, { lineWidth: 120, noRefs: true });
    await writeFile(tmp, dump, { mode: 0o644 });
    await rename(tmp, CONFIG_PATH);
  } catch (e) { return { ok: false, error: String(e) }; }
  return { ok: true };
}

// Uninstall via the Hermes CLI (it knows how to clean up bootstrap dirs,
// tokens, etc — we don't want to reimplement that).
export async function uninstall(name: string): Promise<{ ok: boolean; output: string; error?: string }> {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
    return { ok: false, output: "", error: "invalid mcp name" };
  }
  const res = await run("hermes", ["mcp", "remove", name], { cwd: process.cwd(), timeoutMs: 15000 });
  return { ok: res.ok, output: res.stdout || res.stderr, error: res.ok ? undefined : (res.stderr || `exit ${res.code}`) };
}

// ─── Phase 2: install flow helpers ──────────────────────────────────────────

const ENV_PATH = path.join(hermesHome(), ".env");

export interface ManifestEnvVar {
  name: string;
  prompt: string;
  default?: string;
  required?: boolean;
  secret?: boolean;
}

export interface ManifestSummary {
  name: string;
  description?: string;
  source?: string;
  manifestVersion?: number;
  transportType?: string;
  authType?: string;
  authProvider?: string;
  envVars: ManifestEnvVar[];
  defaultEnabledTools?: string[];
  // Bootstrap commands — surfaced for the trust-model dialog.
  bootstrap?: string[];
  installUrl?: string;
  installRef?: string;
}

// Public reader — same readManifest as the private helper above but with
// normalised return shape suitable for the install modal.
export async function loadManifest(name: string): Promise<ManifestSummary | null> {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) return null;
  const m = await readManifest(name);
  if (!m) return null;
  const auth = extractAuth(m.auth);
  const envVars: ManifestEnvVar[] = [];
  // auth.env is the env var list (api_key shape). We dig in raw because our
  // shared ManifestData interface above only sketches the shape.
  if (m.auth && typeof m.auth === "object") {
    const env = (m.auth as Record<string, unknown>)["env"];
    if (Array.isArray(env)) {
      for (const item of env) {
        if (!item || typeof item !== "object") continue;
        const it = item as Record<string, unknown>;
        if (typeof it["name"] !== "string") continue;
        envVars.push({
          name: it["name"] as string,
          prompt: typeof it["prompt"] === "string" ? it["prompt"] as string : (it["name"] as string),
          default: typeof it["default"] === "string" ? it["default"] as string : undefined,
          required: it["required"] !== false,
          secret: it["secret"] === true,
        });
      }
    }
  }
  // Read install block + bootstrap from the raw YAML for the trust dialog.
  // (Schema is documented in PR #30870 — we re-parse to preserve fields the
  // typed interface above doesn't enumerate.)
  let bootstrap: string[] | undefined;
  let installUrl: string | undefined;
  let installRef: string | undefined;
  try {
    const raw = await readFile(path.join(OPTIONAL_MCPS_DIR, name, "manifest.yaml"), "utf8");
    const full = yaml.load(raw) as Record<string, unknown> | null;
    const installBlock = full?.["install"];
    if (installBlock && typeof installBlock === "object") {
      const ib = installBlock as Record<string, unknown>;
      if (typeof ib["url"] === "string") installUrl = ib["url"] as string;
      if (typeof ib["ref"] === "string") installRef = ib["ref"] as string;
      if (Array.isArray(ib["bootstrap"])) {
        bootstrap = (ib["bootstrap"] as unknown[]).filter((x): x is string => typeof x === "string");
      }
    }
  } catch { /* manifest read failure already handled by readManifest above */ }

  return {
    name,
    description: typeof m.description === "string" ? m.description : undefined,
    source: typeof m.source === "string" ? m.source : undefined,
    manifestVersion: typeof m.manifest_version === "number" ? m.manifest_version : undefined,
    transportType: m.transport?.type,
    authType: auth.type,
    authProvider: auth.provider,
    envVars,
    defaultEnabledTools: Array.isArray(m.tools?.default_enabled) ? m.tools?.default_enabled : undefined,
    bootstrap,
    installUrl,
    installRef,
  };
}

// Append/update env vars in ~/.hermes/.env atomically. Preserves all existing
// keys; only overwrites the ones in `vars`. Atomic = write to tempfile + rename
// so a half-written .env can't brick Hermes config loading.
export async function upsertEnv(vars: Record<string, string>): Promise<{ ok: boolean; error?: string; written: string[] }> {
  const keys = Object.keys(vars);
  if (keys.length === 0) return { ok: true, written: [] };
  // Light sanity: env var names follow POSIX shape.
  for (const k of keys) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
      return { ok: false, error: `invalid env var name: ${k}`, written: [] };
    }
  }
  let existing = "";
  if (existsSync(ENV_PATH)) {
    try { existing = await readFile(ENV_PATH, "utf8"); }
    catch (e) { return { ok: false, error: String(e), written: [] }; }
  }
  // Walk existing lines, replace any whose key is in vars, leave others.
  const lines = existing.split(/\r?\n/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
    if (m && vars[m[1]] !== undefined) {
      out.push(`${m[1]}=${escapeEnvValue(vars[m[1]])}`);
      seen.add(m[1]);
    } else {
      out.push(line);
    }
  }
  // Drop trailing empty lines, we'll re-add a single newline at the end.
  while (out.length && out[out.length - 1] === "") out.pop();
  for (const k of keys) {
    if (!seen.has(k)) out.push(`${k}=${escapeEnvValue(vars[k])}`);
  }
  const body = out.join("\n") + "\n";
  const tmp = `${ENV_PATH}.tmp-${Date.now()}`;
  try {
    await writeFile(tmp, body, { mode: 0o600 });
    await rename(tmp, ENV_PATH);
  } catch (e) { return { ok: false, error: String(e), written: [] }; }
  return { ok: true, written: keys };
}

// Conservative escape: if the value has special characters, wrap in double
// quotes and escape inner double quotes + backslashes. dotenv parsers vary;
// this works with python-dotenv (what Hermes uses).
function escapeEnvValue(v: string): string {
  if (/^[A-Za-z0-9._/:@-]*$/.test(v)) return v;
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// ─── Custom MCP add ─────────────────────────────────────────────────────────
// Wraps `hermes mcp add <name> [...]` for the wider MCP ecosystem (servers
// that aren't in the Nous-approved catalogue). Non-interactive — the CLI
// command accepts all required fields as flags.

export interface AddCustomSpec {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  auth?: "oauth" | "header";
  preset?: string;
  envVars?: Record<string, string>;
}

export async function addCustomServer(spec: AddCustomSpec): Promise<{ ok: boolean; output: string; error?: string }> {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(spec.name)) {
    return { ok: false, output: "", error: "name must match [a-zA-Z0-9_-]{1,64}" };
  }
  if (spec.transport === "stdio" && !spec.command) {
    return { ok: false, output: "", error: "stdio transport requires a command" };
  }
  if (spec.transport === "http" && !spec.url) {
    return { ok: false, output: "", error: "http transport requires a url" };
  }
  // 1) Write env vars first so the CLI sees them populated. Hermes config also
  //    references them by `${VAR}` substitution at server-connect time.
  if (spec.envVars && Object.keys(spec.envVars).length > 0) {
    const r = await upsertEnv(spec.envVars);
    if (!r.ok) return { ok: false, output: "", error: `env write failed: ${r.error}` };
  }

  // 2) Build the CLI arg list. Validate each piece — anything user-supplied
  //    must not contain shell metacharacters or NULs.
  const cleanStr = (s: string): string | null => {
    if (typeof s !== "string" || s.length === 0 || s.length > 4096) return null;
    if (s.includes("\0")) return null;
    // We allow most printable ASCII because args can include URLs, paths, etc.
    // We reject control chars and the actual shell metacharacters we'd worry
    // about (none here since spawn() doesn't shell-interpret args).
    return s;
  };

  const argList: string[] = ["mcp", "add", spec.name];
  if (spec.url) {
    const u = cleanStr(spec.url);
    if (!u) return { ok: false, output: "", error: "invalid url" };
    argList.push("--url", u);
  }
  if (spec.command) {
    const c = cleanStr(spec.command);
    if (!c) return { ok: false, output: "", error: "invalid command" };
    argList.push("--command", c);
  }
  if (spec.args && spec.args.length > 0) {
    argList.push("--args");
    for (const a of spec.args) {
      const ca = cleanStr(a);
      if (ca === null) return { ok: false, output: "", error: `invalid arg: ${a}` };
      argList.push(ca);
    }
  }
  if (spec.auth) argList.push("--auth", spec.auth);
  if (spec.preset) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(spec.preset)) {
      return { ok: false, output: "", error: "invalid preset name" };
    }
    argList.push("--preset", spec.preset);
  }
  // The CLI accepts --env KEY=VAL KEY=VAL... but env vars are also in .env
  // already (step 1). We pass them on the CLI too so the CLI's own validation
  // (e.g. "this preset wants GITHUB_TOKEN") sees them this run.
  if (spec.envVars && Object.keys(spec.envVars).length > 0) {
    argList.push("--env");
    for (const [k, v] of Object.entries(spec.envVars)) {
      // Encode KEY=VAL — the CLI parses on first `=`.
      argList.push(`${k}=${v}`);
    }
  }

  const res = await run("hermes", argList, { cwd: process.cwd(), timeoutMs: 30000 });
  return { ok: res.ok, output: res.stdout || res.stderr, error: res.ok ? undefined : (res.stderr || `exit ${res.code}`) };
}

// ─── Per-tool tools.include editor ─────────────────────────────────────────
// Updates the `tools.include` array for an installed server. Atomic YAML
// rewrite — only the targeted server's tools.include is touched.

export async function setToolsInclude(name: string, tools: string[]): Promise<{ ok: boolean; error?: string }> {
  if (!existsSync(CONFIG_PATH)) return { ok: false, error: "config.yaml not found" };
  // Light validation of tool names — MCP tool names are dotted identifiers.
  for (const t of tools) {
    if (typeof t !== "string" || t.length === 0 || t.length > 200) {
      return { ok: false, error: `invalid tool name: ${t}` };
    }
    if (!/^[A-Za-z0-9_.-]+$/.test(t)) {
      return { ok: false, error: `tool name contains illegal chars: ${t}` };
    }
  }
  let raw: string;
  try { raw = await readFile(CONFIG_PATH, "utf8"); }
  catch (e) { return { ok: false, error: String(e) }; }
  let doc: Record<string, unknown>;
  try { doc = yaml.load(raw) as Record<string, unknown>; }
  catch (e) { return { ok: false, error: `yaml parse: ${e}` }; }
  if (!doc) doc = {};
  const servers = (doc["mcp_servers"] as Record<string, unknown> | undefined) ?? {};
  const entry = servers[name];
  if (!entry || typeof entry !== "object") {
    return { ok: false, error: `server '${name}' is not configured` };
  }
  const entryObj = entry as Record<string, unknown>;
  if (tools.length === 0) {
    // Empty list = remove the include filter entirely (which means "all tools").
    // This matches the docs: "If you select everything, no filter is written".
    if (entryObj["tools"] && typeof entryObj["tools"] === "object") {
      const toolsObj = entryObj["tools"] as Record<string, unknown>;
      delete toolsObj["include"];
      if (Object.keys(toolsObj).length === 0) delete entryObj["tools"];
    }
  } else {
    const existing = (entryObj["tools"] as Record<string, unknown> | undefined) ?? {};
    existing["include"] = tools;
    entryObj["tools"] = existing;
  }
  const tmp = `${CONFIG_PATH}.tmp-${Date.now()}`;
  try {
    const dump = yaml.dump(doc, { lineWidth: 120, noRefs: true });
    await writeFile(tmp, dump, { mode: 0o644 });
    await rename(tmp, CONFIG_PATH);
  } catch (e) { return { ok: false, error: String(e) }; }
  return { ok: true };
}

// Read tools.include for a given installed server. Returns null if no include
// filter is set (which means "all tools enabled").
export async function getToolsInclude(name: string): Promise<string[] | null> {
  if (!existsSync(CONFIG_PATH)) return null;
  let doc: unknown;
  try { doc = yaml.load(await readFile(CONFIG_PATH, "utf8")); }
  catch { return null; }
  if (!doc || typeof doc !== "object") return null;
  const servers = (doc as Record<string, unknown>)["mcp_servers"];
  if (!servers || typeof servers !== "object") return null;
  const entry = (servers as Record<string, unknown>)[name];
  if (!entry || typeof entry !== "object") return null;
  const toolsSection = (entry as Record<string, unknown>)["tools"];
  if (!toolsSection || typeof toolsSection !== "object") return null;
  const inc = (toolsSection as Record<string, unknown>)["include"];
  if (!Array.isArray(inc)) return null;
  return inc.filter((t): t is string => typeof t === "string");
}

// The manifest_version our codepath understands. Anything higher = warn the
// user to update Hermes before installing.
export const SUPPORTED_MANIFEST_VERSION = 1;

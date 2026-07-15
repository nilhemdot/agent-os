import { readFileSync, existsSync, writeFileSync, openSync } from "node:fs";
import { hermesHome } from "@/lib/config";
import { spawn, execSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

// Orchestration for the "Call your Hermes agent" phone pipeline:
//   Twilio number → ElevenLabs ConvAI agent → public tunnel → Hermes API server.
// Reads ElevenLabs + API-server keys from the Hermes profile .env (never config.json).

// Read the ACTIVE Hermes profile (e.g. "julian"), not a hardcoded "main" — most
// installs use a named profile. ~/.hermes/active_profile holds the current one.
function activeProfile(): string {
  try {
    const p = readFileSync(path.join(hermesHome(), "active_profile"), "utf8").trim();
    if (p) return p;
  } catch { /* fall through */ }
  return process.env.HERMES_PROFILE || "main";
}
const ENV_FILE = path.join(hermesHome(), "profiles", activeProfile(), ".env");
const TUNNEL_LOG = "/tmp/agentos-cf-tunnel.log";
const TUNNEL_URL_FILE = "/tmp/agentos-cf-url.txt";
const API_PORT = 8642;
const EL = "https://api.elevenlabs.io/v1/convai";
const AGENT_NAME = "Hermes Phone Agent (Agent OS)";
const SECRET_NAME = "hermes_api_server_key";
const ADAM_VOICE = "pNInz6obpgDQGcFmaJgB";

export function readHermesEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(ENV_FILE)) return out;
  for (const raw of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

function elKey(): string { return readHermesEnv().ELEVENLABS_API_KEY ?? ""; }
function apiServerKey(): string { return readHermesEnv().API_SERVER_KEY ?? ""; }

function findCloudflared(): string | null {
  const candidates = [
    path.join(os.homedir(), ".local", "bin", "cloudflared"),
    "/opt/homebrew/bin/cloudflared",
    "/usr/local/bin/cloudflared",
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  try { return execSync("command -v cloudflared", { encoding: "utf8" }).trim() || null; } catch { return null; }
}

async function reachable(url: string, headers: Record<string, string> = {}, ms = 6000): Promise<number | null> {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(ms), cache: "no-store" });
    return r.status;
  } catch { return null; }
}

// ── API server ───────────────────────────────────────────────────────────
export async function apiServerUp(): Promise<boolean> {
  // 401 (auth required) or 200 both mean it's listening.
  const s = await reachable(`http://127.0.0.1:${API_PORT}/v1/models`);
  return s === 200 || s === 401;
}

// ── Tunnel ───────────────────────────────────────────────────────────────
export function tunnelProcessRunning(): boolean {
  try { execSync("pgrep -f 'cloudflared tunnel --url'", { stdio: ["ignore", "pipe", "ignore"] }); return true; }
  catch { return false; }
}
export function savedTunnelUrl(): string | null {
  try { return existsSync(TUNNEL_URL_FILE) ? readFileSync(TUNNEL_URL_FILE, "utf8").trim() || null : null; } catch { return null; }
}
export async function tunnelStatus(): Promise<{ running: boolean; url: string | null; reachable: boolean; cloudflared: boolean }> {
  const url = savedTunnelUrl();
  const running = tunnelProcessRunning();
  let ok = false;
  if (url && running) {
    const s = await reachable(`${url}/v1/models`, { Authorization: `Bearer ${apiServerKey()}` }, 8000);
    ok = s === 200;
  }
  return { running, url, reachable: ok, cloudflared: !!findCloudflared() };
}
export async function startTunnel(): Promise<{ url: string | null; error?: string }> {
  const bin = findCloudflared();
  if (!bin) return { url: null, error: "cloudflared not installed" };
  if (tunnelProcessRunning()) {
    const u = savedTunnelUrl();
    if (u) return { url: u };
    try { execSync("pkill -f 'cloudflared tunnel --url'"); } catch {}
  }
  try { writeFileSync(TUNNEL_LOG, ""); } catch {}
  const child = spawn(bin, ["tunnel", "--url", `http://localhost:${API_PORT}`], {
    detached: true,
    stdio: ["ignore", (await import("node:fs")).openSync(TUNNEL_LOG, "a"), (await import("node:fs")).openSync(TUNNEL_LOG, "a")],
  });
  child.unref();
  // poll the log for the trycloudflare URL
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const m = readFileSync(TUNNEL_LOG, "utf8").match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) { writeFileSync(TUNNEL_URL_FILE, m[0]); return { url: m[0] }; }
    } catch {}
  }
  return { url: null, error: "tunnel did not produce a URL in time" };
}
export function stopTunnel(): void {
  try { execSync("pkill -f 'cloudflared tunnel --url'"); } catch {}
  try { writeFileSync(TUNNEL_URL_FILE, ""); } catch {}
}

const INSTALL_LOG = "/tmp/agentos-cf-install.log";
export function installerRunning(): boolean {
  try { execSync("pgrep -f 'brew install cloudflared'", { stdio: ["ignore", "pipe", "ignore"] }); return true; }
  catch { return false; }
}
// Kick off `brew install cloudflared` in the background (idempotent). Returns the
// state so the UI can poll tunnelStatus().cloudflared until it flips true.
export function installCloudflared(): { state: "present" | "installing" | "started" | "no-brew" } {
  if (findCloudflared()) return { state: "present" };
  if (installerRunning()) return { state: "installing" };
  let brew = "";
  for (const b of ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]) if (existsSync(b)) { brew = b; break; }
  if (!brew) { try { brew = execSync("command -v brew", { encoding: "utf8" }).trim(); } catch {} }
  if (!brew) return { state: "no-brew" };
  const out = openSync(INSTALL_LOG, "a");
  const child = spawn(brew, ["install", "cloudflared"], {
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: "1", HOMEBREW_NO_INSTALL_CLEANUP: "1", HOMEBREW_NO_ENV_HINTS: "1" },
  });
  child.unref();
  return { state: "started" };
}

// ── ElevenLabs ───────────────────────────────────────────────────────────
async function elFetch(pathStr: string, init?: RequestInit): Promise<unknown> {
  const key = elKey();
  if (!key) throw new Error("ELEVENLABS_API_KEY not set in Hermes .env");
  const r = await fetch(`${EL}${pathStr}`, {
    ...init,
    headers: { "xi-api-key": key, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${typeof data === "string" ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200)}`);
  return data;
}

export async function elevenStatus(): Promise<{
  configured: boolean;
  numbers: { phone_number: string; id: string; agent_id?: string; agent_name?: string }[];
  hermesAgentId: string | null;
}> {
  if (!elKey()) return { configured: false, numbers: [], hermesAgentId: null };
  const nums = (await elFetch("/phone-numbers")) as Array<Record<string, unknown>>;
  const numbers = (Array.isArray(nums) ? nums : []).map((n) => ({
    phone_number: String(n.phone_number ?? ""),
    id: String(n.phone_number_id ?? ""),
    agent_id: (n.assigned_agent as Record<string, unknown> | null)?.agent_id as string | undefined,
    agent_name: (n.assigned_agent as Record<string, unknown> | null)?.agent_name as string | undefined,
  }));
  const agentsResp = (await elFetch("/agents?page_size=50")) as { agents?: Array<Record<string, unknown>> };
  const hermes = (agentsResp.agents ?? []).find((a) => a.name === AGENT_NAME);
  return { configured: true, numbers, hermesAgentId: (hermes?.agent_id as string) ?? null };
}

async function ensureSecret(): Promise<string> {
  const list = (await elFetch("/secrets")) as Array<Record<string, unknown>>;
  const existing = (Array.isArray(list) ? list : []).find((s) => s.name === SECRET_NAME);
  if (existing) return String(existing.secret_id);
  const created = (await elFetch("/secrets", {
    method: "POST",
    body: JSON.stringify({ type: "new", name: SECRET_NAME, value: apiServerKey() }),
  })) as { secret_id: string };
  return created.secret_id;
}

// Create-or-update the Hermes agent's custom LLM to point at the live tunnel, then
// assign the given phone number (or the first Twilio one) to it.
export async function syncAgent(phoneNumberId?: string): Promise<{ agentId: string; url: string; assigned: string[] }> {
  const url = savedTunnelUrl();
  if (!url) throw new Error("Start the tunnel first");
  const secretId = await ensureSecret();
  const customLlm = { url: `${url}/v1`, model_id: "main", api_key: { secret_id: secretId } };

  // find existing hermes agent
  const agentsResp = (await elFetch("/agents?page_size=50")) as { agents?: Array<Record<string, unknown>> };
  let agentId = (agentsResp.agents ?? []).find((a) => a.name === AGENT_NAME)?.agent_id as string | undefined;

  const convConfig = {
    agent: {
      language: "en",
      first_message: "Hi, this is your Hermes agent. How can I help?",
      prompt: {
        prompt: "You are Hermes, a helpful, concise voice assistant answering a phone call. Keep replies short and natural for speech.",
        llm: "custom-llm",
        custom_llm: customLlm,
      },
    },
    tts: { voice_id: ADAM_VOICE },
  };

  if (!agentId) {
    const created = (await elFetch("/agents/create", {
      method: "POST",
      body: JSON.stringify({ name: AGENT_NAME, conversation_config: convConfig }),
    })) as { agent_id: string };
    agentId = created.agent_id;
  } else {
    await elFetch(`/agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify({ conversation_config: convConfig }),
    });
  }

  // assign phone number(s)
  const nums = (await elFetch("/phone-numbers")) as Array<Record<string, unknown>>;
  const targets = (Array.isArray(nums) ? nums : []).filter((n) =>
    phoneNumberId ? n.phone_number_id === phoneNumberId : n.provider === "twilio"
  );
  const assigned: string[] = [];
  for (const n of targets) {
    await elFetch(`/phone-numbers/${n.phone_number_id}`, {
      method: "PATCH",
      body: JSON.stringify({ agent_id: agentId }),
    });
    assigned.push(String(n.phone_number));
  }
  return { agentId: agentId!, url: `${url}/v1`, assigned };
}

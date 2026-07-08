import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Gemini 3.5 Live Translate connection broker.
//
// The browser cannot safely hold the API key, and Gemini's ephemeral-token
// auth doesn't work over the raw websocket (only the official SDK's internal
// path does). So this route — which only ever answers localhost (Agent OS
// binds 127.0.0.1) — reads the key from ~/.agentic-os/gemini.env (OUTSIDE the
// repo, never committed, never written into the mini-app HTML) and hands the
// browser a ready-to-use websocket URL + the Live setup message. The key lives
// only in the local browser session for the duration of a translation.
const KEY_FILE = path.join(homedir(), ".agentic-os", "gemini.env");
const MODEL = "models/gemini-3.5-live-translate-preview";
const WS_BASE =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

async function readKey(): Promise<string | null> {
  try {
    const env = await readFile(KEY_FILE, "utf8");
    const m = env.match(/GEMINI_API_KEY\s*=\s*(.+)/);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

// Only allow same-machine callers — defence in depth on top of the 127.0.0.1 bind.
function isLocal(req: Request): boolean {
  const host = (req.headers.get("host") || "").split(":")[0];
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

export async function POST(req: Request) {
  if (!isLocal(req)) return NextResponse.json({ error: "local only" }, { status: 403 });

  const key = await readKey();
  if (!key)
    return NextResponse.json(
      { error: "No Gemini API key found. Add GEMINI_API_KEY=… to ~/.agentic-os/gemini.env, then reload." },
      { status: 400 },
    );

  let body: { to?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* default below */
  }
  // Gemini Live Translate AUTO-DETECTS the spoken language, so the client only
  // chooses the TARGET. Keep it to a short BCP-47 code (e.g. "es", "fr", "ja").
  const to = (body.to || "es").trim().slice(0, 12).replace(/[^A-Za-z-]/g, "") || "es";

  const setup = {
    model: MODEL,
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    generationConfig: {
      responseModalities: ["AUDIO"],
      translationConfig: { targetLanguageCode: to, echoTargetLanguage: true },
    },
  };

  return NextResponse.json({ wsUrl: `${WS_BASE}?key=${encodeURIComponent(key)}`, setup, model: MODEL });
}

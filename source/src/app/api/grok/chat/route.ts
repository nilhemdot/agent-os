import { spawnStream } from "@/lib/runner";
import { hermesHome } from "@/lib/config";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Grok Build chat — drives the REAL Grok Build CLI (signed in via `grok login`
// on the X Premium+ / SuperGrok plan — no API key, no OpenRouter cost). One turn:
//   grok -p "<prompt>" --output-format streaming-json --always-approve --cwd <ws>
// Grok's streaming-json emits one JSON object per line:
//   {"type":"thought","data":"…"}   — chain-of-thought (skipped in the chat view)
//   {"type":"text","data":"…"}       — the actual answer (streamed to the user)
//   {"type":"end","stopReason":"…"}  — end of turn
// Anything it writes (HTML games, apps) lands in the grok-build workspace, which
// the Workspace tab + preview route serve, so a chat build shows up as a build.
//   {"t":"d","c":"chunk"}  · {"t":"done"}  · {"t":"error","m":"…"}

const GROK_WORKSPACE = path.join(hermesHome(), "profiles", "grok-build", "workspace");

interface ChatMsg { role: "user" | "assistant" | "system"; text: string; }

function buildPromptWithHistory(history: ChatMsg[], current: string): string {
  if (!history.length) return current;
  const recent = history.slice(-24);
  const lines: string[] = [
    "The following is the prior conversation between you and the user.",
    "Read it, then answer the user's latest message at the bottom.",
    "",
    "--- prior conversation ---",
  ];
  let bytes = 0;
  const MAX_BYTES = 8000;
  for (const m of recent) {
    const role = m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : "System";
    const line = `${role}: ${m.text}`;
    if (bytes + line.length > MAX_BYTES) { lines.push("…[earlier turns trimmed]"); break; }
    lines.push(line);
    bytes += line.length;
  }
  lines.push("--- end prior conversation ---", "", `User: ${current}`, "Assistant:");
  return lines.join("\n");
}

export async function POST(req: Request) {
  const body = await req.json();
  const prompt = body.prompt;
  const history: ChatMsg[] = Array.isArray(body.history) ? body.history : [];
  if (typeof prompt !== "string" || prompt.length === 0) {
    return new Response("missing prompt", { status: 400 });
  }
  if (prompt.length > 16_000) {
    return new Response("prompt too long", { status: 413 });
  }
  const fullPrompt = buildPromptWithHistory(history, prompt);

  // Pin cwd to the grok-build workspace so anything it builds lands where the
  // Workspace tab + preview route can serve it.
  if (!existsSync(GROK_WORKSPACE)) { try { await mkdir(GROK_WORKSPACE, { recursive: true }); } catch {} }
  const cwd = GROK_WORKSPACE;

  const args = ["-p", fullPrompt, "--output-format", "streaming-json", "--always-approve"];

  let child;
  try {
    child = spawnStream("grok", args, { cwd });
  } catch (e) {
    return new Response(JSON.stringify({ t: "error", m: String(e) }) + "\n",
      { status: 503, headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let emitted = false;
      let stderrBuf = "";
      let stdoutBuf = "";
      const send = (obj: unknown) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n")); }
        catch { closed = true; }
      };
      const safeClose = () => { if (closed) return; closed = true; try { controller.close(); } catch {} };

      const handleLine = (line: string) => {
        const t = line.trim();
        if (!t) return;
        let evt: { type?: string; data?: unknown };
        try { evt = JSON.parse(t); } catch { return; } // ignore non-JSON noise
        if (evt.type === "text" && typeof evt.data === "string" && evt.data) {
          emitted = true; send({ t: "d", c: evt.data });
        }
        // thought / tool / end events are not shown in the chat stream.
      };

      child.stdout.on("data", (b: Buffer) => {
        stdoutBuf += b.toString();
        const lines = stdoutBuf.split("\n");
        stdoutBuf = lines.pop() ?? "";
        for (const l of lines) handleLine(l);
      });
      child.stderr.on("data", (b: Buffer) => { stderrBuf += b.toString(); });
      child.on("close", (code) => {
        if (stdoutBuf) handleLine(stdoutBuf);
        if (!emitted) {
          const se = stderrBuf.trim();
          const msg = /not (logged|signed) in|unauthor|auth/i.test(se)
            ? "Grok Build isn't signed in. Run `grok login --device-auth` in a terminal (X Premium+ / SuperGrok)."
            : (se.slice(-400) || `Grok exited with code ${code} and no output.`);
          send({ t: "error", m: msg });
        }
        send({ t: "done", code });
        safeClose();
      });
      child.on("error", (e) => { send({ t: "error", m: String(e) }); safeClose(); });
    },
    cancel() { try { child.kill("SIGTERM"); } catch {} },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

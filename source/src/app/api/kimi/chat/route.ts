import { spawnStream } from "@/lib/runner";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KIMI_SCRATCH_ROOT = process.env.AGENTIC_OS_KIMI_SCRATCH
  ?? path.join(os.homedir(), ".agentic-os", "kimi-projects");

async function ensureKimiProject(name: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) return null;
  if (!existsSync(KIMI_SCRATCH_ROOT)) await mkdir(KIMI_SCRATCH_ROOT, { recursive: true });
  const dir = path.join(KIMI_SCRATCH_ROOT, name);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  return dir;
}

// Kimi Code chat — `kimi -p "<prompt>" --output-format stream-json` runs one
// turn non-interactively and emits NDJSON. Kimi's events look like:
//   {"role":"assistant","content":"..."}                    — the answer
//   {"role":"meta","type":"session.resume_hint","session_id":...}
// We translate them into a tiny envelope the KimiView reads:
//   {"t":"d","c":"chunk"}  · {"t":"done"}  · {"t":"error","m":"..."}
//
// Kimi runs single-shot per invocation (like codex / claude -p), so we pack
// prior turns into the prompt for multi-turn memory.
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

// Pull display text out of a Kimi assistant event's `content` (string or blocks).
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b) => (typeof b === "string" ? b : (b?.text ?? ""))).join("");
  }
  return "";
}

export async function POST(req: Request) {
  const body = await req.json();
  const prompt = body.prompt;
  const model = typeof body.model === "string" && /^[A-Za-z0-9._:/-]+$/.test(body.model) ? body.model : null;
  const history: ChatMsg[] = Array.isArray(body.history) ? body.history : [];
  if (typeof prompt !== "string" || prompt.length === 0) {
    return new Response("missing prompt", { status: 400 });
  }
  if (prompt.length > 16_000) {
    return new Response("prompt too long", { status: 413 });
  }
  const fullPrompt = buildPromptWithHistory(history, prompt);

  // Pin Kimi's cwd to a scratch project so anything it writes (HTML, scripts,
  // assets) lands somewhere the Workspace tab + preview route can serve.
  let cwd: string | undefined;
  if (typeof body.project === "string" && /^[A-Za-z0-9_.-]+$/.test(body.project)) {
    cwd = (await ensureKimiProject(body.project)) ?? undefined;
  } else if (typeof body.cwd === "string") {
    cwd = body.cwd;
  } else {
    cwd = (await ensureKimiProject("kimi-default")) ?? path.join(KIMI_SCRATCH_ROOT, "kimi-default");
  }

  // `-p` is single-shot non-interactive; stream-json emits one JSON object per line.
  // (-y / --auto are rejected in prompt mode — prompt mode is already non-interactive.)
  const args = ["-p", fullPrompt, "--output-format", "stream-json"];
  if (model) args.push("--model", model);

  let child;
  try {
    child = spawnStream("kimi", args, { cwd });
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
        let evt: { role?: string; content?: unknown; type?: string };
        try { evt = JSON.parse(t); } catch { return; } // ignore non-JSON noise
        if (evt.role === "assistant") {
          const text = contentText(evt.content);
          if (text) { emitted = true; send({ t: "d", c: text }); }
        }
        // meta / session hints and everything else are ignored for the chat view.
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
          const msg = stderrBuf.trim().slice(-400) || `Kimi exited with code ${code} and no output.`;
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

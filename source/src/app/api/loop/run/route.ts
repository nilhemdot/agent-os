import { orKey, nousToken, workerAct, verdict, DEFAULT_JUDGE } from "@/lib/loopEngine";
import { minimaxToken } from "@/lib/hermesStudio";
import { writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Pull a complete HTML doc out of an artifact (strip ```html fences) so visual
// builds can be saved as openable .html files in the Builds workspace.
function extractHtml(text: string): string | null {
  const fence = /```(?:html)?\s*\n?([\s\S]*?)```/i.exec(text);
  const body = fence ? fence[1] : text;
  if (!/<!doctype html|<html[\s>]|<body[\s>]|<svg[\s>]|<canvas[\s>]/i.test(body)) return null;
  const m = /(<!doctype html[\s\S]*<\/html>|<html[\s\S]*<\/html>|<svg[\s\S]*<\/svg>)/i.exec(body);
  return (m ? m[1] : body).trim();
}

// Find the Playwright headless-chromium binary (separate from the user's real Chrome).
let _chrome: string | null | undefined;
function findChrome(): string | null {
  if (_chrome !== undefined) return _chrome;
  _chrome = null;
  try {
    const base = path.join(os.homedir(), "Library", "Caches", "ms-playwright");
    const fs = require("node:fs") as typeof import("node:fs");
    for (const d of fs.readdirSync(base)) {
      if (!d.startsWith("chromium_headless_shell")) continue;
      const inner = path.join(base, d);
      for (const sub of fs.readdirSync(inner)) {
        const bin = path.join(inner, sub, "chrome-headless-shell");
        if (existsSync(bin)) { _chrome = bin; return _chrome; }
      }
    }
  } catch { /* none */ }
  return _chrome;
}

// RENDER VERIFICATION — actually open the build in a headless browser and catch
// JS/console errors or a blank render. This is what a text judge can't do: tell
// whether the thing genuinely WORKS. Returns { ok, errors }.
async function renderCheck(html: string, signal?: AbortSignal): Promise<{ ok: boolean; errors: string[] }> {
  const bin = findChrome();
  if (!bin) return { ok: true, errors: [] }; // no browser → can't verify, don't block
  const tmp = path.join(os.tmpdir(), `loop-rc-${Date.now()}-${process.pid}.html`);
  try {
    await writeFile(tmp, html, "utf8");
    const dom = await new Promise<{ out: string; err: string }>((resolve) => {
      const child = spawn(bin, [
        "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
        "--enable-logging=stderr", "--v=1", "--virtual-time-budget=3500",
        "--dump-dom", `file://${tmp}`,
      ], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "", err = "";
      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} resolve({ out, err }); }, 15000);
      const onAbort = () => { try { child.kill("SIGKILL"); } catch {} };
      signal?.addEventListener("abort", onAbort, { once: true });
      child.stdout.on("data", (d) => { out += String(d); });
      child.stderr.on("data", (d) => { err += String(d); });
      child.on("close", () => { clearTimeout(timer); resolve({ out, err }); });
      child.on("error", () => { clearTimeout(timer); resolve({ out, err }); });
    });
    const errors: string[] = [];
    // JS / console errors surfaced by the browser
    const errRe = /CONSOLE[^"]*"([^"]*(?:Uncaught|ReferenceError|TypeError|SyntaxError|is not defined|is not a function|Cannot read|null is not)[^"]*)"/gi;
    let m: RegExpExecArray | null;
    const seen = new Set<string>();
    while ((m = errRe.exec(dom.err)) !== null) {
      const e = m[1].trim();
      if (!seen.has(e)) { seen.add(e); errors.push(`Browser error: ${e}`); }
      if (errors.length >= 5) break;
    }
    // blank render check (skip for canvas/svg apps which can be visually rich with little text)
    const hasCanvasOrSvg = /<canvas|<svg/i.test(dom.out);
    const visibleText = dom.out.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!hasCanvasOrSvg && visibleText.length < 20) errors.push("It renders blank/empty — nothing visible on the page.");
    return { ok: errors.length === 0, errors };
  } catch {
    return { ok: true, errors: [] }; // verification failure shouldn't block the loop
  } finally {
    try { await rm(tmp, { force: true }); } catch { /* ignore */ }
  }
}

function judgeName(j: string): string {
  if (j === "local") return "Local (Ollama)";
  if (j === "openrouter/fusion") return "Fusion council";
  if (j.startsWith("minimax:")) return `MiniMax · ${j.slice(8)}`;
  if (j.startsWith("nous:")) return `Nous · ${j.slice(5)}`;
  if (/n2/i.test(j)) return "N2 (free)";
  return j.split("/").pop() || j;
}

// POST { goal, artifact?, worker?, judge?, maxIters? } → streams NDJSON of the loop cycle.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const goal = String(body.goal || "").trim();
  const startArtifact = String(body.artifact || "");
  const worker = String(body.worker || "minimax:MiniMax-M3");
  const judge = String(body.judge || DEFAULT_JUDGE);
  const maxIters = Math.max(1, Math.min(8, Number(body.maxIters) || 4));
  const key = orKey();
  const creds = { orKey: key, nousToken: nousToken(), minimaxToken: minimaxToken() };
  const enc = new TextEncoder();

  const usesOR = (id: string) => id !== "local" && !id.startsWith("nous:") && !id.startsWith("minimax:");
  const needsOR = usesOR(worker) || usesOR(judge);
  const usesNous = worker.startsWith("nous:") || judge.startsWith("nous:");
  const usesMinimax = worker.startsWith("minimax:") || judge.startsWith("minimax:");
  const jName = judgeName(judge);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => { try { controller.enqueue(enc.encode(JSON.stringify(o) + "\n")); } catch { /* closed */ } };
      if (!goal) { send({ t: "error", m: "Define what 'done' looks like first." }); send({ t: "done", reason: "no goal" }); controller.close(); return; }
      if (needsOR && !key) { send({ t: "error", m: "No OpenRouter key — pick the free Local judge + a free/MiniMax builder, or add a key." }); send({ t: "done", reason: "no key" }); controller.close(); return; }
      if (usesNous && !creds.nousToken) { send({ t: "error", m: "Nous Portal isn't logged in. Run `hermes portal`, then rerun." }); send({ t: "done", reason: "nous not logged in" }); controller.close(); return; }
      if (usesMinimax && !creds.minimaxToken) { send({ t: "error", m: "MiniMax isn't connected. Run `hermes auth add minimax-oauth`, then rerun." }); send({ t: "done", reason: "minimax not connected" }); controller.close(); return; }

      let cur = startArtifact, issues: string[] = [], lastScore = -1, stall = 0, done = false, passed = false, reason = "";
      send({ t: "start", goal, worker, judge, maxIters });

      for (let n = 1; n <= maxIters && !req.signal.aborted; n++) {
        send({ t: "iter", n, step: "state", detail: n === 1 ? "Reading the goal + starting point" : "Re-reading goal + last verdict" });
        send({ t: "iter", n, step: "act", detail: `Builder (${worker.split("/").pop()}) working…` });
        try { cur = await workerAct(goal, cur, issues, worker, creds, req.signal); }
        catch (e) { send({ t: "iter", n, step: "error", detail: `Builder failed — ${String(e).slice(0, 140)}` }); if (req.signal.aborted) break; continue; }
        send({ t: "artifact", n, artifact: cur });

        const html = extractHtml(cur);
        // STEP — RUN IT. For visual builds, open in a real browser first; a build
        // with JS errors or a blank render is auto-rejected (the judge can't see that).
        if (html) {
          send({ t: "iter", n, step: "verify", detail: "Running it in a real browser…" });
          const rc = await renderCheck(html, req.signal);
          if (!rc.ok) {
            send({ t: "verdict", n, pass: false, score: 0, issues: rc.errors, summary: "It doesn't run cleanly in the browser — fixing the errors and trying again." });
            issues = rc.errors;
            stall = 0 <= lastScore ? stall + 1 : 0; lastScore = 0;
            if (stall >= 2) { reason = "Couldn't get it running cleanly after repeated tries — stopped. Try a stronger builder or simpler goal."; break; }
            continue; // builder fixes the runtime errors next round; don't waste a judge call
          }
        }

        // STEP — JUDGE the spec/quality (it already runs cleanly if it's HTML)
        send({ t: "iter", n, step: "verify", detail: `${jName} judging adversarially…` });
        let v;
        try { v = await verdict(goal, cur, judge, creds, req.signal); }
        catch (e) { send({ t: "iter", n, step: "error", detail: `Verifier failed — ${String(e).slice(0, 140)}` }); break; }
        send({ t: "verdict", n, pass: v.pass, score: v.score, issues: v.issues, summary: v.summary });
        if (v.pass) { done = true; passed = true; reason = `${jName} approved on round ${n} — it runs clean and meets the goal.`; break; }
        issues = v.issues;
        if (v.score <= lastScore) stall++; else stall = 0;
        lastScore = v.score;
        if (stall >= 2) { done = true; reason = `No progress for 2 rounds (stalled ~${v.score}/100). Stopped — refine the goal and rerun.`; break; }
      }
      if (req.signal.aborted) reason = "Stopped by you.";
      else if (!done) reason = `Reached the ${maxIters}-round cap without a clean pass.`;

      const slug = (goal.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 46)) || "loop";
      // VAULT — always log the run (the loop's memory), pass or fail.
      try {
        const dir = path.join(os.homedir(), "Documents", "Obsidian Vault", "Agentic OS", "Loops");
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, `${slug}.md`), `# Loop · ${goal}\n\n**Result:** ${reason}\n**Passed:** ${passed}\n**Builder:** ${worker} · **Judge:** ${jName}\n\n---\n\n${cur}\n`, "utf8");
      } catch { /* vault optional */ }
      // BUILDS WORKSPACE — ONLY save builds that actually passed (ran clean + met the goal).
      // No more half-broken junk in the gallery.
      if (passed) {
        try {
          const html = extractHtml(cur);
          if (html) {
            const bdir = path.join(os.homedir(), ".agentic-os", "loop-builds");
            await mkdir(bdir, { recursive: true });
            await writeFile(path.join(bdir, `${slug}.html`), html, "utf8");
            send({ t: "saved", slug });
          }
        } catch { /* builds optional */ }
      }

      send({ t: "done", reason, artifact: cur, passed });
      controller.close();
    },
  });

  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}

import { run } from "@/lib/runner";
import os from "node:os";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Draft this →" — turns one radar signal into a ready-to-fire banger X post (tweet) in
// the user's voice: scroll-stopping hook, beautiful line breaks, no hashtags. Designed to
// quote-post on top of the source tweet. Uses Hermes (Grok via OAuth).

const HERMES_WORKSPACE = os.homedir(); // cwd for the hermes run — output comes back on stdout

// Map ASCII to Unicode "Mathematical Sans-Serif Bold" so the hook renders bold on X
// (X has no markdown — this is how people bold text in a tweet).
function toBold(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 65 && c <= 90) out += String.fromCodePoint(0x1d5d4 + (c - 65));       // A-Z
    else if (c >= 97 && c <= 122) out += String.fromCodePoint(0x1d5ee + (c - 97)); // a-z
    else if (c >= 48 && c <= 57) out += String.fromCodePoint(0x1d7ec + (c - 48));  // 0-9
    else out += ch;
  }
  return out;
}

function formatTweet(raw: string): string {
  let t = raw.trim();
  const fence = t.match(/```(?:[a-z]*)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  t = t.replace(/^(?:tweet|post|x post)\s*:\s*/i, "");        // drop a "Tweet:" label if added
  t = t.replace(/\*\*([\s\S]+?)\*\*/g, (_m, inner) => toBold(inner)); // **bold** -> unicode bold (no /s flag — pre-es2018 safe)
  t = t.replace(/__([\s\S]+?)__/g, (_m, inner) => toBold(inner));     // __bold__ -> unicode bold
  t = t.replace(/\*/g, "");                                    // drop any leftover markdown asterisks
  t = t.replace(/(^|\s)#[A-Za-z0-9_]+/g, "$1");               // strip hashtags (keep the surrounding space)
  t = t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const headline = String(body.headline || "").slice(0, 200);
  const why = String(body.why_now || "").slice(0, 600);
  const angle = String(body.angle || "").slice(0, 400);
  const hook = String(body.hook || "").slice(0, 300);
  if (!headline) return Response.json({ ok: false, error: "missing signal" }, { status: 400 });

  const who = config.userName && config.userName !== "You" ? config.userName : "you";
  const prompt = [
    `You are writing an X (Twitter) post as ${who}. Turn this trending AI story into ONE banger tweet to QUOTE-POST on top of the original post and ride the wave today.`,
    "",
    `TREND: ${headline}`,
    `WHY IT'S HOT: ${why}`,
    `THE ANGLE: ${angle}`,
    hook ? `A HOOK TO BUILD ON: ${hook}` : "",
    "",
    "Write it as a scroll-stopping X post in the user's voice — direct, punchy, confident, a strong contrarian or builder take, like a viral tech-founder tweet. Plain English, no fluff, no corporate words.",
    "",
    "RULES:",
    "- Open with a SHORT punchy hook line. Wrap ONLY that one hook line in **double asterisks** so it can be bolded.",
    "- Then 3-6 short lines — ONE sentence per line — with blank lines between beats for clean, beautiful spacing.",
    "- Deliver a real insight or hot take, not a summary. Make the reader feel they'll fall behind if they ignore this.",
    "- End on a punchy one-liner takeaway.",
    "- NO hashtags. NO links. NO 'thread', NO 'RT if', NO 'follow me'. At most ONE tasteful emoji, and only if it truly fits.",
    "- It must read as a strong STANDALONE tweet that also works as commentary quoting the original post.",
    "- Keep it tight — a few short lines, not an essay.",
    "- Do NOT run any web/X search. Output ONLY the tweet text, nothing before or after.",
  ].filter(Boolean).join("\n");

  const res = await run("hermes", ["-z", prompt], { cwd: HERMES_WORKSPACE, timeoutMs: 150_000 });

  const text = (res.stdout || "").trim();
  if (!text) {
    const se = (res.stderr || "").trim();
    return Response.json({ ok: false, error: se.slice(-260) || "Hermes returned nothing." }, { status: 502 });
  }
  return Response.json({ ok: true, draft: formatTweet(text) });
}

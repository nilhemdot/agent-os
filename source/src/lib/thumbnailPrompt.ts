// Prompt layer for the thumbnail tool. Two modes:
//
//  "edit" (default): look at the reference and write a prompt that recreates it
//    FAITHFULLY — same design, fonts, colours, layout — changing ONLY what the
//    user asked. This is what ChatGPT does ("thought for 1m"): analyse the image,
//    describe it in full, apply the one change → gpt-image regenerates it cleanly.
//
//  "redesign": art-direct a brand-new thumbnail using the channel style guide.

import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const SKILL = path.join(os.homedir(), ".claude/skills/youtube-thumbnails");

function openaiKey(): string | null {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    const env = readFileSync(path.join(SKILL, ".env"), "utf8");
    const m = env.match(/^OPENAI_API_KEY=(.+)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
  } catch { return null; }
}

function styleGuide(): string {
  try { return readFileSync(path.join(SKILL, "reference/style-guide.md"), "utf8"); }
  catch { return ""; }
}

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

const EDIT_SYSTEM = `You are editing an EXISTING YouTube thumbnail. Look very carefully at the reference image and recreate it FAITHFULLY — the exact same design, layout, composition, fonts, font weights, colours, logos, icons, badges, arrows, borders and background — changing ONLY what the user explicitly asks for.

Write ONE detailed image-generation prompt for gpt-image-2 that describes the FULL original design precisely so it can be recreated to look identical:
- Every text element: its exact wording, colour, font style (bold/condensed/etc.), case, and position.
- The hero subject / logo / icon (describe it precisely so it is preserved and stays crisp).
- The background, and every accent (badge text + colour, arrow direction + colour, borders, underline, cursor, verified tick).
- Exact layout and composition (what is where).

Then state the user's requested change, integrated into the description.

RULES: Do NOT redesign. Do NOT add, remove, move, or restyle anything except the requested change. Keep it pixel-faithful and clean. End with: "keep the exact original design, crisp and clean, only changing the requested element."

Output ONLY the final prompt text — no preamble, no explanation, no quotes.`;

function redesignSystem(): string {
  return `You are an elite YouTube thumbnail ART DIRECTOR for an AI / AI-agent channel. Turn the user's request into ONE detailed gpt-image-2 prompt for a brand-new CLEAN, high-CTR thumbnail in EXACTLY this channel's style.

=== STYLE GUIDE ===
${styleGuide()}
=== END ===

Specify: the exact HEADLINE (2-4 UPPERCASE words, a shock word), huge bold outlined two-tone text; the single HERO subject from the reference; clean composition; background (white or dark gradient with a coloured glow); accents (FREE badge, arrow, underline, logo pill, ✓). End with "ultra clean, crisp, premium, sharp, professional, not cluttered." Output ONLY the prompt.`;
}

export async function enhancePrompt(instruction: string, refDataUrl: string | null, mode: "edit" | "redesign" = "edit"): Promise<string> {
  const key = openaiKey();
  if (!key) return instruction;
  // Edit mode needs an image to describe; with no reference, fall back to redesign.
  const useMode = mode === "edit" && !refDataUrl ? "redesign" : mode;
  const system = useMode === "edit" ? EDIT_SYSTEM : redesignSystem();

  const userText = useMode === "edit"
    ? `Change requested: ${instruction || "make it cleaner and sharper, keep the design"}`
    : `Create the thumbnail. My instruction: ${instruction || "make a cleaner, more clickable version of this"}`;
  const parts: Part[] = [{ type: "text", text: userText }];
  if (refDataUrl && /^data:image\//.test(refDataUrl)) parts.push({ type: "image_url", image_url: { url: refDataUrl } });

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: system }, { role: "user", content: parts }],
        max_tokens: 700,
        temperature: useMode === "edit" ? 0.3 : 0.75,
      }),
      signal: ctrl.signal,
    });
    const j = await r.json();
    let text = String(j?.choices?.[0]?.message?.content ?? "").trim();
    text = text.replace(/^\**\s*(final\s+)?prompt\s*:?\**\s*/i, "").trim();
    return text.length > 20 ? text : instruction;
  } catch {
    return instruction;
  } finally {
    clearTimeout(to);
  }
}

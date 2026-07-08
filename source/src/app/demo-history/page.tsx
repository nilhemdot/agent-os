"use client";

// One-shot utility page: seeds each agent's Chat thread (browser localStorage)
// with realistic example conversation history so the Chat tabs aren't empty.
// Visit /demo-history once → open any agent → history is there.
//
// Chat threads are stored per-agent under `agentic-os-chat-v2:<agent>` as a
// JSON array of { role, agent?, text, ts }. We curate a thread per agent. Any
// real (non-error) messages already present are appended AFTER the demo so we
// never silently delete genuine chats.

import { useEffect, useState } from "react";
import Link from "next/link";

type Msg = { role: "user" | "assistant"; agent?: string; text: string; ts: number };
const key = (a: string) => `agentic-os-chat-v2:${a}`;

// timestamps walking backwards from "now" so they read as a real session
let t = Date.now() - 1000 * 60 * 60 * 6;
const next = (gapMin: number) => (t += gapMin * 60 * 1000);

function thread(agent: string, turns: [string, string][]): Msg[] {
  const out: Msg[] = [];
  for (const [u, a] of turns) {
    out.push({ role: "user", text: u, ts: next(3) });
    out.push({ role: "assistant", agent, text: a, ts: next(1) });
  }
  return out;
}

const DEMO: Record<string, Msg[]> = {
  claude: thread("claude", [
    ["Build me a bunch of fun, crazy, dopamine-inducing demos for the workspace — something I can show off the power of this with",
     "Oh this is going to be fun 😎 — I'll drop a whole arcade of interactive canvas toys into your workspace, every one a single self-contained file that renders live. Building them now…"],
    ["go wild",
     "🎉 Shipped SIX interactive demos to your Claude workspace — open Claude → Workspace → pick one → Preview, they all animate and react to you:\n\n🫧 Liquid Lava — gooey metaballs that merge, split and chase your mouse (SVG goo filter, pure hypnosis).\n🧬 Game of Life — Conway's automata you paint into with your mouse; cells glow by age. Randomize / pause / clear.\n💚 Digital Rain — the Matrix code storm; mouse bends it, click flashes the grid.\n🌅 Outrun Sunset — an endless synthwave horizon: scrolling neon grid + a chrome scanline sun. 80s dopamine.\n🪐 Gravity Sandbox — click to drop stars and watch 1,500 particles fall into glowing orbits. Real n-body physics.\n🌸 Living Tree — a recursive fractal tree that grows and sways in the wind; click to change the season's blossoms.\n\nAll mouse/click-interactive — perfect for a live demo. Want a 'launch all 6' arcade gallery to tie them together?"],
    ["these are insane 🔥",
     "🙌 Right?? Each is ~100 lines of pure HTML/canvas — zero libraries, zero assets — so they load instantly and run anywhere, even offline. Best crowd-pleasers live: Liquid Lava + Gravity Sandbox (they react to the mouse) and Digital Rain (everyone loves the Matrix). I can add sound, make a fullscreen kiosk mode, or generate matching thumbnails next — just say the word."],
  ]),
  openclaw: thread("openclaw", [
    ["What's trending in AI agents on X today?",
     "Top themes: (1) local-first agents trending after a viral benchmark thread, (2) multi-agent kanban orchestration, (3) Grok 4.3 tool-use demos. Pulled from 5 high-engagement posts — want the links + a summary thread drafted?"],
    ["Generate a hero image: a lobster astronaut on a pink nebula",
     "Generated 4 variations with Grok image (1024²). The third — chrome helmet against a swirling magenta nebula — is strongest. Saved all four to the Studio gallery. Want 2K upscales of the favourite? 🦞"],
  ]),
  // Mirrors the real MiniMax-M3 session 20260602_062612_7a596f, verbatim.
  hermes: thread("hermes", [
    ["I just built 5 interactive, zero-dependency canvas demos in my Hermes workspace for an Agent OS showcase: (1) Cosmic Galaxy - a mouse-reactive 2,600-particle spiral galaxy with click-to-supernova, (2) Flow Field Art - a generative vector-field painting that reseeds on click, (3) Neon Spectrum - a 96-band radial audio visualizer with a beat-synced core, (4) Global Mesh - a rotating 3D wireframe globe with travelling data arcs, (5) Dopamine Fireworks - click-anywhere fireworks with trails and gravity. Give me a punchy one-line pitch for each, then tell me which one to open first for maximum wow.",
     "Here are your pitches:\n\n1. Cosmic Galaxy — 2,600 mouse-reactive particles spiraling in a galactic dance, with click-to-supernova detonations.\n2. Flow Field Art — A generative vector-field painter that reseeds a fresh cosmic tapestry with every click.\n3. Neon Spectrum — A 96-band radial audio visualizer with a beat-synced core that pulses to your sound.\n4. Global Mesh — A rotating 3D wireframe globe traced with travelling data arcs between continents.\n5. Dopamine Fireworks — Click-anywhere firework bursts with glowing trails and gravitational falloff.\n\nOpen Cosmic Galaxy first. It's the strongest cold-open: you see 2,600 particles already doing something beautiful the instant the page loads, the mouse-following swirl makes it feel alive without any instruction, and the click-to-supernova is a high-drama payoff that happens within seconds — exactly the kind of \"wait, I can do that?!\" moment that hooks a viewer before they've even tried the other four. Save Fireworks for demo number two when they ask \"what else can I click?\""],
    ["Love it. Give me a single high-energy caption I could post with a screen-recording of all 5, and 3 hashtags.",
     "Five zero-dependency canvas demos, one shared workspace — spiral galaxies, vector fields, audio-reactive spectrums, wireframe globes, and click-anywhere fireworks. Built to prove the canvas can do a lot more than scrollbars. 🚀\n\n#AgentOS #CanvasDemos #BuiltWithHermes"],
    ["Perfect. Ship it.",
     "Shipping it. 🚀"],
  ]),
  antigravity: thread("antigravity", [
    ["Spin up a multi-agent run to audit my repo for security issues",
     "Spawned 4 parallel subagents across the codebase. Findings so far: 1 hard-coded token in a test fixture, 2 routes missing input validation, 1 outdated dependency with a known CVE. Full report writing to brain/ — want me to open PRs for the fixes?"],
  ]),
  codex: thread("codex", [
    ["Write a sorting visualizer that animates quick/merge/bubble sort",
     "Built a self-contained sorting visualizer — animates Quick, Merge and Bubble over the same dataset with live comparison/swap counters and a colour pass for the sorted region. It's in your Codex workspace as algo-visualizer. Hit Preview to watch it run."],
  ]),
};

export default function DemoHistory() {
  const [done, setDone] = useState<string[]>([]);
  useEffect(() => {
    const seeded: string[] = [];
    for (const [agent, demo] of Object.entries(DEMO)) {
      try {
        let existing: Msg[] = [];
        try { existing = JSON.parse(localStorage.getItem(key(agent)) || "[]"); } catch { existing = []; }
        // keep only genuine, non-error real messages the user may have sent
        const real = existing.filter(
          (m) => m && m.text && !/no output|authenticat|401|no response|\[error/i.test(m.text)
        );
        const isDemoAlready = real.length && real[0]?.text === demo[0]?.text;
        const merged = isDemoAlready ? real : [...demo, ...real];
        localStorage.setItem(key(agent), JSON.stringify(merged.slice(-50)));
        seeded.push(agent);
      } catch { /* ignore */ }
    }
    setDone(seeded);
  }, []);

  const labels: Record<string, string> = {
    claude: "Claude", openclaw: "OpenClaw", hermes: "Hermes",
    antigravity: "Antigravity", codex: "Codex",
  };
  const hrefs: Record<string, string> = {
    claude: "/claude", openclaw: "/openclaw", hermes: "/hermes",
    antigravity: "/antigravity", codex: "/codex",
  };

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 40,
      fontFamily: "-apple-system, Inter, sans-serif", color: "#f3ece6" }}>
      <div style={{ maxWidth: 560, textAlign: "center" }}>
        <div style={{ fontSize: 46, marginBottom: 10 }}>{done.length ? "✅" : "⏳"}</div>
        <h1 style={{ fontSize: 26, letterSpacing: "-.02em", marginBottom: 10 }}>
          {done.length ? "Demo conversation history loaded" : "Loading demo history…"}
        </h1>
        <p style={{ color: "#b3a89e", fontSize: 15, lineHeight: 1.6, marginBottom: 26 }}>
          Seeded example threads into <b>{done.length}</b> agent chats. Open any agent and the
          Chat tab now has history. (Your real messages are kept; error replies were cleaned out.)
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", marginBottom: 28 }}>
          {done.map((a) => (
            <Link key={a} href={hrefs[a]} style={{
              padding: "9px 16px", borderRadius: 11, border: "1px solid rgba(255,255,255,.16)",
              color: "#f3ece6", textDecoration: "none", fontSize: 14 }}>
              {labels[a]} →
            </Link>
          ))}
        </div>
        <Link href="/" style={{ color: "#d97757", textDecoration: "none", fontSize: 14 }}>← Back to Mission Control</Link>
      </div>
    </div>
  );
}

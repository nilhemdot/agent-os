import { NextResponse } from "next/server";
import { spawnSubprocess } from "@/lib/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/hermes/realtime/open  { target }  → { ok }
// Opens a website (https URL) or a macOS app by name. Executes ONLY the macOS
// `open` command with a validated argument (no shell → no injection). Used by the
// Realtime butler's function-calling so it can actually act, not just talk.
function runOpen(target: string): Promise<boolean> {
  return new Promise((resolve) => {
    const t = (target || "").trim();
    let args: string[];
    const looksUrl = /^https?:\/\//i.test(t) || /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(t);
    if (looksUrl) {
      const url = /^https?:\/\//i.test(t) ? t : `https://${t}`;
      if (!/^https?:\/\/[\w.\-/?=&%#~+:@]+$/i.test(url)) return resolve(false);
      args = [url];
    } else {
      if (!/^[\w .'&\-]{1,40}$/.test(t)) return resolve(false); // app name only
      args = ["-a", t];
    }
    try {
      const c = spawnSubprocess("open", args, { stdio: "ignore" });
      c.on("close", (code) => resolve(code === 0));
      c.on("error", () => resolve(false));
    } catch { resolve(false); }
  });
}

export async function POST(req: Request) {
  const { target } = await req.json().catch(() => ({ target: "" }));
  if (typeof target !== "string" || !target.trim()) return NextResponse.json({ ok: false, error: "missing target" }, { status: 400 });
  const ok = await runOpen(target);
  return NextResponse.json({ ok, target });
}

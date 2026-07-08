"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, ExternalLink, RefreshCw, AlertTriangle, ShieldCheck } from "lucide-react";

// Embed the real Hermes web dashboard (FastAPI on :9119) inside Agent OS.
// Use localhost (same-site as Agent OS on localhost:3737) so the dashboard's
// login cookie can flow into the iframe instead of being blocked as third-party.
const DASH_URL = "http://localhost:9119";
const ACCENT = "#60a5fa";

type State = "checking" | "starting" | "up" | "error";

export default function HermesManage() {
  const [state, setState] = useState<State>("checking");
  const [err, setErr] = useState("");
  const [bust, setBust] = useState(0);

  const ensure = useCallback(async () => {
    setState("checking");
    setErr("");
    try {
      const s = await (await fetch("/api/hermes/dashboard", { cache: "no-store" })).json();
      if (s.running) { setState("up"); setBust((b) => b + 1); return; }
      setState("starting");
      const r = await (await fetch("/api/hermes/dashboard", { method: "POST" })).json();
      if (r.running) { setState("up"); setBust((b) => b + 1); }
      else { setState("error"); setErr(r.warn ?? r.error ?? "Could not start the Hermes dashboard."); }
    } catch (e) {
      setState("error"); setErr(String(e));
    }
  }, []);

  useEffect(() => { ensure(); }, [ensure]);

  const dot = state === "up" ? "#34d399" : state === "error" ? "#f87171" : ACCENT;
  const label =
    state === "up" ? "Connected" :
    state === "starting" ? "Starting dashboard…" :
    state === "error" ? "Not running" : "Checking…";

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* header */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            {state === "up" && (
              <span className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping" style={{ background: dot }} />
            )}
            <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: dot }} />
          </span>
          <div>
            <div className="text-sm font-medium" style={{ color: ACCENT }}>Hermes Dashboard</div>
            <div className="text-[11px] text-[var(--fg-dim)]">{label} · {DASH_URL.replace("http://", "")}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={ensure}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[12px] transition hover:bg-[rgba(255,255,255,0.04)]"
            style={{ borderColor: "var(--panel-border)", color: "var(--fg-dim)" }}
          >
            <RefreshCw size={13} className={state === "checking" || state === "starting" ? "animate-spin" : ""} />
            Refresh
          </button>
          <a
            href={DASH_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[12px] transition hover:bg-[rgba(96,165,250,0.12)]"
            style={{ borderColor: ACCENT, color: ACCENT }}
            title="If a panel asks you to log in, open it once in a full tab"
          >
            <ExternalLink size={13} /> Open in tab
          </a>
        </div>
      </div>

      {/* body — embedded dashboard */}
      <div className="flex-1 min-h-[640px] rounded-2xl border border-[var(--panel-border)] overflow-hidden relative bg-[#0a0518]">
        {state === "up" ? (
          <iframe
            key={bust}
            src={DASH_URL}
            title="Hermes Dashboard"
            className="absolute inset-0 w-full h-full border-0"
            allow="clipboard-read; clipboard-write"
          />
        ) : state === "error" ? (
          <div className="absolute inset-0 grid place-items-center p-8 text-center">
            <div className="max-w-md space-y-3">
              <AlertTriangle size={22} className="mx-auto text-amber-300" />
              <div className="text-sm text-[var(--fg)]">Couldn&apos;t reach the Hermes dashboard.</div>
              <div className="text-[12px] text-[var(--fg-dim)] font-[var(--font-geist-mono)] bg-[rgba(0,0,0,0.3)] rounded-lg p-3 break-words">{err}</div>
              <button
                onClick={ensure}
                className="px-4 py-2 rounded-xl text-sm font-medium"
                style={{ background: `${ACCENT}24`, border: `1px solid ${ACCENT}55`, color: ACCENT }}
              >
                Try again
              </button>
              <div className="text-[11px] text-[var(--fg-dimmer)]">Or run <code>hermes dashboard</code> in a terminal.</div>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 grid place-items-center text-center p-6">
            <div>
              <Loader2 size={22} className="mx-auto mb-2 animate-spin" style={{ color: ACCENT }} />
              <div className="text-[12.5px] text-[var(--fg-dim)]">{label}</div>
              {state === "starting" && (
                <div className="text-[11px] text-[var(--fg-dimmer)] mt-1">First launch builds the UI — can take ~20s.</div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 mt-2 text-[11px] text-[var(--fg-dimmer)]">
        <ShieldCheck size={12} /> Runs locally on your machine — config, keys &amp; sessions never leave localhost.
      </div>
    </div>
  );
}

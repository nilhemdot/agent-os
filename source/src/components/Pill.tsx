import type { ReactNode } from "react";

// Uppercase mono status chip; tone maps to .pill-ok / -warn / -err / -info.
export default function Pill({ tone, children }: { tone?: "ok" | "warn" | "err" | "info"; children: ReactNode }) {
  return <span className={`pill ${tone ? `pill-${tone}` : ""}`}>{children}</span>;
}

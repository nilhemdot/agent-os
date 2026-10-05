import type { ReactNode } from "react";

type Status = "ok" | "warn" | "err" | "info";

export function StatusPill({ children }: { children: ReactNode }) {
  return <span className="status-pill">{children}</span>;
}

export function StatusMeta({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`status-meta ${className}`.trim()}>{children}</span>;
}

export function StatusDot({ status }: { status: Status }) {
  return <span className={`status-dot ${status}`} />;
}

// Pulsing live dot — use only for something actually live.
export function Heartbeat({ color = "var(--emerald)" }: { color?: string }) {
  return <span className="heartbeat inline-block" style={{ color }} />;
}

// `● Active   28 days remaining` — wrap a number in <em> for the Caveat accent.
export default function StatusRow({ label, meta }: { label: ReactNode; meta?: ReactNode }) {
  return (
    <div className="flex items-center gap-6">
      <StatusPill>{label}</StatusPill>
      {meta !== undefined && <StatusMeta>{meta}</StatusMeta>}
    </div>
  );
}

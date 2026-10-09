import type { ReactNode } from "react";

// Chapter eyebrow — `I. ───── MISSION CONTROL`. Same markup as TopBar.tsx.
export default function Eyebrow({ numeral, label, className = "" }: { numeral: ReactNode; label: ReactNode; className?: string }) {
  return (
    <div className={`eyebrow ${className}`.trim()}>
      <span className="num">{numeral}</span>
      <span className="line" />
      <span className="label">{label}</span>
    </div>
  );
}

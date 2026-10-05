import type { ReactNode } from "react";

// Chapter eyebrow — `I. ───── MISSION CONTROL`. Same markup as TopBar.tsx.
export default function Eyebrow({ numeral, label }: { numeral: ReactNode; label: ReactNode }) {
  return (
    <div className="eyebrow">
      <span className="num">{numeral}</span>
      <span className="line" />
      <span className="label">{label}</span>
    </div>
  );
}

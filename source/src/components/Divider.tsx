import type { ReactNode } from "react";

// ✦ ornament divider between major page blocks, as in Overview.tsx.
export default function Divider({ ornament = "✦" }: { ornament?: ReactNode }) {
  return (
    <div className="divider">
      <span className="rule" />
      <span className="ornament">{ornament}</span>
      <span className="rule" />
    </div>
  );
}

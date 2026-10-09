import type { ReactNode } from "react";

// Numbered step card — Caveat numeral, small-caps tag, Bricolage title,
// cream-soft description, optional action (usually a CopyButton).
export default function ActionCard({
  num, tag, upNext, title, desc, active, action,
}: {
  num: ReactNode;
  tag?: ReactNode;
  upNext?: boolean;
  title: ReactNode;
  desc?: ReactNode;
  active?: boolean;
  action?: ReactNode;
}) {
  return (
    <div className={`action-card ${active ? "active" : ""}`}>
      <div className="flex items-baseline justify-between">
        <span className="action-num">{num}</span>
        {tag !== undefined && <span className={`action-tag ${upNext ? "up-next" : ""}`}>{tag}</span>}
      </div>
      <div className="action-title mt-2.5">{title}</div>
      {desc !== undefined && <p className="action-desc mt-2 mb-0">{desc}</p>}
      {action !== undefined && <div className="mt-4">{action}</div>}
    </div>
  );
}

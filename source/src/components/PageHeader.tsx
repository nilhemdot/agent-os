import type { ReactNode } from "react";
import Eyebrow from "./Eyebrow";

// Page title block: optional eyebrow, Bricolage title (wrap one word in <em>
// for the gold Caveat accent) and a cream-dim subtitle.
export default function PageHeader({
  numeral, label, title, sub,
}: {
  numeral?: ReactNode;
  label?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div>
      {label !== undefined && <Eyebrow numeral={numeral} label={label} />}
      <h1 className="page-title">{title}</h1>
      {sub !== undefined && <p className="page-subtitle">{sub}</p>}
    </div>
  );
}

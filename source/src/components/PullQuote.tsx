import type { ReactNode } from "react";

// Editorial blockquote with a gold citation.
export default function PullQuote({ children, cite }: { children: ReactNode; cite?: ReactNode }) {
  return (
    <blockquote>
      {children}
      {cite !== undefined && <cite>{cite}</cite>}
    </blockquote>
  );
}

"use client";

import type { ReactNode } from "react";

// The one filled (gold pill) button. type="button" so it never submits a surrounding form.
export default function CopyButton({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return <button type="button" className="copy-btn" onClick={onClick}>{children}</button>;
}

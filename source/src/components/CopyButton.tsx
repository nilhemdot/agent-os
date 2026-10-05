"use client";

import type { ReactNode } from "react";

// The one filled (gold pill) button.
export default function CopyButton({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return <button className="copy-btn" onClick={onClick}>{children}</button>;
}

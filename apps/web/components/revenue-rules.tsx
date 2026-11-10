"use client";
import { useState, type ReactNode } from "react";
/** Only active rules go here. Keep setup actions and recoupment outside. */
export function RevenueRules({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  return <details className="revenue-rules-disclosure" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>Revenue rules</summary>
    <p className="muted">The active rules for this agreement.</p>
    {children}
  </details>;
}

import React, { type ReactNode, type ButtonHTMLAttributes } from "react";
import { statusLabel } from "../lib/status-labels";
export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet";
}) {
  return (
    <button className={`button ${variant} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}
export function Badge({ value }: { value: string }) {
  const good = [
    "ACTIVE",
    "COMPLETED",
    "APPROVED",
    "CONFIRMED",
    "SUCCESS",
  ].includes(value);
  const bad = /FAIL|HOLD|HELD|UNKNOWN|REVIEW_REQUIRED/.test(value);
  return (
    <span className={`badge ${good ? "good" : bad ? "warning" : "neutral"}`}>
      {statusLabel(value)}
    </span>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Empty({
  title: heading,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon" aria-hidden="true">
        ◇
      </span>
      <h3>{heading}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Notice({
  children,
  warning = false,
  announcement = "none",
}: {
  children: ReactNode;
  warning?: boolean;
  announcement?: "none" | "polite" | "assertive";
}) {
  return (
    <div
      role={
        announcement === "assertive"
          ? "alert"
          : announcement === "polite"
            ? "status"
            : undefined
      }
      className={`notice ${warning ? "warning" : ""}`}
    >
      {children}
    </div>
  );
}
export function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    Overview: (
      <>
        <path d="m3 10 9-7 9 7v11h-6v-7H9v7H3z" />
      </>
    ),
    Agreements: (
      <>
        <path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6" />
      </>
    ),
    Payouts: (
      <>
        <path d="M3 7h18v14H3zM3 7V4h15M15 12h6v5h-6z" />
      </>
    ),
    Settings: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2" />
      </>
    ),
  };
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.Agreements}
    </svg>
  );
}

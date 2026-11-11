import React from "react";
import { initials } from "../lib/person";

export enum AvatarSize {
  SMALL = "sm",
  MEDIUM = "md",
}

export function Avatar({
  name,
  tone,
  size = AvatarSize.MEDIUM,
  label = true,
}: {
  name: string;
  tone: number;
  size?: AvatarSize;
  label?: boolean;
}) {
  return (
    <span
      className={`person-avatar tone-${tone} size-${size}`}
      title={label ? name : undefined}
      aria-label={label ? name : undefined}
      aria-hidden={label ? undefined : true}
    >
      {initials(name)}
    </span>
  );
}

export interface SplitSegment {
  userId: string;
  name: string;
  basisPoints: number;
  tone: number;
}

/** Proportional bar; the accessible name carries the same split as text. */
export function SplitBar({ segments }: { segments: SplitSegment[] }) {
  const total = segments.reduce((sum, s) => sum + s.basisPoints, 0);
  if (!total) return <span className="muted">Not set</span>;
  const text = segments
    .map((s) => `${s.name} ${s.basisPoints / 100}%`)
    .join(", ");
  return (
    <span
      className="split-bar"
      role="img"
      aria-label={`Split: ${text}`}
      title={text}
    >
      {segments.map((s) => (
        <span
          key={s.userId}
          className={`split-segment tone-${s.tone}`}
          style={{ flexGrow: s.basisPoints }}
        />
      ))}
    </span>
  );
}

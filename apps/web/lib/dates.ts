const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Relative within a week ("just now", "5m", "2h", "3d"), then "Nov 6" or "Nov 6, 2025". */
export function formatWhen(
  value: string | number | undefined,
  now = Date.now(),
) {
  const at = toTime(value);
  if (!Number.isFinite(at)) return "Not recorded";
  const elapsed = now - at;
  if (elapsed >= 0 && elapsed < MINUTE) return "just now";
  if (elapsed >= 0 && elapsed < HOUR)
    return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed >= 0 && elapsed < DAY)
    return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed >= 0 && elapsed < 7 * DAY)
    return `${Math.floor(elapsed / DAY)}d ago`;
  return formatDay(value);
}

export function formatDay(
  value: string | number | undefined,
  now = Date.now(),
) {
  const at = toTime(value);
  if (!Number.isFinite(at)) return "Not recorded";
  const date = new Date(at);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Full timestamp for a title tooltip, so the exact time stays one hover away. */
export function formatExact(value: string | number | undefined) {
  const at = toTime(value);
  if (!Number.isFinite(at)) return undefined;
  return new Date(at).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function toTime(value: string | number | undefined) {
  if (typeof value === "number") return value;
  return value ? Date.parse(value) : NaN;
}

"use client";
import { useId } from "react";

export interface DetailsDraft {
  name: string;
  effectiveFrom: string;
  effectiveTo: string;
  noEndDate: boolean;
}

export const emptyDetails = (): DetailsDraft => ({
  name: "",
  effectiveFrom: "",
  effectiveTo: "",
  noEndDate: false,
});

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isCalendarDate(value: string) {
  const match = DATE.exec(value);
  if (!match) return false;
  const [y, m, d] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/** Same rules as the API: 1–200 characters, real dates, end on or after start. */
export function validateDetails(details: DetailsDraft): string | undefined {
  const name = details.name.trim();
  if (!name) return "Give this agreement a name.";
  if (details.name.length > 200 || /[\u0000-\u001f\u007f]/.test(details.name))
    return "Use up to 200 characters for the name.";
  if (details.effectiveFrom && !isCalendarDate(details.effectiveFrom))
    return "Enter a valid start date.";
  if (!details.noEndDate && details.effectiveTo) {
    if (!isCalendarDate(details.effectiveTo)) return "Enter a valid end date.";
    if (details.effectiveFrom && details.effectiveTo < details.effectiveFrom)
      return "The end date can’t be before the start date.";
  }
  return undefined;
}

/** The intake fields for these details. effectiveTo null = no end date. */
export function detailsPayload(details: DetailsDraft) {
  return {
    name: details.name.trim(),
    ...(details.effectiveFrom ? { effectiveFrom: details.effectiveFrom } : {}),
    ...(details.noEndDate
      ? { effectiveTo: null }
      : details.effectiveTo
        ? { effectiveTo: details.effectiveTo }
        : {}),
  };
}

export function formatDate(value: string) {
  const match = DATE.exec(value);
  if (!match) return value;
  const [y, m, d] = match.slice(1).map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "Oct 1, 2026 – no end date", "Oct 1, 2026 – Sep 30, 2027", or "Not set". */
export function formatDateRange(details: DetailsDraft) {
  const from = details.effectiveFrom ? formatDate(details.effectiveFrom) : "";
  const to = details.noEndDate
    ? "no end date"
    : details.effectiveTo
      ? formatDate(details.effectiveTo)
      : "";
  if (from && to) return `${from} – ${to}`;
  if (from) return `From ${from}`;
  if (details.noEndDate) return "No end date";
  if (to) return `Until ${to}`;
  return "Not set";
}

function CalendarIcon() {
  return (
    <svg
      className="wiz-input-icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="4"
        y="5"
        width="16"
        height="15"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M4 10h16M8 3v4M16 3v4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function DetailsStep({
  details,
  disabled = false,
  showErrors = false,
  onChange,
}: {
  details: DetailsDraft;
  disabled?: boolean;
  showErrors?: boolean;
  onChange(details: DetailsDraft): void;
}) {
  const id = useId();
  const error = showErrors ? validateDetails(details) : undefined;
  const set = (patch: Partial<DetailsDraft>) =>
    onChange({ ...details, ...patch });
  return (
    <div className="wiz-fields">
      <div className="wiz-field">
        <label htmlFor={`${id}-name`}>Agreement name</label>
        <input
          id={`${id}-name`}
          value={details.name}
          maxLength={200}
          autoComplete="off"
          disabled={disabled}
          placeholder="e.g. Midnight Sessions"
          aria-invalid={!!error && !details.name.trim()}
          onChange={(event) => set({ name: event.target.value })}
        />
      </div>
      <div className="wiz-field">
        <span className="wiz-label" id={`${id}-currency`}>
          Currency
        </span>
        <div className="wiz-fixed-value" aria-labelledby={`${id}-currency`}>
          <span className="wiz-currency-mark" aria-hidden="true">
            $
          </span>
          USD · US dollar
        </div>
        <small className="wiz-hint">
          Payments and payouts are in US dollars.
        </small>
      </div>
      <fieldset className="wiz-field wiz-dates" disabled={disabled}>
        <legend>
          Effective dates <span className="wiz-optional">(optional)</span>
        </legend>
        <div className="wiz-date-row">
          <label className="wiz-date">
            <span className="visually-hidden">Start date</span>
            <CalendarIcon />
            <input
              type="date"
              value={details.effectiveFrom}
              onChange={(event) => set({ effectiveFrom: event.target.value })}
            />
          </label>
          <label className="wiz-date">
            <span className="visually-hidden">End date</span>
            <CalendarIcon />
            <input
              type="date"
              value={details.noEndDate ? "" : details.effectiveTo}
              min={details.effectiveFrom || undefined}
              disabled={disabled || details.noEndDate}
              onChange={(event) => set({ effectiveTo: event.target.value })}
            />
          </label>
        </div>
        <label className="wiz-check">
          <input
            type="checkbox"
            checked={details.noEndDate}
            onChange={(event) =>
              set({ noEndDate: event.target.checked, effectiveTo: "" })
            }
          />
          No end date
        </label>
      </fieldset>
      {error && (
        <p className="wiz-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

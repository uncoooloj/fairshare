"use client";
import React, { useId, useState } from "react";
import {
  AnswerSource,
  FeeChoice,
  TOTAL_BASIS_POINTS,
  exampleSplit,
} from "../lib/rules-answers";
import type {
  AdvanceAnswer,
  AgreementAnswers,
  Cited,
  PersonAnswer,
} from "../lib/rules-answers";
import { parseCents } from "../lib/model";
import { formatMoneyHeadline } from "../lib/preferences";
import { SplitBar } from "./person";
import { SplitDrawer, percentText, rosterTone } from "./split-drawer";
import { WizardDrawer } from "./wizard-drawer";

/** How much the AI managed to read; picks the headline. */
export enum CheckMode {
  FOUND_ALL = "found_all",
  FOUND_SOME = "found_some",
  MANUAL = "manual",
}

enum OpenDrawer {
  AGREEMENT = "agreement",
  SPLIT = "split",
  ADVANCE = "advance",
}

/** The example payment every dollar line uses, per the spec. */
export const EXAMPLE_PAYMENT_CENTS = 300000;

export function checkHeadline(mode: CheckMode) {
  switch (mode) {
    case CheckMode.FOUND_ALL:
      return {
        title: "Here's what your agreement says",
        lede: "Only change something if it's wrong.",
      };
    case CheckMode.FOUND_SOME:
      return {
        title: "Here's what we found. A couple of things need you.",
        lede: "Check each part and fill in anything that's missing.",
      };
    case CheckMode.MANUAL:
      return {
        title: "Let's set up the split",
        lede: "Tell us who gets what. You can change it until you send it.",
      };
  }
}

/** "4.2" or "§ 4.2" → "§ 4.2"; only shown for values read from the document. */
export function clauseLabel(cited?: Cited<unknown>) {
  if (!cited || cited.source !== AnswerSource.DOCUMENT) return undefined;
  const clause = cited.clause?.trim();
  if (!clause) return undefined;
  return clause.startsWith("§") ? clause : `§ ${clause}`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
/** "2026-10-01" → "Oct 1, 2026", read as a calendar date (no time zone shift). */
export function calendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  return `${MONTHS[Number(match[2]) - 1] ?? match[2]} ${Number(match[3])}, ${match[1]}`;
}

export function dateRange(answers: AgreementAnswers) {
  const from = answers.effectiveFrom?.value;
  const to = answers.effectiveTo?.value;
  if (from && to) return `${calendarDate(from)} to ${calendarDate(to)}`;
  if (from) return `From ${calendarDate(from)} · No end date`;
  if (to) return `Until ${calendarDate(to)}`;
  return "No dates set";
}

/** First names, unless two people share one. */
export function shortNames(people: PersonAnswer[]) {
  const first = (person: PersonAnswer) =>
    person.name.trim().split(/\s+/)[0] || "Someone";
  const counts = new Map<string, number>();
  for (const person of people)
    counts.set(first(person), (counts.get(first(person)) ?? 0) + 1);
  return new Map(
    people.map((person) => [
      person.key,
      (counts.get(first(person)) ?? 0) > 1 ? person.name.trim() : first(person),
    ]),
  );
}

/** "Maya 50% · Jordan 30% · Riley 20%" */
export function splitSummary(people: PersonAnswer[]) {
  const names = shortNames(people);
  return people
    .map(
      (person) =>
        `${names.get(person.key)} ${percentText(person.basisPoints)}%`,
    )
    .join(" · ");
}

/**
 * "On a $3,000 payment: Maya $1,500, Jordan $900, Riley $600 (after the advance is paid back)."
 * Worked out by the real engine on the split alone, so it shows what the split does once
 * any advance is out of the way. Undefined while the split can't be worked out.
 */
export function exampleLine(answers: AgreementAnswers) {
  const people = answers.people.value;
  if (
    !people.length ||
    people.reduce((sum, p) => sum + p.basisPoints, 0) !== TOTAL_BASIS_POINTS
  )
    return undefined;
  const rows = exampleSplit(
    { ...answers, advance: undefined },
    EXAMPLE_PAYMENT_CENTS,
  );
  if (!rows.length) return undefined;
  const names = shortNames(people);
  const amounts = rows
    .map((row) => `${names.get(row.key)} ${formatMoneyHeadline(row.cents)}`)
    .join(", ");
  const caveat = answers.advance ? " (after the advance is paid back)" : "";
  return `On a ${formatMoneyHeadline(EXAMPLE_PAYMENT_CENTS)} payment: ${amounts}${caveat}.`;
}

export function feeLine(answers: AgreementAnswers) {
  switch (answers.fees?.value) {
    case FeeChoice.BEFORE_SPLIT:
      return "PayPal fees come off the top, before the split.";
    case FeeChoice.ORGANIZER_SHARE: {
      const organizer =
        answers.people.value.find((p) => p.isSelf) ?? answers.people.value[0];
      const name = organizer
        ? shortNames(answers.people.value).get(organizer.key)
        : "The organizer";
      return `PayPal fees come out of ${name}'s share.`;
    }
    default:
      return undefined;
  }
}

function recipientName(answers: AgreementAnswers) {
  const key = answers.advance?.value.recipientKey;
  const person = answers.people.value.find((p) => p.key === key);
  return person ? shortNames(answers.people.value).get(person.key) : undefined;
}

export function advanceSentence(answers: AgreementAnswers) {
  if (!answers.advance) return undefined;
  const who = recipientName(answers) ?? "Someone";
  return `${who} put in ${formatMoneyHeadline(answers.advance.value.amountCents)} upfront and is paid back first, before anyone splits.`;
}

function ClauseChip({ cited }: { cited?: Cited<unknown> }) {
  const label = clauseLabel(cited);
  if (!label) return null;
  return (
    <span
      className="clause-chip wc-chip"
      title={cited?.quote ? `“${cited.quote}”` : "From your agreement"}
    >
      <span className="sr-only">From your agreement, </span>
      {label}
    </span>
  );
}

function CardHead({
  title,
  cited,
  onChange,
  changeLabel,
}: {
  title: string;
  cited?: Cited<unknown>;
  onChange(): void;
  changeLabel: string;
}) {
  return (
    <header className="wc-card-head">
      <h2>{title}</h2>
      <ClauseChip cited={cited} />
      <button
        type="button"
        className="wc-link wc-change"
        onClick={onChange}
        aria-label={changeLabel}
      >
        Change
      </button>
    </header>
  );
}

/** Step 3 of the wizard: what we read from the agreement, each part with its clause and a Change link. */
export function WizardCheckStep({
  answers,
  onChange,
  mode,
  equalSplitGuessed = false,
}: {
  answers: AgreementAnswers;
  onChange(answers: AgreementAnswers): void;
  mode: CheckMode;
  /** Names were found without percentages, so the split is an equal one to start from. */
  equalSplitGuessed?: boolean;
}) {
  const [drawer, setDrawer] = useState<OpenDrawer>();
  const [splitTouched, setSplitTouched] = useState(false);
  const headingId = useId();
  const paidName = useId();
  const { title, lede } = checkHeadline(mode);
  const people = answers.people.value;
  const names = shortNames(people);
  const example = exampleLine(answers);
  const fees = feeLine(answers);
  const advance = answers.advance;
  const advanceWho = recipientName(answers);
  const amount = advance ? formatMoneyHeadline(advance.value.amountCents) : "";
  const close = () => setDrawer(undefined);

  function setPaid(alreadyPaid: boolean) {
    if (!advance) return;
    onChange({
      ...answers,
      advance: { ...advance, value: { ...advance.value, alreadyPaid } },
    });
  }

  return (
    <section className="wiz-step wc" aria-labelledby={headingId}>
      <h1 id={headingId} tabIndex={-1}>
        {title}
      </h1>
      <p className="wiz-lede">{lede}</p>

      <article className="wc-card">
        <CardHead
          title="The agreement"
          cited={answers.name.value ? answers.name : answers.effectiveFrom}
          onChange={() => setDrawer(OpenDrawer.AGREEMENT)}
          changeLabel="Change the agreement name and dates"
        />
        <p className="wc-name">
          {answers.name.value.trim() || (
            <span className="wc-missing">No name yet</span>
          )}
        </p>
        <p className="wc-meta">
          <span>{dateRange(answers)}</span>
          <span aria-hidden="true">·</span>
          <span>USD</span>
        </p>
      </article>

      <article className="wc-card">
        <CardHead
          title="Who gets what"
          cited={answers.people}
          onChange={() => setDrawer(OpenDrawer.SPLIT)}
          changeLabel="Change who gets what"
        />
        <div className="wc-split">
          <SplitBar
            segments={people.map((person) => ({
              userId: person.key,
              name: names.get(person.key) ?? person.name,
              basisPoints: person.basisPoints,
              tone: rosterTone(person, people),
            }))}
          />
          <ul className="wc-legend" aria-label="Split">
            {people.map((person) => (
              <li key={person.key}>
                <span
                  className={`wc-dot tone-${rosterTone(person, people)}`}
                  aria-hidden="true"
                />
                <span className="wc-legend-name">{names.get(person.key)}</span>
                <span className="wc-legend-share">
                  {percentText(person.basisPoints)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
        {equalSplitGuessed && !splitTouched ? (
          <p className="wc-note">
            We didn't find the percentages. Here's an equal split to start from.
          </p>
        ) : null}
        {mode === CheckMode.MANUAL && people.length === 1 ? (
          <p className="wc-note">Add the people you split the money with.</p>
        ) : null}
        {example && people.length > 1 ? (
          <p className="wc-example">{example}</p>
        ) : null}
        {fees ? (
          <p className="wc-fees">
            <span>{fees}</span>
            <ClauseChip cited={answers.fees} />
          </p>
        ) : null}
      </article>

      {advance ? (
        <article className="wc-card">
          <CardHead
            title="Paid back first"
            cited={advance}
            onChange={() => setDrawer(OpenDrawer.ADVANCE)}
            changeLabel="Change who paid upfront and how much"
          />
          <p className="wc-sentence">{advanceSentence(answers)}</p>
          <fieldset className="wc-paid">
            <legend>
              Has {advanceWho ?? "this person"} already paid the {amount}?
            </legend>
            <div className="wc-segmented">
              <label>
                <input
                  type="radio"
                  name={paidName}
                  checked={advance.value.alreadyPaid === true}
                  onChange={() => setPaid(true)}
                />
                <span>Yes</span>
              </label>
              <label>
                <input
                  type="radio"
                  name={paidName}
                  checked={advance.value.alreadyPaid === false}
                  onChange={() => setPaid(false)}
                />
                <span>Not yet</span>
              </label>
            </div>
            {advance.value.alreadyPaid === false ? (
              <p className="wiz-hint" role="status">
                You can send this once {advanceWho ?? "the money"}{" "}
                {advanceWho ? "has paid it" : "is in"}.
              </p>
            ) : null}
          </fieldset>
        </article>
      ) : (
        <p className="wc-quiet">
          <button
            type="button"
            className="wc-link"
            onClick={() => setDrawer(OpenDrawer.ADVANCE)}
          >
            Someone paid upfront?
          </button>
        </p>
      )}

      {drawer === OpenDrawer.AGREEMENT ? (
        <AgreementDrawer
          answers={answers}
          onCancel={close}
          onSave={(next) => {
            onChange(next);
            close();
          }}
        />
      ) : null}
      {drawer === OpenDrawer.SPLIT ? (
        <SplitDrawer
          people={people}
          lockedKeys={advance ? [advance.value.recipientKey] : []}
          onCancel={close}
          onSave={(next) => {
            setSplitTouched(true);
            onChange({ ...answers, people: edited(answers.people, next) });
            close();
          }}
        />
      ) : null}
      {drawer === OpenDrawer.ADVANCE ? (
        <AdvanceDrawer
          answers={answers}
          onCancel={close}
          onSave={(next) => {
            onChange(next);
            close();
          }}
        />
      ) : null}
    </section>
  );
}

/** A value the person changed no longer comes from the document. */
function edited<T>(cited: Cited<T> | undefined, value: T): Cited<T> {
  if (cited && JSON.stringify(cited.value) === JSON.stringify(value))
    return cited;
  return { value, source: AnswerSource.PERSON };
}

function AgreementDrawer({
  answers,
  onSave,
  onCancel,
}: {
  answers: AgreementAnswers;
  onSave(answers: AgreementAnswers): void;
  onCancel(): void;
}) {
  const [name, setName] = useState(answers.name.value);
  const [from, setFrom] = useState(answers.effectiveFrom?.value ?? "");
  const [to, setTo] = useState(answers.effectiveTo?.value ?? "");
  const [noEnd, setNoEnd] = useState(
    answers.effectiveTo !== undefined && answers.effectiveTo.value === null,
  );
  const [error, setError] = useState<string>();
  const id = useId();

  function save() {
    if (!name.trim()) return setError("Give the agreement a name.");
    if (from && to && !noEnd && to < from)
      return setError("The end date is before the start date.");
    const next: AgreementAnswers = {
      ...answers,
      name: edited(answers.name, name.trim()),
    };
    next.effectiveFrom = from ? edited(answers.effectiveFrom, from) : undefined;
    next.effectiveTo = noEnd
      ? edited<string | null>(answers.effectiveTo, null)
      : to
        ? edited<string | null>(answers.effectiveTo, to)
        : undefined;
    onSave(next);
  }

  return (
    <WizardDrawer title="The agreement" onSave={save} onCancel={onCancel}>
      <div className="wiz-fields">
        <div className="wiz-field">
          <label htmlFor={`${id}-name`}>Name</label>
          <input
            id={`${id}-name`}
            type="text"
            autoComplete="off"
            value={name}
            aria-invalid={error && !name.trim() ? true : undefined}
            onChange={(event) => {
              setName(event.target.value);
              setError(undefined);
            }}
          />
        </div>
        <div className="wd-date-row">
          <div className="wiz-field">
            <label htmlFor={`${id}-from`}>Starts</label>
            <input
              id={`${id}-from`}
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                setError(undefined);
              }}
            />
          </div>
          <div className="wiz-field">
            <label htmlFor={`${id}-to`}>Ends</label>
            <input
              id={`${id}-to`}
              type="date"
              value={noEnd ? "" : to}
              disabled={noEnd}
              onChange={(event) => {
                setTo(event.target.value);
                setError(undefined);
              }}
            />
          </div>
        </div>
        <label className="wiz-check wd-check">
          <input
            type="checkbox"
            checked={noEnd}
            onChange={(event) => {
              setNoEnd(event.target.checked);
              setError(undefined);
            }}
          />
          No end date
        </label>
        {error ? (
          <p className="wiz-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </WizardDrawer>
  );
}

function AdvanceDrawer({
  answers,
  onSave,
  onCancel,
}: {
  answers: AgreementAnswers;
  onSave(answers: AgreementAnswers): void;
  onCancel(): void;
}) {
  const people = answers.people.value;
  const current = answers.advance?.value;
  const self = people.find((p) => p.isSelf) ?? people[0];
  const [who, setWho] = useState(current?.recipientKey ?? self?.key ?? "");
  const [amount, setAmount] = useState(
    current ? (current.amountCents / 100).toFixed(2).replace(/\.00$/, "") : "",
  );
  const [error, setError] = useState<string>();
  const id = useId();

  function save() {
    let cents: number;
    try {
      cents = parseCents(amount.replace(/[$,\s]/g, ""));
    } catch (problem) {
      return setError(
        problem instanceof Error ? problem.message : "Enter an amount.",
      );
    }
    if (cents <= 0) return setError("Enter an amount above $0.");
    if (!people.some((p) => p.key === who)) return setError("Choose who paid.");
    const same =
      current && current.recipientKey === who && current.amountCents === cents;
    const value: AdvanceAnswer = same
      ? current
      : { recipientKey: who, amountCents: cents };
    onSave({
      ...answers,
      advance:
        same && answers.advance
          ? answers.advance
          : { value, source: AnswerSource.PERSON },
    });
  }

  return (
    <WizardDrawer
      title={current ? "Paid back first" : "Someone paid upfront"}
      lede="Whoever put money in upfront is paid back first, before anyone splits."
      onSave={save}
      onCancel={onCancel}
    >
      <div className="wiz-fields">
        <div className="wiz-field">
          <label htmlFor={`${id}-who`}>Who paid</label>
          <select
            id={`${id}-who`}
            value={who}
            onChange={(event) => {
              setWho(event.target.value);
              setError(undefined);
            }}
          >
            {people.map((person) => (
              <option key={person.key} value={person.key}>
                {person.isSelf ? `${person.name} (you)` : person.name}
              </option>
            ))}
          </select>
        </div>
        <div className="wiz-field">
          <label htmlFor={`${id}-amount`}>How much</label>
          <div className="wd-money">
            <span aria-hidden="true">$</span>
            <input
              id={`${id}-amount`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="2,000"
              value={amount}
              aria-invalid={error ? true : undefined}
              onChange={(event) => {
                setAmount(event.target.value);
                setError(undefined);
              }}
            />
          </div>
        </div>
        {error ? (
          <p className="wiz-error" role="alert">
            {error}
          </p>
        ) : null}
        {current ? (
          <button
            type="button"
            className="wc-link wc-danger"
            onClick={() => onSave({ ...answers, advance: undefined })}
          >
            No one paid upfront
          </button>
        ) : null}
      </div>
    </WizardDrawer>
  );
}

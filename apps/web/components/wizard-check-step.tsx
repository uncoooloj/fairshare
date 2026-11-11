"use client";
import { useId, useState, type ReactNode } from "react";
import {
  AnswerSource,
  FeeChoice,
  TOTAL_BASIS_POINTS,
  exampleSplit,
} from "../lib/rules-answers";
import { StandardQuestionId, feeQuestion } from "../lib/standard-questions";
import type {
  AdvanceAnswer,
  AgreementAnswers,
  Cited,
  PersonAnswer,
} from "../lib/rules-answers";
import { parseCents } from "../lib/model";
import { formatMoneyHeadline } from "../lib/preferences";
import type { DocumentCitation } from "../lib/document-citations";
import type { DocumentRecord } from "./agreement-document";
import { DocumentCitationView } from "./document-citation-view";
import { SplitBar } from "./person";
import { SplitDrawer, percentText, rosterTone } from "./split-drawer";
import { WizardDrawer } from "./wizard-drawer";

/** How much the AI managed to read; picks the headline. */
export enum CheckMode {
  FOUND_ALL = "found_all",
  FOUND_SOME = "found_some",
  MANUAL = "manual",
  /** Changing an agreement that was already sent. */
  REVISE = "revise",
  /** The reading found no revenue-share terms: a brief, an invoice, something else. */
  NOT_AGREEMENT = "not_agreement",
}

/** Where a note from someone else (such as a change request) is pinned. */
export enum CheckCard {
  /** Under the headline, for parts without a card here. */
  TOP = "top",
  SPLIT = "split",
  ADVANCE = "advance",
}

enum OpenDrawer {
  AGREEMENT = "agreement",
  SPLIT = "split",
  ADVANCE = "advance",
  FEES = "fees",
}

/** True of the engine: a refund puts payouts on hold until it's checked. It isn't a choice. */
export const REFUND_LINE =
  "If a payment is refunded, payouts pause while it's checked.";

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
    case CheckMode.REVISE:
      return {
        title: "What should change?",
        lede: "Change what needs fixing. Everything else stays as it is.",
      };
    case CheckMode.NOT_AGREEMENT:
      return {
        title: "This doesn't look like a revenue-share agreement",
        lede: "We couldn't find who gets what share of the money in it.",
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

/** "Maya 50% · Jordan 30% · Riley 20%"; anyone at 0% is left out. */
export function splitSummary(people: PersonAnswer[]) {
  const names = shortNames(people);
  return people
    .filter((person) => person.basisPoints > 0)
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
    .filter((row) => row.cents !== 0)
    .map((row) => `${names.get(row.key)} ${formatMoneyHeadline(row.cents)}`)
    .join(", ");
  const caveat = answers.advance ? " (after the advance is paid back)" : "";
  return `On a ${formatMoneyHeadline(EXAMPLE_PAYMENT_CENTS)} payment: ${amounts}${caveat}.`;
}

/** Fees nobody chose come off the top: the recommended default, and what the rules store. */
export function feeLine(answers: AgreementAnswers) {
  switch (answers.fees?.value) {
    case FeeChoice.ORGANIZER_SHARE: {
      const organizer =
        answers.people.value.find((p) => p.key === answers.feeBearerId) ??
        answers.people.value.find((p) => p.isSelf) ??
        answers.people.value[0];
      const name = organizer
        ? shortNames(answers.people.value).get(organizer.key)
        : "The organizer";
      return `PayPal fees come out of ${name}'s share.`;
    }
    default:
      return "PayPal fees come off the top, before the split.";
  }
}

/** The document asked for a fee payer Fairshare can't charge; the question comes next. */
function feesAsked(answers: AgreementAnswers) {
  return (
    !answers.fees &&
    answers.questions.some(
      (q) => q.id === StandardQuestionId.FEES && !q.answeredChoiceId,
    )
  );
}

/** Save a fee choice when it changed, or when the organizer explicitly picked it again. */
export function feesNeedSave(
  answers: AgreementAnswers,
  chosen: string,
  explicitlyChosen: boolean,
) {
  const current = answers.fees?.value ?? FeeChoice.BEFORE_SPLIT;
  return explicitlyChosen || chosen !== current;
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

/** Draft answers have no Version yet. Keep only an unambiguous verbatim quote
 * in the saved document; all other values stay visible but uncited. */
export function wizardCitations(
  answers: AgreementAnswers,
  document: Pick<DocumentRecord, "documentId" | "text" | "provenance">,
  sourceDocumentIds?: { agreement?: string; advance?: string },
): DocumentCitation[] {
  // Draft persistence stores answers but not their producing document ID.
  // Without that identity, a matching phrase in a newer file is not evidence.
  if (!sourceDocumentIds) return [];
  const candidates: Array<{
    id: string;
    label: string;
    summary: string;
    cited?: Cited<unknown>;
    documentId?: string;
  }> = [
    {
      id: "wizard-agreement",
      label: "The agreement",
      summary: answers.name.value || "Agreement details",
      cited: answers.name,
      documentId: sourceDocumentIds?.agreement,
    },
    // The agreement card has one citation chip. Prefer its name citation; use a
    // term citation only when no document-sourced name exists.
    {
      id: "wizard-dates",
      label: "Dates",
      summary: dateRange(answers),
      cited:
        answers.name.source === AnswerSource.DOCUMENT
          ? undefined
          : (answers.effectiveFrom ?? answers.effectiveTo),
      documentId: sourceDocumentIds?.agreement,
    },
    {
      id: "wizard-split",
      label: "Who gets what",
      summary: splitSummary(answers.people.value),
      cited: answers.people,
      documentId: sourceDocumentIds?.agreement,
    },
    {
      id: "wizard-fees",
      label: "PayPal fees",
      summary: feeLine(answers),
      cited: answers.fees,
      documentId: sourceDocumentIds?.agreement,
    },
    {
      id: "wizard-advance",
      label: "Paid back first",
      summary: advanceSentence(answers) ?? "Advance",
      cited: answers.advance,
      documentId: sourceDocumentIds?.advance,
    },
  ];
  const exact = candidates.flatMap((candidate) => {
    const { cited, documentId } = candidate;
    const quote =
      cited?.source === AnswerSource.DOCUMENT ? cited.quote?.trim() : undefined;
    const start = quote ? document.text.indexOf(quote) : -1;
    if (
      !quote ||
      documentId !== document.documentId ||
      start < 0 ||
      document.text.indexOf(quote, start + 1) !== -1
    )
      return [];
    return [{ candidate, quote, start, end: start + quote.length }];
  });
  return exact.flatMap(
    ({ candidate: { id, label, summary, cited }, quote, start, end }) => {
      // A shared or intersecting span cannot tell which rule the person selected.
      // Leave every owner uncited instead of making one rule masquerade as another.
      if (
        exact.filter((other) => other.start < end && other.end > start)
          .length !== 1
      )
        return [];
      const pages = document.provenance?.pages;
      const matches = Array.isArray(pages)
        ? pages.filter(
            (page) =>
              Number.isInteger(page.page) &&
              page.page > 0 &&
              Number.isInteger(page.start) &&
              Number.isInteger(page.end) &&
              page.start >= 0 &&
              page.end >= end &&
              page.start <= start &&
              page.end <= document.text.length,
          )
        : [];
      return [
        {
          id,
          label,
          summary,
          reference: {
            origin: "SOURCE_CLAUSE",
            documentId: document.documentId,
            clause: cited?.clause?.trim() || label,
            excerpt: quote,
          },
          highlight: {
            id,
            label,
            kind: "SAVED_RULE",
            rawValue: quote,
            quote,
            start,
            end,
          },
          ...(matches.length === 1 ? { page: matches[0].page } : {}),
        },
      ];
    },
  );
}

function ClauseChip({
  cited,
  onOpen,
  hideWhenUnavailable = false,
}: {
  cited?: Cited<unknown>;
  onOpen?: (cited: Cited<unknown>) => void;
  hideWhenUnavailable?: boolean;
}) {
  const label = clauseLabel(cited);
  if (!label || (hideWhenUnavailable && !onOpen)) return null;
  return (
    <button
      type="button"
      className="clause-chip wc-chip"
      title={cited?.quote ? `“${cited.quote}”` : "From your agreement"}
      onClick={() => cited && onOpen?.(cited)}
    >
      <span className="sr-only">From your agreement, </span>
      {label}
    </button>
  );
}

function CardHead({
  title,
  cited,
  onOpenCitation,
  hideUnavailableCitation,
  onChange,
  changeLabel,
}: {
  title: string;
  cited?: Cited<unknown>;
  onOpenCitation?: (cited: Cited<unknown>) => void;
  hideUnavailableCitation?: boolean;
  onChange(): void;
  changeLabel: string;
}) {
  return (
    <header className="wc-card-head">
      <h2>{title}</h2>
      <ClauseChip
        cited={cited}
        onOpen={onOpenCitation}
        hideWhenUnavailable={hideUnavailableCitation}
      />
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
  mode: givenMode,
  equalSplitGuessed = false,
  peopleFixed = false,
  flag,
  onUploadAgain,
  onSetUpMyself,
  busy = false,
  document,
  originalUrl,
  fileName,
  sourceDocumentIds,
}: {
  answers: AgreementAnswers;
  onChange(answers: AgreementAnswers): void;
  mode: CheckMode;
  /** Names were found without percentages, so the split is an equal one to start from. */
  equalSplitGuessed?: boolean;
  /** The people were already sent the agreement: shares can change, nobody is added or removed. */
  peopleFixed?: boolean;
  /** Highlights one card with a note on it. */
  flag?: { card: CheckCard; note: ReactNode };
  /** Not an agreement: back to Upload for another file. */
  onUploadAgain?: () => void;
  /** Not an agreement: the organizer chose to set the split up by hand. */
  onSetUpMyself?: () => void;
  /** Disables both replacement choices while the current draft is being retired. */
  busy?: boolean;
  /** The saved source document for Check; omitted only while it cannot be recovered. */
  document?: DocumentRecord;
  originalUrl?: string;
  fileName?: string;
  /** Source IDs keep a revise from borrowing a quote from a different file. */
  sourceDocumentIds?: { agreement?: string; advance?: string };
}) {
  const [setUpMyself, setSetUpMyself] = useState(false);
  // Once they chose to set it up (or already added people), it's a manual setup.
  const mode =
    givenMode === CheckMode.NOT_AGREEMENT &&
    (setUpMyself || answers.people.value.length > 1)
      ? CheckMode.MANUAL
      : givenMode;
  const [drawer, setDrawer] = useState<OpenDrawer>();
  const [splitTouched, setSplitTouched] = useState(false);
  const headingId = useId();
  const paidName = useId();
  const { title, lede } = checkHeadline(mode);
  const people = answers.people.value;
  const names = shortNames(people);
  const example = exampleLine(answers);
  const fees = feesAsked(answers)
    ? "We'll ask you about the PayPal fees next."
    : feeLine(answers);
  const advance = answers.advance;
  const advanceWho = recipientName(answers);
  const amount = advance ? formatMoneyHeadline(advance.value.amountCents) : "";
  const close = () => setDrawer(undefined);
  const citations = document
    ? wizardCitations(answers, document, sourceDocumentIds)
    : [];
  const openCitation = (id?: string) => {
    if (!id || !citations.some((citation) => citation.id === id)) return;
    window.dispatchEvent(
      new CustomEvent("fairshare:open-citation", { detail: id }),
    );
  };
  const focusRule = (id: string) => {
    const target =
      id === "wizard-dates"
        ? "wizard-agreement"
        : id === "wizard-fees"
          ? "wizard-split"
          : id;
    globalThis.document
      .getElementById(`wc-rule-${target}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  // No advance card to pin an advance note to: it goes under the headline.
  const flagAt =
    flag?.card === CheckCard.ADVANCE && !advance ? CheckCard.TOP : flag?.card;
  const flagNote = (card: CheckCard) =>
    flag && flagAt === card ? (
      <div className="wc-flag-note">{flag.note}</div>
    ) : null;
  const flagged = (card: CheckCard) =>
    flag && flagAt === card ? "wc-card wc-flagged" : "wc-card";

  function setPaid(alreadyPaid: boolean) {
    if (!advance) return;
    onChange({
      ...answers,
      advance: { ...advance, value: { ...advance.value, alreadyPaid } },
    });
  }

  if (mode === CheckMode.NOT_AGREEMENT)
    return (
      <section className="wiz-step wc" aria-labelledby={headingId}>
        <h1 id={headingId} tabIndex={-1}>
          {title}
        </h1>
        <p className="wiz-lede">{lede}</p>
        <div className="wc-not-agreement">
          {onUploadAgain ? (
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={onUploadAgain}
            >
              Upload a different file
            </button>
          ) : null}
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => {
              setSetUpMyself(true);
              onSetUpMyself?.();
            }}
          >
            Set it up myself
          </button>
        </div>
      </section>
    );

  return (
    <section className="wiz-step wc" aria-labelledby={headingId}>
      <h1 id={headingId} tabIndex={-1}>
        {title}
      </h1>
      <p className="wiz-lede">{lede}</p>
      {flagNote(CheckCard.TOP)}

      {document ? (
        <div className="wc-reader">
          <DocumentCitationView
            document={document}
            citations={citations}
            fileName={fileName ?? "Your agreement"}
            nameOf={(id) => names.get(id) ?? "A participant"}
            originalUrl={originalUrl}
            onCitationSelect={focusRule}
            hideCitationRail
          />
        </div>
      ) : null}

      <div className="wc-rules">
        <article className="wc-card" id="wc-rule-wizard-agreement">
          <CardHead
            title="The agreement"
            cited={answers.name.value ? answers.name : answers.effectiveFrom}
            onOpenCitation={
              citations.some(
                (citation) =>
                  citation.id ===
                  (answers.name.value ? "wizard-agreement" : "wizard-dates"),
              )
                ? () =>
                    openCitation(
                      answers.name.value ? "wizard-agreement" : "wizard-dates",
                    )
                : undefined
            }
            hideUnavailableCitation={!!document}
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

        <article className={flagged(CheckCard.SPLIT)} id="wc-rule-wizard-split">
          {flagNote(CheckCard.SPLIT)}
          <CardHead
            title="Who gets what"
            cited={answers.people}
            onOpenCitation={
              citations.some((citation) => citation.id === "wizard-split")
                ? () => openCitation("wizard-split")
                : undefined
            }
            hideUnavailableCitation={!!document}
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
                  <span className="wc-legend-name">
                    {names.get(person.key)}
                  </span>
                  <span className="wc-legend-share">
                    {person.basisPoints > 0
                      ? `${percentText(person.basisPoints)}%`
                      : "Not in the split"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {equalSplitGuessed && !splitTouched ? (
            <p className="wc-note">
              We didn't find the percentages. Here's an equal split to start
              from.
            </p>
          ) : null}
          {mode === CheckMode.MANUAL && people.length === 1 ? (
            <p className="wc-note">Add the people you split the money with.</p>
          ) : null}
          {example && people.length > 1 ? (
            <p className="wc-example">{example}</p>
          ) : null}
          <p className="wc-fees">
            <span>{fees}</span>
            <ClauseChip
              cited={answers.fees}
              onOpen={
                citations.some((citation) => citation.id === "wizard-fees")
                  ? () => openCitation("wizard-fees")
                  : undefined
              }
              hideWhenUnavailable={!!document}
            />
            {feesAsked(answers) ? null : (
              <button
                type="button"
                className="wc-link wc-change"
                onClick={() => setDrawer(OpenDrawer.FEES)}
                aria-label="Change who covers the PayPal fees"
              >
                Change
              </button>
            )}
          </p>
          <p className="wc-fees wc-refunds">{REFUND_LINE}</p>
        </article>

        {advance ? (
          <article
            className={flagged(CheckCard.ADVANCE)}
            id="wc-rule-wizard-advance"
          >
            {flagNote(CheckCard.ADVANCE)}
            <CardHead
              title="Paid back first"
              cited={advance}
              onOpenCitation={
                citations.some((citation) => citation.id === "wizard-advance")
                  ? () => openCitation("wizard-advance")
                  : undefined
              }
              hideUnavailableCitation={!!document}
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
                  {NOT_PAID_YET}
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
      </div>

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
          lockedKeys={
            peopleFixed
              ? people.map((p) => p.key)
              : advance
                ? [advance.value.recipientKey]
                : []
          }
          canAdd={!peopleFixed}
          onCancel={close}
          onSave={(next) => {
            setSplitTouched(true);
            onChange({ ...answers, people: edited(answers.people, next) });
            close();
          }}
        />
      ) : null}
      {drawer === OpenDrawer.FEES ? (
        <FeesDrawer
          answers={answers}
          onCancel={close}
          onSave={(next) => {
            onChange(next);
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

/** "Not yet" on the advance: it can still be sent; the organizer confirms it later. */
export const NOT_PAID_YET =
  "You'll confirm it once it's paid. Nothing is split until then.";

/** Who covers the PayPal fees: before the split (recommended) or the organizer's share. */
function FeesDrawer({
  answers,
  onSave,
  onCancel,
}: {
  answers: AgreementAnswers;
  onSave(answers: AgreementAnswers): void;
  onCancel(): void;
}) {
  const question = feeQuestion(answers);
  const [chosen, setChosen] = useState<string>(
    answers.fees?.value ?? FeeChoice.BEFORE_SPLIT,
  );
  const [explicitlyChosen, setExplicitlyChosen] = useState(false);
  const name = useId();
  function save() {
    if (!feesNeedSave(answers, chosen, explicitlyChosen)) return onCancel();
    const choice = question.choices.find((c) => c.id === chosen);
    onSave(choice ? choice.apply(answers) : answers);
  }
  return (
    <WizardDrawer title="PayPal fees" onSave={save} onCancel={onCancel}>
      <fieldset className="wiz-fields wc-fee-choices">
        <legend className="sr-only">Who covers the PayPal fees</legend>
        {question.choices.map((choice) => (
          <label key={choice.id} className="wiz-check wc-fee-choice">
            <input
              type="radio"
              name={name}
              checked={chosen === choice.id}
              onClick={() => setExplicitlyChosen(true)}
              onChange={() => {
                setExplicitlyChosen(true);
                setChosen(choice.id);
              }}
            />
            <span>
              <strong>{choice.label}</strong>
              <span className="wc-fee-explain">{choice.explanation}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </WizardDrawer>
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

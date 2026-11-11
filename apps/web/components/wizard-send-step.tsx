"use client";
import { useId, useState } from "react";
import {
  AnswerSource,
  BlockerKind,
  sendBlockers,
  type AgreementAnswers,
  type Blocker,
} from "../lib/rules-answers";
import { formatMoneyHeadline } from "../lib/preferences";
import { answerQuestion } from "./wizard-questions-step";
import { NOT_PAID_YET } from "./wizard-check-step";
import { SplitDrawer } from "./split-drawer";

export type ReviewDocument = {
  name: string;
  detail?: string;
};

function calendarDay(value: string | null | undefined) {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const month = [
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
  ][Number(match[2]) - 1];
  return `${month ?? match[2]} ${Number(match[3])}, ${match[1]}`;
}

function dateRange(answers: AgreementAnswers) {
  const from = calendarDay(answers.effectiveFrom?.value);
  const to = calendarDay(answers.effectiveTo?.value);
  if (from && to) return `${from} – ${to}`;
  if (from) return `${from} – no end date`;
  if (to) return `Until ${to}`;
  return "No dates set";
}

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

function DocumentIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path
        d="M5 2.5h6.2L15 6.3v11.2H5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M11 2.8v3.6h3.6M7.5 10h5M7.5 13h5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The final wizard step is a check of the saved draft, before the approval request. */
export function WizardReviewSummary({
  answers,
  document,
  currency = "USD",
}: {
  answers: AgreementAnswers;
  document?: ReviewDocument;
  currency?: string;
}) {
  return (
    <>
      <h1 id="wiz-step-title" tabIndex={-1}>
        Review
      </h1>
      <p className="wiz-lede">Check the details, then send it for approval.</p>
      <dl className="wiz-review-card">
        <div className="wiz-review-row">
          <dt>Name</dt>
          <dd>{answers.name.value || "Untitled agreement"}</dd>
        </div>
        <div className="wiz-review-row">
          <dt>Currency</dt>
          <dd>{currency === "USD" ? "USD – US dollar" : currency}</dd>
        </div>
        <div className="wiz-review-row">
          <dt>Dates</dt>
          <dd>{dateRange(answers)}</dd>
        </div>
        <div className="wiz-review-row">
          <dt>Document</dt>
          <dd className="wiz-review-document">
            <DocumentIcon />
            <span>{document?.name ?? "Your agreement"}</span>
            {document?.detail ? <span> · {document.detail}</span> : null}
          </dd>
        </div>
        <div className="wiz-review-row wiz-review-people">
          <dt>People</dt>
          <dd>
            <ul>
              {answers.people.value.map((person, index) => (
                <li key={person.key}>
                  <span
                    className={`wiz-avatar wiz-avatar-${index % 3}`}
                    aria-hidden="true"
                  >
                    {initials(person.name)}
                  </span>
                  <span>{person.name || "Unnamed person"}</span>
                  <small>{person.isSelf ? "Owner" : "Collaborator"}</small>
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>
    </>
  );
}

/** Has the advance been paid? Both answers can be sent; "Not yet" is confirmed later. */
function AdvancePaid({
  answers,
  onChange,
}: {
  answers: AgreementAnswers;
  onChange(answers: AgreementAnswers): void;
}) {
  const name = useId();
  const advance = answers.advance;
  if (!advance) return null;
  const who =
    answers.people.value
      .find((p) => p.key === advance.value.recipientKey)
      ?.name.trim()
      .split(/\s+/)[0] ?? "They";
  const amount = formatMoneyHeadline(advance.value.amountCents);
  const set = (alreadyPaid: boolean) =>
    onChange({
      ...answers,
      advance: { ...advance, value: { ...advance.value, alreadyPaid } },
    });
  return (
    <fieldset className="wc-paid ws-paid">
      <legend>
        Has {who} already paid the {amount}?
      </legend>
      <div className="wc-segmented">
        <label>
          <input
            type="radio"
            name={name}
            checked={advance.value.alreadyPaid === true}
            onChange={() => set(true)}
          />
          <span>Yes</span>
        </label>
        <label>
          <input
            type="radio"
            name={name}
            checked={advance.value.alreadyPaid === false}
            onChange={() => set(false)}
          />
          <span>Not yet</span>
        </label>
      </div>
    </fieldset>
  );
}

/** One open question from the document, answered right here. */
function InlineQuestion({
  answers,
  questionId,
  onChange,
}: {
  answers: AgreementAnswers;
  questionId: string;
  onChange(answers: AgreementAnswers): void;
}) {
  const index = answers.questions.findIndex((q) => q.id === questionId);
  const question = answers.questions[index];
  if (!question) return null;
  return (
    <div className="ws-fix">
      <p className="ws-fix-title">{question.text}</p>
      <div className="ws-choices">
        {question.choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            className="button secondary"
            onClick={() => onChange(answerQuestion(answers, index, choice))}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function InlineName({
  answers,
  onChange,
}: {
  answers: AgreementAnswers;
  onChange(answers: AgreementAnswers): void;
}) {
  const [name, setName] = useState("");
  const id = useId();
  return (
    <form
      className="ws-fix ws-name"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim())
          onChange({
            ...answers,
            name: { value: name.trim(), source: AnswerSource.PERSON },
          });
      }}
    >
      <label htmlFor={id} className="ws-fix-title">
        Name the agreement
      </label>
      <span className="ws-name-row">
        <input
          id={id}
          type="text"
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" className="button secondary">
          Save
        </button>
      </span>
    </form>
  );
}

/** Whoever the advance belongs to left the split: pick them again. */
function InlineAdvanceWho({
  answers,
  onChange,
}: {
  answers: AgreementAnswers;
  onChange(answers: AgreementAnswers): void;
}) {
  const advance = answers.advance;
  const id = useId();
  if (!advance) return null;
  const amount = formatMoneyHeadline(advance.value.amountCents);
  return (
    <div className="ws-fix">
      <label htmlFor={id} className="ws-fix-title">
        Who put in the {amount}?
      </label>
      <span className="ws-name-row">
        <select
          id={id}
          defaultValue=""
          onChange={(event) =>
            event.target.value &&
            onChange({
              ...answers,
              advance: {
                ...advance,
                value: { ...advance.value, recipientKey: event.target.value },
              },
            })
          }
        >
          <option value="" disabled>
            Choose someone
          </option>
          {answers.people.value.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="wc-link"
          onClick={() => onChange({ ...answers, advance: undefined })}
        >
          No one paid upfront
        </button>
      </span>
    </div>
  );
}

/** Step 6: the agreement in sentences, and anything still in the way, fixable right here. */
export function WizardSendStep({
  answers,
  error,
  onChange,
  onFixPeople,
  document,
  currency,
}: {
  answers: AgreementAnswers;
  error?: string;
  /** Without it the blockers are listed but can't be fixed here. */
  onChange?: (answers: AgreementAnswers) => void;
  /** Names and emails are fixed on the People step. */
  onFixPeople?: () => void;
  /** Kept in wizard memory; historical drafts may not have a filename or byte count. */
  document?: ReviewDocument;
  currency?: string;
}) {
  const [splitOpen, setSplitOpen] = useState(false);
  const blockers = sendBlockers(answers);
  // The advance question stays on screen once answered, so it can be changed.
  const advanceHere = !!answers.advance && !!onChange;
  const listed = blockers.filter(
    (b) => !(advanceHere && b.kind === BlockerKind.ADVANCE_PAID),
  );

  function fix(blocker: Blocker) {
    if (!onChange) return <li key={blocker.text}>{blocker.text}</li>;
    switch (blocker.kind) {
      case BlockerKind.ADVANCE_PAID:
        return <li key={blocker.text}>{blocker.text}</li>;
      case BlockerKind.QUESTION:
        return (
          <li key={blocker.text} className="ws-item">
            <InlineQuestion
              answers={answers}
              questionId={blocker.questionId!}
              onChange={onChange}
            />
          </li>
        );
      case BlockerKind.NAME:
        return (
          <li key={blocker.text} className="ws-item">
            <InlineName answers={answers} onChange={onChange} />
          </li>
        );
      case BlockerKind.ADVANCE_WHO:
        return (
          <li key={blocker.text} className="ws-item">
            <InlineAdvanceWho answers={answers} onChange={onChange} />
          </li>
        );
      case BlockerKind.SPLIT:
        return (
          <li key={blocker.text} className="ws-item ws-row">
            <span>{blocker.text}</span>
            <button
              type="button"
              className="wc-link"
              onClick={() => setSplitOpen(true)}
            >
              Fix it
            </button>
          </li>
        );
      case BlockerKind.PEOPLE:
        return (
          <li key={blocker.text} className="ws-item ws-row">
            <span>{blocker.text}</span>
            {onFixPeople ? (
              <button type="button" className="wc-link" onClick={onFixPeople}>
                Fix it
              </button>
            ) : null}
          </li>
        );
    }
  }

  return (
    <section className="wiz-step wiz-send" aria-labelledby="wiz-step-title">
      <WizardReviewSummary
        answers={answers}
        document={document}
        currency={currency}
      />
      {advanceHere ? (
        <div className="ws-advance">
          <AdvancePaid answers={answers} onChange={onChange!} />
          {answers.advance!.value.alreadyPaid === false ? (
            <p className="wiz-hint" role="status">
              {NOT_PAID_YET}
            </p>
          ) : null}
        </div>
      ) : null}
      {listed.length > 0 && (
        <div className="wiz-blocking ws-blocking" role="status">
          <p>
            {listed.length === 1
              ? "One thing before you send"
              : "A few things before you send"}
          </p>
          <ul>{listed.map(fix)}</ul>
        </div>
      )}
      <p className="wiz-lede">
        Nothing is paid until everyone approves. You can still change things if
        someone asks.
      </p>
      {error && (
        <p className="wiz-error wiz-error-banner" role="alert">
          {error}
        </p>
      )}
      {splitOpen && onChange ? (
        <SplitDrawer
          people={answers.people.value}
          lockedKeys={answers.people.value.map((p) => p.key)}
          canAdd={false}
          onCancel={() => setSplitOpen(false)}
          onSave={(people) => {
            onChange({
              ...answers,
              people: { value: people, source: AnswerSource.PERSON },
            });
            setSplitOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}

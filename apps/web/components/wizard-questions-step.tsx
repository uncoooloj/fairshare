"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { parseCents } from "../lib/model";
import { reopenChangedQuestions } from "../lib/rules-answers";
import { formatMoney, formatMoneyHeadline } from "../lib/preferences";
import { toneInRoster } from "../lib/person";
import type {
  AgreementAnswers,
  Question,
  QuestionChoice,
} from "../lib/rules-answers";
import {
  SAMPLE_GROSS_CENTS,
  choiceEffect,
  sampleFeeCents,
  type PersonEffect,
} from "../lib/standard-questions";
import { Avatar, AvatarSize } from "./person";

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
      <path
        d="M10.5 2.5l3 3L5 14H2v-3z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
      <path
        d="M4 1.75h5l3 3v9.5H4zM9 1.75v3h3M6 8h4M6 10.5h4"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const signedMoney = (cents: number) =>
  `${cents < 0 ? "−" : ""}${formatMoneyHeadline(Math.abs(cents))}`;

/** Records the chosen answer on the question and applies it to the answers. */
export function answerQuestion(
  answers: AgreementAnswers,
  index: number,
  choice: QuestionChoice,
): AgreementAnswers {
  if (choice.available && !choice.available(answers)) return answers;
  const applied = reopenChangedQuestions(answers, choice.apply(answers));
  return {
    ...applied,
    questions: applied.questions.map((q, i) =>
      i === index ? { ...q, answeredChoiceId: choice.id } : q,
    ),
  };
}

function SampleAmount({
  cents,
  onChange,
}: {
  cents: number;
  onChange: (cents: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();
  const inputId = useId();
  const commit = () => {
    try {
      const value = parseCents(draft.replace(/[$,\s]/g, ""));
      if (!value) throw new Error("Enter an amount above $0.");
      onChange(value);
      setEditing(false);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enter an amount.");
    }
  };
  if (!editing)
    return (
      <p className="wq-sample">
        On a {formatMoneyHeadline(cents)} payment
        <button
          type="button"
          className="wq-sample-edit"
          aria-label="Change the example amount"
          onClick={() => {
            setDraft(String(cents / 100));
            setEditing(true);
          }}
        >
          <PencilIcon />
        </button>
      </p>
    );
  return (
    <div className="wq-sample editing">
      <label htmlFor={inputId}>Example payment</label>
      <span className="wq-sample-field">
        <span aria-hidden="true">$</span>
        <input
          id={inputId}
          inputMode="decimal"
          autoFocus
          value={draft}
          aria-invalid={error ? true : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") setEditing(false);
          }}
        />
      </span>
      <button type="button" className="button secondary" onClick={commit}>
        Update
      </button>
      {error && (
        <p className="wq-sample-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function EffectRow({
  rows,
  roster,
}: {
  rows: PersonEffect[];
  roster: { userId: string }[];
}) {
  return (
    <ul className="wq-effect">
      {rows.map((row) => (
        <li key={row.key}>
          <Avatar
            name={row.name}
            tone={toneInRoster(row.key, roster)}
            size={AvatarSize.SMALL}
            label={false}
          />
          <span className="visually-hidden">{row.name}</span>
          <span className="wq-effect-amount">
            {row.cents < 0 ? signedMoney(row.cents) : formatMoney(row.cents)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Step 4: one unclear point per screen, each choice shown in dollars for real people. */
export function WizardQuestionsStep({
  answers,
  onChange,
  index,
  onNext,
  onBack,
}: {
  answers: AgreementAnswers;
  onChange: (answers: AgreementAnswers) => void;
  index: number;
  onNext: () => void;
  onBack: () => void;
}) {
  const question: Question | undefined = answers.questions[index];
  const [selectedId, setSelectedId] = useState<string | undefined>(
    question?.answeredChoiceId,
  );
  const [shownFor, setShownFor] = useState(question?.id);
  const [sampleCents, setSampleCents] = useState(SAMPLE_GROSS_CENTS);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const headingId = useId();

  // A new question starts from its own saved answer.
  if (question?.id !== shownFor) {
    setShownFor(question?.id);
    setSelectedId(question?.answeredChoiceId);
  }
  if (!question) return null;

  const feeCents = sampleFeeCents(sampleCents);
  const roster = answers.people.value.map((p) => ({ userId: p.key }));
  const choices = question.choices.filter(
    (choice) => !choice.available || choice.available(answers),
  );
  const selected = choices.find((c) => c.id === selectedId);

  const select = (choiceIndex: number) => {
    const choice = choices[choiceIndex];
    setSelectedId(choice.id);
    cardRefs.current[choiceIndex]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent, choiceIndex: number) => {
    const count = choices.length;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      select((choiceIndex + 1) % count);
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      select((choiceIndex - 1 + count) % count);
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      select(choiceIndex);
    }
  };
  const focusIndex = Math.max(
    0,
    choices.findIndex((c) => c.id === selectedId),
  );

  return (
    <section className="wq" aria-labelledby={headingId}>
      <p className="wq-progress">
        Question {index + 1} of {answers.questions.length}
      </p>
      <h2 id={headingId} className="wq-question">
        {question.text}
      </h2>
      {question.quote ? (
        <blockquote className="wq-quote">
          <p>“{question.quote}”</p>
          {question.clause && (
            <span className="wq-clause">
              <DocIcon />
              {question.clause}
            </span>
          )}
        </blockquote>
      ) : (
        <p className="wq-silent">
          We couldn't locate a clear answer in the agreement. Check the source
          with everyone before choosing.
        </p>
      )}

      <p className="wq-proposal-note">
        {question.proposalNote ??
          "These are possible fixes, not a decision about what is fair. Compare what each person gets, then choose a proposal for everyone to review."}{" "}
        Your original contract stays unchanged. Everyone must approve the
        proposed rules before they can take effect.
      </p>
      {choices.length < question.choices.length && (
        <p className="muted">
          Some options no longer fit the people or terms you entered. Go back to
          check them, or leave this question open.
        </p>
      )}
      <SampleAmount cents={sampleCents} onChange={setSampleCents} />
      <p className="wq-example-line">
        {`With a ${formatMoneyHeadline(feeCents)} PayPal fee, each person gets:`}
      </p>

      <div className="wq-choices" role="radiogroup" aria-labelledby={headingId}>
        {choices.map((choice, i) => {
          const checked = choice.id === selectedId;
          const rows = choiceEffect(answers, choice, sampleCents, feeCents);
          return (
            <div
              key={choice.id}
              ref={(el) => {
                cardRefs.current[i] = el;
              }}
              role="radio"
              aria-checked={checked}
              tabIndex={i === focusIndex ? 0 : -1}
              className={`wq-choice${checked ? " selected" : ""}`}
              onClick={() => select(i)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              <span className="wq-radio" aria-hidden="true" />
              <span className="wq-choice-body">
                <span className="wq-choice-label">{choice.label}</span>
                <span className="wq-choice-explanation">
                  {choice.explanation}
                </span>
                {rows && rows.length > 0 && (
                  <EffectRow rows={rows} roster={roster} />
                )}
              </span>
            </div>
          );
        })}
      </div>

      <div className="wq-actions">
        <button type="button" className="button secondary" onClick={onBack}>
          Back
        </button>
        <span className="wq-actions-end">
          <button type="button" className="wq-skip" onClick={onNext}>
            Not sure? Skip for now
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!selected}
            onClick={() => {
              if (!selected) return;
              onChange(answerQuestion(answers, index, selected));
              onNext();
            }}
          >
            Use this
          </button>
        </span>
      </div>
    </section>
  );
}

"use client";
import { useId, useState } from "react";
import {
  AnswerSource,
  BlockerKind,
  sendBlockers,
  summarySentences,
  type AgreementAnswers,
  type Blocker,
} from "../lib/rules-answers";
import { formatMoneyHeadline } from "../lib/preferences";
import { answerQuestion } from "./wizard-questions-step";
import { NOT_PAID_YET } from "./wizard-check-step";
import { SplitDrawer } from "./split-drawer";

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
}: {
  answers: AgreementAnswers;
  error?: string;
  /** Without it the blockers are listed but can't be fixed here. */
  onChange?: (answers: AgreementAnswers) => void;
  /** Names and emails are fixed on the People step. */
  onFixPeople?: () => void;
}) {
  const [splitOpen, setSplitOpen] = useState(false);
  const lines = summarySentences(answers);
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
      <h1 id="wiz-step-title" tabIndex={-1}>
        {blockers.length ? "Almost ready to send" : "Ready to send"}
      </h1>
      <ul className="wiz-summary">
        {lines.map((line, index) => (
          <li key={line} className={index === 0 ? "wiz-summary-title" : ""}>
            {line}
          </li>
        ))}
      </ul>
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

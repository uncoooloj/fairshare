"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { submitForApproval } from "../lib/agreement-api";
import {
  answersFromRules,
  revisableRules,
  revisedRules,
} from "../lib/answers-from-rules";
import { joinNames } from "../lib/agreement-status";
import {
  ApiError,
  Currency,
  api,
  type Agreement,
  type Rules,
  type User,
} from "../lib/model";
import {
  blockingReasons,
  summarySentences,
  type AgreementAnswers,
  type Question,
} from "../lib/rules-answers";
import {
  feeQuestion,
  questionsFor,
  refundQuestion,
} from "../lib/standard-questions";
import { workspaceBase } from "../lib/workspace-base";
import { checkProblem, detailsPatch } from "./agreement-creation-wizard";
import { partPhrase, type ChangeRequestView } from "./change-request-drawer";
import { WrongPart } from "./something-wrong-drawer";
import { CheckCard, CheckMode, WizardCheckStep } from "./wizard-check-step";
import { WizardFrame } from "./wizard-chrome";
import { WizardQuestionsStep } from "./wizard-questions-step";

/** The screens of a change to a sent agreement. Questions only when something is open. */
export enum ReviseStage {
  CHECK = "check",
  QUESTIONS = "questions",
  SEND = "send",
}

/** Progress dots for a change: Questions count as Check. */
const REVISE_STEPS = [
  { stage: ReviseStage.CHECK, label: "Check" },
  { stage: ReviseStage.SEND, label: "Send" },
];

/** Which Check card a request is pinned to. Fees sit in the split card; refunds have no card. */
export const REQUEST_CARD: Record<WrongPart, CheckCard> = {
  [WrongPart.SPLIT]: CheckCard.SPLIT,
  [WrongPart.ADVANCE]: CheckCard.ADVANCE,
  [WrongPart.FEES]: CheckCard.SPLIT,
  [WrongPart.REFUNDS]: CheckCard.TOP,
  [WrongPart.OTHER]: CheckCard.TOP,
};

/** A fees or refunds request asks that question again, starting from today's answer. */
function requestedQuestion(
  answers: AgreementAnswers,
  request?: ChangeRequestView,
): Question | undefined {
  const question =
    request?.part === WrongPart.FEES
      ? feeQuestion(answers)
      : request?.part === WrongPart.REFUNDS
        ? refundQuestion(answers)
        : undefined;
  if (!question || !request) return undefined;
  const current =
    request.part === WrongPart.FEES
      ? answers.fees?.value
      : answers.refunds?.value;
  return {
    ...question,
    quote: request.note,
    clause: `${request.name}'s note`,
    ...(current ? { answeredChoiceId: current } : {}),
  };
}

/** Questions after Check: the requested one first, then anything the rules leave open. */
export function reviseQuestions(
  answers: AgreementAnswers,
  request?: ChangeRequestView,
): Question[] {
  const answered = answers.questions.filter((q) => q.answeredChoiceId);
  const asked = requestedQuestion(answers, request);
  const first =
    asked && !answered.some((q) => q.id === asked.id) ? [asked] : [];
  const fresh = questionsFor(answers).filter(
    (q) => ![...first, ...answered].some((a) => a.id === q.id),
  );
  return [...first, ...answered, ...fresh].slice(0, 3);
}

/** Names of everyone who approves again (everyone but the organizer). */
export function approverNames(answers: AgreementAnswers) {
  return answers.people.value
    .filter((p) => !p.isSelf)
    .map((p) => p.name.trim().split(/\s+/)[0] || p.name);
}

/** A retry may only adopt a submit whose new version contains this attempt's rules. */
export function revisedSubmissionWasCommitted(
  before: Agreement,
  recovered: Agreement,
  rules: Rules,
  details?: Record<string, unknown>,
): boolean {
  const patch = details as
    | { name?: string; effectiveFrom?: string; effectiveTo?: string | null }
    | undefined;
  const expectedDetails = {
    currency: before.value.details?.currency ?? Currency.USD,
    effectiveFrom: before.value.details?.effectiveFrom,
    effectiveTo: before.value.details?.effectiveTo,
  };
  if (patch?.effectiveFrom !== undefined)
    expectedDetails.effectiveFrom = patch.effectiveFrom;
  if (patch?.effectiveTo !== undefined)
    expectedDetails.effectiveTo = patch.effectiveTo;
  const recoveredDetails = recovered.value.details ?? {
    currency: Currency.USD,
  };
  const detailsMatch =
    recovered.value.name === (patch?.name ?? before.value.name) &&
    recoveredDetails.currency === expectedDetails.currency &&
    recoveredDetails.effectiveFrom === expectedDetails.effectiveFrom &&
    recoveredDetails.effectiveTo === expectedDetails.effectiveTo;
  return (
    detailsMatch &&
    recovered.value.versions
      .slice(before.value.versions.length)
      .some(
        (version) =>
          version.status !== "DRAFT" &&
          JSON.stringify(version.rules) === JSON.stringify(rules),
      )
  );
}

function mayHaveCommitted(cause: unknown): boolean {
  return !(cause instanceof ApiError) || cause.status >= 500;
}

function RequestNote({ request }: { request: ChangeRequestView }) {
  return (
    <figure className="gr-flag">
      <figcaption>
        {request.name} asked for a change to {partPhrase(request.part)}
      </figcaption>
      <blockquote>“{request.note}”</blockquote>
      {request.part === WrongPart.REFUNDS || request.part === WrongPart.FEES ? (
        <p className="gr-flag-hint">You can change this on the next screen.</p>
      ) : null}
    </figure>
  );
}

function ReviseStepper({ stage }: { stage: ReviseStage }) {
  const current = stage === ReviseStage.SEND ? 1 : 0;
  return (
    <nav className="wiz-stepper" aria-label="Change progress">
      <ol>
        {REVISE_STEPS.map((step, index) => {
          const state =
            index < current
              ? "done"
              : index === current
                ? "current"
                : "upcoming";
          return (
            <li
              key={step.stage}
              className={`wiz-stepper-item ${state}`}
              aria-current={index === current ? "step" : undefined}
            >
              <span className="wiz-stepper-mark" aria-hidden="true">
                {index < current ? "✓" : index + 1}
              </span>
              <span className="wiz-stepper-label">
                {step.label}
                {index < current && (
                  <span className="visually-hidden"> (done)</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Guided change to a sent agreement: Check (pre-filled from the current rules, the requested
 * part highlighted) → Questions (only if something is open) → Send. No upload, reading or
 * people screens: the people were fixed when it was first sent. Sending proposes the new
 * rules, records the organizer's approval and sends them in one call.
 */
export function AgreementReviseWizard({
  agreement,
  owner,
  request,
  onDone,
  onClose,
  onBusyChange,
  onDirtyChange,
}: {
  agreement: Agreement;
  owner: User;
  /** The change request being fixed, if any. */
  request?: ChangeRequestView;
  /** Sent: the agreement as the server now holds it. */
  onDone: (agreement: Agreement) => void;
  onClose: () => void;
  onBusyChange?: (busy: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [rules] = useState<Rules | undefined>(() => revisableRules(agreement));
  const [initial] = useState(() =>
    rules ? answersFromRules(agreement, rules, owner.id) : undefined,
  );
  const [answers, setAnswers] = useState(initial);
  const [stage, setStage] = useState(ReviseStage.CHECK);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [documentText, setDocumentText] = useState<string>();
  const [busy, setBusyState] = useState(false);
  const [error, setError] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const lock = useRef(false);
  const root = `${workspaceBase(agreement.workspaceId)}/collaborations/${agreement.id}`;

  // The document text lets a quoted clause keep its citation; without it the quote
  // becomes a plain sentence, which is still valid.
  useEffect(() => {
    const documentId = rules?.source.documentId;
    if (!documentId) return;
    let live = true;
    api<{ text?: string }>(
      `${root}/documents/${encodeURIComponent(documentId)}`,
    )
      .then((doc) => {
        if (live && typeof doc?.text === "string") setDocumentText(doc.text);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [root, rules]);

  useEffect(() => {
    setError("");
    document.querySelector<HTMLElement>(".wiz-main h1, .wiz-main h2")?.focus();
  }, [stage, questionIndex]);

  function setBusy(next: boolean) {
    setBusyState(next);
    onBusyChange?.(next);
  }

  const dirty = JSON.stringify(answers) !== JSON.stringify(initial);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  function close() {
    if (busy) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  }

  if (!rules || !answers)
    return (
      <WizardFrame title="Change agreement" onClose={onClose}>
        <section className="wiz-step">
          <h1 tabIndex={-1}>There's nothing to change yet</h1>
          <p className="wiz-lede">Send the agreement for approval first.</p>
        </section>
      </WizardFrame>
    );

  function leaveCheck() {
    if (!answers) return;
    const problem = checkProblem(answers);
    if (problem) return setError(problem);
    const next = { ...answers, questions: reviseQuestions(answers, request) };
    setAnswers(next);
    setQuestionIndex(0);
    setStage(next.questions.length ? ReviseStage.QUESTIONS : ReviseStage.SEND);
  }

  async function send() {
    if (!answers || !rules || lock.current) return;
    if (blockingReasons(answers).length) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const next = revisedRules(answers, rules, {
        organizerId: owner.id,
        documentText,
      });
      const patch = detailsPatch(agreement, answers);
      let current: Agreement;
      try {
        current = await submitForApproval(
          agreement.workspaceId,
          agreement.id,
          agreement.revision,
          next,
          patch,
        );
      } catch (cause) {
        if (!mayHaveCommitted(cause)) throw cause;
        try {
          const recovered = await api<Agreement>(root);
          if (!revisedSubmissionWasCommitted(agreement, recovered, next, patch))
            throw cause;
          current = recovered;
        } catch {
          throw cause;
        }
      }
      onDirtyChange?.(false);
      onDone(current);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "We couldn’t send the changes. Try again.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const dialog = confirmClose && (
    <div className="gr-dialog-backdrop">
      <div
        className="wiz-dialog gr-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="gr-dialog-title"
      >
        <h2 id="gr-dialog-title">Discard your changes?</h2>
        <p>Nothing has been sent. The agreement stays as it is.</p>
        <div className="wiz-dialog-actions">
          <button
            type="button"
            className="button secondary"
            autoFocus
            onClick={() => setConfirmClose(false)}
          >
            Keep editing
          </button>
          <button type="button" className="button primary" onClick={onClose}>
            Discard
          </button>
        </div>
      </div>
    </div>
  );

  const frame = (footer: ReactNode, body: ReactNode) => (
    <WizardFrame
      title="Change agreement"
      closeLabel="Close without sending"
      onClose={close}
      closeDisabled={busy}
      busy={busy}
      stepper={<ReviseStepper stage={stage} />}
      footer={footer}
    >
      {body}
      {dialog}
    </WizardFrame>
  );
  const errorBanner = error && (
    <p className="wiz-error wiz-error-banner" role="alert">
      {error}
    </p>
  );

  if (stage === ReviseStage.QUESTIONS)
    return frame(
      null,
      <WizardQuestionsStep
        answers={answers}
        onChange={setAnswers}
        index={questionIndex}
        onBack={() =>
          questionIndex > 0
            ? setQuestionIndex(questionIndex - 1)
            : setStage(ReviseStage.CHECK)
        }
        onNext={() => {
          if (questionIndex + 1 < answers.questions.length)
            setQuestionIndex(questionIndex + 1);
          else setStage(ReviseStage.SEND);
        }}
      />,
    );

  if (stage === ReviseStage.SEND) {
    const reasons = blockingReasons(answers);
    const names = approverNames(answers);
    const lines = summarySentences(answers).filter(
      (line) => !line.startsWith("Sending to"),
    );
    return frame(
      <>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => {
            if (answers.questions.length) {
              setQuestionIndex(answers.questions.length - 1);
              setStage(ReviseStage.QUESTIONS);
            } else setStage(ReviseStage.CHECK);
          }}
        >
          Back
        </button>
        <button
          type="button"
          className="button primary"
          disabled={busy || reasons.length > 0}
          onClick={() => void send()}
        >
          {busy ? "Sending…" : "Send the changes"}
        </button>
      </>,
      <section className="wiz-step wiz-send" aria-labelledby="wiz-step-title">
        <h1 id="wiz-step-title" tabIndex={-1}>
          Send the changes
        </h1>
        <ul className="wiz-summary">
          {lines.map((line, index) => (
            <li key={line} className={index === 0 ? "wiz-summary-title" : ""}>
              {line}
            </li>
          ))}
          {names.length > 0 && (
            <li>Sending to {joinNames(names)} to approve again.</li>
          )}
        </ul>
        {reasons.length > 0 && (
          <div className="wiz-blocking" role="status">
            <p>Before you send:</p>
            <ul>
              {reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="wiz-lede">
          {agreement.value.activeVersionId
            ? "Everyone approves again. Until they do, payments keep splitting the current way."
            : "Everyone approves again. Nothing is paid until they do."}
        </p>
        {errorBanner}
      </section>,
    );
  }

  return frame(
    <>
      <span />
      <button
        type="button"
        className="button primary"
        disabled={busy}
        onClick={leaveCheck}
      >
        Continue
      </button>
    </>,
    <>
      <WizardCheckStep
        answers={answers}
        onChange={(next) => {
          setError("");
          setAnswers(next);
        }}
        mode={CheckMode.REVISE}
        peopleFixed
        flag={
          request
            ? {
                card: REQUEST_CARD[request.part],
                note: <RequestNote request={request} />,
              }
            : undefined
        }
      />
      {errorBanner}
    </>,
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import {
  addPerson,
  deleteDraft,
  removePerson,
  replacePersonLink,
  submitForApproval,
  type AgreementMember,
} from "../lib/agreement-api";
import {
  answersFromDraft,
  type ExtractedAnswers,
} from "../lib/answers-from-extraction";
import { api, type Agreement } from "../lib/model";
import { readAgreement, ReadingOutcome } from "../lib/reading";
import {
  blockingReasons,
  toRules,
  totalBasisPoints,
  TOTAL_BASIS_POINTS,
  type AgreementAnswers,
  type PersonAnswer,
} from "../lib/rules-answers";
import { questionsFor } from "../lib/standard-questions";
import { workspaceBase } from "../lib/workspace-base";
import {
  clearDraftAnswers,
  loadDraftAnswers,
  saveDraftAnswers,
} from "../lib/wizard-draft-store";
import {
  DocumentMode,
  DocumentStep,
  MAX_DOCUMENT_TEXT_LENGTH,
  validateDocumentFile,
} from "./document-step";
import { PeopleStep, validatePeopleEmails } from "./people-step";
import { ReadingDocument } from "./reading-document";
import { CheckMode, WizardCheckStep } from "./wizard-check-step";
import { WizardFrame, WizardStep, WizardStepper } from "./wizard-chrome";
import { WizardCloseDialog } from "./wizard-close-dialog";
import {
  buildIntakeInput,
  isUnreadableDocument,
  unreadableDetail,
  type AgreementIntakeInput,
  type CreatedAgreement,
} from "./wizard-intake";
import { WizardQuestionsStep } from "./wizard-questions-step";
import { WizardSendStep } from "./wizard-send-step";
import { WizardSentStep, type SentInvite } from "./wizard-sent-step";

/** Every screen of the upload-first flow, in order. */
export enum WizardStage {
  UPLOAD = "upload",
  READING = "reading",
  CHECK = "check",
  QUESTIONS = "questions",
  PEOPLE = "people",
  SEND = "send",
  SENT = "sent",
}

/** Which of the four progress dots each screen lights. */
export const STAGE_STEP: Record<WizardStage, WizardStep | undefined> = {
  [WizardStage.UPLOAD]: WizardStep.UPLOAD,
  [WizardStage.READING]: WizardStep.UPLOAD,
  [WizardStage.CHECK]: WizardStep.CHECK,
  [WizardStage.QUESTIONS]: WizardStep.CHECK,
  [WizardStage.PEOPLE]: WizardStep.PEOPLE,
  [WizardStage.SEND]: WizardStep.SEND,
  [WizardStage.SENT]: undefined,
};

export interface WizardPrefill {
  text?: string;
}

/** A saved draft reopened from Agreements: the wizard starts at Check. */
export interface WizardResume {
  created: CreatedAgreement;
  extraction: unknown;
}

/** Issued invite links, by person key. A link is only good for the name and email it was made for. */
interface IssuedInvite {
  invitationId: string;
  token: string;
  name: string;
  email: string;
}

const PRIVACY_LINE =
  "Read my agreement sends it to AI (Cloudflare Workers AI, with an Anthropic fallback) to suggest the split.";

/** Pending people the server holds for this draft. */
function pendingMembers(agreement: Agreement) {
  return (agreement.value.members as AgreementMember[]).flatMap((member) =>
    member.pending ? [{ ...member, pending: member.pending }] : [],
  );
}

/** A retry may only adopt a submit whose new version contains this attempt's rules. */
export function submissionWasCommitted(
  before: Agreement,
  recovered: Agreement,
  rules: ReturnType<typeof toRules>,
): boolean {
  return recovered.value.versions
    .slice(before.value.versions.length)
    .some(
      (version) =>
        version.status !== "DRAFT" &&
        JSON.stringify(version.rules) === JSON.stringify(rules),
    );
}

/** A late read must never replace choices made after the organizer continued manually. */
export function readingResultIsCurrent(
  activeGeneration: number,
  resultGeneration: number,
): boolean {
  return activeGeneration === resultGeneration;
}

/** Once an old pending seat is removed, a retry must add rather than remove it again. */
export function clearPersonInvitation(
  answers: AgreementAnswers,
  personKey: string,
): AgreementAnswers {
  return {
    ...answers,
    people: {
      ...answers.people,
      value: answers.people.value.map((person) =>
        person.key === personKey
          ? { ...person, invitationId: undefined }
          : person,
      ),
    },
  };
}

/**
 * Questions for step 4. Answered ones stay so Back can revisit them; new ones come from
 * whatever the Check screen left open.
 */
export function mergeQuestions(answers: AgreementAnswers): AgreementAnswers {
  const answered = answers.questions.filter((q) => q.answeredChoiceId);
  const fresh = questionsFor(
    answers,
    answers.questions.filter((q) => !q.answeredChoiceId),
  ).filter((q) => !answered.some((a) => a.id === q.id));
  return { ...answers, questions: [...answered, ...fresh].slice(0, 3) };
}

/** Why Check can't continue yet, or undefined. */
export function checkProblem(answers: AgreementAnswers): string | undefined {
  const people = answers.people.value;
  if (people.length < 2) return "Add the people you split the money with.";
  if (totalBasisPoints(people) !== TOTAL_BASIS_POINTS)
    return "Make the split add up to 100%.";
  if (!answers.name.value.trim()) return "Give the agreement a name.";
  return undefined;
}

/**
 * Upload → Reading → Check → Questions → People → Send → Sent. Pressing "Read my agreement"
 * (or "Set it up myself") saves a private draft through intake; People adds pending people;
 * Send saves the rules, approves for the organizer and sends in one call.
 */
export function AgreementCreationWizard({
  owner,
  prefill,
  resume,
  onCreate,
  onFinish,
  onKeepDraft,
  onClose,
  onBusyChange,
}: {
  owner: { id: string; name: string; email: string };
  prefill?: WizardPrefill;
  resume?: WizardResume;
  onCreate: (input: AgreementIntakeInput) => Promise<CreatedAgreement>;
  /** After Sent: open the agreement. */
  onFinish: (agreement: Agreement) => void;
  /** × → Keep as draft. */
  onKeepDraft: (agreement: Agreement) => void;
  /** × before anything was saved, or after Discard deleted the draft. */
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const self = { name: owner.name, userId: owner.id };
  const [initial] = useState(() =>
    resume ? resumedAnswers(resume, self) : undefined,
  );
  const [stage, setStage] = useState(
    resume ? WizardStage.CHECK : WizardStage.UPLOAD,
  );
  const [mode, setModeState] = useState(
    prefill?.text ? DocumentMode.PASTE : DocumentMode.UPLOAD,
  );
  const [file, setFileState] = useState<File | null>(null);
  const [text, setTextState] = useState(prefill?.text ?? "");
  const [documentError, setDocumentError] = useState("");
  const [created, setCreated] = useState<CreatedAgreement | null>(
    resume?.created ?? null,
  );
  const [agreement, setAgreement] = useState<Agreement | null>(
    resume?.created.agreement ?? null,
  );
  const [answers, setAnswers] = useState<AgreementAnswers | null>(
    initial?.answers ?? null,
  );
  const [checkMode, setCheckMode] = useState(initial?.mode ?? CheckMode.MANUAL);
  const [equalSplitGuessed, setEqualSplitGuessed] = useState(
    initial?.equalSplitGuessed ?? false,
  );
  const [questionIndex, setQuestionIndex] = useState(0);
  const [invites, setInvites] = useState<Record<string, IssuedInvite>>({});
  const [busy, setBusyState] = useState(false);
  const [error, setError] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState("");
  // One idempotency key per intake attempt: kept across a retry of the same input, cleared on any edit.
  const requestId = useRef("");
  const lock = useRef(false);
  const readingGeneration = useRef(0);
  const heading = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setError("");
    setShowErrors(false);
    const node = document.querySelector<HTMLElement>(".wiz-main h1");
    heading.current = node;
    node?.focus();
  }, [stage, questionIndex]);

  // Check, Questions and People choices survive "Keep as draft" on this device.
  useEffect(() => {
    if (!answers || !created || stage === WizardStage.SENT) return;
    saveDraftAnswers(created.workspaceId, created.agreementId, answers);
  }, [answers, created, stage]);

  function setBusy(next: boolean) {
    setBusyState(next);
    onBusyChange(next);
  }
  function edited() {
    requestId.current = "";
    setError("");
    setDocumentError("");
  }
  const setFile = (next: File | null) => {
    edited();
    setFileState(next);
  };
  const setText = (next: string) => {
    edited();
    setTextState(next);
  };
  const setMode = (next: DocumentMode) => {
    edited();
    setModeState(next);
  };

  function documentProblem(): string | undefined {
    if (documentError) return documentError;
    if (mode === DocumentMode.UPLOAD)
      return file ? validateDocumentFile(file) : "Choose a document first.";
    if (!text.trim()) return "Paste the agreement text first.";
    if (text.length > MAX_DOCUMENT_TEXT_LENGTH)
      return "Use up to 40,000 characters of agreement text.";
    return undefined;
  }

  /** Runs one server step behind the lock; errors land on the current screen. */
  async function guarded(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "Something went wrong. Try again.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function adopt(next: ExtractedAnswers, made: CreatedAgreement) {
    setAnswers(withDraftName(next.answers, made.agreement));
    setCheckMode(next.mode);
    setEqualSplitGuessed(next.equalSplitGuessed);
  }

  /** Saves the private draft (intake). Nothing is saved until one of the Upload buttons is
   * pressed, and AI reading only runs when `read` is set. */
  async function start(read: boolean) {
    if (documentProblem()) return;
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    let made: CreatedAgreement;
    try {
      requestId.current ||= crypto.randomUUID();
      made = await onCreate(
        await buildIntakeInput({
          requestId: requestId.current,
          mode,
          file,
          text,
        }),
      );
    } catch (cause) {
      const message =
        cause instanceof Error && cause.message
          ? cause.message
          : "We couldn’t save your agreement. Try again.";
      if (isUnreadableDocument(cause)) {
        requestId.current = "";
        setDocumentError(unreadableDetail(cause));
      } else setError(message);
      return;
    } finally {
      lock.current = false;
      setBusy(false);
    }
    setCreated(made);
    setAgreement(made.agreement);
    if (read) setStage(WizardStage.READING);
    else {
      adopt(
        answersFromDraft(made.agreement, null, made.documentText, self),
        made,
      );
      setStage(WizardStage.CHECK);
    }
  }

  function leaveCheck() {
    if (!answers) return;
    const problem = checkProblem(answers);
    if (problem) {
      setError(problem);
      return;
    }
    const next = mergeQuestions(answers);
    setAnswers(next);
    setQuestionIndex(0);
    setStage(
      next.questions.length ? WizardStage.QUESTIONS : WizardStage.PEOPLE,
    );
  }

  /** Makes the server's pending people match the People screen, issuing links as needed. */
  async function syncPeople() {
    if (!answers || !created || !agreement) return;
    const { workspaceId, agreementId } = created;
    let current = agreement;
    const issued = { ...invites };
    const people: PersonAnswer[] = [];
    const keep = new Set<string>();
    for (const person of answers.people.value) {
      if (person.isSelf || person.userId) {
        people.push(person);
        continue;
      }
      const name = person.name.trim();
      const email = (person.email ?? "").trim();
      const link = issued[person.key];
      if (
        person.invitationId &&
        link?.invitationId === person.invitationId &&
        link.name === name &&
        link.email.toLowerCase() === email.toLowerCase()
      ) {
        keep.add(person.invitationId);
        people.push(person);
        continue;
      }
      const held = person.invitationId
        ? pendingMembers(current).find(
            (m) => m.pending.invitationId === person.invitationId,
          )
        : undefined;
      let result;
      if (
        held &&
        held.displayName === name &&
        held.pending.email.toLowerCase() === email.toLowerCase()
      )
        // A resumed draft: same person, but this screen never saw their link. Issue a fresh one.
        result = await replacePersonLink(
          workspaceId,
          agreementId,
          current.revision,
          held.userId,
        );
      else {
        // New, or the name or email changed: their old place and link go.
        if (held) {
          current = await removePerson(
            workspaceId,
            agreementId,
            current.revision,
            held.userId,
          );
          // The removal is already committed even if adding the replacement fails.
          // Keep its revision and clear the obsolete invitation before retrying.
          delete issued[person.key];
          setAgreement(current);
          setInvites({ ...issued });
          setAnswers((currentAnswers) =>
            currentAnswers
              ? clearPersonInvitation(currentAnswers, person.key)
              : currentAnswers,
          );
        }
        result = await addPerson(workspaceId, agreementId, current.revision, {
          name,
          email,
        });
      }
      current = result.agreement;
      issued[person.key] = {
        invitationId: result.invitation.id,
        token: result.invitation.token,
        name,
        email,
      };
      keep.add(result.invitation.id);
      people.push({
        ...person,
        name,
        email,
        invitationId: result.invitation.id,
      });
      // Saved as we go, so a failure part-way doesn't add the same person twice on retry.
      setAgreement(current);
      setInvites({ ...issued });
      setAnswers((a) => (a ? withPeople(a, people, answers.people.value) : a));
    }
    // Anyone removed from the split loses their pending place and link.
    for (const member of pendingMembers(current)) {
      if (keep.has(member.pending.invitationId)) continue;
      current = await removePerson(
        workspaceId,
        agreementId,
        current.revision,
        member.userId,
      );
      // Each deletion advances the revision. Retain it before the next deletion or retry.
      setAgreement(current);
    }
    setAgreement(current);
    setInvites(issued);
    setAnswers((a) => (a ? withPeople(a, people, answers.people.value) : a));
  }

  async function leavePeople() {
    if (!answers) return;
    const problem = validatePeopleEmails(answers, owner.email);
    if (problem) {
      setShowErrors(true);
      setError(problem);
      return;
    }
    await guarded(async () => {
      await syncPeople();
      setStage(WizardStage.SEND);
    });
  }

  async function send() {
    if (!answers || !created || !agreement) return;
    if (blockingReasons(answers).length) return;
    await guarded(async () => {
      const { workspaceId, agreementId, documentId } = created;
      let current = agreement;
      const patch = detailsPatch(current, answers);
      if (patch)
        current = await api<Agreement>(
          `${workspaceBase(workspaceId)}/collaborations/${agreementId}/details`,
          "POST",
          { expectedRevision: current.revision, ...patch },
        );
      // Details and submit are separate revisioned commits. Keep the acknowledged
      // details revision even when sending fails, so retry does not conflict.
      setAgreement(current);
      const rules = toRules(answers, {
        documentId,
        organizerId: owner.id,
        documentText: created.documentText,
      });
      try {
        current = await submitForApproval(
          workspaceId,
          agreementId,
          current.revision,
          rules,
        );
      } catch (cause) {
        // A response can be lost after the server commits. Re-read once, and only
        // finish when the new version is exactly the rules this attempt submitted.
        try {
          const recovered = await api<Agreement>(
            `${workspaceBase(workspaceId)}/collaborations/${agreementId}`,
          );
          setAgreement(recovered);
          if (submissionWasCommitted(current, recovered, rules))
            current = recovered;
          else throw cause;
        } catch {
          throw cause;
        }
      }
      setAgreement(current);
      clearDraftAnswers(workspaceId, agreementId);
      setStage(WizardStage.SENT);
    });
  }

  async function discard() {
    if (!created || !agreement) {
      onClose();
      return;
    }
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setCloseError("");
    try {
      await deleteDraft(
        created.workspaceId,
        created.agreementId,
        agreement.revision,
      );
      clearDraftAnswers(created.workspaceId, created.agreementId);
      onClose();
    } catch (cause) {
      setCloseError(
        cause instanceof Error && cause.message
          ? cause.message
          : "We couldn’t discard this draft. Try again.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function close() {
    if (busy || stage === WizardStage.READING) return;
    if (stage === WizardStage.SENT && agreement) return onFinish(agreement);
    const dirty = !!file || !!text.trim();
    if (!created && !dirty) return onClose();
    setCloseError("");
    setClosing(true);
  }

  const dialog = closing && (
    <WizardCloseDialog
      saved={!!created}
      busy={busy}
      error={closeError}
      onKeep={() => agreement && onKeepDraft(agreement)}
      onDiscard={() => void discard()}
      onCancel={() => setClosing(false)}
    />
  );

  const step = STAGE_STEP[stage];
  const frame = (
    footer: React.ReactNode,
    body: React.ReactNode,
    closeLabel = "Close new agreement",
  ) => (
    <WizardFrame
      onClose={close}
      closeLabel={closeLabel}
      closeDisabled={busy || stage === WizardStage.READING}
      busy={busy}
      stepper={step === undefined ? undefined : <WizardStepper step={step} />}
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

  if (stage === WizardStage.READING && created) {
    // This render owns its read attempt. Manual exit invalidates it before Check opens.
    // The server request may finish, but it cannot overwrite manual edits afterward.
    const generation = readingGeneration.current;
    return frame(
      null,
      <ReadingDocument
        key={created.documentId}
        fileName={
          mode === DocumentMode.UPLOAD && file ? file.name : "Pasted agreement"
        }
        run={async () => {
          let extraction: unknown = null;
          let outcome = ReadingOutcome.MANUAL;
          try {
            const result = await readAgreement({
              workspaceId: created.workspaceId,
              agreementId: created.agreementId,
              documentId: created.documentId,
              consent: true,
              // Upload-first: no people yet, so names stay as written.
              context: { source: created.documentText, members: null },
            });
            extraction = result.extraction;
            outcome = result.outcome;
          } finally {
            if (readingResultIsCurrent(readingGeneration.current, generation))
              adopt(
                answersFromDraft(
                  created.agreement,
                  extraction,
                  created.documentText,
                  self,
                ),
                created,
              );
          }
          return outcome;
        }}
        onDone={() => setStage(WizardStage.CHECK)}
        onCancel={() => {
          readingGeneration.current++;
          adopt(
            answersFromDraft(
              created.agreement,
              null,
              created.documentText,
              self,
            ),
            created,
          );
          setStage(WizardStage.CHECK);
        }}
      />,
    );
  }

  if (stage === WizardStage.CHECK && answers)
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
          mode={checkMode}
          equalSplitGuessed={equalSplitGuessed}
        />
        {created?.lowConfidence && (
          <p className="wiz-warning" role="note">
            Some words may be wrong. Check the split before sending.
          </p>
        )}
        {errorBanner}
      </>,
    );

  if (stage === WizardStage.QUESTIONS && answers)
    return frame(
      null,
      <WizardQuestionsStep
        answers={answers}
        onChange={setAnswers}
        index={questionIndex}
        onBack={() =>
          questionIndex > 0
            ? setQuestionIndex(questionIndex - 1)
            : setStage(WizardStage.CHECK)
        }
        onNext={() => {
          if (questionIndex + 1 < answers.questions.length)
            setQuestionIndex(questionIndex + 1);
          else setStage(WizardStage.PEOPLE);
        }}
      />,
    );

  if (stage === WizardStage.PEOPLE && answers)
    return frame(
      <>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => {
            if (answers.questions.length) {
              setQuestionIndex(answers.questions.length - 1);
              setStage(WizardStage.QUESTIONS);
            } else setStage(WizardStage.CHECK);
          }}
        >
          Back
        </button>
        <button
          type="button"
          className="button primary"
          disabled={busy}
          onClick={() => void leavePeople()}
        >
          {busy ? "Saving…" : "Review and send"}
        </button>
      </>,
      <section className="wiz-step" aria-labelledby="wiz-step-title">
        <h1 id="wiz-step-title" tabIndex={-1}>
          Who should we send this to?
        </h1>
        <p className="wiz-lede">
          We found these people in your agreement. Add their emails so they can
          approve.
        </p>
        <PeopleStep
          answers={answers}
          onChange={(next) => {
            setError("");
            setAnswers(next);
          }}
          showErrors={showErrors}
          disabled={busy}
          selfEmail={owner.email}
        />
        {errorBanner}
      </section>,
    );

  if (stage === WizardStage.SEND && answers)
    return frame(
      <>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => setStage(WizardStage.PEOPLE)}
        >
          Back
        </button>
        <button
          type="button"
          className="button primary"
          disabled={busy || blockingReasons(answers).length > 0}
          onClick={() => void send()}
        >
          {busy ? "Sending…" : "Send for approval"}
        </button>
      </>,
      <WizardSendStep answers={answers} error={error || undefined} />,
    );

  if (stage === WizardStage.SENT && answers && agreement)
    return frame(
      <>
        <span />
        <button
          type="button"
          className="button primary"
          onClick={() => onFinish(agreement)}
        >
          Go to agreement
        </button>
      </>,
      <WizardSentStep
        invites={answers.people.value
          .filter((p) => !p.isSelf)
          .map<SentInvite>((p) => ({
            key: p.key,
            name: p.name,
            email: p.email ?? "",
            token: invites[p.key]?.token,
          }))}
      />,
      "Close and open the agreement",
    );

  const problem = documentProblem();
  return frame(
    <>
      <button
        type="button"
        className="text-button wiz-manual"
        disabled={busy || !!problem}
        onClick={() => void start(false)}
      >
        Set it up myself
      </button>
      <span className="wiz-footer-primary">
        <button
          type="button"
          className="button primary"
          disabled={busy || !!problem}
          onClick={() => void start(true)}
        >
          {busy ? "Saving…" : "Read my agreement"}
        </button>
        <small>{PRIVACY_LINE}</small>
      </span>
    </>,
    <section className="wiz-step" aria-labelledby="wiz-step-title">
      <h1 id="wiz-step-title" tabIndex={-1}>
        Upload your agreement
      </h1>
      <p className="wiz-lede">We’ll read it and set up the split for you.</p>
      {mode === DocumentMode.PASTE && documentError && (
        <p className="wiz-error wiz-error-banner" role="alert">
          {documentError}
        </p>
      )}
      <DocumentStep
        file={file}
        text={text}
        mode={mode}
        error={documentError || undefined}
        disabled={busy}
        onFile={setFile}
        onText={setText}
        onMode={setMode}
      />
      {errorBanner}
    </section>,
  );
}

/** The People screen's version of each person replaces the earlier one, keyed by person. */
function withPeople(
  a: AgreementAnswers,
  synced: PersonAnswer[],
  original: PersonAnswer[],
): AgreementAnswers {
  const byKey = new Map(synced.map((p) => [p.key, p]));
  return {
    ...a,
    people: {
      ...a.people,
      value: original.map((p) => byKey.get(p.key) ?? p),
    },
  };
}

/** Name and dates changed on Check, as a details request body; undefined when nothing changed. */
export function detailsPatch(
  agreement: Agreement,
  answers: AgreementAnswers,
): Record<string, unknown> | undefined {
  const patch: Record<string, unknown> = {};
  const name = answers.name.value.trim();
  if (name && name !== agreement.value.name) patch.name = name;
  const details = agreement.value.details;
  const from = answers.effectiveFrom?.value || undefined;
  if (from && from !== details?.effectiveFrom) patch.effectiveFrom = from;
  if (answers.effectiveTo !== undefined) {
    const to = answers.effectiveTo.value || null;
    if (to !== details?.effectiveTo) patch.effectiveTo = to;
  }
  return Object.keys(patch).length ? patch : undefined;
}

/** No title read from the document: keep the one the draft was saved with. */
function withDraftName(
  answers: AgreementAnswers,
  agreement: Agreement,
): AgreementAnswers {
  return answers.name.value.trim()
    ? answers
    : { ...answers, name: { ...answers.name, value: agreement.value.name } };
}

/**
 * A reopened draft: the document's answers, then what was set on this device before
 * "Keep as draft", reconciled with the pending people the server still holds.
 */
export function resumedAnswers(
  resume: WizardResume,
  self: { name: string; userId: string },
): ExtractedAnswers {
  const { agreement, documentText, workspaceId, agreementId } = resume.created;
  const read = answersFromDraft(
    agreement,
    resume.extraction,
    documentText,
    self,
  );
  const stored = loadDraftAnswers(workspaceId, agreementId);
  if (!stored)
    return { ...read, answers: withDraftName(read.answers, agreement) };
  const held = new Map(
    pendingMembers(agreement).map((m) => [m.pending.invitationId, m]),
  );
  const people = stored.people.value.map((p) =>
    p.invitationId && !held.has(p.invitationId)
      ? { ...p, invitationId: undefined }
      : p,
  );
  // Anyone the server holds but this device doesn't know: a 0% row, removed at People.
  for (const [invitationId, m] of held)
    if (!people.some((p) => p.invitationId === invitationId))
      people.push({
        key: m.userId,
        name: m.displayName,
        email: m.pending.email,
        invitationId,
        basisPoints: 0,
        isSelf: false,
      });
  const merged: AgreementAnswers = {
    ...stored,
    people: { ...stored.people, value: people },
    questions: [],
  };
  // Local storage holds only question identifiers and selected choices. Rebuild
  // source questions here so citations and closures stay tied to the current reading.
  let restored: AgreementAnswers = {
    ...merged,
    questions: questionsFor(merged, read.answers.questions),
  };
  for (const saved of stored.questionAnswers ?? []) {
    if (!saved.answeredChoiceId) continue;
    const question = restored.questions.find((item) => item.id === saved.id);
    const choice = question?.choices.find(
      (item) => item.id === saved.answeredChoiceId,
    );
    if (!question || !choice) continue;
    const applied = choice.apply(restored);
    restored = {
      ...applied,
      questions: applied.questions.map((item) =>
        item.id === question.id
          ? { ...item, answeredChoiceId: saved.answeredChoiceId }
          : item,
      ),
    };
  }
  return {
    ...read,
    answers: withDraftName(restored, agreement),
  };
}

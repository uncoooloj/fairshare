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
import { ApiError, api, type Agreement } from "../lib/model";
import { readAgreement, ReadingOutcome } from "../lib/reading";
import {
  blockingReasons,
  toRules,
  totalBasisPoints,
  TOTAL_BASIS_POINTS,
  type AgreementAnswers,
  type PersonAnswer,
} from "../lib/rules-answers";
import { MAX_QUESTIONS, questionsFor } from "../lib/standard-questions";
import { workspaceBase } from "../lib/workspace-base";
import {
  clearDraftAnswers,
  loadDraftAnswers,
  loadStoredInviteTokens,
  restoreQuestions,
  saveDraftAnswers,
  saveInviteLinks,
  type StoredInviteToken,
  type StoredPlace,
} from "../lib/wizard-persistence";
import {
  DocumentMode,
  DocumentStep,
  MAX_DOCUMENT_TEXT_LENGTH,
  validateDocumentFile,
} from "./document-step";
import { PeopleStep, validatePeopleEmails } from "./people-step";
import { ReadingDocument } from "./reading-document";
import { CheckMode, WizardCheckStep } from "./wizard-check-step";
import { originalDocumentUrl, type DocumentRecord } from "./agreement-document";
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

/** A saved draft reopened from Agreements: the wizard returns to where the organizer stopped. */
export interface WizardResume {
  created: CreatedAgreement;
  extraction: unknown;
}

/** Screens a reopened draft can land on. Upload and Reading are behind it; Sent means it's gone. */
const RESUMABLE = new Set<string>([
  WizardStage.CHECK,
  WizardStage.QUESTIONS,
  WizardStage.PEOPLE,
  WizardStage.SEND,
]);

/**
 * Where a reopened draft lands: the screen it was closed on, unless an earlier screen now
 * needs attention (the split doesn't add up, a question went away, an email is missing).
 */
export function resumePlace(
  answers: AgreementAnswers,
  place: StoredPlace | undefined,
  selfEmail?: string,
): { stage: WizardStage; questionIndex: number } {
  const check = { stage: WizardStage.CHECK, questionIndex: 0 };
  if (!place || !RESUMABLE.has(place.stage) || checkProblem(answers))
    return check;
  const stage = place.stage as WizardStage;
  const count = answers.questions.length;
  if (stage === WizardStage.QUESTIONS)
    return count
      ? {
          stage,
          questionIndex: Math.min(Math.max(place.questionIndex, 0), count - 1),
        }
      : { stage: WizardStage.PEOPLE, questionIndex: 0 };
  if (stage === WizardStage.SEND && validatePeopleEmails(answers, selfEmail))
    return { stage: WizardStage.PEOPLE, questionIndex: 0 };
  return { stage, questionIndex: 0 };
}

/** The progress line under the current dot: which question of how many. */
export function stageDetail(
  stage: WizardStage,
  questionIndex: number,
  questionCount: number,
): string | undefined {
  if (stage !== WizardStage.QUESTIONS || !questionCount) return undefined;
  return `Question ${Math.min(questionIndex, questionCount - 1) + 1} of ${questionCount}`;
}

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

type DraftDelete = (
  workspaceId: string,
  agreementId: string,
  expectedRevision: number,
) => Promise<void>;
type DraftRead = (
  workspaceId: string,
  agreementId: string,
) => Promise<Agreement>;

/** A lost DELETE response is safe to recover only when a fresh read proves the draft is gone. */
export async function deleteDraftForReplacement(
  workspaceId: string,
  agreementId: string,
  expectedRevision: number,
  deps: { deleteDraft?: DraftDelete; readDraft?: DraftRead } = {},
): Promise<void> {
  const remove = deps.deleteDraft ?? deleteDraft;
  const read =
    deps.readDraft ??
    ((workspace: string, agreement: string) =>
      api<Agreement>(
        `${workspaceBase(workspace)}/collaborations/${agreement}`,
      ));
  try {
    await remove(workspaceId, agreementId, expectedRevision);
  } catch (cause) {
    try {
      await read(workspaceId, agreementId);
    } catch (readCause) {
      if (
        readCause instanceof ApiError &&
        readCause.status === 404 &&
        readCause.code === "NOT_FOUND"
      )
        return;
    }
    throw cause;
  }
}

/** The server calls People needs; swappable so tests can count them. */
export interface PeopleApi {
  addPerson: typeof addPerson;
  removePerson: typeof removePerson;
  replacePersonLink: typeof replacePersonLink;
}

const PEOPLE_API: PeopleApi = { addPerson, removePerson, replacePersonLink };

/**
 * Makes the server's pending people match the People screen. Called only by Send, never on
 * navigation. Each person's link is made once: adding them returns it and `onLink` keeps it.
 * A person already on the server keeps their link; only one saved by an older build (on the
 * server, but with no link on this device) gets a new link, once. Progress is reported as it
 * commits, so a failure part-way never adds the same person twice on retry.
 */
export async function syncPendingPeople({
  workspaceId,
  agreementId,
  agreement,
  answers,
  links,
  onAgreement = () => {},
  onAnswers = () => {},
  onLink = () => {},
  calls = PEOPLE_API,
}: {
  workspaceId: string;
  agreementId: string;
  agreement: Agreement;
  answers: AgreementAnswers;
  /** Tokens already made, by invitation id. */
  links: Record<string, string | StoredInviteToken>;
  onAgreement?: (agreement: Agreement) => void;
  onAnswers?: (answers: AgreementAnswers) => void;
  onLink?: (invitationId: string, token: string, expiresAt: number) => void;
  calls?: PeopleApi;
}): Promise<{
  agreement: Agreement;
  answers: AgreementAnswers;
  links: Record<string, string>;
}> {
  let current = agreement;
  let next = answers;
  const issued = Object.fromEntries(
    Object.entries(links).flatMap(([id, link]) =>
      !!link &&
      typeof link === "object" &&
      typeof link.token === "string" &&
      Number.isFinite(link.expiresAt) &&
      link.expiresAt > Date.now()
        ? [[id, link.token]]
        : [],
    ),
  ) as Record<string, string>;
  const keep = new Set<string>();
  const committed = (
    result: {
      agreement: Agreement;
      invitation: { id: string; token: string; expiresAt: number };
    },
    personKey: string,
    patch: Partial<PersonAnswer> = {},
  ) => {
    current = result.agreement;
    onAgreement(current);
    issued[result.invitation.id] = result.invitation.token;
    onLink(
      result.invitation.id,
      result.invitation.token,
      result.invitation.expiresAt,
    );
    keep.add(result.invitation.id);
    next = withInvitation(next, personKey, result.invitation.id, patch);
    onAnswers(next);
  };
  for (const person of answers.people.value) {
    if (person.isSelf || person.userId) continue;
    const name = person.name.trim();
    const email = (person.email ?? "").trim();
    const held = person.invitationId
      ? pendingMembers(current).find(
          (m) => m.pending.invitationId === person.invitationId,
        )
      : undefined;
    if (
      held &&
      held.displayName === name &&
      held.pending.email.toLowerCase() === email.toLowerCase()
    ) {
      keep.add(held.pending.invitationId);
      if (issued[held.pending.invitationId]) continue;
      // Saved by an older build with no link on this device: make it once, now.
      committed(
        await calls.replacePersonLink(
          workspaceId,
          agreementId,
          current.revision,
          held.userId,
        ),
        person.key,
      );
      continue;
    }
    // New, or the name or email changed: their old place and link go.
    if (held) {
      current = await calls.removePerson(
        workspaceId,
        agreementId,
        current.revision,
        held.userId,
      );
      // The removal is already committed even if adding the replacement fails.
      // Keep its revision and clear the obsolete invitation before retrying.
      onAgreement(current);
      next = clearPersonInvitation(next, person.key);
      onAnswers(next);
    }
    committed(
      await calls.addPerson(workspaceId, agreementId, current.revision, {
        name,
        email,
      }),
      person.key,
      { name, email },
    );
  }
  // Anyone removed from the split loses their pending place and link.
  for (const member of pendingMembers(current)) {
    if (keep.has(member.pending.invitationId)) continue;
    current = await calls.removePerson(
      workspaceId,
      agreementId,
      current.revision,
      member.userId,
    );
    // Each deletion advances the revision. Retain it before the next deletion or retry.
    onAgreement(current);
  }
  return { agreement: current, answers: next, links: issued };
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
  return {
    ...answers,
    questions: [...fresh, ...answered].slice(0, MAX_QUESTIONS),
  };
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
 * (or "Set it up myself") saves a private draft through intake. Moving between screens is
 * local. Send adds the pending people (making each link once), then saves the rules,
 * approves for the organizer and sends in one call.
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
  onLeaveAttempt = () => {},
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
  onLeaveAttempt?: (attempt: () => boolean) => void;
}) {
  const self = { name: owner.name, userId: owner.id };
  const [initial] = useState(() =>
    resume ? resumedAnswers(resume, self) : undefined,
  );
  const [place] = useState(() =>
    initial
      ? resumePlace(initial.answers, initial.place, owner.email)
      : { stage: WizardStage.UPLOAD, questionIndex: 0 },
  );
  const [stage, setStage] = useState(place.stage);
  const [mode, setModeState] = useState(
    prefill?.text ? DocumentMode.PASTE : DocumentMode.UPLOAD,
  );
  const [file, setFileState] = useState<File | null>(null);
  const [text, setTextState] = useState(prefill?.text ?? "");
  const [documentError, setDocumentError] = useState("");
  const [created, setCreated] = useState<CreatedAgreement | null>(
    resume?.created ?? null,
  );
  // Persisted draft answers do not record their producing document. A fresh upload in
  // this same wizard does, so it can restore source citations after replacement.
  const [sourceIdentityKnown, setSourceIdentityKnown] = useState(!resume);
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
  const [questionIndex, setQuestionIndex] = useState(place.questionIndex);
  // Invite tokens by invitation id. Each is made once, at Send, and kept on this device.
  const [links, setLinks] = useState<Record<string, StoredInviteToken>>(() =>
    resume
      ? loadStoredInviteTokens(
          resume.created.workspaceId,
          resume.created.agreementId,
        )
      : {},
  );
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
    // People: straight into the first email still to fill in.
    const email =
      stage === WizardStage.PEOPLE
        ? Array.from(
            document.querySelectorAll<HTMLInputElement>(
              '.wiz-main input[type="email"]',
            ),
          ).find((input) => !input.value.trim() && !input.disabled)
        : undefined;
    (email ?? node)?.focus();
  }, [stage, questionIndex]);

  // Choices and the current screen survive a reload or "Keep as draft" on this device.
  useEffect(() => {
    if (!answers || !created || stage === WizardStage.SENT) return;
    saveDraftAnswers(created.workspaceId, created.agreementId, answers, {
      stage,
      questionIndex,
    });
  }, [answers, created, stage, questionIndex]);

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
    setSourceIdentityKnown(true);
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

  /** Server people sync for Send, with progress kept so a retry never repeats a step. */
  async function syncPeople(start: Agreement, from: AgreementAnswers) {
    if (!created) return { agreement: start, answers: from };
    const { workspaceId, agreementId } = created;
    return syncPendingPeople({
      workspaceId,
      agreementId,
      agreement: start,
      answers: from,
      links,
      onAgreement: setAgreement,
      onAnswers: setAnswers,
      onLink: (invitationId, token, expiresAt) => {
        saveInviteLinks(workspaceId, agreementId, {
          [invitationId]: { token, expiresAt },
        });
        setLinks((current) => ({
          ...current,
          [invitationId]: { token, expiresAt },
        }));
      },
    });
  }

  function leavePeople() {
    if (!answers) return;
    const problem = validatePeopleEmails(answers, owner.email);
    if (problem) {
      setShowErrors(true);
      setError(problem);
      return;
    }
    setStage(WizardStage.SEND);
  }

  async function send() {
    if (!answers || !created || !agreement) return;
    if (blockingReasons(answers).length) return;
    await guarded(async () => {
      const { workspaceId, agreementId, documentId } = created;
      const synced = await syncPeople(agreement, answers);
      let current = synced.agreement;
      const patch = detailsPatch(current, synced.answers);
      if (patch)
        current = await api<Agreement>(
          `${workspaceBase(workspaceId)}/collaborations/${agreementId}/details`,
          "POST",
          { expectedRevision: current.revision, ...patch },
        );
      // Details and submit are separate revisioned commits. Keep the acknowledged
      // details revision even when sending fails, so retry does not conflict.
      setAgreement(current);
      const rules = toRules(synced.answers, {
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

  /**
   * Not an agreement → "Upload a different file": the first draft is discarded (it holds
   * nothing but that document), so Agreements never fills up with abandoned drafts. The
   * next "Read my agreement" saves a fresh one.
   */
  async function uploadAgain() {
    if (!created || !agreement) {
      setStage(WizardStage.UPLOAD);
      return;
    }
    const { workspaceId, agreementId } = created;
    await guarded(async () => {
      await deleteDraftForReplacement(
        workspaceId,
        agreementId,
        agreement.revision,
      );
      clearDraftAnswers(workspaceId, agreementId);
      readingGeneration.current++;
      requestId.current = "";
      setCreated(null);
      setSourceIdentityKnown(false);
      setAgreement(null);
      setAnswers(null);
      setLinks({});
      setCheckMode(CheckMode.MANUAL);
      setEqualSplitGuessed(false);
      setQuestionIndex(0);
      setModeState(DocumentMode.UPLOAD);
      setFileState(null);
      setTextState("");
      setDocumentError("");
      setStage(WizardStage.UPLOAD);
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

  function attemptLeave() {
    if (busy || stage === WizardStage.READING) return false;
    if (stage === WizardStage.SENT && agreement) {
      onFinish(agreement);
      return false;
    }
    const dirty = !!file || !!text.trim();
    if (!created && !dirty) return true;
    setCloseError("");
    setClosing(true);
    return false;
  }

  useEffect(() => {
    onLeaveAttempt(attemptLeave);
    return () => onLeaveAttempt(() => true);
  });

  function close() {
    if (attemptLeave()) onClose();
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
  const detail = stageDetail(
    stage,
    questionIndex,
    answers?.questions.length ?? 0,
  );
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
      stepper={
        step === undefined ? undefined : (
          <WizardStepper step={step} detail={detail} />
        )
      }
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

  // "This doesn't look like a revenue-share agreement": its own two buttons are the only
  // actions, so no footer. Same rule as Check uses to leave that screen.
  const notAgreement =
    checkMode === CheckMode.NOT_AGREEMENT && answers
      ? answers.people.value.length <= 1
      : false;
  if (stage === WizardStage.CHECK && answers)
    return frame(
      notAgreement ? null : (
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
        </>
      ),
      <>
        <WizardCheckStep
          answers={answers}
          onChange={(next) => {
            setError("");
            setAnswers(next);
          }}
          mode={checkMode}
          equalSplitGuessed={equalSplitGuessed}
          busy={busy}
          onUploadAgain={() => void uploadAgain()}
          onSetUpMyself={() => setCheckMode(CheckMode.MANUAL)}
          document={
            {
              documentId: created?.documentId ?? "",
              text: created?.documentText ?? "",
              provenance: {
                inputType:
                  mode === DocumentMode.UPLOAD &&
                  file?.name.toLowerCase().endsWith(".pdf")
                    ? "PDF"
                    : mode === DocumentMode.UPLOAD &&
                        file?.name.toLowerCase().endsWith(".docx")
                      ? "DOCX"
                      : "TEXT",
              },
              hasOriginal: mode === DocumentMode.UPLOAD && !!file,
            } satisfies DocumentRecord
          }
          originalUrl={
            created && mode === DocumentMode.UPLOAD
              ? originalDocumentUrl(workspaceBase(created.workspaceId), {
                  documentId: created.documentId,
                  hasOriginal: true,
                  text: created.documentText,
                })
              : undefined
          }
          fileName={
            mode === DocumentMode.UPLOAD && file
              ? file.name
              : "Pasted agreement"
          }
          sourceDocumentIds={
            created && sourceIdentityKnown
              ? { agreement: created.documentId, advance: created.documentId }
              : undefined
          }
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
          onClick={leavePeople}
        >
          Review and send
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
      <WizardSendStep
        answers={answers}
        error={error || undefined}
        currency={agreement?.value.details?.currency}
        document={
          mode === DocumentMode.UPLOAD && file
            ? {
                name: file.name,
                detail: formatFileSize(file.size),
              }
            : text.trim()
              ? {
                  name: "Pasted agreement",
                  detail: `${text.length.toLocaleString("en-US")} characters`,
                }
              : undefined
        }
        onChange={(next) => {
          setError("");
          setAnswers(next);
        }}
        onFixPeople={() => setStage(WizardStage.PEOPLE)}
      />,
    );

  if (stage === WizardStage.SENT && answers && agreement)
    return frame(
      <>
        <button type="button" className="text-button" onClick={onClose}>
          Done, I’ll share later
        </button>
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
            invitationId: p.invitationId,
            workspaceId: agreement.workspaceId,
            agreementId: agreement.id,
            userId: p.invitationId ? `pending:${p.invitationId}` : undefined,
            name: p.name,
            email: p.email ?? "",
            token: p.invitationId ? links[p.invitationId]?.token : undefined,
            expiresAt: p.invitationId
              ? links[p.invitationId]?.expiresAt
              : undefined,
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

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** One person now holds this invitation (and the trimmed name and email it was made for). */
function withInvitation(
  a: AgreementAnswers,
  personKey: string,
  invitationId: string,
  patch: Partial<PersonAnswer> = {},
): AgreementAnswers {
  return {
    ...a,
    people: {
      ...a.people,
      value: a.people.value.map((p) =>
        p.key === personKey ? { ...p, ...patch, invitationId } : p,
      ),
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
): ExtractedAnswers & { place?: StoredPlace } {
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
  const people = stored.answers.people.value.map((p) =>
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
    ...stored.answers,
    people: { ...stored.answers.people, value: people },
    questions: [],
  };
  // Answered questions are rebuilt as they were asked (before their answer was applied),
  // in the stored order. Local storage holds only question identifiers and selected
  // choices, so citations and closures stay tied to the current reading.
  const asked = questionsFor(
    { ...merged, fees: undefined, refunds: undefined },
    read.answers.questions,
  );
  let restored: AgreementAnswers = {
    ...merged,
    questions: restoreQuestions(
      stored.questions.map(({ id }) => ({ id })),
      [...asked, ...read.answers.questions],
    ),
  };
  for (const saved of stored.questions) {
    if (!saved.answeredChoiceId) continue;
    const question = restored.questions.find((item) => item.id === saved.id);
    const choice = question?.choices.find(
      (item) => item.id === saved.answeredChoiceId,
    );
    if (!question || !choice) continue;
    // Never replay an old choice onto later manual edits. It only remains answered
    // when the stored answers still equal the choice's effect; otherwise surface it
    // again for an explicit current decision.
    const applied = choice.apply(restored);
    if (applied === restored) continue;
    const stillMatches =
      JSON.stringify(applied.people) === JSON.stringify(restored.people) &&
      JSON.stringify(applied.advance) === JSON.stringify(restored.advance) &&
      JSON.stringify(applied.fees) === JSON.stringify(restored.fees) &&
      JSON.stringify(applied.refunds) === JSON.stringify(restored.refunds);
    if (!stillMatches) continue;
    restored = {
      ...restored,
      questions: restored.questions.map((item) =>
        item.id === question.id
          ? { ...item, answeredChoiceId: saved.answeredChoiceId }
          : item,
      ),
    };
  }
  return {
    ...read,
    answers: withDraftName(mergeQuestions(restored), agreement),
    place: stored.place,
  };
}

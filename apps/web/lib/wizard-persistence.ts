import type { AgreementAnswers, PersonAnswer, Question } from "./rules-answers";

/**
 * Everything the organizer set in the wizard on this device (split, advance, fees, refunds,
 * answered questions), kept per draft until it is sent or discarded. The server only stores
 * the document, name, dates and pending people before sending, so without this a reload or
 * a resumed draft would lose the rest. Browser storage can be missing or full; every call is
 * best effort. Invite links are never stored: answers carry no tokens, and people are copied
 * field by field so nothing else rides along.
 */
const VERSION = 1;

/** A question is stored by id and answer only; its choices are rebuilt on restore. */
export interface StoredQuestion {
  id: string;
  answeredChoiceId?: string;
}

export interface StoredAnswers {
  answers: Omit<AgreementAnswers, "questions">;
  questions: StoredQuestion[];
}

interface StoredDraft extends StoredAnswers {
  version: number;
}

export const draftAnswersKey = (workspaceId: string, agreementId: string) =>
  `fairshare:wizard-answers:v${VERSION}:${workspaceId}:${agreementId}`;

/**
 * The unversioned key earlier builds wrote: the answers flat, with answered choices (if any)
 * under `questionAnswers`. Read once, then replaced.
 */
const legacyKey = (workspaceId: string, agreementId: string) =>
  `fairshare:wizard-draft:${workspaceId}:${agreementId}`;

function storedPerson(p: PersonAnswer): PersonAnswer {
  return {
    key: p.key,
    name: p.name,
    ...(p.email !== undefined ? { email: p.email } : {}),
    ...(p.userId !== undefined ? { userId: p.userId } : {}),
    ...(p.invitationId !== undefined ? { invitationId: p.invitationId } : {}),
    basisPoints: p.basisPoints,
    isSelf: p.isSelf,
  };
}

export function saveDraftAnswers(
  workspaceId: string,
  agreementId: string,
  answers: AgreementAnswers,
) {
  try {
    const { questions, ...rest } = answers;
    const draft: StoredDraft = {
      version: VERSION,
      answers: {
        ...rest,
        people: { ...rest.people, value: rest.people.value.map(storedPerson) },
      },
      questions: questions.map((q) =>
        q.answeredChoiceId
          ? { id: q.id, answeredChoiceId: q.answeredChoiceId }
          : { id: q.id },
      ),
    };
    localStorage.setItem(
      draftAnswersKey(workspaceId, agreementId),
      JSON.stringify(draft),
    );
  } catch {
    // Private mode or blocked storage: resuming falls back to the document.
  }
}

const usable = (answers: unknown): answers is StoredAnswers["answers"] => {
  const a = answers as StoredAnswers["answers"] | null;
  return !!a && !!a.name && Array.isArray(a.people?.value);
};

export function loadDraftAnswers(
  workspaceId: string,
  agreementId: string,
): StoredAnswers | undefined {
  try {
    const raw = localStorage.getItem(draftAnswersKey(workspaceId, agreementId));
    if (raw) {
      const draft = JSON.parse(raw) as StoredDraft;
      if (draft?.version !== VERSION || !usable(draft.answers))
        return undefined;
      return {
        answers: draft.answers,
        questions: Array.isArray(draft.questions) ? draft.questions : [],
      };
    }
    const legacy = localStorage.getItem(legacyKey(workspaceId, agreementId));
    if (!legacy) return undefined;
    const {
      questions: _questions,
      questionAnswers,
      ...answers
    } = JSON.parse(legacy);
    return usable(answers)
      ? {
          answers,
          questions: Array.isArray(questionAnswers) ? questionAnswers : [],
        }
      : undefined;
  } catch {
    return undefined;
  }
}

export function clearDraftAnswers(workspaceId: string, agreementId: string) {
  try {
    localStorage.removeItem(draftAnswersKey(workspaceId, agreementId));
    localStorage.removeItem(legacyKey(workspaceId, agreementId));
  } catch {
    // Nothing to clear.
  }
}

/**
 * Stored questions matched back to live ones by id, in the stored order, keeping each
 * answer whose choice still exists. Questions that can't be rebuilt are dropped.
 */
export function restoreQuestions(
  stored: StoredQuestion[],
  candidates: Question[],
): Question[] {
  return stored.flatMap((s) => {
    const q = candidates.find((c) => c.id === s.id);
    if (!q) return [];
    const answered =
      s.answeredChoiceId &&
      q.choices.some((choice) => choice.id === s.answeredChoiceId)
        ? s.answeredChoiceId
        : undefined;
    return [{ ...q, answeredChoiceId: answered }];
  });
}

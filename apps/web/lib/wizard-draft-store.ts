import type { AgreementAnswers } from "./rules-answers";

/**
 * What the organizer set on Check this device, kept until the draft is sent. The server only
 * stores the document and pending people before sending, so without this a resumed draft
 * would lose its split. Browser storage can be missing; every call is best effort.
 */
interface StoredQuestionAnswer {
  id: string;
  answeredChoiceId?: string;
}
export type StoredAnswers = Omit<AgreementAnswers, "questions"> & {
  /** Choice metadata only: source questions and their closures are rebuilt on resume. */
  questionAnswers?: StoredQuestionAnswer[];
};

const key = (workspaceId: string, agreementId: string) =>
  `fairshare:wizard-draft:${workspaceId}:${agreementId}`;

export function saveDraftAnswers(
  workspaceId: string,
  agreementId: string,
  answers: AgreementAnswers,
) {
  try {
    const { questions, ...stored } = answers;
    localStorage.setItem(
      key(workspaceId, agreementId),
      JSON.stringify({
        ...stored,
        questionAnswers: questions.map(({ id, answeredChoiceId }) => ({
          id,
          ...(answeredChoiceId ? { answeredChoiceId } : {}),
        })),
      } satisfies StoredAnswers),
    );
  } catch {
    // Private mode or blocked storage: resuming falls back to the document.
  }
}

export function loadDraftAnswers(
  workspaceId: string,
  agreementId: string,
): StoredAnswers | undefined {
  try {
    const raw = localStorage.getItem(key(workspaceId, agreementId));
    if (!raw) return undefined;
    const value = JSON.parse(raw) as StoredAnswers;
    return value && Array.isArray(value.people?.value) && value.name
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

export function clearDraftAnswers(workspaceId: string, agreementId: string) {
  try {
    localStorage.removeItem(key(workspaceId, agreementId));
  } catch {
    // Nothing to clear.
  }
}

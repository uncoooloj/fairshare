import {
  AnswerSource,
  FeeChoice,
  RefundChoice,
  type AdvanceAnswer,
  type AgreementAnswers,
  type Cited,
  type PersonAnswer,
  type Question,
} from "./rules-answers";

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

function storedCited<T>(answer: Cited<T>): Cited<T> {
  return {
    value: answer.value,
    source: answer.source,
    ...(answer.clause !== undefined ? { clause: answer.clause } : {}),
    ...(answer.quote !== undefined ? { quote: answer.quote } : {}),
  };
}

function storedAnswers(answers: AgreementAnswers): StoredAnswers["answers"] {
  const stored: StoredAnswers["answers"] = {
    name: storedCited(answers.name),
    people: {
      ...storedCited(answers.people),
      value: answers.people.value.map(storedPerson),
    },
  };
  if (answers.effectiveFrom)
    stored.effectiveFrom = storedCited(answers.effectiveFrom);
  if (answers.effectiveTo)
    stored.effectiveTo = storedCited(answers.effectiveTo);
  if (answers.advance) stored.advance = storedCited(answers.advance);
  if (answers.fees) stored.fees = storedCited(answers.fees);
  if (answers.refunds) stored.refunds = storedCited(answers.refunds);
  return stored;
}

function storedQuestions(value: unknown): StoredQuestion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string") return [];
    return [
      {
        id: item.id,
        ...(typeof item.answeredChoiceId === "string"
          ? { answeredChoiceId: item.answeredChoiceId }
          : {}),
      },
    ];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function legacyCited<T>(
  value: unknown,
  validValue: (candidate: unknown) => candidate is T,
): Cited<T> | undefined {
  if (!isRecord(value) || !validValue(value.value)) return undefined;
  if (
    value.source !== AnswerSource.DOCUMENT &&
    value.source !== AnswerSource.PERSON
  )
    return undefined;
  return {
    value: value.value,
    source: value.source,
    ...(typeof value.clause === "string" ? { clause: value.clause } : {}),
    ...(typeof value.quote === "string" ? { quote: value.quote } : {}),
  };
}

const isString = (value: unknown): value is string => typeof value === "string";
const isNullableString = (value: unknown): value is string | null =>
  typeof value === "string" || value === null;

function legacyPerson(value: unknown): PersonAnswer | undefined {
  if (
    !isRecord(value) ||
    !isString(value.key) ||
    !isString(value.name) ||
    typeof value.basisPoints !== "number" ||
    !Number.isFinite(value.basisPoints) ||
    typeof value.isSelf !== "boolean"
  )
    return undefined;
  return {
    key: value.key,
    name: value.name,
    ...(isString(value.email) ? { email: value.email } : {}),
    ...(isString(value.userId) ? { userId: value.userId } : {}),
    ...(isString(value.invitationId)
      ? { invitationId: value.invitationId }
      : {}),
    basisPoints: value.basisPoints,
    isSelf: value.isSelf,
  };
}

function legacyAnswers(value: unknown): StoredAnswers["answers"] | undefined {
  if (!isRecord(value)) return undefined;
  const name = legacyCited(value.name, isString);
  const people = legacyCited(value.people, Array.isArray);
  if (!name || !people) return undefined;
  const stored: StoredAnswers["answers"] = {
    name,
    people: {
      ...people,
      value: people.value.flatMap((person) => {
        const sanitized = legacyPerson(person);
        return sanitized ? [sanitized] : [];
      }),
    },
  };
  const effectiveFrom = legacyCited(value.effectiveFrom, isString);
  const effectiveTo = legacyCited(value.effectiveTo, isNullableString);
  const advance = legacyCited(
    value.advance,
    (candidate): candidate is AdvanceAnswer =>
      isRecord(candidate) &&
      isString(candidate.recipientKey) &&
      typeof candidate.amountCents === "number" &&
      Number.isFinite(candidate.amountCents) &&
      (candidate.alreadyPaid === undefined ||
        typeof candidate.alreadyPaid === "boolean"),
  );
  const fees = legacyCited(
    value.fees,
    (candidate): candidate is FeeChoice =>
      candidate === FeeChoice.BEFORE_SPLIT ||
      candidate === FeeChoice.ORGANIZER_SHARE,
  );
  const refunds = legacyCited(
    value.refunds,
    (candidate): candidate is RefundChoice =>
      candidate === RefundChoice.SPLIT || candidate === RefundChoice.ADVANCE,
  );
  if (effectiveFrom) stored.effectiveFrom = effectiveFrom;
  if (effectiveTo) stored.effectiveTo = effectiveTo;
  if (advance) stored.advance = advance;
  if (fees) stored.fees = fees;
  if (refunds) stored.refunds = refunds;
  return stored;
}

function writeDraft(
  workspaceId: string,
  agreementId: string,
  draft: StoredDraft,
): boolean {
  try {
    localStorage.setItem(
      draftAnswersKey(workspaceId, agreementId),
      JSON.stringify(draft),
    );
    return true;
  } catch {
    return false;
  }
}

export function saveDraftAnswers(
  workspaceId: string,
  agreementId: string,
  answers: AgreementAnswers,
) {
  writeDraft(workspaceId, agreementId, {
    version: VERSION,
    answers: storedAnswers(answers),
    questions: storedQuestions(answers.questions),
  });
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
    const parsed = JSON.parse(legacy);
    const answers = legacyAnswers(parsed);
    if (!usable(answers)) return undefined;
    const draft = {
      version: VERSION,
      answers,
      questions: storedQuestions(
        isRecord(parsed) ? parsed.questionAnswers : undefined,
      ),
    };
    if (writeDraft(workspaceId, agreementId, draft)) {
      try {
        localStorage.removeItem(legacyKey(workspaceId, agreementId));
      } catch {
        // The migrated copy is safe; leaving the old key is harmless.
      }
    }
    return draft;
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
 * answer whose choice still exists. Current candidates absent from storage follow in their
 * current order, so a newer extraction cannot silently lose a new ambiguity.
 */
export function restoreQuestions(
  stored: StoredQuestion[],
  candidates: Question[],
): Question[] {
  const restored = stored.flatMap((s) => {
    const q = candidates.find((c) => c.id === s.id);
    if (!q) return [];
    const answered =
      s.answeredChoiceId &&
      q.choices.some((choice) => choice.id === s.answeredChoiceId)
        ? s.answeredChoiceId
        : undefined;
    return [{ ...q, answeredChoiceId: answered }];
  });
  const restoredIds = new Set(restored.map((q) => q.id));
  return [
    ...restored,
    ...candidates.flatMap((q) => {
      if (restoredIds.has(q.id)) return [];
      restoredIds.add(q.id);
      return [q];
    }),
  ];
}

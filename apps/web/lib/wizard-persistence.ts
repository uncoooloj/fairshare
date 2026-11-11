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
 * best effort. Answers carry no tokens, and people are copied field by field so nothing else
 * rides along; invite links live in their own store below, written once when they're made.
 */
const VERSION = 1;

/** A question is stored by id and answer only; its choices are rebuilt on restore. */
export interface StoredQuestion {
  id: string;
  answeredChoiceId?: string;
}

/** Where the organizer stopped. The stage is the wizard's own enum value, checked on resume. */
export interface StoredPlace {
  stage: string;
  questionIndex: number;
}

export interface StoredAnswers {
  answers: Omit<AgreementAnswers, "questions">;
  questions: StoredQuestion[];
  place?: StoredPlace;
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

function storedAdvance(answer: Cited<AdvanceAnswer>): Cited<AdvanceAnswer> {
  return {
    ...storedCited(answer),
    value: {
      recipientKey: answer.value.recipientKey,
      amountCents: answer.value.amountCents,
      ...(answer.value.alreadyPaid !== undefined
        ? { alreadyPaid: answer.value.alreadyPaid }
        : {}),
    },
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
  if (answers.advance) stored.advance = storedAdvance(answers.advance);
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
  if (advance) stored.advance = storedAdvance(advance);
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

function storedPlace(value: unknown): StoredPlace | undefined {
  if (!isRecord(value) || typeof value.stage !== "string") return undefined;
  const index = value.questionIndex;
  return {
    stage: value.stage,
    questionIndex:
      typeof index === "number" && Number.isInteger(index) && index >= 0
        ? index
        : 0,
  };
}

export function saveDraftAnswers(
  workspaceId: string,
  agreementId: string,
  answers: AgreementAnswers,
  place?: StoredPlace,
) {
  writeDraft(workspaceId, agreementId, {
    version: VERSION,
    answers: storedAnswers(answers),
    questions: storedQuestions(answers.questions),
    ...(place ? { place: storedPlace(place) } : {}),
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
      const place = storedPlace(draft.place);
      return {
        answers: draft.answers,
        questions: Array.isArray(draft.questions) ? draft.questions : [],
        ...(place ? { place } : {}),
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
  const seenStoredIds = new Set<string>();
  const restored = stored.flatMap((s) => {
    if (seenStoredIds.has(s.id)) return [];
    seenStoredIds.add(s.id);
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

/**
 * Invite links made for a draft, by invitation id. The server keeps only a hash, so this
 * device is the one place a link can be shown again. A cached token must retain the expiry
 * returned when it was issued; legacy token-only values are deliberately unusable. Kept after
 * sending; writes merge so a link is never made twice for one invitation.
 */
export const inviteLinksKey = (workspaceId: string, agreementId: string) =>
  `fairshare:invite-links:v1:${workspaceId}:${agreementId}`;

export interface StoredInviteToken {
  token: string;
  expiresAt: number;
}

/** Drops malformed and expired bearer tokens without treating legacy token-only values as live. */
export function forgetStaleInviteTokens(
  links: Record<string, StoredInviteToken>,
  now = Date.now(),
): Record<string, StoredInviteToken> {
  return Object.fromEntries(
    Object.entries(links).filter(
      (entry): entry is [string, StoredInviteToken] =>
        typeof entry[1]?.token === "string" &&
        Number.isFinite(entry[1]?.expiresAt) &&
        entry[1].expiresAt > now,
    ),
  );
}

function storedInviteTokens(value: unknown): Record<string, StoredInviteToken> {
  if (!isRecord(value)) return {};
  return forgetStaleInviteTokens(
    Object.fromEntries(
      Object.entries(value).flatMap(([id, entry]) =>
        isRecord(entry) &&
        typeof entry.token === "string" &&
        typeof entry.expiresAt === "number"
          ? [[id, { token: entry.token, expiresAt: entry.expiresAt }]]
          : [],
      ),
    ),
  );
}

export function loadInviteLinks(
  workspaceId: string,
  agreementId: string,
): Record<string, string> {
  try {
    const parsed = loadStoredInviteTokens(workspaceId, agreementId);
    return Object.fromEntries(
      Object.entries(parsed).map(([id, entry]) => [id, entry.token]),
    );
  } catch {
    return {};
  }
}

export function loadStoredInviteTokens(
  workspaceId: string,
  agreementId: string,
): Record<string, StoredInviteToken> {
  try {
    return storedInviteTokens(
      JSON.parse(
        localStorage.getItem(inviteLinksKey(workspaceId, agreementId)) ?? "{}",
      ),
    );
  } catch {
    return {};
  }
}

export function saveInviteLinks(
  workspaceId: string,
  agreementId: string,
  links: Record<string, StoredInviteToken>,
) {
  try {
    const existing = storedInviteTokens(
      JSON.parse(
        localStorage.getItem(inviteLinksKey(workspaceId, agreementId)) ?? "{}",
      ),
    );
    localStorage.setItem(
      inviteLinksKey(workspaceId, agreementId),
      JSON.stringify({
        ...existing,
        ...forgetStaleInviteTokens(links),
      }),
    );
  } catch {
    // Storage full or blocked: the Sent screen still has the link in memory.
  }
}

/** Replaces the cached set after the agreement tells us which pending seats still exist. */
export function replaceInviteLinks(
  workspaceId: string,
  agreementId: string,
  links: Record<string, StoredInviteToken>,
) {
  try {
    const live = forgetStaleInviteTokens(links);
    if (Object.keys(live).length)
      localStorage.setItem(
        inviteLinksKey(workspaceId, agreementId),
        JSON.stringify(live),
      );
    else localStorage.removeItem(inviteLinksKey(workspaceId, agreementId));
  } catch {
    // Storage can be blocked; callers keep their in-memory cache.
  }
}

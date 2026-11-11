import type { AgreementMember } from "./agreement-api";
import type { Agreement, Rules, Source } from "./model";
import {
  AnswerSource,
  FeeChoice,
  RefundChoice,
  toRules,
  type AgreementAnswers,
  type Cited,
  type PersonAnswer,
} from "./rules-answers";

const SOURCE_CLAUSE = "SOURCE_CLAUSE";
const ORGANIZER_SHARE = "ORGANIZER_SHARE";

/** A value backed by a verbatim clause keeps its citation; anything else was set by a person. */
function cited<T>(value: T, source: Source | undefined): Cited<T> {
  if (source?.origin !== SOURCE_CLAUSE)
    return { value, source: AnswerSource.PERSON };
  return {
    value,
    source: AnswerSource.DOCUMENT,
    clause: source.clause,
    quote: source.excerpt,
  };
}

/** The refunds choice lives only in the summary sentence `toRules` writes. */
function refundsFrom(excerpt: string): RefundChoice | undefined {
  if (/Refunds come off the split\./.test(excerpt)) return RefundChoice.SPLIT;
  if (/Refunds come off [^.]*advance\./.test(excerpt))
    return RefundChoice.ADVANCE;
  return undefined;
}

/**
 * The answers a sent agreement already holds, so the organizer revises from what everyone
 * saw rather than from a blank wizard. People are the agreement's members in share order;
 * someone who hasn't joined keeps their invitation, so `toRules` names the same seat.
 */
export function answersFromRules(
  agreement: Agreement,
  rules: Rules,
  selfId: string,
): AgreementAnswers {
  const members = agreement.value.members as AgreementMember[];
  const people: PersonAnswer[] = rules.shares.map((share) => {
    const member = members.find((m) => m.userId === share.userId);
    const pending = member?.pending;
    return {
      key: share.userId,
      name: member?.displayName ?? "Former member",
      basisPoints: share.basisPoints,
      isSelf: share.userId === selfId,
      ...(pending
        ? { invitationId: pending.invitationId, email: pending.email }
        : { userId: share.userId }),
    };
  });
  const details = agreement.value.details;
  const answers: AgreementAnswers = {
    name: { value: agreement.value.name, source: AnswerSource.PERSON },
    people: cited(people, rules.source),
    fees: cited(feeChoiceOf(rules), rules.source),
    ...(rules.feeBearerId
      ? { feeBearerId: rules.feeBearerId, feeBearerChoice: "KEEP" as const }
      : {}),
    questions: [],
  };
  if (details?.effectiveFrom)
    answers.effectiveFrom = {
      value: details.effectiveFrom,
      source: AnswerSource.PERSON,
    };
  if (details?.effectiveTo !== undefined)
    answers.effectiveTo = {
      value: details.effectiveTo,
      source: AnswerSource.PERSON,
    };
  if (rules.advance)
    answers.advance = cited(
      {
        recipientKey: rules.advance.recipientId,
        amountCents: rules.advance.amountCents,
        alreadyPaid: rules.advance.verified,
      },
      rules.advance.source,
    );
  const refunds = refundsFrom(rules.source.excerpt);
  if (refunds)
    answers.refunds = { value: refunds, source: AnswerSource.PERSON };
  return answers;
}

/** The advance `toRules` compares against: same amount and person keeps its ID (and what
 * was already paid back); any change gets a new ID, carrying the repaid amount over. */
export function priorAdvanceOf(rules: Rules) {
  const advance = rules.advance;
  return advance
    ? {
        id: advance.id,
        amountCents: advance.amountCents,
        recipientId: advance.recipientId,
      }
    : undefined;
}

/** The fee choice the prior rules hold. */
export function feeChoiceOf(rules: Rules): FeeChoice {
  return rules.feePolicy === ORGANIZER_SHARE
    ? FeeChoice.ORGANIZER_SHARE
    : FeeChoice.BEFORE_SPLIT;
}

/**
 * The rules a revise sends. Same as `toRules`, with the advance compared against the prior
 * one, and one exception: an unchanged fee choice keeps its actual bearer, even if the
 * organizer role has since moved to someone else. Choosing organizer-paid fees again
 * explicitly moves the fees to the current organizer.
 */
export function revisedRules(
  answers: AgreementAnswers,
  prior: Rules,
  ctx: { organizerId: string; documentText?: string },
): Rules {
  const next = toRules(answers, {
    documentId: prior.source.documentId,
    organizerId: ctx.organizerId,
    priorAdvance: priorAdvanceOf(prior),
    documentText: ctx.documentText,
  });
  if (
    next.feePolicy === ORGANIZER_SHARE &&
    answers.feeBearerChoice === "KEEP" &&
    prior.feeBearerId
  )
    next.feeBearerId = prior.feeBearerId;
  return next;
}

/** The rules a revision starts from: the latest proposal, which is what people last saw. */
export function revisableRules(agreement: Agreement): Rules | undefined {
  return agreement.value.versions.at(-1)?.rules;
}

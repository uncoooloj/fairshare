import {
  createCollaboration,
  proposeVersion,
  previewVersion,
  DomainError,
  FeePolicy,
  MemberRole,
  RuleOrigin,
  pendingUserId,
  type Member as DomainMember,
  type Rules as DomainRules,
} from "../../../packages/domain/src/index";
import type { Rules } from "./model";
import { formatMoneyHeadline } from "./preferences";

/** Where a value came from. */
export enum AnswerSource {
  DOCUMENT = "document",
  PERSON = "person",
}
export interface Cited<T> {
  value: T;
  source: AnswerSource;
  clause?: string;
  quote?: string;
}
export interface PersonAnswer {
  key: string;
  name: string;
  email?: string;
  userId?: string;
  invitationId?: string;
  basisPoints: number;
  isSelf: boolean;
}
export interface AdvanceAnswer {
  recipientKey: string;
  amountCents: number;
  alreadyPaid?: boolean;
}
/** Values match the domain FeePolicy. */
export enum FeeChoice {
  BEFORE_SPLIT = "BEFORE_SPLIT",
  ORGANIZER_SHARE = "ORGANIZER_SHARE",
}
/** Stored in the clarification text only (the engine has no refund rule). */
export enum RefundChoice {
  SPLIT = "SPLIT",
  ADVANCE = "ADVANCE",
}
export interface QuestionChoice {
  id: string;
  label: string;
  explanation: string;
  apply(a: AgreementAnswers): AgreementAnswers;
}
export interface Question {
  id: string;
  text: string;
  quote?: string;
  clause?: string;
  choices: QuestionChoice[];
  answeredChoiceId?: string;
}
export interface AgreementAnswers {
  name: Cited<string>;
  effectiveFrom?: Cited<string>;
  effectiveTo?: Cited<string | null>;
  /** Includes the organizer (isSelf). */
  people: Cited<PersonAnswer[]>;
  advance?: Cited<AdvanceAnswer>;
  /** undefined = not stated, becomes a Question. */
  fees?: Cited<FeeChoice>;
  /** The actual person whose share pays organizer fees in the prior rules. */
  feeBearerId?: string;
  /** A revise either keeps that person or explicitly moves fees to today's organizer. */
  feeBearerChoice?: "KEEP" | "ORGANIZER";
  refunds?: Cited<RefundChoice>;
  questions: Question[];
}

export const TOTAL_BASIS_POINTS = 10000;
const EXCERPT_LIMIT = 10000;
const EXAMPLE_AT = "2000-01-01T00:00:00.000Z";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emptyAnswers(self: {
  name: string;
  userId: string;
}): AgreementAnswers {
  return {
    name: { value: "", source: AnswerSource.PERSON },
    people: {
      value: [
        {
          key: self.userId,
          name: self.name,
          userId: self.userId,
          basisPoints: TOTAL_BASIS_POINTS,
          isSelf: true,
        },
      ],
      source: AnswerSource.PERSON,
    },
    questions: [],
  };
}

export function totalBasisPoints(people: PersonAnswer[]): number {
  return people.reduce((sum, p) => sum + p.basisPoints, 0);
}

/** Integer largest-remainder distribution of `total` by `weights`; ties go to the earlier row. */
function distribute(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  const rows = weights.map((w, index) => {
    const exact = sum > 0 ? (total * w) / sum : total / weights.length;
    const floor = Math.floor(exact);
    return { index, floor, remainder: exact - floor };
  });
  let left = total - rows.reduce((s, r) => s + r.floor, 0);
  const order = [...rows].sort(
    (a, b) => b.remainder - a.remainder || a.index - b.index,
  );
  for (const row of order) {
    if (left <= 0) break;
    row.floor++;
    left--;
  }
  return rows.map((r) => r.floor);
}

/**
 * Linked sliders: set one person, spread the rest over the others by their current
 * shares (equally if they were all 0). Integers, never negative.
 *
 * `heldKeys` are people already set by hand: they never move, so only the rest absorb the
 * change. With nobody held it always totals 10000; when everyone else is held nothing else
 * moves and the total can be off, for the caller to show. `step` (100 = whole percents)
 * keeps the people who move on that grid whenever what is left divides by it.
 */
export function rebalance(
  people: PersonAnswer[],
  changedKey: string,
  basisPoints: number,
  heldKeys: readonly string[] = [],
  step = 1,
): PersonAnswer[] {
  const changed = people.find((p) => p.key === changedKey);
  if (!changed) return people.map((p) => ({ ...p }));
  if (people.length === 1)
    return [{ ...changed, basisPoints: TOTAL_BASIS_POINTS }];
  const value = Math.min(
    TOTAL_BASIS_POINTS,
    Math.max(0, Math.round(Number.isFinite(basisPoints) ? basisPoints : 0)),
  );
  const held = people.filter(
    (p) => p.key !== changedKey && heldKeys.includes(p.key),
  );
  const free = people.filter(
    (p) => p.key !== changedKey && !heldKeys.includes(p.key),
  );
  const left = Math.max(0, TOTAL_BASIS_POINTS - value - totalBasisPoints(held));
  const unit = step > 1 && left % step === 0 ? step : 1;
  const spread = distribute(
    left / unit,
    free.map((p) => Math.max(0, p.basisPoints)),
  );
  const next = new Map(free.map((p, i) => [p.key, spread[i] * unit]));
  return people.map((p) => ({
    ...p,
    basisPoints:
      p.key === changedKey ? value : (next.get(p.key) ?? p.basisPoints),
  }));
}

/** The id the API knows this person by, or undefined if they can't be referenced yet. */
function ruleUserId(p: PersonAnswer, organizerId?: string): string | undefined {
  if (p.userId) return p.userId;
  if (p.isSelf && organizerId) return organizerId;
  if (p.invitationId) return pendingUserId(p.invitationId);
  return undefined;
}

function organizerOf(people: PersonAnswer[]): PersonAnswer | undefined {
  return people.find((p) => p.isSelf) ?? people[0];
}

function firstName(p: PersonAnswer | undefined) {
  return p?.name.trim() || "Someone";
}

function percent(basisPoints: number) {
  const value = basisPoints / 100;
  return Number.isInteger(value) ? String(value) : String(+value.toFixed(2));
}

function listNames(names: string[]) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
/** "2026-10-01" → "Oct 1, 2026"; calendar dates, no time zone shift. */
function calendarDay(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}, ${m[1]}`;
}

function datesLine(a: AgreementAnswers): string | undefined {
  const from = a.effectiveFrom?.value;
  const to = a.effectiveTo?.value;
  if (from && to) return `${calendarDay(from)} to ${calendarDay(to)}`;
  if (from) return `From ${calendarDay(from)}, no end date`;
  if (to) return `Until ${calendarDay(to)}`;
  return undefined;
}

function advanceRecipient(a: AgreementAnswers) {
  const key = a.advance?.value.recipientKey;
  return a.people.value.find((p) => p.key === key);
}

function splitLine(a: AgreementAnswers): string {
  const people = a.people.value;
  const split = people.map((p) => percent(p.basisPoints)).join(" / ");
  const advance = a.advance?.value;
  if (advance) {
    const who = firstName(advanceRecipient(a));
    const rest =
      people.length === 1
        ? `Then the rest goes to ${firstName(people[0])}.`
        : `Then the rest is split ${split}.`;
    return `${who} is paid back ${formatMoneyHeadline(advance.amountCents)} first. ${rest}`;
  }
  if (people.length === 1) return `All of it goes to ${firstName(people[0])}.`;
  return `The money is split ${split}.`;
}

function feesLine(a: AgreementAnswers): string | undefined {
  switch (a.fees?.value) {
    case FeeChoice.BEFORE_SPLIT:
      return "PayPal fees come off the top.";
    case FeeChoice.ORGANIZER_SHARE:
      return `${firstName(
        a.people.value.find((p) => p.key === a.feeBearerId) ??
          organizerOf(a.people.value),
      )} covers the PayPal fees.`;
    default:
      return undefined;
  }
}

function refundsLine(a: AgreementAnswers): string | undefined {
  switch (a.refunds?.value) {
    case RefundChoice.SPLIT:
      return "Refund preference recorded for organizer review: shared split.";
    case RefundChoice.ADVANCE:
      return a.advance
        ? `Refund preference recorded for organizer review: ${firstName(advanceRecipient(a))}'s advance.`
        : "Refund preference recorded for organizer review: advance.";
    default:
      return undefined;
  }
}

function sendingLine(a: AgreementAnswers): string | undefined {
  const others = a.people.value.filter((p) => !p.isSelf);
  if (!others.length) return undefined;
  return `Sending to ${listNames(
    others.map((p) =>
      p.email?.trim() ? `${firstName(p)} (${p.email.trim()})` : firstName(p),
    ),
  )}`;
}

/** The Send screen summary, one plain sentence per line. */
export function summarySentences(a: AgreementAnswers): string[] {
  const name = a.name.value.trim();
  const dates = datesLine(a);
  const heading = [name, dates].filter(Boolean).join(" · ");
  return [
    heading,
    splitLine(a),
    feesLine(a),
    refundsLine(a),
    sendingLine(a),
  ].filter((line): line is string => !!line);
}

function questionReason(q: Question): string {
  const id = q.id.toLowerCase();
  if (id.includes("refund")) return "Answer the refunds question";
  if (id.includes("fee")) return "Answer the fees question";
  return `Answer "${q.text.trim()}"`;
}

/** Why the agreement can't be sent yet, as plain sentences. Empty means ready. */
export function blockingReasons(a: AgreementAnswers): string[] {
  const reasons: string[] = [];
  const people = a.people.value;
  if (!a.name.value.trim()) reasons.push("Give the agreement a name");
  if (people.some((p) => !p.name.trim())) reasons.push("Add everyone's name");
  if (!people.length || totalBasisPoints(people) !== TOTAL_BASIS_POINTS)
    reasons.push("Make the split add up to 100%");
  const unanswered = a.questions.filter((q) => !q.answeredChoiceId);
  for (const q of unanswered) reasons.push(questionReason(q));
  if (!a.fees && !unanswered.some((q) => q.id.toLowerCase().includes("fee")))
    reasons.push("Tell us who covers the PayPal fees");
  if (a.advance) {
    const recipient = advanceRecipient(a);
    const amount = formatMoneyHeadline(a.advance.value.amountCents);
    if (!recipient) reasons.push("Choose who paid upfront");
    else if (a.advance.value.alreadyPaid === undefined)
      reasons.push(`Tell us if ${firstName(recipient)} has paid the ${amount}`);
    else if (!a.advance.value.alreadyPaid)
      reasons.push(
        `${firstName(recipient)} needs to have paid the ${amount} before you send`,
      );
  }
  for (const p of people) {
    if (p.isSelf || p.userId || p.invitationId) continue;
    const email = p.email?.trim();
    if (!email) reasons.push(`Add ${firstName(p)}'s email`);
    else if (!EMAIL.test(email)) reasons.push(`Check ${firstName(p)}'s email`);
  }
  return [...new Set(reasons)];
}

function summaryExcerpt(a: AgreementAnswers) {
  const text = summarySentences(a)
    .filter((line) => !line.startsWith("Sending to"))
    .join(" ")
    .trim();
  return (text || "Agreement set up by the organizer.").slice(0, EXCERPT_LIMIT);
}

function verbatim(excerpt: string, documentText?: string) {
  return !!documentText && !!excerpt && documentText.includes(excerpt);
}

function bounded(value: string | undefined, fallback: string) {
  return (value?.trim() || fallback).slice(0, EXCERPT_LIMIT);
}

interface RulesContext {
  documentId: string;
  organizerId: string;
  priorAdvance?: { id: string; amountCents: number; recipientId: string };
  /** Plain document text, used to decide whether an excerpt is a real quote. */
  documentText?: string;
}

function buildRules(
  a: AgreementAnswers,
  ids: Map<string, string>,
  ctx: RulesContext,
  advanceId: (amountCents: number, recipientId: string) => string,
): DomainRules {
  const name = bounded(a.name.value, "Agreement");
  const excerpt = summaryExcerpt(a);
  const source = {
    origin: verbatim(excerpt, ctx.documentText)
      ? RuleOrigin.SOURCE_CLAUSE
      : RuleOrigin.HUMAN_PROPOSAL,
    documentId: ctx.documentId,
    clause: name,
    excerpt,
  };
  const feePolicy =
    a.fees?.value === FeeChoice.ORGANIZER_SHARE
      ? FeePolicy.ORGANIZER_SHARE
      : FeePolicy.BEFORE_SPLIT;
  const rules: DomainRules = {
    currency: "USD",
    shares: a.people.value.map((p) => ({
      userId: ids.get(p.key)!,
      basisPoints: p.basisPoints,
    })),
    feePolicy,
    ...(feePolicy === FeePolicy.ORGANIZER_SHARE
      ? { feeBearerId: ctx.organizerId }
      : {}),
    source,
    unresolvedQuestions: a.questions
      .filter((q) => !q.answeredChoiceId)
      .map((q) => q.text.trim())
      .filter(Boolean),
  };
  if (a.advance) {
    const recipient = advanceRecipient(a);
    const recipientId = recipient && ids.get(recipient.key);
    if (!recipientId) throw new Error("Choose who paid upfront");
    const amountCents = a.advance.value.amountCents;
    const quote = a.advance.quote?.trim();
    const quoted = !!quote && verbatim(quote, ctx.documentText);
    rules.advance = {
      id: advanceId(amountCents, recipientId),
      recipientId,
      amountCents,
      verified: a.advance.value.alreadyPaid === true,
      source: {
        origin: quoted ? RuleOrigin.SOURCE_CLAUSE : RuleOrigin.HUMAN_PROPOSAL,
        documentId: ctx.documentId,
        clause: bounded(a.advance.clause, name),
        excerpt: quoted
          ? quote!.slice(0, EXCERPT_LIMIT)
          : `${firstName(recipient)} put in ${formatMoneyHeadline(amountCents)} upfront and is paid back first.`,
      },
    };
  }
  return rules;
}

/** The rules the API stores, with every hidden field filled in. Throws if someone in
 * the split can't be referenced yet (no account and no invitation). */
export function toRules(a: AgreementAnswers, ctx: RulesContext): Rules {
  const ids = new Map<string, string>();
  for (const p of a.people.value) {
    const id = ruleUserId(p, ctx.organizerId);
    if (!id) throw new Error(`Add ${firstName(p)}'s email`);
    ids.set(p.key, id);
  }
  const prior = ctx.priorAdvance;
  return buildRules(a, ids, ctx, (amountCents, recipientId) =>
    prior &&
    prior.amountCents === amountCents &&
    prior.recipientId === recipientId
      ? prior.id
      : crypto.randomUUID(),
  ) as Rules;
}

/** Dollars each person gets from one payment, computed by the real settlement engine.
 * Returns [] while the answers can't form valid rules (e.g. the split isn't 100%). */
export function exampleSplit(
  a: AgreementAnswers,
  grossCents: number,
  feeCents = 0,
): { key: string; name: string; cents: number }[] {
  const people = a.people.value;
  const organizer = organizerOf(people);
  if (!organizer || (a.advance && !advanceRecipient(a))) return [];
  const ids = new Map(people.map((p, i) => [p.key, `person-${i}`]));
  const organizerId = ids.get(organizer.key)!;
  const members: DomainMember[] = people.map((p) => ({
    userId: ids.get(p.key)!,
    displayName: firstName(p),
    role: p === organizer ? MemberRole.ORGANIZER : MemberRole.COLLABORATOR,
  }));
  try {
    const rules = buildRules(
      { ...a, questions: [] },
      ids,
      { documentId: "example", organizerId },
      () => "example-advance",
    );
    const scratch = createCollaboration(
      { id: "example", name: "Example", members },
      organizerId,
      EXAMPLE_AT,
    );
    const proposed = proposeVersion(scratch, rules, organizerId, EXAMPLE_AT);
    const preview = previewVersion(
      proposed,
      proposed.versions.at(-1)!.id,
      { grossCents, feeCents },
      organizerId,
    );
    const byId = new Map(preview.allocations.map((x) => [x.userId, x]));
    return people.map((p) => ({
      key: p.key,
      name: p.name,
      cents: byId.get(ids.get(p.key)!)?.totalCents ?? 0,
    }));
  } catch (error) {
    if (error instanceof DomainError) return [];
    throw error;
  }
}

import {
  createCollaboration,
  proposeVersion,
  previewVersion,
  FeePolicy,
  DomainError,
  type Member as DomainMember,
  type AgreementVersion,
  type AllocationPreview,
  type Rules as DomainRules,
} from "../../../packages/domain/src/index";
import { parseShare, type Agreement, type Member, type Rules } from "./model";

/** Mirrors ExtractionSection in @fairshare/contract-ai (server-only package). */
export enum RulesSection {
  SPLIT = "SPLIT",
  ADVANCE = "ADVANCE",
  FEES = "FEES",
  REFUNDS = "REFUNDS",
  TERM = "TERM",
  PEOPLE = "PEOPLE",
}
export enum DraftStatus {
  /** Confident: show what the document says, quote included, and ask the human to confirm. */
  SHOWN = "SHOWN",
  /** Ask the human. A hint quote or AI question may be attached. */
  ASK = "ASK",
}
export enum AskReason {
  /** The document does not say, or nothing could be read. */
  NOT_STATED = "NOT_STATED",
  /** The reading raised a question about it. */
  QUESTION = "QUESTION",
  UNMATCHED_NAME = "UNMATCHED_NAME",
  SHARES_NOT_100 = "SHARES_NOT_100",
  CONFLICT = "CONFLICT",
  /** The document says something the rules cannot express (e.g. an advance that is not paid back). */
  NOT_SUPPORTED = "NOT_SUPPORTED",
}
export enum UnmatchedReason {
  NO_MEMBER = "NO_MEMBER",
  SEVERAL_MEMBERS = "SEVERAL_MEMBERS",
}
/** Mirrors RefundStep in @fairshare/contract-ai. Display only; Rules has no refund field. */
export enum RefundStep {
  BEFORE_SPLIT = "BEFORE_SPLIT",
  FROM_PARTY_SHARE = "FROM_PARTY_SHARE",
}
enum FactKind {
  SHARE = "SHARE",
  ADVANCE = "ADVANCE",
  FEES = "FEES",
  REFUNDS = "REFUNDS",
  TERM = "TERM",
  PERSON = "PERSON",
}
enum TermBoundary {
  START = "START",
  END = "END",
}
const READ = "READ";
const TOPIC_SECTION: Record<string, RulesSection> = {
  SPLIT: RulesSection.SPLIT,
  ADVANCE: RulesSection.ADVANCE,
  FEES: RulesSection.FEES,
};

/** A document name tied to a member, or null while people are not set up yet (upload-first). */
export interface NamedPerson {
  name: string;
  userId: string | null;
}
export interface SplitValue {
  shares: (NamedPerson & { basisPoints: number; percent: string })[];
}
export interface AdvanceValue {
  recipient: NamedPerson;
  amountCents: number;
  recoupedBeforeSplit: true;
  /** The document never proves the advance was paid. */
  verified: false;
}
export interface FeesValue {
  feePolicy: FeePolicy;
  feeBearer: NamedPerson | null;
}
export interface RefundsValue {
  refundStep: RefundStep;
  chargedTo: NamedPerson | null;
}
export interface TermValue {
  effectiveFrom?: string;
  effectiveTo?: string;
}
export interface PeopleValue {
  people: NamedPerson[];
}
export interface ShownSection<T> {
  status: DraftStatus.SHOWN;
  value: T;
  /** First supporting quote; `quotes` holds every distinct one in document order. */
  quote: string;
  quotes: string[];
}
/** The exact Rules change a reading means. Names stay visible so the UI can say who. */
export interface RulesPatch {
  feePolicy?: FeePolicy;
  feeBearer?: NamedPerson;
  advanceRecoupedBeforeSplit?: boolean;
  shares?: (NamedPerson & { basisPoints: number })[];
}
export interface DraftReading {
  label: string;
  explanation: string;
  patch: RulesPatch;
}
export interface DraftQuestion {
  question: string;
  quote?: string;
  readings: DraftReading[];
}
export interface AskSection {
  status: DraftStatus.ASK;
  reason: AskReason;
  hint?: string;
  question?: DraftQuestion;
}
export type SectionDraft<T> = ShownSection<T> | AskSection;
export interface UnmatchedName {
  name: string;
  reason: UnmatchedReason;
}
export interface ExtractionDraftView {
  title: { value: string; quote: string } | null;
  sections: {
    [RulesSection.SPLIT]: SectionDraft<SplitValue>;
    [RulesSection.ADVANCE]: SectionDraft<AdvanceValue>;
    [RulesSection.FEES]: SectionDraft<FeesValue>;
    [RulesSection.REFUNDS]: SectionDraft<RefundsValue>;
    [RulesSection.TERM]: SectionDraft<TermValue>;
    [RulesSection.PEOPLE]: SectionDraft<PeopleValue>;
  };
  /** Document names that could not be tied to exactly one member. Never silently dropped. */
  unmatchedNames: UnmatchedName[];
}

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
/** Keep the browser's evidence checks aligned with the server: source ranges
 * remain exact, while model casing and straight/curly quote substitutions do
 * not discard an otherwise source-backed observation. */
const normalizedEvidence = (value: string) =>
  normalize(value)
    .replace(/[“”„‟\"'‘’‚‛`´]/g, '"')
    .toLowerCase();
const containsEvidence = (quote: string, value: string) =>
  normalizedEvidence(quote).includes(normalizedEvidence(value));
const tokens = (value: string) =>
  normalize(value)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, "")
    .split(" ")
    .filter(Boolean);

/** Case-insensitive; "Maya Okafor" matches member "Maya" (first or last name) and vice versa.
 * An exact full-name match wins. Anything else that is not exactly one member is unmatched. */
export function matchMember(
  name: string,
  members: Member[],
): { userId: string } | { reason: UnmatchedReason } {
  const wanted = tokens(name);
  if (!wanted.length) return { reason: UnmatchedReason.NO_MEMBER };
  const key = wanted.join(" ");
  const pick = (found: Member[]) =>
    found.length === 1
      ? { userId: found[0].userId }
      : {
          reason: found.length
            ? UnmatchedReason.SEVERAL_MEMBERS
            : UnmatchedReason.NO_MEMBER,
        };
  const exact = members.filter((m) => tokens(m.displayName).join(" ") === key);
  if (exact.length) return pick(exact);
  const partOf = (short: string[], long: string[]) =>
    short.length < long.length &&
    (short.length === 1
      ? short[0] === long[0] || short[0] === long[long.length - 1]
      : short.every((t) => long.includes(t)));
  return pick(
    members.filter((m) => {
      const have = tokens(m.displayName);
      return partOf(have, wanted) || partOf(wanted, have);
    }),
  );
}

interface RawFact {
  kind: string;
  subject: string;
  rawValue: string;
  quote: string;
  [key: string]: unknown;
}
function reviewable(e: any, documentId: string): boolean {
  return (
    !!e &&
    e.status === "REVIEW_REQUIRED" &&
    e.documentId === documentId &&
    e.requiresHumanReview === true &&
    e.executable === false &&
    Array.isArray(e.facts)
  );
}
/** Re-checks a stored fact against the saved source: exact range, sentence-length quote,
 * subject and value inside that quote. `source: null` skips the range check only. */
function checkedFact(f: any, source: string | null): RawFact | null {
  const c = f?.citation;
  if (
    typeof f?.kind !== "string" ||
    typeof f.subject !== "string" ||
    typeof f.rawValue !== "string" ||
    !c ||
    typeof c.quote !== "string" ||
    !c.quote.trim() ||
    c.quote.length > 300 ||
    !Number.isInteger(c.start) ||
    !Number.isInteger(c.end) ||
    c.start < 0 ||
    c.end <= c.start ||
    (source !== null && source.slice(c.start, c.end) !== c.quote) ||
    !containsEvidence(c.quote, f.subject) ||
    !containsEvidence(c.quote, f.rawValue)
  )
    return null;
  return { ...f, quote: c.quote };
}
const ask = (
  reason: AskReason,
  hint?: string,
  question?: DraftQuestion,
): AskSection => ({
  status: DraftStatus.ASK,
  reason,
  ...(hint ? { hint } : {}),
  ...(question ? { question } : {}),
});
function shown<T>(value: T, quotes: string[]): ShownSection<T> {
  const distinct = [...new Set(quotes)];
  return {
    status: DraftStatus.SHOWN,
    value,
    quote: distinct[0],
    quotes: distinct,
  };
}

/**
 * Per Rules section: SHOWN (with value and quote) only when the server marked the section READ,
 * every quote re-checks against the saved source, every name maps to exactly one member (or people
 * are not set up yet: `members === null`), and shares add up to exactly 100%. Otherwise ASK, with the
 * document's quote as a hint and the AI's plain-language question and readings when it raised one.
 * Nothing here saves, approves or activates rules; it only prefills a draft people confirm.
 */
export function extractionDraft(
  extraction: unknown,
  documentId: string,
  source: string | null,
  members: Member[] | null,
): ExtractionDraftView {
  const e = extraction as any;
  const notStated = ask(AskReason.NOT_STATED);
  const empty: ExtractionDraftView = {
    title: null,
    sections: {
      [RulesSection.SPLIT]: notStated,
      [RulesSection.ADVANCE]: notStated,
      [RulesSection.FEES]: notStated,
      [RulesSection.REFUNDS]: notStated,
      [RulesSection.TERM]: notStated,
      [RulesSection.PEOPLE]: notStated,
    },
    unmatchedNames: [],
  };
  if (!reviewable(e, documentId)) return empty;
  const unmatched = new Map<string, UnmatchedName>();
  const person = (name: string): NamedPerson & { matched: boolean } => {
    if (members === null) return { name, userId: null, matched: true };
    const found = matchMember(name, members);
    if ("userId" in found) return { name, userId: found.userId, matched: true };
    unmatched.set(normalize(name).toLocaleLowerCase(), {
      name: normalize(name),
      reason: found.reason,
    });
    return { name, userId: null, matched: false };
  };
  const strip = ({ name, userId }: NamedPerson): NamedPerson => ({
    name,
    userId,
  });
  const facts = (e.facts as unknown[]).map((f) => checkedFact(f, source));
  const issues: any[] = Array.isArray(e.issues) ? e.issues : [];
  const serverStatus = (section: RulesSection) => e.sections?.[section]?.status;
  const questionFor = (section: RulesSection): DraftQuestion | undefined => {
    const issue = issues.find(
      (i) => TOPIC_SECTION[i?.topic] === section && Array.isArray(i.readings),
    );
    if (!issue || typeof issue.question !== "string") return undefined;
    const quote =
      typeof issue.citation?.quote === "string" &&
      (source === null ||
        source.slice(issue.citation.start, issue.citation.end) ===
          issue.citation.quote)
        ? issue.citation.quote
        : undefined;
    return {
      question: issue.question,
      ...(quote ? { quote } : {}),
      readings: issue.readings.flatMap((r: any): DraftReading[] => {
        const s = r?.setting ?? {};
        const patch: RulesPatch = {};
        if (Object.values(FeePolicy).includes(s.feePolicy))
          patch.feePolicy = s.feePolicy;
        if (typeof s.feeBearer === "string")
          patch.feeBearer = strip(person(s.feeBearer));
        if (typeof s.advanceRecoupedBeforeSplit === "boolean")
          patch.advanceRecoupedBeforeSplit = s.advanceRecoupedBeforeSplit;
        if (Array.isArray(s.shares))
          patch.shares = s.shares.map((x: any) => ({
            ...strip(person(String(x?.name ?? ""))),
            basisPoints: Number(x?.basisPoints),
          }));
        return typeof r?.label === "string" &&
          typeof r?.explanation === "string" &&
          Object.keys(patch).length
          ? [{ label: r.label, explanation: r.explanation, patch }]
          : [];
      }),
    };
  };
  const of = (kind: FactKind) =>
    e.facts.flatMap((raw: any, i: number) =>
      raw?.kind === kind && facts[i] ? [facts[i]!] : [],
    ) as RawFact[];
  const anyInvalid = (kind: FactKind) =>
    e.facts.some((raw: any, i: number) => raw?.kind === kind && !facts[i]);
  /** ASK fallback with the most useful hint and the AI question, if any. */
  const askFor = (
    section: RulesSection,
    reason: AskReason,
    found: RawFact[],
  ): AskSection => {
    const question = questionFor(section);
    return ask(
      question ? AskReason.QUESTION : reason,
      found[0]?.quote ?? question?.quote,
      question,
    );
  };
  const gate = (section: RulesSection, kind: FactKind) => {
    const found = of(kind);
    if (serverStatus(section) !== READ || anyInvalid(kind) || !found.length)
      return {
        found,
        fail: askFor(
          section,
          found.length ? AskReason.CONFLICT : AskReason.NOT_STATED,
          found,
        ),
      };
    return { found, fail: null };
  };

  // SPLIT
  const splitSection = ((): SectionDraft<SplitValue> => {
    const { found, fail } = gate(RulesSection.SPLIT, FactKind.SHARE);
    // Name matching runs even on ASK so unmatched names are always reported.
    const shares = found.map((f) => ({
      ...person(f.subject),
      basisPoints: Number(f.basisPoints),
      percent: f.rawValue.replace(/\s|%/g, ""),
      quote: f.quote,
    }));
    if (fail) return fail;
    if (shares.some((s) => !s.matched))
      return askFor(RulesSection.SPLIT, AskReason.UNMATCHED_NAME, found);
    const owners = shares.map(
      (s) => s.userId ?? normalize(s.name).toLowerCase(),
    );
    if (new Set(owners).size !== owners.length)
      return askFor(RulesSection.SPLIT, AskReason.CONFLICT, found);
    let total = 0;
    for (const s of shares) {
      try {
        if (parseShare(s.percent) !== s.basisPoints) throw new Error();
      } catch {
        return askFor(RulesSection.SPLIT, AskReason.CONFLICT, found);
      }
      total += s.basisPoints;
    }
    if (total !== 10_000)
      return askFor(RulesSection.SPLIT, AskReason.SHARES_NOT_100, found);
    return shown(
      {
        shares: shares.map(({ name, userId, basisPoints, percent }) => ({
          name,
          userId,
          basisPoints,
          percent,
        })),
      },
      shares.map((s) => s.quote),
    );
  })();

  // ADVANCE
  const advanceSection = ((): SectionDraft<AdvanceValue> => {
    const { found, fail } = gate(RulesSection.ADVANCE, FactKind.ADVANCE);
    const recipients = found.map((f) => person(f.subject));
    if (fail) return fail;
    const f = found[0];
    if (f.recoupedBeforeSplit !== true)
      return askFor(RulesSection.ADVANCE, AskReason.NOT_SUPPORTED, found);
    if (!recipients[0].matched)
      return askFor(RulesSection.ADVANCE, AskReason.UNMATCHED_NAME, found);
    const amountCents = Number(f.amountCents);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0)
      return askFor(RulesSection.ADVANCE, AskReason.CONFLICT, found);
    return shown(
      {
        recipient: strip(recipients[0]),
        amountCents,
        recoupedBeforeSplit: true,
        verified: false,
      },
      found.map((x) => x.quote),
    );
  })();

  // FEES
  const feesSection = ((): SectionDraft<FeesValue> => {
    const { found, fail } = gate(RulesSection.FEES, FactKind.FEES);
    const bearers = found.map((f) =>
      typeof f.feeBearer === "string" ? person(f.feeBearer) : null,
    );
    if (fail) return fail;
    const feePolicy = found[0].feePolicy as FeePolicy;
    if (!Object.values(FeePolicy).includes(feePolicy))
      return askFor(RulesSection.FEES, AskReason.CONFLICT, found);
    if (feePolicy === FeePolicy.ORGANIZER_SHARE && !bearers[0]?.matched)
      return askFor(RulesSection.FEES, AskReason.UNMATCHED_NAME, found);
    return shown(
      {
        feePolicy,
        feeBearer:
          feePolicy === FeePolicy.ORGANIZER_SHARE ? strip(bearers[0]!) : null,
      },
      found.map((x) => x.quote),
    );
  })();

  // REFUNDS (display only)
  const refundsSection = ((): SectionDraft<RefundsValue> => {
    const { found, fail } = gate(RulesSection.REFUNDS, FactKind.REFUNDS);
    const charged = found.map((f) =>
      typeof f.chargedTo === "string" ? person(f.chargedTo) : null,
    );
    if (fail) return fail;
    const refundStep = found[0].refundStep as RefundStep;
    if (!Object.values(RefundStep).includes(refundStep))
      return askFor(RulesSection.REFUNDS, AskReason.CONFLICT, found);
    if (charged[0] && !charged[0].matched)
      return askFor(RulesSection.REFUNDS, AskReason.UNMATCHED_NAME, found);
    return shown(
      { refundStep, chargedTo: charged[0] ? strip(charged[0]) : null },
      found.map((x) => x.quote),
    );
  })();

  // TERM
  const termSection = ((): SectionDraft<TermValue> => {
    const { found, fail } = gate(RulesSection.TERM, FactKind.TERM);
    if (fail) return fail;
    const date = (boundary: TermBoundary) =>
      found.find(
        (f) =>
          f.boundary === boundary &&
          typeof f.date === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(f.date),
      )?.date as string | undefined;
    const effectiveFrom = date(TermBoundary.START);
    const effectiveTo = date(TermBoundary.END);
    if (!effectiveFrom && !effectiveTo)
      return askFor(RulesSection.TERM, AskReason.CONFLICT, found);
    return shown(
      {
        ...(effectiveFrom ? { effectiveFrom } : {}),
        ...(effectiveTo ? { effectiveTo } : {}),
      },
      found.map((x) => x.quote),
    );
  })();

  // PEOPLE
  const peopleSection = ((): SectionDraft<PeopleValue> => {
    const { found, fail } = gate(RulesSection.PEOPLE, FactKind.PERSON);
    const seen = new Set<string>();
    const people = found
      .filter((f) => {
        const key = normalize(f.subject).toLocaleLowerCase();
        return seen.has(key) ? false : (seen.add(key), true);
      })
      .map((f) => person(f.subject));
    if (fail) return fail;
    if (people.some((p) => !p.matched))
      return askFor(RulesSection.PEOPLE, AskReason.UNMATCHED_NAME, found);
    return shown(
      { people: people.map(strip) },
      found.map((x) => x.quote),
    );
  })();

  const titleQuote = e.titleCitation;
  const title =
    typeof e.suggestedTitle === "string" &&
    typeof titleQuote?.quote === "string" &&
    titleQuote.quote === e.suggestedTitle &&
    (source === null ||
      source.slice(titleQuote.start, titleQuote.end) === titleQuote.quote)
      ? { value: e.suggestedTitle, quote: titleQuote.quote }
      : null;

  return {
    title,
    sections: {
      [RulesSection.SPLIT]: splitSection,
      [RulesSection.ADVANCE]: advanceSection,
      [RulesSection.FEES]: feesSection,
      [RulesSection.REFUNDS]: refundsSection,
      [RulesSection.TERM]: termSection,
      [RulesSection.PEOPLE]: peopleSection,
    },
    unmatchedNames: [...unmatched.values()],
  };
}

/**
 * Applies a reading to a draft Rules copy. Returns null when the reading names someone who is not
 * matched to a member, or talks about an advance the draft does not have. "Not paid back" removes
 * the advance from the rules: revenue is split without recouping it first.
 */
export function applyReading(rules: Rules, patch: RulesPatch): Rules | null {
  const next: Rules = structuredClone(rules);
  if (patch.shares) {
    if (patch.shares.some((s) => s.userId === null)) return null;
    next.shares = patch.shares.map((s) => ({
      userId: s.userId!,
      basisPoints: s.basisPoints,
    }));
  }
  if (patch.feePolicy) {
    next.feePolicy = patch.feePolicy;
    if (patch.feePolicy === FeePolicy.ORGANIZER_SHARE) {
      if (!patch.feeBearer?.userId) return null;
      next.feeBearerId = patch.feeBearer.userId;
    } else delete next.feeBearerId;
  }
  if (patch.advanceRecoupedBeforeSplit !== undefined) {
    if (!next.advance) return null;
    if (!patch.advanceRecoupedBeforeSplit) delete next.advance;
  }
  return next;
}

export interface ReadingPreview {
  label: string;
  explanation: string;
  /** Per-person cents from the settlement engine, or null when it cannot be computed. */
  preview: AllocationPreview | null;
  error: string | null;
}
/** Dollars per person for each reading, from the same exact-cent engine as settlement, on a
 * detached scratch copy. Illustrative only: nothing is saved or approved. */
export function readingPreviews(
  agreement: Agreement,
  draft: Rules,
  question: DraftQuestion,
  grossCents: number,
  feeCents: number,
): ReadingPreview[] {
  const actor =
    agreement.value.members.find((m) => m.role === "ORGANIZER") ??
    agreement.value.members[0];
  return question.readings.map(({ label, explanation, patch }) => {
    const rules = actor ? applyReading(draft, patch) : null;
    if (!rules)
      return {
        label,
        explanation,
        preview: null,
        error: "Match everyone in this option to a person first.",
      };
    try {
      const scratch = createCollaboration(
        {
          id: agreement.id,
          name: agreement.value.name,
          members: agreement.value.members as DomainMember[],
        },
        actor!.userId,
        "2000-01-01T00:00:00Z",
      );
      scratch.versions = agreement.value.versions.map((version) => ({
        ...structuredClone(version),
        createdAt: "2000-01-01T00:00:00Z",
      })) as AgreementVersion[];
      scratch.recoupedByAdvance = structuredClone(
        agreement.value.recoupedByAdvance,
      );
      const proposed = proposeVersion(
        scratch,
        rules as DomainRules,
        actor!.userId,
        "2000-01-01T00:00:00Z",
      );
      return {
        label,
        explanation,
        preview: previewVersion(
          proposed,
          proposed.versions.at(-1)!.id,
          { grossCents, feeCents },
          actor!.userId,
        ),
        error: null,
      };
    } catch (error) {
      if (error instanceof DomainError)
        return { label, explanation, preview: null, error: error.message };
      throw error;
    }
  });
}

/** Form prefill for the share inputs: only source-backed shares whose name maps to exactly one
 * member. This never saves/approves rules. */
export function suggestedShares(
  extraction: unknown,
  documentId: string,
  source: string,
  members: Member[],
): Record<string, string> {
  const e = extraction as any;
  if (!reviewable(e, documentId)) return {};
  const candidates = new Map<string, string[]>();
  for (const raw of e.facts) {
    if (raw?.kind !== FactKind.SHARE) continue;
    const f = checkedFact(raw, source);
    if (!f || !/^\d+(\.\d{1,2})?%$/.test(f.rawValue)) continue;
    const match = matchMember(f.subject, members);
    if (!("userId" in match)) continue;
    const value = f.rawValue.slice(0, -1);
    try {
      parseShare(value);
    } catch {
      continue;
    }
    candidates.set(match.userId, [
      ...(candidates.get(match.userId) || []),
      value,
    ]);
  }
  // Duplicate/conflicting facts require manual review, even when numbers agree.
  return Object.fromEntries(
    [...candidates]
      .filter(([, values]) => values.length === 1)
      .map(([id, values]) => [id, values[0]]),
  );
}

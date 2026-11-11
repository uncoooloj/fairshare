import {
  DraftStatus,
  containsNormalizedEvidence,
  extractionDraft,
  matchMember,
  RulesSection,
  type DraftQuestion,
  type RulesPatch,
} from "./ai-draft";
import { FeePolicy } from "../../../packages/domain/src/index";
import { type Agreement, type Member } from "./model";
import { formatMoneyHeadline } from "./preferences";
import {
  AnswerSource,
  emptyAnswers,
  FeeChoice,
  TOTAL_BASIS_POINTS,
  type AdvanceAnswer,
  type AgreementAnswers,
  type Cited,
  type PersonAnswer,
  type Question,
  type QuestionChoice,
} from "./rules-answers";
import {
  feeQuestion,
  questionsFor,
  StandardQuestionId,
} from "./standard-questions";
import { CheckMode } from "../components/wizard-check-step";

export { CheckMode };

export interface ExtractedAnswers {
  answers: AgreementAnswers;
  mode: CheckMode;
  /** Names were found without percentages, so the split starts equal. */
  equalSplitGuessed: boolean;
}

/** Ids of questions raised from the reading itself (fees reuse the standard id). */
export enum ReadingQuestionId {
  SPLIT = "split",
  ADVANCE = "advance",
}

/** Server section status (mirrors SectionStatus in @fairshare/contract-ai). */
enum ServerSection {
  READ = "READ",
  ASK = "ASK",
  NOT_FOUND = "NOT_FOUND",
}

const SECTIONS = Object.values(RulesSection);

const normal = (name: string) =>
  name.replace(/\s+/g, " ").trim().toLocaleLowerCase();
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const keyFor = (name: string) =>
  `doc:${normal(name).replace(/[^a-z0-9]+/g, "-")}`;
const asMembers = (names: string[]): Member[] =>
  names.map((displayName, i) => ({
    userId: String(i),
    displayName,
    role: "COLLABORATOR",
  }));

/** Index of the one name that is the same person (full name, or first/last name of it), or -1. */
function sameNameIndex(name: string, names: string[]): number {
  const found = matchMember(name, asMembers(names));
  return "userId" in found ? Number(found.userId) : -1;
}

/** Equal integer split; the remainder goes to the first rows. */
function equalSplit(count: number): number[] {
  const base = Math.floor(TOTAL_BASIS_POINTS / count);
  const left = TOTAL_BASIS_POINTS - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < left ? 1 : 0));
}

/**
 * The clause number a quote sits under: the nearest line at or above it that starts with a
 * number like "4.2", "§ 4.2" or "Section 4". Undefined when the document isn't numbered.
 */
export function clauseFor(
  documentText: string,
  quote: string | undefined,
): string | undefined {
  if (!quote) return undefined;
  const at = documentText.indexOf(quote);
  if (at < 0) return undefined;
  const lines = documentText
    .slice(0, at + 1)
    .split(/\r?\n/)
    .reverse();
  for (const line of lines) {
    const m =
      /^\s*(?:§\s*|(?:section|clause|article)\s+)?(\d+(?:\.\d+)*)(?:[.)]\s|\s|$)/i.exec(
        line,
      );
    if (m) return m[1];
  }
  return undefined;
}

interface RawFact {
  kind: string;
  subject: string;
  rawValue: string;
  quote: string;
  boundary?: unknown;
  amountCents?: unknown;
  recoupedBeforeSplit?: unknown;
}

/** Facts whose quote is exactly where it says in the document. Used for names and for an
 * advance the reading could not settle, never for percentages. */
function verifiedFacts(extraction: any, documentText: string): RawFact[] {
  if (!Array.isArray(extraction?.facts)) return [];
  return extraction.facts.flatMap((f: any): RawFact[] => {
    const c = f?.citation;
    return typeof f?.kind === "string" &&
      typeof f.subject === "string" &&
      f.subject.trim() &&
      typeof f.rawValue === "string" &&
      f.rawValue.trim() &&
      typeof c?.quote === "string" &&
      c.quote.trim() &&
      Number.isInteger(c.start) &&
      Number.isInteger(c.end) &&
      documentText.slice(c.start, c.end) === c.quote &&
      containsNormalizedEvidence(c.quote, f.subject) &&
      containsNormalizedEvidence(c.quote, f.rawValue)
      ? [{ ...f, subject: f.subject.trim(), quote: c.quote }]
      : [];
  });
}

/** An advance read from the document, before deciding whether it is paid back first. */
interface FoundAdvance {
  recipient: string;
  amountCents: number;
  /** null: the document doesn't say. */
  paidBackFirst: boolean | null;
  quote: string;
}

function foundAdvance(facts: RawFact[]): FoundAdvance | undefined {
  for (const f of facts) {
    if (f.kind !== "ADVANCE") continue;
    const amountCents = Number(f.amountCents);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) continue;
    return {
      recipient: f.subject,
      amountCents,
      paidBackFirst:
        typeof f.recoupedBeforeSplit === "boolean"
          ? f.recoupedBeforeSplit
          : null,
      quote: f.quote,
    };
  }
  return undefined;
}

/** The person in these answers with this document name, by the same name rules as the reading. */
function personFor(
  people: PersonAnswer[],
  name: string,
): PersonAnswer | undefined {
  const index = sameNameIndex(
    name,
    people.map((p) => p.name),
  );
  return index >= 0 ? people[index] : undefined;
}

const isOrganizer = (people: PersonAnswer[], name: string) =>
  personFor(people, name)?.isSelf === true;

/**
 * One reading applied to the answers, or null when Fairshare can't do what it says: a split that
 * doesn't add up to 100%, fees paid by someone who isn't the organizer, or an advance we don't have.
 */
function applyPatch(
  a: AgreementAnswers,
  patch: RulesPatch,
  advance: FoundAdvance | undefined,
): AgreementAnswers | null {
  let next: AgreementAnswers = { ...a };
  if (patch.shares) {
    const total = patch.shares.reduce((s, x) => s + x.basisPoints, 0);
    if (
      total !== TOTAL_BASIS_POINTS ||
      patch.shares.some(
        (s) => !Number.isInteger(s.basisPoints) || s.basisPoints < 0,
      )
    )
      return null;
    const people = a.people.value.map((p) => ({ ...p, basisPoints: 0 }));
    for (const share of patch.shares) {
      const found = personFor(people, share.name);
      if (found) found.basisPoints += share.basisPoints;
      else
        people.push({
          key: keyFor(share.name),
          name: share.name.trim(),
          basisPoints: share.basisPoints,
          isSelf: false,
        });
    }
    next = { ...next, people: { value: people, source: AnswerSource.PERSON } };
  }
  if (patch.feePolicy) {
    if (
      patch.feePolicy === FeePolicy.ORGANIZER_SHARE &&
      !(patch.feeBearer && isOrganizer(next.people.value, patch.feeBearer.name))
    )
      return null;
    next = {
      ...next,
      fees: {
        value: patch.feePolicy as unknown as FeeChoice,
        source: AnswerSource.PERSON,
      },
    };
  }
  if (patch.advanceRecoupedBeforeSplit === false) next.advance = undefined;
  if (patch.advanceRecoupedBeforeSplit === true) {
    const recipient =
      advance && personFor(next.people.value, advance.recipient);
    if (!advance || !recipient) return null;
    next = {
      ...next,
      advance: {
        value: {
          recipientKey: recipient.key,
          amountCents: advance.amountCents,
        },
        source: AnswerSource.PERSON,
      },
    };
  }
  return next;
}

/** The AI's question as a wizard question: only readings Fairshare can carry out become choices. */
function readingQuestion(
  id: string,
  question: DraftQuestion,
  base: AgreementAnswers,
  advance: FoundAdvance | undefined,
  documentText: string,
): Question | undefined {
  const choices: QuestionChoice[] = question.readings.flatMap((r, i) =>
    applyPatch(base, r.patch, advance)
      ? [
          {
            id:
              id === StandardQuestionId.FEES && r.patch.feePolicy
                ? r.patch.feePolicy
                : `reading-${i}`,
            label: r.label,
            explanation: r.explanation,
            available: (a: AgreementAnswers) =>
              !!applyPatch(a, r.patch, advance),
            apply: (a: AgreementAnswers) =>
              applyPatch(a, r.patch, advance) ?? a,
          },
        ]
      : [],
  );
  if (choices.length < 2) return undefined;
  return {
    id,
    text: question.question,
    ...(question.quote
      ? {
          quote: question.quote,
          clause: clauseFor(documentText, question.quote),
        }
      : {}),
    choices,
  };
}

/** The document names an advance but doesn't say it is paid back first (or says it isn't). The
 * document's own reading comes first; nothing is repaid unless someone picks it. */
function advanceQuestion(
  advance: FoundAdvance,
  documentText: string,
): Question {
  const who = firstName(advance.recipient);
  const amount = formatMoneyHeadline(advance.amountCents);
  const no: QuestionChoice = {
    id: "not-paid-back",
    label: "No, split from the first dollar",
    explanation: `${who}'s ${amount} isn't paid back from payments.`,
    apply: (a) => ({ ...a, advance: undefined }),
  };
  const yes: QuestionChoice = {
    id: "paid-back-first",
    label: "Yes, paid back first",
    explanation: `${who} gets ${amount} back before anyone splits.`,
    apply: (a) => {
      const recipient = personFor(a.people.value, advance.recipient);
      return recipient
        ? {
            ...a,
            advance: {
              value: {
                recipientKey: recipient.key,
                amountCents: advance.amountCents,
              },
              source: AnswerSource.PERSON,
            },
          }
        : a;
    },
  };
  return {
    id: ReadingQuestionId.ADVANCE,
    text: `Is ${who}'s ${amount} paid back before the split?`,
    quote: advance.quote,
    clause: clauseFor(documentText, advance.quote),
    choices: advance.paidBackFirst === false ? [no, yes] : [yes, no],
  };
}

/**
 * The AI reading (extraction v2) as wizard answers. What the reading SHOWS is filled in with its
 * quote and clause; what it asks about becomes a question whose choices change the answers; what
 * it never found stays empty. MANUAL when nothing usable was read, FOUND_ALL when the split was
 * read and nothing the rules need is unclear, FOUND_SOME otherwise.
 */
export function answersFromExtraction(
  extraction: unknown,
  documentText: string,
  self: { name: string; userId: string },
): ExtractedAnswers {
  const e = extraction as any;
  const base = emptyAnswers(self);
  const draft = extractionDraft(
    extraction,
    typeof e?.documentId === "string" ? e.documentId : "",
    documentText,
    null,
  );
  const cite = <T>(value: T, quote?: string): Cited<T> => ({
    value,
    source: AnswerSource.DOCUMENT,
    ...(quote ? { quote, clause: clauseFor(documentText, quote) } : {}),
  });
  const { sections } = draft;
  const split = sections[RulesSection.SPLIT];
  const advanceSection = sections[RulesSection.ADVANCE];
  const fees = sections[RulesSection.FEES];
  const term = sections[RulesSection.TERM];
  // Names only come from a reading the server marked for review, quote by quote.
  const facts =
    e?.status === "REVIEW_REQUIRED" &&
    e.requiresHumanReview === true &&
    e.executable === false
      ? verifiedFacts(e, documentText)
      : [];

  // Everyone the document names, once each, keeping the fullest form of each name.
  const names: string[] = [];
  const addName = (name: string) => {
    const index = sameNameIndex(name, names);
    if (index < 0) names.push(name.trim());
    else if (name.trim().length > names[index].length)
      names[index] = name.trim();
  };
  const shareNames: string[] = [];
  if (split.status === DraftStatus.SHOWN)
    for (const s of split.value.shares) addName(s.name);
  for (const f of facts)
    if (f.kind === "SHARE") {
      addName(f.subject);
      shareNames.push(f.subject);
    }
  for (const f of facts) if (f.kind === "PERSON") addName(f.subject);
  for (const f of facts) if (f.kind === "ADVANCE") addName(f.subject);

  // A reading with no revenue-share terms at all (no split, no share quoted, no split
  // question) is some other document, such as a brief. Nothing is filled from guesses.
  // When the reader says it read a split we just couldn't verify, it's a manual setup.
  const splitAsked = split.status === DraftStatus.ASK && !!split.question;
  if (
    e?.status === "REVIEW_REQUIRED" &&
    e.sections?.[RulesSection.SPLIT]?.status !== ServerSection.READ &&
    split.status !== DraftStatus.SHOWN &&
    !shareNames.length &&
    !splitAsked
  )
    return {
      answers: base,
      mode: CheckMode.NOT_AGREEMENT,
      equalSplitGuessed: false,
    };

  const title = draft.title ? cite(draft.title.value) : base.name;
  const dates: Partial<AgreementAnswers> =
    term.status === DraftStatus.SHOWN
      ? {
          // Start and end can be in different clauses. Cite each only when its
          // own verified fact proves the date, never the section's first quote.
          ...(term.value.effectiveFrom
            ? {
                effectiveFrom: cite(
                  term.value.effectiveFrom,
                  facts.find(
                    (fact) => fact.kind === "TERM" && fact.boundary === "START",
                  )?.quote,
                ),
              }
            : {}),
          ...(term.value.effectiveTo
            ? {
                effectiveTo: cite<string | null>(
                  term.value.effectiveTo,
                  facts.find(
                    (fact) => fact.kind === "TERM" && fact.boundary === "END",
                  )?.quote,
                ),
              }
            : {}),
        }
      : {};

  if (!names.length) {
    const answers: AgreementAnswers = { ...base, name: title, ...dates };
    return {
      answers: { ...answers, questions: questionsFor(answers) },
      mode:
        draft.title || term.status === DraftStatus.SHOWN
          ? CheckMode.FOUND_SOME
          : CheckMode.MANUAL,
      equalSplitGuessed: false,
    };
  }

  // The organizer is only "You" on an exact full-name match; a shared first name is two people.
  const selfIndex = names.findIndex((n) => normal(n) === normal(self.name));
  const complete =
    split.status === DraftStatus.SHOWN &&
    split.value.shares.every((s) => sameNameIndex(s.name, names) >= 0);
  const points = names.map(() => 0);
  if (complete)
    for (const s of split.value.shares)
      points[sameNameIndex(s.name, names)] += s.basisPoints;
  else {
    // Equal over the people the split mentions, or everyone named when it mentions no one.
    const inSplit = [
      ...new Set(
        (shareNames.length ? shareNames : names).map((n) =>
          sameNameIndex(n, names),
        ),
      ),
    ].filter((i) => i >= 0);
    const equal = equalSplit(inSplit.length);
    inSplit.forEach((index, i) => (points[index] = equal[i]));
  }
  const usedKeys = new Set<string>([self.userId]);
  const people: PersonAnswer[] = names.map((name, index) => {
    if (index === selfIndex)
      return {
        key: self.userId,
        name,
        userId: self.userId,
        basisPoints: points[index],
        isSelf: true,
      };
    let key = keyFor(name);
    while (usedKeys.has(key)) key = `${key}-${index}`;
    usedKeys.add(key);
    return { key, name, basisPoints: points[index], isSelf: false };
  });
  // Not named in the document: the organizer still sends it, with no share to start.
  if (selfIndex < 0)
    people.unshift({
      key: self.userId,
      name: self.name,
      userId: self.userId,
      basisPoints: 0,
      isSelf: true,
    });

  const advanceFound = foundAdvance(facts);
  let advance: Cited<AdvanceAnswer> | undefined;
  if (advanceSection.status === DraftStatus.SHOWN) {
    const recipient = personFor(people, advanceSection.value.recipient.name);
    if (recipient)
      advance = cite(
        {
          recipientKey: recipient.key,
          amountCents: advanceSection.value.amountCents,
        },
        advanceSection.quote,
      );
  }

  let feesAnswer: Cited<FeeChoice> | undefined;
  /** Fees the document gives to someone Fairshare can't charge them to. */
  let feeBearerElsewhere: string | undefined;
  if (fees.status === DraftStatus.SHOWN) {
    const bearer = fees.value.feeBearer?.name;
    if (fees.value.feePolicy === FeePolicy.BEFORE_SPLIT)
      feesAnswer = cite(FeeChoice.BEFORE_SPLIT, fees.quote);
    else if (bearer && isOrganizer(people, bearer))
      feesAnswer = cite(FeeChoice.ORGANIZER_SHARE, fees.quote);
    else feeBearerElsewhere = bearer ?? "someone else";
  }

  const answers: AgreementAnswers = {
    ...base,
    ...dates,
    name: title,
    people: complete
      ? cite(people, split.quote)
      : { value: people, source: AnswerSource.PERSON },
    ...(advance ? { advance } : {}),
    ...(feesAnswer ? { fees: feesAnswer } : {}),
  };

  // Keep questions the reading actually raised, including fees. A default is not
  // an answer to an ambiguous clause. Refunds remain outside this rules engine.
  const raised: Question[] = [];
  const askOf = (section: RulesSection) => {
    const s = sections[section];
    return s.status === DraftStatus.ASK ? s : undefined;
  };
  const splitAsk = askOf(RulesSection.SPLIT);
  if (splitAsk?.question) {
    const q = readingQuestion(
      ReadingQuestionId.SPLIT,
      splitAsk.question,
      answers,
      advanceFound,
      documentText,
    );
    if (q) raised.push(q);
  }
  const advanceAsk = askOf(RulesSection.ADVANCE);
  if (advanceAsk && advanceFound) {
    const q =
      (advanceAsk.question &&
        readingQuestion(
          ReadingQuestionId.ADVANCE,
          advanceAsk.question,
          answers,
          advanceFound,
          documentText,
        )) ||
      advanceQuestion(advanceFound, documentText);
    raised.push(q);
  }
  const feesAsk = askOf(RulesSection.FEES);
  if (feesAsk?.question) {
    const q = readingQuestion(
      StandardQuestionId.FEES,
      feesAsk.question,
      answers,
      advanceFound,
      documentText,
    );
    raised.push(
      q ?? {
        ...feeQuestion(answers),
        text: feesAsk.question.question,
        quote: feesAsk.question.quote,
        clause: clauseFor(documentText, feesAsk.question.quote),
        proposalNote:
          "We can't apply every interpretation of this clause. These are payment rules you can propose instead; check them with everyone.",
      },
    );
  }
  if (feeBearerElsewhere && fees.status === DraftStatus.SHOWN) {
    const standard = feeQuestion(answers);
    raised.push({
      ...standard,
      text: `We can't have ${firstName(feeBearerElsewhere)} pay the PayPal fee yet. Who covers it?`,
      quote: fees.quote,
      clause: clauseFor(documentText, fees.quote),
    });
  }

  const questions = questionsFor(
    answers,
    raised.map((question) => ({
      ...question,
      requiresExplicitAnswer: true,
      documentId: typeof e?.documentId === "string" ? e.documentId : undefined,
    })),
  );
  const serverStatus = (s: RulesSection) => e?.sections?.[s]?.status;
  // Fees and refunds never need the organizer unless a question was raised above.
  const unclear = SECTIONS.some(
    (s) =>
      s !== RulesSection.FEES &&
      s !== RulesSection.REFUNDS &&
      sections[s].status === DraftStatus.ASK &&
      serverStatus(s) !== ServerSection.NOT_FOUND,
  );
  return {
    answers: { ...answers, questions },
    mode:
      complete && !unclear && !raised.some((q) => q.choices.length)
        ? CheckMode.FOUND_ALL
        : CheckMode.FOUND_SOME,
    equalSplitGuessed: !complete && names.length > 1,
  };
}

/**
 * A saved draft as answers: the extraction mapping, then what the draft itself holds
 * (dates, and anyone already added as a pending person, matched by name).
 */
export function answersFromDraft(
  agreement: Agreement,
  extraction: unknown,
  documentText: string,
  self: { name: string; userId: string },
): ExtractedAnswers {
  const read = answersFromExtraction(extraction, documentText, self);
  let answers = read.answers;
  const details = agreement.value.details;
  if (details?.effectiveFrom)
    answers = {
      ...answers,
      effectiveFrom: {
        value: details.effectiveFrom,
        source: AnswerSource.PERSON,
      },
    };
  if (details?.effectiveTo !== undefined)
    answers = {
      ...answers,
      effectiveTo: { value: details.effectiveTo, source: AnswerSource.PERSON },
    };
  const people = [...answers.people.value];
  for (const member of agreement.value.members) {
    const pending = (
      member as { pending?: { invitationId: string; email: string } }
    ).pending;
    if (!pending) continue;
    const index = people.findIndex(
      (p) =>
        !p.isSelf &&
        !p.invitationId &&
        normal(p.name) === normal(member.displayName),
    );
    const known = { email: pending.email, invitationId: pending.invitationId };
    if (index >= 0) people[index] = { ...people[index], ...known };
    else
      people.push({
        key: `pending:${pending.invitationId}`,
        name: member.displayName,
        basisPoints: 0,
        isSelf: false,
        ...known,
      });
  }
  return {
    ...read,
    answers: { ...answers, people: { ...answers.people, value: people } },
  };
}

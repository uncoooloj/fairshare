import { suggestedShares } from "./ai-draft";
import { parseCents, type Agreement, type Member } from "./model";
import {
  AnswerSource,
  emptyAnswers,
  TOTAL_BASIS_POINTS,
  type AgreementAnswers,
  type Cited,
  type PersonAnswer,
  type Question,
} from "./rules-answers";
import { questionsFor, StandardQuestionId } from "./standard-questions";
import { CheckMode } from "../components/wizard-check-step";

export { CheckMode };

export interface ExtractedAnswers {
  answers: AgreementAnswers;
  mode: CheckMode;
  /** Names were found without percentages, so the split starts equal. */
  equalSplitGuessed: boolean;
}

interface Fact {
  kind: string;
  subject: string;
  rawValue: string;
  citation: { start: number; end: number; quote: string };
}

/** A fact is usable only when its quote is really in the document and names its subject and value. */
function citedFacts(extraction: any, documentText: string): Fact[] {
  if (
    !extraction ||
    extraction.status !== "REVIEW_REQUIRED" ||
    extraction.requiresHumanReview !== true ||
    extraction.executable !== false ||
    !Array.isArray(extraction.facts)
  )
    return [];
  return extraction.facts.filter((f: any): f is Fact => {
    const c = f?.citation;
    return (
      typeof f?.kind === "string" &&
      typeof f.subject === "string" &&
      !!f.subject.trim() &&
      typeof f.rawValue === "string" &&
      !!c &&
      Number.isInteger(c.start) &&
      Number.isInteger(c.end) &&
      c.start >= 0 &&
      c.end > c.start &&
      typeof c.quote === "string" &&
      documentText.slice(c.start, c.end) === c.quote &&
      c.quote.includes(f.subject) &&
      c.quote.includes(f.rawValue)
    );
  });
}

const normal = (name: string) => name.trim().toLocaleLowerCase();
const first = (name: string) => normal(name).split(/\s+/)[0] ?? "";
const keyFor = (name: string) =>
  `doc:${normal(name).replace(/[^a-z0-9]+/g, "-")}`;

/** Equal integer split; the remainder goes to the first rows. */
function equalSplit(count: number): number[] {
  const base = Math.floor(TOTAL_BASIS_POINTS / count);
  const left = TOTAL_BASIS_POINTS - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < left ? 1 : 0));
}

function parseMoneyToken(raw: string): number | undefined {
  const token = raw.replace(/^\s*(US\$|USD|\$)\s*/i, "").replace(/,/g, "");
  try {
    const cents = parseCents(token);
    return cents > 0 ? cents : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Today's extraction (SHARE / ADVANCE / RECIPIENT facts, suggested title) as wizard answers.
 * The mode is honest: MANUAL when nothing usable was read, FOUND_ALL only when the document
 * gave a complete 100% split, FOUND_SOME otherwise. The new extraction replaces this mapping.
 */
export function answersFromExtraction(
  extraction: unknown,
  documentText: string,
  self: { name: string; userId: string },
): ExtractedAnswers {
  const base = emptyAnswers(self);
  const facts = citedFacts(extraction, documentText);
  const title =
    typeof (extraction as any)?.suggestedTitle === "string"
      ? ((extraction as any).suggestedTitle as string).trim()
      : "";

  // Everyone the document names, in first-mention order.
  const names: string[] = [];
  for (const f of facts)
    if (
      ["SHARE", "ADVANCE", "RECIPIENT"].includes(f.kind) &&
      !names.some((n) => normal(n) === normal(f.subject))
    )
      names.push(f.subject.trim());

  if (!names.length) {
    const answers: AgreementAnswers = title
      ? { ...base, name: { value: title, source: AnswerSource.DOCUMENT } }
      : base;
    return {
      answers: { ...answers, questions: questionsFor(answers) },
      mode: CheckMode.MANUAL,
      equalSplitGuessed: false,
    };
  }

  // Shares only when the AI draft rules accept them (exact, single, cited, ≤ 2 decimals).
  const members: Member[] = names.map((name) => ({
    userId: keyFor(name),
    displayName: name,
    role: "COLLABORATOR",
  }));
  const documentId = (extraction as any).documentId;
  const shares = suggestedShares(extraction, documentId, documentText, members);
  const sharePoints = new Map<string, number>();
  for (const [key, value] of Object.entries(shares)) {
    try {
      sharePoints.set(key, parseCents(value));
    } catch {
      // Not a usable percentage: the person still gets a row.
    }
  }
  const shareTotal = [...sharePoints.values()].reduce((s, v) => s + v, 0);
  const complete =
    sharePoints.size === names.length && shareTotal === TOTAL_BASIS_POINTS;
  const equal = equalSplit(names.length);

  // The signed-in user is matched by full name, then by first name if that is unique.
  const selfIndex = (() => {
    const exact = names.findIndex((n) => normal(n) === normal(self.name));
    if (exact >= 0) return exact;
    const byFirst = names.filter((n) => first(n) === first(self.name));
    return byFirst.length === 1 ? names.indexOf(byFirst[0]) : -1;
  })();

  const people: PersonAnswer[] = names.map((name, index) => ({
    key: index === selfIndex ? self.userId : keyFor(name),
    name,
    ...(index === selfIndex ? { userId: self.userId } : {}),
    basisPoints: complete ? sharePoints.get(keyFor(name))! : equal[index],
    isSelf: index === selfIndex,
  }));
  // Not named in the document: the organizer still sends it, with no share to start.
  if (selfIndex < 0)
    people.unshift({
      key: self.userId,
      name: self.name,
      userId: self.userId,
      basisPoints: 0,
      isSelf: true,
    });

  const shareFact = facts.find((f) => f.kind === "SHARE");
  const peopleAnswer: Cited<PersonAnswer[]> = {
    value: people,
    source: complete ? AnswerSource.DOCUMENT : AnswerSource.PERSON,
    ...(complete && shareFact ? { quote: shareFact.citation.quote } : {}),
  };

  // One advance: the first cited ADVANCE fact whose amount parses.
  let advance: AgreementAnswers["advance"];
  for (const f of facts) {
    if (f.kind !== "ADVANCE") continue;
    const amountCents = parseMoneyToken(f.rawValue);
    const recipient = people.find((p) => normal(p.name) === normal(f.subject));
    if (!amountCents || !recipient) continue;
    advance = {
      value: { recipientKey: recipient.key, amountCents },
      source: AnswerSource.DOCUMENT,
      quote: f.citation.quote,
    };
    break;
  }

  const answers: AgreementAnswers = {
    ...base,
    name: title ? { value: title, source: AnswerSource.DOCUMENT } : base.name,
    people: peopleAnswer,
    ...(advance ? { advance } : {}),
  };

  // Today's issues have no choices; only their quotes carry over onto the standard questions.
  const issues: Question[] = [];
  for (const issue of Array.isArray((extraction as any).issues)
    ? (extraction as any).issues
    : []) {
    const quote = issue?.citation?.quote;
    if (typeof quote !== "string" || !documentText.includes(quote)) continue;
    const id =
      issue.kind === "FEES"
        ? StandardQuestionId.FEES
        : issue.kind === "RECOUPMENT"
          ? StandardQuestionId.REFUNDS
          : undefined;
    if (id === StandardQuestionId.REFUNDS && !advance) continue;
    if (id && !issues.some((q) => q.id === id))
      issues.push({ id, text: "", quote, choices: [] });
  }

  return {
    answers: { ...answers, questions: questionsFor(answers, issues) },
    mode: complete ? CheckMode.FOUND_ALL : CheckMode.FOUND_SOME,
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

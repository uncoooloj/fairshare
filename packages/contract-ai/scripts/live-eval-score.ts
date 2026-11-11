import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ExtractionSection,
  ExtractionStatus,
  FactKind,
  FeePolicy,
  IssueTopic,
  RefundStep,
  SectionStatus,
  TermBoundary,
  normalizeWhitespace,
  type Citation,
  type ExtractionResult,
} from "../src/index.js";

/** Scores one ExtractionResult against a hand-written expected reading. No network, no provider. */

export enum ScoredField {
  STATUS = "status",
  PEOPLE = "people",
  SHARES = "shares",
  ADVANCE = "advance",
  FEES = "fees",
  REFUNDS = "refunds",
  TERM = "term",
  SECTIONS = "sections",
  QUESTIONS = "questions",
  QUOTES = "quotes",
}

/** Either one exact value, or any of several acceptable values. */
export type Acceptable<T> = T | { oneOf: T[] };

export interface ExpectedPerson {
  name: string;
  /** Other ways the document names this person, e.g. a defined term like "the Producer". */
  aliases?: string[];
}
export interface ExpectedShare {
  name: string;
  basisPoints: number;
}
export interface ExpectedAdvance {
  recipient: string;
  amountCents: number;
  recoupedBeforeSplit: boolean | null;
}
export interface ExpectedFees {
  feePolicy: FeePolicy;
  feeBearer: string | null;
}
export interface ExpectedRefunds {
  refundStep: RefundStep;
  chargedTo: string | null;
}
export interface ExpectedReading {
  description: string;
  people: ExpectedPerson[];
  /** Distinct (name, share) pairs the reading should contain; [] means no shares should be read. */
  shares: Acceptable<ExpectedShare[]>;
  advance: Acceptable<ExpectedAdvance | null>;
  fees: Acceptable<ExpectedFees | null>;
  refunds: Acceptable<ExpectedRefunds | null>;
  term: { start: string | null; end: string | null };
  sections: Partial<Record<ExtractionSection, Acceptable<SectionStatus>>>;
  questions: { min: number; max: number; topics: IssueTopic[] };
}
export interface LiveFixture {
  id: string;
  text: string;
  expected: ExpectedReading;
}
export interface FieldScore {
  field: ScoredField;
  pass: boolean;
  detail: string;
}
export interface FixtureScore {
  fixture: string;
  passed: number;
  total: number;
  fields: FieldScore[];
}

export function loadFixtures(dir: string): LiveFixture[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".txt"))
    .sort()
    .map((name) => {
      const id = name.slice(0, -".txt".length);
      return {
        id,
        text: readFileSync(join(dir, name), "utf8"),
        expected: JSON.parse(
          readFileSync(join(dir, `${id}.expected.json`), "utf8"),
        ) as ExpectedReading,
      };
    });
}

const key = (value: string) => normalizeWhitespace(value).toLowerCase();
const options = <T>(value: Acceptable<T>): T[] =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  "oneOf" in value
    ? (value as { oneOf: T[] }).oneOf
    : [value as T];
/** Order-insensitive comparison of plain JSON values. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        )
      : v,
  );
const show = (value: unknown) => JSON.stringify(value);

/** Maps a name as the model wrote it to the expected canonical name. "Kemi Adeyemi (the Artist)",
 * "the Artist" and "KEMI ADEYEMI" all resolve to "Kemi Adeyemi". Unknown names pass through. */
export function nameResolver(people: ExpectedPerson[]) {
  const exact = new Map<string, string>();
  for (const person of people)
    for (const form of [person.name, ...(person.aliases ?? [])])
      exact.set(key(form), person.name);
  return (raw: string | null): string | null => {
    if (raw === null) return null;
    const k = key(raw).replace(/^the /, "");
    const hit = exact.get(key(raw)) ?? exact.get(k);
    if (hit) return hit;
    const contained = people.filter((p) => k.includes(key(p.name)));
    return contained.length === 1
      ? contained[0].name
      : normalizeWhitespace(raw);
  };
}

function citationOk(text: string, citation: Citation | null | undefined) {
  return (
    !citation ||
    (text.slice(citation.start, citation.end) === citation.quote &&
      normalizeWhitespace(text).includes(normalizeWhitespace(citation.quote)))
  );
}

/** The distinct values a set of facts asserts, compared against acceptable expectations. */
function scoreDistinct<T>(
  field: ScoredField,
  actual: T[],
  expected: Acceptable<T | null>,
): FieldScore {
  const distinct = [...new Map(actual.map((v) => [canonical(v), v])).values()];
  const got =
    distinct.length === 0
      ? null
      : distinct.length === 1
        ? distinct[0]
        : distinct;
  const pass = options(expected).some((want) =>
    want === null
      ? distinct.length === 0
      : distinct.length === 1 && canonical(distinct[0]) === canonical(want),
  );
  return {
    field,
    pass,
    detail: pass ? show(got) : `got ${show(got)}, want ${show(expected)}`,
  };
}

export function scoreResult(
  fixture: LiveFixture,
  result: ExtractionResult,
): FixtureScore {
  const { expected, text } = fixture;
  const fields: FieldScore[] = [];
  const add = (field: ScoredField, pass: boolean, detail: string) =>
    fields.push({ field, pass, detail });

  add(
    ScoredField.STATUS,
    result.status === ExtractionStatus.REVIEW_REQUIRED,
    `${result.status}${result.reason ? ` (${result.reason})` : ""}, ${result.facts.length} facts, ${result.rejections.length} rejected`,
  );
  const resolve = nameResolver(expected.people);
  const facts = result.facts;

  // People: every expected person is named somewhere in the reading.
  const named = new Set(
    facts
      .filter((f) =>
        [FactKind.PERSON, FactKind.SHARE, FactKind.ADVANCE].includes(f.kind),
      )
      .map((f) => resolve(f.subject)),
  );
  const missing = expected.people.filter((p) => !named.has(p.name));
  const extra = [...named].filter(
    (n) => !expected.people.some((p) => p.name === n),
  );
  add(
    ScoredField.PEOPLE,
    missing.length === 0,
    `missing ${show(missing.map((p) => p.name))}, extra ${show(extra)}`,
  );

  const shares = facts.flatMap((f) =>
    f.kind === FactKind.SHARE
      ? [{ name: resolve(f.subject), basisPoints: f.basisPoints }]
      : [],
  );
  const shareSet = (list: { name: string | null; basisPoints: number }[]) =>
    [...new Set(list.map((s) => `${s.name}=${s.basisPoints}`))].sort();
  const gotShares = shareSet(shares);
  const sharesPass = options(expected.shares).some(
    (want) => canonical(shareSet(want)) === canonical(gotShares),
  );
  add(
    ScoredField.SHARES,
    sharesPass,
    sharesPass
      ? show(gotShares)
      : `got ${show(gotShares)}, want ${show(options(expected.shares).map(shareSet))}`,
  );

  fields.push(
    scoreDistinct(
      ScoredField.ADVANCE,
      facts.flatMap((f) =>
        f.kind === FactKind.ADVANCE
          ? [
              {
                recipient: resolve(f.subject),
                amountCents: f.amountCents,
                recoupedBeforeSplit: f.recoupedBeforeSplit,
              },
            ]
          : [],
      ),
      expected.advance,
    ),
    scoreDistinct(
      ScoredField.FEES,
      facts.flatMap((f) =>
        f.kind === FactKind.FEES
          ? [{ feePolicy: f.feePolicy, feeBearer: resolve(f.feeBearer) }]
          : [],
      ),
      expected.fees,
    ),
    scoreDistinct(
      ScoredField.REFUNDS,
      facts.flatMap((f) =>
        f.kind === FactKind.REFUNDS
          ? [{ refundStep: f.refundStep, chargedTo: resolve(f.chargedTo) }]
          : [],
      ),
      expected.refunds,
    ),
  );

  const dates = (boundary: TermBoundary) => [
    ...new Set(
      facts.flatMap((f) =>
        f.kind === FactKind.TERM && f.boundary === boundary ? [f.date] : [],
      ),
    ),
  ];
  const term = {
    start: dates(TermBoundary.START),
    end: dates(TermBoundary.END),
  };
  const dateOk = (got: string[], want: string | null) =>
    want === null ? got.length === 0 : got.length === 1 && got[0] === want;
  add(
    ScoredField.TERM,
    dateOk(term.start, expected.term.start) &&
      dateOk(term.end, expected.term.end),
    `got ${show(term)}, want ${show(expected.term)}`,
  );

  const wrongSections = Object.entries(expected.sections).flatMap(
    ([section, want]) => {
      const got = result.sections[section as ExtractionSection]?.status;
      return options(want).includes(got)
        ? []
        : [`${section}: got ${got}, want ${show(want)}`];
    },
  );
  add(
    ScoredField.SECTIONS,
    wrongSections.length === 0,
    wrongSections.join("; ") || "all match",
  );

  const topics = result.issues.map((i) => i.topic);
  const missingTopics = expected.questions.topics.filter(
    (t) => !topics.includes(t),
  );
  add(
    ScoredField.QUESTIONS,
    topics.length >= expected.questions.min &&
      topics.length <= expected.questions.max &&
      missingTopics.length === 0,
    `${topics.length} asked ${show(topics)}, want ${expected.questions.min}-${expected.questions.max}` +
      (missingTopics.length ? `, missing ${show(missingTopics)}` : "") +
      result.issues.map((i) => ` | "${i.question}"`).join(""),
  );

  const citations = [
    ...facts.map((f) => f.citation),
    ...result.issues.map((i) => i.citation),
    result.titleCitation,
  ];
  const badQuotes = citations.filter((c) => !citationOk(text, c)).length;
  add(
    ScoredField.QUOTES,
    badQuotes === 0,
    `${citations.filter(Boolean).length - badQuotes}/${citations.filter(Boolean).length} quotes verbatim in text`,
  );

  return {
    fixture: fixture.id,
    passed: fields.filter((f) => f.pass).length,
    total: fields.length,
    fields,
  };
}

export function formatScores(scores: FixtureScore[]): string {
  const lines: string[] = [];
  for (const score of scores) {
    lines.push(`${score.fixture}: ${score.passed}/${score.total}`);
    for (const f of score.fields)
      lines.push(`  ${f.pass ? "PASS" : "FAIL"} ${f.field}: ${f.detail}`);
  }
  const passed = scores.reduce((n, s) => n + s.passed, 0);
  const total = scores.reduce((n, s) => n + s.total, 0);
  lines.push(
    `TOTAL ${passed}/${total} fields passed across ${scores.length} fixtures`,
  );
  return lines.join("\n");
}

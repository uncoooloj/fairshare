import test from "node:test";
import assert from "node:assert/strict";
import { suggestedShares } from "../lib/ai-draft";
import {
  applyReading,
  AskReason,
  DraftStatus,
  extractionDraft,
  matchMember,
  readingPreviews,
  RefundStep,
  RulesSection,
  UnmatchedReason,
} from "../lib/ai-draft";
import { FeePolicy } from "../../../packages/domain/src/index";
import type { Agreement, Rules } from "../lib/model";
const source = "Maya receives 50%. Jordan receives 30%. Riley receives 20%.";
const members = ["Maya", "Jordan", "Riley"].map((displayName, i) => ({
  displayName,
  userId: String(i),
  role: "MEMBER",
}));
const fact = (subject: string, rawValue: string) => ({
  kind: "SHARE",
  subject,
  rawValue,
  citation: { start: 0, end: source.length, quote: source },
});
const result = (facts: any[]) => ({
  status: "REVIEW_REQUIRED",
  documentId: "doc",
  requiresHumanReview: true,
  executable: false,
  facts,
});
test("prepares exact source-backed shares for explicit draft review", () =>
  assert.deepEqual(
    suggestedShares(
      result([
        fact("Maya", "50%"),
        fact("Jordan", "30%"),
        fact("Riley", "20%"),
      ]),
      "doc",
      source,
      members,
    ),
    { "0": "50", "1": "30", "2": "20" },
  ));

test("accepts server-valid casing and quote normalization while retaining exact source proof", () => {
  const source = "“MAYA OKAFOR” receives 50%. Jordan receives 50%.";
  const firstEnd = source.indexOf(" Jordan");
  const secondStart = firstEnd + 1;
  const extraction = result([
    {
      kind: "SHARE",
      subject: "maya okafor",
      rawValue: "50%",
      citation: { start: 0, end: firstEnd, quote: source.slice(0, firstEnd) },
    },
    {
      kind: "SHARE",
      subject: "JORDAN",
      rawValue: "50%",
      citation: {
        start: secondStart,
        end: source.length,
        quote: source.slice(secondStart),
      },
    },
  ]);
  assert.deepEqual(
    suggestedShares(extraction, "doc", source, [
      { displayName: "Maya Okafor", userId: "maya", role: "MEMBER" },
      { displayName: "Jordan", userId: "jordan", role: "MEMBER" },
    ]),
    { maya: "50", jordan: "50" },
  );
});
test("rejects stale documents, unavailable model and executable output", () => {
  for (const e of [
    { ...result([fact("Maya", "50%")]), documentId: "stale" },
    { ...result([fact("Maya", "50%")]), status: "MANUAL_REQUIRED" },
    { ...result([fact("Maya", "50%")]), executable: true },
  ])
    assert.deepEqual(suggestedShares(e, "doc", source, members), {});
});
test("never guesses ambiguous person, duplicate facts, malformed share or source", () => {
  assert.deepEqual(
    suggestedShares(result([fact("Maya", "50%")]), "doc", source, [
      ...members,
      { ...members[0], userId: "other" },
    ]),
    {},
  );
  assert.deepEqual(
    suggestedShares(
      result([fact("Maya", "50%"), fact("Maya", "50%")]),
      "doc",
      source,
      members,
    ),
    {},
  );
  assert.deepEqual(
    suggestedShares(
      result([fact("Maya", "50%")]),
      "doc",
      "Different agreement",
      members,
    ),
    {},
  );
  assert.deepEqual(
    suggestedShares(result([fact("Maya", "101%")]), "doc", source, members),
    {},
  );
});

// ---------- per-section draft (extraction v4 shape, as stored by the API) ----------

const text = [
  "Summer Sessions Revenue Agreement",
  "This agreement starts on January 1, 2026 and ends on December 31, 2026.",
  "Maya Okafor received a $2,000 advance, which is recouped from revenue before the split.",
  "After recoupment, Maya Okafor receives 50%, Jordan Lee receives 30%, and Riley receives 20% of net revenue.",
  "Payment processing fees are deducted before the split.",
  "Refunds are deducted from revenue before the split.",
].join("\n");
const cite = (quote: string) => {
  const start = text.indexOf(quote);
  assert.ok(start >= 0, quote);
  return { start, end: start + quote.length, quote };
};
const splitQ =
  "After recoupment, Maya Okafor receives 50%, Jordan Lee receives 30%, and Riley receives 20% of net revenue.";
const v4Share = (subject: string, pct: string) => ({
  kind: "SHARE",
  subject,
  rawValue: pct,
  basisPoints: Number(pct.slice(0, -1)) * 100,
  citation: cite(splitQ),
});
const READ = { status: "READ", factIndexes: [], issueIndex: null };
const v4 = (overrides: Record<string, unknown> = {}) => ({
  status: "REVIEW_REQUIRED",
  documentId: "doc",
  requiresHumanReview: true,
  executable: false,
  suggestedTitle: "Summer Sessions Revenue Agreement",
  titleCitation: cite("Summer Sessions Revenue Agreement"),
  facts: [
    v4Share("Maya Okafor", "50%"),
    v4Share("Jordan Lee", "30%"),
    v4Share("Riley", "20%"),
    {
      kind: "ADVANCE",
      subject: "Maya Okafor",
      rawValue: "$2,000",
      amountCents: 200000,
      recoupedBeforeSplit: true,
      citation: cite(
        "Maya Okafor received a $2,000 advance, which is recouped from revenue before the split.",
      ),
    },
    {
      kind: "FEES",
      subject: "deducted before the split",
      rawValue: "deducted before the split",
      feePolicy: "BEFORE_SPLIT",
      feeBearer: null,
      citation: cite("Payment processing fees are deducted before the split."),
    },
    {
      kind: "REFUNDS",
      subject: "Refunds are deducted from revenue before the split",
      rawValue: "Refunds are deducted from revenue before the split",
      refundStep: "BEFORE_SPLIT",
      chargedTo: null,
      citation: cite("Refunds are deducted from revenue before the split."),
    },
    ...(
      [
        ["START", "January 1, 2026", "2026-01-01"],
        ["END", "December 31, 2026", "2026-12-31"],
      ] as const
    ).map(([boundary, raw, date]) => ({
      kind: "TERM",
      subject: raw,
      rawValue: raw,
      boundary,
      date,
      citation: cite(
        "This agreement starts on January 1, 2026 and ends on December 31, 2026.",
      ),
    })),
    ...["Maya Okafor", "Jordan Lee", "Riley"].map((name) => ({
      kind: "PERSON",
      subject: name,
      rawValue: name,
      citation: cite(splitQ),
    })),
  ],
  issues: [],
  sections: {
    SPLIT: READ,
    ADVANCE: READ,
    FEES: READ,
    REFUNDS: READ,
    TERM: READ,
    PEOPLE: READ,
  },
  rejections: [],
  ...overrides,
});
const team = [
  { displayName: "Maya", userId: "u-maya", role: "ORGANIZER" },
  { displayName: "jordan lee", userId: "u-jordan", role: "MEMBER" },
  { displayName: "Riley Park", userId: "u-riley", role: "MEMBER" },
];

test("names match case-insensitively by first or last name; ambiguity is never guessed", () => {
  assert.deepEqual(matchMember("Maya Okafor", team), { userId: "u-maya" });
  assert.deepEqual(matchMember("JORDAN LEE", team), { userId: "u-jordan" });
  assert.deepEqual(matchMember("Riley", team), { userId: "u-riley" });
  assert.deepEqual(matchMember("Park", team), { userId: "u-riley" });
  assert.deepEqual(matchMember("Sam", team), {
    reason: UnmatchedReason.NO_MEMBER,
  });
  assert.deepEqual(
    matchMember("Maya", [
      ...team,
      { displayName: "Maya Chen", userId: "u-chen", role: "MEMBER" },
    ]),
    { userId: "u-maya" },
    "an exact full-name match wins",
  );
  assert.deepEqual(
    matchMember("Maya", [
      { displayName: "Maya Okafor", userId: "u-okafor", role: "MEMBER" },
      { displayName: "Maya Chen", userId: "u-chen", role: "MEMBER" },
    ]),
    { reason: UnmatchedReason.SEVERAL_MEMBERS },
  );
});

test("a stated agreement is SHOWN per section with values and verbatim quotes", () => {
  const d = extractionDraft(v4(), "doc", text, team);
  assert.deepEqual(d.unmatchedNames, []);
  assert.deepEqual(d.title, {
    value: "Summer Sessions Revenue Agreement",
    quote: "Summer Sessions Revenue Agreement",
  });
  const split = d.sections[RulesSection.SPLIT];
  assert.equal(split.status, DraftStatus.SHOWN);
  if (split.status !== DraftStatus.SHOWN) return;
  assert.deepEqual(
    split.value.shares.map((s) => [s.name, s.userId, s.basisPoints]),
    [
      ["Maya Okafor", "u-maya", 5000],
      ["Jordan Lee", "u-jordan", 3000],
      ["Riley", "u-riley", 2000],
    ],
  );
  assert.equal(split.quote, splitQ);
  assert.ok(text.includes(split.quote));
  assert.deepEqual(d.sections[RulesSection.ADVANCE], {
    status: DraftStatus.SHOWN,
    value: {
      recipient: { name: "Maya Okafor", userId: "u-maya" },
      amountCents: 200000,
      recoupedBeforeSplit: true,
      verified: false,
    },
    quote:
      "Maya Okafor received a $2,000 advance, which is recouped from revenue before the split.",
    quotes: [
      "Maya Okafor received a $2,000 advance, which is recouped from revenue before the split.",
    ],
  });
  const fees = d.sections[RulesSection.FEES];
  assert.equal(
    fees.status === DraftStatus.SHOWN && fees.value.feePolicy,
    FeePolicy.BEFORE_SPLIT,
  );
  const refunds = d.sections[RulesSection.REFUNDS];
  assert.equal(
    refunds.status === DraftStatus.SHOWN && refunds.value.refundStep,
    RefundStep.BEFORE_SPLIT,
  );
  const term = d.sections[RulesSection.TERM];
  assert.deepEqual(term.status === DraftStatus.SHOWN && term.value, {
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
  });
  const people = d.sections[RulesSection.PEOPLE];
  assert.equal(
    people.status === DraftStatus.SHOWN && people.value.people.length,
    3,
  );
});

test("upload-first: with no members yet, names are shown as written", () => {
  const d = extractionDraft(v4(), "doc", text, null);
  const split = d.sections[RulesSection.SPLIT];
  assert.equal(split.status, DraftStatus.SHOWN);
  assert.deepEqual(
    split.status === DraftStatus.SHOWN &&
      split.value.shares.map((s) => s.userId),
    [null, null, null],
  );
});

test("unmatched names are reported, and the split asks instead of guessing", () => {
  const d = extractionDraft(v4(), "doc", text, team.slice(0, 2));
  assert.deepEqual(d.unmatchedNames, [
    { name: "Riley", reason: UnmatchedReason.NO_MEMBER },
  ]);
  const split = d.sections[RulesSection.SPLIT];
  assert.equal(split.status, DraftStatus.ASK);
  assert.equal(
    split.status === DraftStatus.ASK && split.reason,
    AskReason.UNMATCHED_NAME,
  );
  assert.equal(split.status === DraftStatus.ASK && split.hint, splitQ);
  // Sections that do not involve Riley stay SHOWN.
  assert.equal(d.sections[RulesSection.FEES].status, DraftStatus.SHOWN);
});

test("shares that do not add up, tampered quotes or old whole-document results ask", () => {
  const partial = v4();
  (partial.facts as any[]).splice(2, 1);
  assert.equal(
    extractionDraft(partial, "doc", text, team).sections[RulesSection.SPLIT]
      .status,
    DraftStatus.ASK,
    "server READ is not enough: shares must still add to 100",
  );
  const tampered = v4();
  (tampered.facts as any[])[0] = {
    ...(tampered.facts as any[])[0],
    citation: { start: 0, end: 10, quote: "Maya Okafor receives 50%" },
  };
  assert.equal(
    extractionDraft(tampered, "doc", text, team).sections[RulesSection.SPLIT]
      .status,
    DraftStatus.ASK,
  );
  const legacy = v4({ sections: undefined });
  for (const section of Object.values(RulesSection))
    assert.equal(
      extractionDraft(legacy, "doc", text, team).sections[section].status,
      DraftStatus.ASK,
      section,
    );
  for (const bad of [
    v4({ status: "MANUAL_REQUIRED" }),
    v4({ executable: true }),
    v4({ documentId: "stale" }),
  ])
    assert.equal(
      extractionDraft(bad, "doc", text, team).sections[RulesSection.SPLIT]
        .status,
      DraftStatus.ASK,
    );
});

const grossText =
  "Maya receives 60% and Jordan receives 40% of gross revenue. Maya organizes the shows.";
const grossQuote =
  "Maya receives 60% and Jordan receives 40% of gross revenue.";
const feesQuestion = v4({
  facts: [
    {
      kind: "SHARE",
      subject: "Maya",
      rawValue: "60%",
      basisPoints: 6000,
      citation: { start: 0, end: grossQuote.length, quote: grossQuote },
    },
    {
      kind: "SHARE",
      subject: "Jordan",
      rawValue: "40%",
      basisPoints: 4000,
      citation: { start: 0, end: grossQuote.length, quote: grossQuote },
    },
  ],
  issues: [
    {
      topic: "FEES",
      question: "Who pays the card processing fees?",
      citation: { start: 0, end: grossQuote.length, quote: grossQuote },
      readings: [
        {
          label: "Fees come off first",
          explanation: "Fees come off the top, then everyone splits the rest.",
          setting: { feePolicy: "BEFORE_SPLIT" },
        },
        {
          label: "Maya pays the fees",
          explanation: "Split the full amount, then Maya covers the fees.",
          setting: { feePolicy: "ORGANIZER_SHARE", feeBearer: "Maya" },
        },
      ],
    },
  ],
  sections: {
    SPLIT: READ,
    FEES: { status: "ASK", factIndexes: [], issueIndex: 0 },
    ADVANCE: { status: "NOT_FOUND", factIndexes: [], issueIndex: null },
  },
  suggestedTitle: undefined,
  titleCitation: undefined,
});
const twoPeople = [
  { displayName: "Maya", userId: "u-maya", role: "ORGANIZER" },
  { displayName: "Jordan", userId: "u-jordan", role: "COLLABORATOR" },
];

test("an open question carries its quote and readings mapped to exact Rules settings", () => {
  const d = extractionDraft(feesQuestion, "doc", grossText, twoPeople);
  assert.equal(d.sections[RulesSection.SPLIT].status, DraftStatus.SHOWN);
  const fees = d.sections[RulesSection.FEES];
  assert.equal(fees.status, DraftStatus.ASK);
  if (fees.status !== DraftStatus.ASK) return;
  assert.equal(fees.reason, AskReason.QUESTION);
  assert.equal(fees.question?.quote, grossQuote);
  assert.deepEqual(
    fees.question?.readings.map((r) => r.patch),
    [
      { feePolicy: FeePolicy.BEFORE_SPLIT },
      {
        feePolicy: FeePolicy.ORGANIZER_SHARE,
        feeBearer: { name: "Maya", userId: "u-maya" },
      },
    ],
  );
  assert.equal(d.sections[RulesSection.ADVANCE].status, DraftStatus.ASK);
});

test("each reading becomes per-person dollars through the settlement engine", () => {
  const d = extractionDraft(feesQuestion, "doc", grossText, twoPeople);
  const fees = d.sections[RulesSection.FEES];
  assert.equal(fees.status, DraftStatus.ASK);
  if (fees.status !== DraftStatus.ASK || !fees.question) return;
  const source = {
    origin: "SOURCE_CLAUSE",
    documentId: "doc",
    clause: "Shares",
    excerpt: grossQuote,
  };
  const draft: Rules = {
    currency: "USD",
    shares: [
      { userId: "u-maya", basisPoints: 6000 },
      { userId: "u-jordan", basisPoints: 4000 },
    ],
    feePolicy: FeePolicy.BEFORE_SPLIT,
    source,
    unresolvedQuestions: [],
  };
  const agreement = {
    id: "c1",
    workspaceId: "w1",
    revision: 1,
    value: {
      name: "Shows",
      members: twoPeople,
      versions: [],
      revenue: [],
      recoupedByAdvance: {},
      reviewHold: false,
      audit: [],
    },
  } as unknown as Agreement;
  const previews = readingPreviews(
    agreement,
    draft,
    fees.question,
    10_000,
    300,
  );
  assert.deepEqual(
    previews.map((p) => p.error),
    [null, null],
  );
  const cents = previews.map((p) =>
    Object.fromEntries(
      p.preview!.allocations.map((a) => [a.userId, a.totalCents]),
    ),
  );
  // $100 gross, $3 fee. Fees first: 60/40 of $97. Maya pays: 60/40 of $100, Maya minus $3.
  assert.deepEqual(cents, [
    { "u-maya": 5820, "u-jordan": 3880 },
    { "u-maya": 5700, "u-jordan": 4000 },
  ]);
  assert.equal(
    applyReading(draft, {
      feePolicy: FeePolicy.ORGANIZER_SHARE,
      feeBearer: { name: "Sam", userId: null },
    }),
    null,
    "a reading naming an unmatched person cannot be applied",
  );
});

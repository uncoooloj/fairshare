/**
 * Recorded extraction v2 results, built by hand from the @fairshare/contract-ai types
 * (ExtractionResult, ExtractedFact, ContractIssue, SectionSummary). No AI calls.
 */

export enum Status {
  READ = "READ",
  ASK = "ASK",
  NOT_FOUND = "NOT_FOUND",
}

export const MIDNIGHT = [
  "Midnight Sessions",
  "Revenue Share Agreement",
  "",
  "1. Term",
  "This agreement starts on October 1, 2026 and ends on September 30, 2027.",
  "",
  "4. Payments",
  "4.1 Maya Okafor paid a $2,000 advance, which is paid back before any split.",
  "4.2 Net revenue is split 50% to Maya Okafor, 30% to Jordan Reyes and 20% to Riley Chen.",
  "4.3 PayPal fees come off the top before the split.",
  "",
  "5. Refunds",
  "5.2 Refunds shall be deducted from future Net Revenue.",
].join("\n");

export function cite(doc: string, quote: string) {
  const start = doc.indexOf(quote);
  if (start < 0) throw new Error(`Not in the document: ${quote}`);
  return { start, end: start + quote.length, quote };
}

const SECTIONS = ["SPLIT", "ADVANCE", "FEES", "REFUNDS", "TERM", "PEOPLE"];

/** A REVIEW_REQUIRED result; sections default to NOT_FOUND. */
export function reading(
  doc: string,
  {
    title,
    facts = [],
    issues = [],
    sections = {},
  }: {
    title?: string;
    facts?: Record<string, unknown>[];
    issues?: Record<string, unknown>[];
    sections?: Record<string, Status>;
  },
) {
  return {
    status: "REVIEW_REQUIRED",
    documentId: "doc-1",
    revision: 1,
    sourceHash: "hash",
    requiresHumanReview: true,
    executable: false,
    provider: "cloudflare",
    model: "fixture",
    fallbackFrom: null,
    promptVersion: "contract-extraction-v4",
    reason: null,
    ...(title
      ? { suggestedTitle: title, titleCitation: cite(doc, title) }
      : {}),
    facts,
    issues,
    rejections: [],
    sections: Object.fromEntries(
      SECTIONS.map((s) => [
        s,
        {
          status: sections[s] ?? Status.NOT_FOUND,
          factIndexes: [],
          issueIndex: null,
        },
      ]),
    ),
  };
}

const SPLIT_SENTENCE =
  "Net revenue is split 50% to Maya Okafor, 30% to Jordan Reyes and 20% to Riley Chen.";
const ADVANCE_SENTENCE =
  "Maya Okafor paid a $2,000 advance, which is paid back before any split.";

export const share = (
  doc: string,
  name: string,
  percent: number,
  quote = SPLIT_SENTENCE,
) => ({
  kind: "SHARE",
  subject: name,
  rawValue: `${percent}%`,
  basisPoints: percent * 100,
  citation: cite(doc, quote),
});
export const person = (doc: string, name: string, quote: string) => ({
  kind: "PERSON",
  subject: name,
  rawValue: name,
  citation: cite(doc, quote),
});
export const advance = (
  doc: string,
  recoupedBeforeSplit: boolean | null,
  quote = ADVANCE_SENTENCE,
) => ({
  kind: "ADVANCE",
  subject: "Maya Okafor",
  rawValue: "$2,000",
  amountCents: 200_000,
  recoupedBeforeSplit,
  citation: cite(doc, quote),
});

/** Everything read: title, dates, people, a full split, an advance paid back first, fees. */
export function fullReading(doc = MIDNIGHT) {
  return reading(doc, {
    title: "Midnight Sessions",
    facts: [
      {
        kind: "TERM",
        subject: "October 1, 2026",
        rawValue: "October 1, 2026",
        boundary: "START",
        date: "2026-10-01",
        citation: cite(
          doc,
          "This agreement starts on October 1, 2026 and ends on September 30, 2027.",
        ),
      },
      {
        kind: "TERM",
        subject: "September 30, 2027",
        rawValue: "September 30, 2027",
        boundary: "END",
        date: "2027-09-30",
        citation: cite(
          doc,
          "This agreement starts on October 1, 2026 and ends on September 30, 2027.",
        ),
      },
      share(doc, "Maya Okafor", 50),
      share(doc, "Jordan Reyes", 30),
      share(doc, "Riley Chen", 20),
      person(doc, "Maya Okafor", SPLIT_SENTENCE),
      person(doc, "Jordan Reyes", SPLIT_SENTENCE),
      person(doc, "Riley Chen", SPLIT_SENTENCE),
      advance(doc, true),
      {
        kind: "FEES",
        subject: "PayPal fees",
        rawValue: "PayPal fees",
        feePolicy: "BEFORE_SPLIT",
        feeBearer: null,
        citation: cite(doc, "PayPal fees come off the top before the split."),
      },
    ],
    sections: {
      SPLIT: Status.READ,
      ADVANCE: Status.READ,
      FEES: Status.READ,
      TERM: Status.READ,
      PEOPLE: Status.READ,
    },
  });
}

/** Split read; the advance doesn't say if it's paid back first (the AI asks); fees silent. */
export function partialReading() {
  const doc = MIDNIGHT.replace(", which is paid back before any split", "");
  const quote = "Maya Okafor paid a $2,000 advance.";
  return {
    doc,
    extraction: reading(doc, {
      title: "Midnight Sessions",
      facts: [
        share(doc, "Maya Okafor", 50),
        share(doc, "Jordan Reyes", 30),
        share(doc, "Riley Chen", 20),
        advance(doc, null, quote),
      ],
      issues: [
        {
          topic: "ADVANCE",
          question: "Is Maya's $2,000 paid back before the split?",
          citation: cite(doc, quote),
          readings: [
            {
              label: "Paid back first",
              explanation: "Maya gets $2,000 back before anyone splits.",
              setting: { advanceRecoupedBeforeSplit: true },
            },
            {
              label: "Not paid back",
              explanation: "Everything is split from the first dollar.",
              setting: { advanceRecoupedBeforeSplit: false },
            },
          ],
        },
      ],
      sections: {
        SPLIT: Status.READ,
        ADVANCE: Status.ASK,
        FEES: Status.ASK,
        PEOPLE: Status.NOT_FOUND,
      },
    }),
  };
}

/** Names, but no percentages anywhere. */
export function namesOnlyReading() {
  const doc =
    "Midnight Sessions\n2. Parties\nThis agreement is between Maya Okafor, Jordan Reyes and Riley Chen.";
  const quote =
    "This agreement is between Maya Okafor, Jordan Reyes and Riley Chen.";
  return {
    doc,
    extraction: reading(doc, {
      title: "Midnight Sessions",
      facts: ["Maya Okafor", "Jordan Reyes", "Riley Chen"].map((n) =>
        person(doc, n, quote),
      ),
      sections: { SPLIT: Status.ASK, PEOPLE: Status.READ, FEES: Status.ASK },
    }),
  };
}

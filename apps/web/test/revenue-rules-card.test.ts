import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Agreement, Rules, Version } from "../lib/model";
import {
  RecoupmentCard,
  RevenueRulesCard,
} from "../components/agreement-workspace";

const members = [
  { userId: "maya", displayName: "Maya", role: "ORGANIZER" },
  { userId: "jordan", displayName: "Jordan", role: "COLLABORATOR" },
  { userId: "riley", displayName: "Riley", role: "COLLABORATOR" },
];
const fromDoc = (clause: string) => ({
  origin: "SOURCE_CLAUSE",
  documentId: "doc",
  clause,
  excerpt: "quote",
});

function agreement(
  versions: Version[],
  activeVersionId?: number,
  recouped = 0,
): Agreement {
  return {
    workspaceId: "w",
    id: "a",
    revision: 1,
    value: {
      name: "Midnight Sessions",
      details: {
        currency: "USD",
        effectiveFrom: "2026-10-01",
        effectiveTo: "2027-09-30",
      },
      members,
      versions,
      activeVersionId,
      revenue: [],
      recoupedByAdvance: { adv: recouped },
    },
  } as unknown as Agreement;
}

const shared: Rules = {
  currency: "USD",
  shares: [
    { userId: "maya", basisPoints: 5000 },
    { userId: "jordan", basisPoints: 3000 },
    { userId: "riley", basisPoints: 2000 },
  ],
  feePolicy: "BEFORE_SPLIT",
  advance: {
    id: "adv",
    recipientId: "maya",
    amountCents: 200000,
    verified: true,
    source: fromDoc("Clause 4.1"),
  },
  source: fromDoc("4.2"),
  unresolvedQuestions: [],
};
const version = (id: number, status: string, rules: Rules): Version => ({
  id,
  status,
  rules,
  approvals: {},
  changeRequests: [],
});

const render = (a: Agreement, v: Version) =>
  renderToStaticMarkup(
    createElement(RevenueRulesCard, { agreement: a, version: v }),
  );

test("active rules render as one card of plain numbered steps", () => {
  const v = version(1, "ACTIVE", shared);
  const html = render(agreement([v], 1), v);
  assert.match(html, /Revenue rules/);
  assert.match(html, /Every payment runs through these steps, in order\./);
  assert.match(html, /In use/);
  for (const label of ["PayPal fee", "Advance paid back first", "Split"])
    assert.match(html, new RegExp(`>${label}<`));
  assert.match(html, /Maya gets their \$2,000 advance back before any split\./);
  assert.match(html, /The rest is split 50 \/ 30 \/ 20\./);
  assert.match(html, /Maya 50%/);
  assert.match(html, /Riley 20%/);
  assert.match(html, /<h3>Current agreement dates<\/h3>/);
  assert.match(html, /<dt>Start<\/dt><dd>Oct 1, 2026<\/dd>/);
  assert.match(html, /<dt>End<\/dt><dd>Sep 30, 2027<\/dd>/);
  assert.doesNotMatch(html, /payments from/);
  // Clause chips show the bare clause number and open the document.
  assert.match(html, /aria-label="Clause 4\.1: show it in the document"/);
  assert.match(html, /<\/svg>4\.2<\/button>/);
  assert.match(html, /aria-expanded="true"/);
  assert.doesNotMatch(
    html,
    /Rules in v|Fees first|Advance payback|Revenue sharing proposal|split-bar|Total/,
  );
});

test("one person at 100% gets a sentence and a chip, no split bar", () => {
  const rules: Rules = {
    ...shared,
    advance: undefined,
    shares: [{ userId: "maya", basisPoints: 10000 }],
    source: {
      origin: "HUMAN_PROPOSAL",
      documentId: "doc",
      clause: "Revenue sharing proposal",
      excerpt: "Proposed split clarification: Maya 100%.",
    },
  };
  const v = version(1, "ACTIVE", rules);
  const html = render(agreement([v], 1), v);
  assert.match(html, /Maya gets 100%\./);
  assert.match(html, /Added by the team/);
  assert.doesNotMatch(
    html,
    /split-bar|Revenue sharing proposal|Proposed split clarification/,
  );
});

test("a version sent for approval uses the same card with its own badge", () => {
  const active = version(1, "ACTIVE", shared);
  const pending = version(2, "AWAITING_APPROVAL", shared);
  const html = render(agreement([active, pending], 1), pending);
  assert.match(html, /Waiting for approval/);
  assert.doesNotMatch(html, /In use/);
});

test("advance allocation card uses truthful ledger language", () => {
  const html = renderToStaticMarkup(
    createElement(RecoupmentCard, {
      agreement: agreement([], 1, 200000),
      rules: shared,
    }),
  );
  assert.match(html, /Advance allocation/);
  assert.match(html, /\$2,000 of \$2,000 allocated toward the advance/);
  assert.match(html, /Fully allocated/);
  assert.match(html, /Every payment now splits 50 \/ 30 \/ 20\./);
  assert.doesNotMatch(html, /paid back|has their advance back/);
});

test("current agreement dates preserve end-only, missing-end and no-end states", () => {
  const v = version(1, "ACTIVE", { ...shared, advance: undefined });
  const withDetails = (details: {
    effectiveFrom?: string;
    effectiveTo?: string | null;
  }) => {
    const a = agreement([v], 1);
    a.value.details = {
      currency: "USD",
      ...details,
    } as Agreement["value"]["details"];
    return render(a, v);
  };
  assert.match(
    withDetails({ effectiveTo: "2027-09-30" }),
    /<dt>Start<\/dt><dd>Not recorded<\/dd>[\s\S]*<dt>End<\/dt><dd>Sep 30, 2027<\/dd>/,
  );
  assert.match(
    withDetails({ effectiveFrom: "2026-10-01", effectiveTo: undefined }),
    /<dt>Start<\/dt><dd>Oct 1, 2026<\/dd>[\s\S]*<dt>End<\/dt><dd>Not recorded<\/dd>/,
  );
  assert.match(
    withDetails({ effectiveFrom: "2026-10-01", effectiveTo: null }),
    /<dt>Start<\/dt><dd>Oct 1, 2026<\/dd>[\s\S]*<dt>End<\/dt><dd>No end date<\/dd>/,
  );
  assert.doesNotMatch(withDetails({}), /ag-current-details/);
});

test("clause requests include the producing version and document identity", () => {
  const workspace = readFileSync(
    new URL("../components/agreement-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(workspace, /versionId,\s*documentId/);
  assert.match(workspace, /id: source\.citation/);
  const documentView = readFileSync(
    new URL("../components/document-citation-view.tsx", import.meta.url),
    "utf8",
  );
  assert.match(documentView, /pendingCitation/);
  assert.match(documentView, /matchesCitationTarget/);
  assert.match(documentView, /typeof detail !== "string"/);
});

test("the Agreement tab drops the old source and active-rules blocks", () => {
  const read = (path: string) =>
    readFileSync(new URL(path, import.meta.url), "utf8");
  const terms = read("../components/sections/agreement-tabs/terms-tab.tsx");
  assert.match(terms, /<RevenueRulesCard/);
  assert.match(terms, /Change the agreement/);
  assert.doesNotMatch(terms, /Written by your team|Rules in v/);
  const review = read("../components/contract-review-guidance.tsx");
  assert.match(review, /const inUse = version\.status === "ACTIVE"/);
});

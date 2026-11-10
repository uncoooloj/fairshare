import test from "node:test";
import assert from "node:assert/strict";
import { suggestedShares } from "../lib/ai-draft";
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

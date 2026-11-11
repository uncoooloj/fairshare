import test from "node:test";
import assert from "node:assert/strict";
import { documentCitations } from "../lib/document-citations";
import { highlightSegments } from "../lib/source-highlights";
import type { Version } from "../lib/model";
const version: Version = {
  id: 1,
  status: "ACTIVE",
  approvals: {},
  changeRequests: [],
  rules: {
    currency: "USD",
    shares: [],
    feePolicy: "BEFORE_SPLIT",
    unresolvedQuestions: [],
    source: {
      documentId: "d",
      origin: "HUMAN_PROPOSAL",
      clause: "4.2",
      excerpt: "Half each.",
    },
  },
};
const document = { documentId: "d", text: "Terms\nHalf each.\nEnd" };
test("exact saved quote locates and shared renderer preserves source", () => {
  const [citation] = documentCitations(version, document);
  assert.equal(citation.highlight?.start, 6);
  assert.equal(
    highlightSegments(document.text, [citation.highlight!])
      .map((x) => x.text)
      .join(""),
    document.text,
  );
});
test("wrong document, edited wording and repeated quotes never guess a position", () => {
  for (const doc of [
    { ...document, documentId: "new" },
    { ...document, text: "Half for each." },
    { ...document, text: "Half each. Half each." },
  ]) {
    const [citation] = documentCitations(version, doc);
    assert.equal(citation.highlight, undefined);
    assert.ok(citation.unavailable);
  }
});
test("page number requires actual unambiguous range mapping, not page count", () => {
  assert.equal(
    documentCitations(version, { ...document, provenance: { pages: 12 } })[0]
      .page,
    undefined,
  );
  assert.equal(
    documentCitations(version, {
      ...document,
      provenance: { pages: [{ page: 3, start: 0, end: document.text.length }] },
    })[0].page,
    3,
  );
  assert.equal(
    documentCitations(version, {
      ...document,
      provenance: { pages: [{ page: 3, start: 0, end: 999 }] },
    })[0].page,
    undefined,
  );
  assert.equal(
    documentCitations(version, {
      ...document,
      provenance: {
        pages: [
          { page: 3, start: 0, end: 19 },
          { page: 4, start: 0, end: 19 },
        ],
      },
    })[0].page,
    undefined,
  );
});
test("no proposed version does not invent citations", () =>
  assert.deepEqual(documentCitations(undefined, document), []));
test("recoup citation uses its own historical document and does not borrow primary source", () => {
  const withAdvance = {
    ...version,
    rules: {
      ...version.rules,
      advance: {
        id: "a",
        recipientId: "m",
        amountCents: 100,
        verified: true,
        source: { ...version.rules.source, documentId: "old" },
      },
    },
  };
  const citations = documentCitations(withAdvance, document);
  assert.ok(citations[0].highlight);
  assert.equal(citations[1].highlight, undefined);
});
test("empty quotes and case-insensitive approximations are not locatable", () => {
  for (const excerpt of ["", " ", "half each."])
    assert.equal(
      documentCitations(
        {
          ...version,
          rules: {
            ...version.rules,
            source: { ...version.rules.source, excerpt },
          },
        },
        document,
      )[0].highlight,
      undefined,
    );
});

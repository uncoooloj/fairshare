import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  citationSummary,
  CitationId,
  documentCitations,
  documentPages,
  pageBlocks,
  pageIndexOf,
  searchHighlights,
  SourceOrigin,
} from "../lib/document-citations";
import { DocumentCitationView } from "../components/document-citation-view";
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
test("pages come from real ranges; pasted text is one page", () => {
  const text = "Page one text\nPage two text";
  assert.deepEqual(documentPages(text), {
    pages: [{ page: 1, start: 0, end: text.length }],
    paged: false,
  });
  const paged = documentPages(text, [
    { page: 2, start: 14, end: text.length },
    { page: 1, start: 0, end: 13 },
  ]);
  assert.equal(paged.paged, true);
  assert.deepEqual(
    paged.pages.map((p) => p.page),
    [1, 2],
  );
  assert.equal(pageIndexOf(paged.pages, 20), 1);
  // Overlapping or out-of-range ranges fall back to one page.
  assert.equal(
    documentPages(text, [
      { page: 1, start: 0, end: 20 },
      { page: 2, start: 10, end: text.length },
    ]).paged,
    false,
  );
  assert.equal(documentPages(text, 12).paged, false);
});
test("page blocks split lines and keep highlight offsets absolute", () => {
  const text = "Intro\n\nHalf each. Rest\nEnd";
  const [citation] = documentCitations(version, { documentId: "d", text });
  const blocks = pageBlocks(text, { page: 1, start: 0, end: text.length }, [
    citation.highlight!,
  ]);
  assert.deepEqual(
    blocks.map((b) => b.segments.map((s) => s.text).join("")),
    ["Intro", "Half each. Rest", "End"],
  );
  const marked = blocks[1].segments.find((s) => s.ids.length);
  assert.equal(marked?.text, "Half each.");
  assert.equal(marked?.start, 7);
});
test("search finds every case-insensitive match", () => {
  const found = searchHighlights("Net revenue. NET Revenue.", "net revenue");
  assert.deepEqual(
    found.map((f) => f.start),
    [0, 13],
  );
  assert.equal(searchHighlights("abc", "a").length, 0);
});
test("summaries use plain words", () => {
  const rules = {
    ...version.rules,
    shares: [
      { userId: "m", basisPoints: 5000 },
      { userId: "j", basisPoints: 3000 },
      { userId: "r", basisPoints: 2000 },
    ],
    advance: {
      id: "a",
      recipientId: "m",
      amountCents: 200000,
      verified: true,
      source: version.rules.source,
    },
  };
  const names = (id: string) => ({ m: "Maya" })[id as "m"] ?? id;
  const withRules = { ...version, rules };
  assert.equal(
    citationSummary(CitationId.Rules, withRules, names),
    "Split 50 / 30 / 20 after the advance is paid back",
  );
  assert.equal(
    citationSummary(CitationId.Advance, withRules, names),
    "Maya's $2,000 advance is paid back first",
  );
});
test("team-typed rules are counted, never listed as cited clauses", () => {
  const html = renderToStaticMarkup(
    createElement(DocumentCitationView, {
      version: {
        ...version,
        rules: {
          ...version.rules,
          shares: [{ userId: "b", basisPoints: 10000 }],
          source: {
            ...version.rules.source,
            excerpt: "Proposed split clarification: Betty White 100%.",
          },
        },
      },
      document,
      fileName: "Brief.pdf",
      nameOf: () => "Betty White",
    }),
  );
  assert.match(html, /1 rule was added by you, not from the document/);
  assert.doesNotMatch(html, /Proposed split clarification|exactly match/);
  assert.doesNotMatch(html, /class="dv-clause"/);
});
test("a document clause gets a card with its clause, page and summary", () => {
  const text = "Cover\nHalf each.\nEnd";
  const html = renderToStaticMarkup(
    createElement(DocumentCitationView, {
      version: {
        ...version,
        rules: {
          ...version.rules,
          shares: [
            { userId: "a", basisPoints: 5000 },
            { userId: "b", basisPoints: 5000 },
          ],
          source: { ...version.rules.source, origin: SourceOrigin.Document },
        },
      },
      document: {
        documentId: "d",
        text,
        provenance: {
          pages: [
            { page: 1, start: 0, end: 5 },
            { page: 2, start: 6, end: text.length },
          ],
        },
      },
      fileName: "Deal.pdf",
      nameOf: (id: string) => id,
    }),
  );
  assert.match(html, /Cited clauses/);
  assert.match(html, /4\.2/);
  assert.match(html, /Page 2/);
  assert.match(html, /Split 50 \/ 50/);
  assert.match(html, /1 \/ 2/);
  assert.doesNotMatch(html, /added by you/);
});

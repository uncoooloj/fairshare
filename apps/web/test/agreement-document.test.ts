import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveCitationTarget } from "../components/agreement-document";
import {
  documentCitations,
  matchesCitationTarget,
} from "../lib/document-citations";
import { highlightSegments } from "../lib/source-highlights";
import type { Version } from "../lib/model";
const source = readFileSync(
  new URL("../components/agreement-document.tsx", import.meta.url),
  "utf8",
);
test("document view uses version-pinned API source and clears stale content", () => {
  assert.match(source, /version\?\.rules.source.documentId/);
  assert.match(
    source,
    /recoverSourceDocument\(\s*base,\s*sourceId,\s*api,?\s*\)/,
  );
  assert.match(source, /setDocument\(\s*null\s*\)/);
  assert.match(source, /if\s*\(\s*!stale\s*\)/);
  assert.match(source, /stale\s*=\s*true/);
  assert.match(source, /setPendingCitation\(detail\)/);
  assert.match(source, /setRequestedDocumentId\(target\.documentId\)/);
  assert.match(source, /pendingCitation=\{pendingCitation\}/);
});

function version(id: number, documentId: string, excerpt: string): Version {
  return {
    id,
    status: "ACTIVE",
    approvals: {},
    changeRequests: [],
    rules: {
      currency: "USD",
      shares: [],
      feePolicy: "BEFORE_SPLIT",
      unresolvedQuestions: [],
      source: {
        origin: "SOURCE_CLAUSE",
        documentId,
        clause: "4.2",
        excerpt,
      },
    },
  };
}

test("scoped citation selects its version and document before highlighting the quote", () => {
  const first = version(1, "doc-v1", "V1 quote");
  const second = version(2, "doc-v2", "V2 quote");
  const request = {
    id: "rules-source",
    versionId: 2,
    documentId: "doc-v2",
  };
  assert.deepEqual(resolveCitationTarget([first, second], request, 1), {
    versionId: 2,
    documentId: "doc-v2",
  });
  assert.equal(matchesCitationTarget(request, 2, "doc-v2"), true);
  assert.equal(matchesCitationTarget(request, 1, "doc-v1"), false);
  assert.equal(
    resolveCitationTarget(
      [first, second],
      { ...request, documentId: "doc-v1" },
      1,
    ),
    undefined,
  );
  const [citation] = documentCitations(second, {
    documentId: "doc-v2",
    text: "Terms\nV2 quote\nEnd",
  });
  assert.ok(citation.highlight);
  assert.ok(
    highlightSegments("Terms\nV2 quote\nEnd", [citation.highlight]).some(
      (segment) => segment.ids.includes(citation.highlight!.id),
    ),
  );
});
test("document starts on the terms version and resets only when that review target changes", () => {
  assert.match(source, /reviewedVersionId\?: number/);
  assert.match(source, /reviewedVersionId \?\?/);
  const detail = readFileSync(
    new URL("../components/sections/agreement-detail.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    detail,
    /key=\{`\$\{selected\.id\}:\$\{latest\?\.id \?\? ""\}`\}/,
  );
  assert.match(detail, /reviewedVersionId=\{latest\?\.id\}/);
});
test("document content is rendered as plain text and download accurately labelled", () => {
  assert.match(source, /<DocumentCitationView/);
  const viewer = readFileSync(
    new URL("../components/document-citation-view.tsx", import.meta.url),
    "utf8",
  );
  assert.match(viewer, /\{segment.text\}/);
  assert.doesNotMatch(viewer, /dangerouslySetInnerHTML|innerHTML/);
  assert.doesNotMatch(
    source,
    /dangerouslySetInnerHTML|innerHTML|application\/pdf/,
  );
  assert.match(source, /Download text/);
  assert.match(source, /text\/plain;charset=utf-8/);
  assert.match(source, /URL.revokeObjectURL/);
  assert.match(viewer, /This is the text we read from your file\./);
  assert.doesNotMatch(source, /File details|Fingerprint/);
  // The caveat paragraph and its label are gone; the tooltip carries it.
  assert.doesNotMatch(source, /Saved agreement text|Each update keeps/);
});
test("the Agreement tab leads with the document; downloads live in the header menu", () => {
  const detail = readFileSync(
    new URL("../components/sections/agreement-detail.tsx", import.meta.url),
    "utf8",
  );
  const terms = detail.indexOf("{shown === AgreementTab.Terms && (");
  const documentAt = detail.indexOf("<AgreementDocument", terms);
  const rulesAt = detail.indexOf("<AgreementTermsTab", terms);
  assert.ok(documentAt > terms && documentAt < rulesAt);
  assert.doesNotMatch(detail, /DocumentFileDetails/);
  assert.match(detail, /label: "Download original"/);
  assert.match(detail, /label: "Download text"/);
  assert.match(detail, /onDocument=\{setLoadedDocument\}/);
});
test("the Agreement tab follows the design: no payment preview, versions beside the rules", () => {
  const terms = readFileSync(
    new URL(
      "../components/sections/agreement-tabs/terms-tab.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(terms, /Try a payment|PreviewForm/);
  assert.match(terms, /<aside className="ag-terms-rail">/);
  const detail = readFileSync(
    new URL("../components/sections/agreement-detail.tsx", import.meta.url),
    "utf8",
  );
  assert.match(detail, /label: "Upload amended agreement"/);
  assert.match(detail, /organizer && selected\.value\.versions\.length > 0/);
  // An amendment starts from a new local source; it must not reuse the
  // approved version's immutable document or extraction.
  assert.match(
    detail,
    /label: "Upload amended agreement"[\s\S]*?if \(!mayLeaveDraft\(\)\) return;[\s\S]*?setSource\(""\);[\s\S]*?setDocumentId\(""\);[\s\S]*?setExtraction\(null\);[\s\S]*?setEditing\(true\)/,
  );
});
test("rule cards carry their own comments; Term shares the overall thread", () => {
  const terms = readFileSync(
    new URL(
      "../components/sections/agreement-tabs/terms-tab.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(terms, /\[RuleKind\.Fees\]: RuleStep\.FEES/);
  assert.match(terms, /\[RuleKind\.Advance\]: RuleStep\.ADVANCE/);
  assert.match(terms, /\[RuleKind\.Split\]: RuleStep\.SPLIT/);
  assert.doesNotMatch(terms, /RuleKind\.Term\]/);
  assert.doesNotMatch(terms, /<ReviewDiscussion/);
  assert.equal(terms.match(/<AgreementComments/g)?.length, 2);
  assert.equal(terms.match(/ruleSlot=\{ruleCommentSlot/g)?.length, 2);
});

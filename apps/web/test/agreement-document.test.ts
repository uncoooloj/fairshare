import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  assert.match(source, /File details/);
  assert.match(source, /Fingerprint/);
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
  const detailsAt = detail.indexOf("<DocumentFileDetails", terms);
  assert.ok(documentAt > terms && documentAt < rulesAt);
  assert.ok(detailsAt > rulesAt);
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

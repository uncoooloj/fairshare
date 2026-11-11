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

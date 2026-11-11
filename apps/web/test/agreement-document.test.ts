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
  const renderer = readFileSync(
    new URL("../components/source-rule-context.tsx", import.meta.url),
    "utf8",
  );
  assert.match(renderer, /\{segment.text\}/);
  assert.doesNotMatch(renderer, /dangerouslySetInnerHTML|innerHTML/);
  assert.doesNotMatch(
    source,
    /dangerouslySetInnerHTML|innerHTML|application\/pdf/,
  );
  assert.match(source, /Download text/);
  assert.match(source, /text\/plain;charset=utf-8/);
  assert.match(source, /URL.revokeObjectURL/);
  assert.match(source, /This is the text we read from your file\./);
  assert.match(source, /File details/);
  assert.match(source, /Fingerprint/);
  assert.match(
    source,
    /Each\s+update\s+keeps\s+the\s+document\s+it\s+was\s+made\s+from/,
  );
});

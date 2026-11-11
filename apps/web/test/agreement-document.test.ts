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
  assert.match(source, /Download extracted text/);
  assert.match(source, /text\/plain;charset=utf-8/);
  assert.match(source, /URL.revokeObjectURL/);
  assert.match(
    source,
    /Each\s+version\s+keeps\s+the\s+document\s+it\s+was\s+created\s+from/,
  );
  assert.match(source, /not a signature verification/);
  assert.match(source, /Source details/);
  assert.match(source, /Source hash/);
});

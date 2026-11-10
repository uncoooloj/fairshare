import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../components/agreement-document.tsx", import.meta.url),
  "utf8",
);
test("document view uses version-pinned API source and clears stale content", () => {
  assert.match(source, /version\?\.rules.source.documentId/);
  assert.match(source, /recoverSourceDocument\(base,sourceId,api\)/);
  assert.match(source, /setDocument\(null\)/);
  assert.match(source, /if\(!stale\)/);
  assert.match(source, /stale=true/);
});
test("document content is rendered as plain text and download accurately labelled", () => {
  assert.match(source, /<pre>\{document.text\}<\/pre>/);
  assert.doesNotMatch(
    source,
    /dangerouslySetInnerHTML|innerHTML|application\/pdf/,
  );
  assert.match(source, /Download extracted text/);
  assert.match(source, /text\/plain;charset=utf-8/);
  assert.match(source, /URL.revokeObjectURL/);
  assert.match(source, /not the original PDF or a signature verification/);
});

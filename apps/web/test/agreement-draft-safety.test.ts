import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const app = readFileSync(
  new URL("../components/fairshare-app.tsx", import.meta.url),
  "utf8",
);
const widgets = readFileSync(
  new URL("../components/agreement-widgets.tsx", import.meta.url),
  "utf8",
);
const editor = widgets.slice(widgets.indexOf("export function RulesEditor("));

test("agreement edits guard navigation and closing the browser before discarding work", () => {
  assert.match(app, /draftDirty\s*&&\s*!window\.confirm/);
  assert.match(app, /window.addEventListener\("beforeunload", warn\)/);
  assert.match(app, /window.removeEventListener\("beforeunload", warn\)/);
  assert.match(
    app,
    /function navigate\(s: Section\) \{\s*if \(!mayLeaveDraft\(\)\) return/,
  );
  assert.match(app, /onNavigate=\{changeAgreementTab\}/);
  assert.match(app, /changeAgreementTab\(next\)/);
  assert.match(app, /Back to proposed terms/);
});
test("manual rules and suggested shares both mark the proposal dirty; saving clears it only after server success", () => {
  assert.match(editor, /onChange=\{onDirty\}/);
  assert.match(editor, /onDirty\?\.\(\);\s*setPrefilled\(true\)/);
  assert.match(
    app,
    /await mutate\("\/versions", \{ rules \}\);\s*setDraftDirty\(false\)/,
  );
  assert.match(editor, /inert=\{busy\}/);
});
test("source upload can be retried with same file and late agreement reads cannot replace current source", () => {
  assert.match(app, /e.target.value = ""/);
  assert.match(app, /Replace your unsaved source and rules draft/);
  assert.equal((app.match(/request !== openRequest.current/g) || []).length, 3);
  assert.match(app, /rows=\{8\}\s*disabled=\{busy\}/);
});

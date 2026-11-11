import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isRulesDraftChange } from "../lib/rule-impact";
import { appSource } from "./app-source";
const app = appSource();
const widgets = readFileSync(
  new URL("../components/agreement-widgets.tsx", import.meta.url),
  "utf8",
);
const impactReview = readFileSync(
  new URL("../components/rule-impact-review.tsx", import.meta.url),
  "utf8",
);
const editor = widgets.slice(widgets.indexOf("export function RulesEditor("));

test("agreement edits guard navigation and closing the browser before discarding work", () => {
  assert.match(app, /draftDirty\s*&&\s*!window\.confirm/);
  assert.match(app, /window.addEventListener\("beforeunload", warn\)/);
  assert.match(app, /window.removeEventListener\("beforeunload", warn\)/);
  assert.match(
    app,
    /function navigate\(s:\s*Section\)\s*\{\s*if\s*\(\s*!mayLeaveDraft\(\)\s*\)\s*return/,
  );
  assert.match(app, /onNavigate=\{changeAgreementTab\}/);
  assert.match(app, /changeAgreementTab\(next\)/);
  assert.match(app, /Back to proposed terms/);
});
test("manual rules and suggested shares both mark the proposal dirty; saving clears it only after server success", () => {
  assert.match(
    editor,
    /if \(isRulesDraftChange\(event.target\)\) onDirty\?\.\(\)/,
  );
  assert.match(editor, /onDirty\?\.\(\);\s*setPrefilled\(true\)/);
  assert.match(
    app,
    /await mutate\("\/versions", \{ rules \}\);\s*setDraftDirty\(false\)/,
  );
  assert.match(editor, /inert=\{busy\}/);
});
test("illustrative fee comparison inputs do not mark the rules draft dirty", () => {
  assert.equal(
    isRulesDraftChange({ dataset: { illustrative: "true" } }),
    false,
  );
  assert.equal(isRulesDraftChange({}), true);
  assert.match(
    editor,
    /onChangeCapture=\{\(event\) => \{\s*if \(isRulesDraftChange\(event.target\)\)/,
  );
  assert.match(
    impactReview,
    /data-illustrative="true"[\s\S]*?value=\{gross\}[\s\S]*?data-illustrative="true"[\s\S]*?value=\{fees\}/,
  );
});
test("changing only the fee proposal preserves source evidence for an unchanged advance", () => {
  assert.match(
    editor,
    /old\.advance\.id === id[\s\S]*?old\.advance\.recipientId === recipientId[\s\S]*?old\.advance\.amountCents === amountCents[\s\S]*?\? old\.advance\.source[\s\S]*?: ref/,
  );
});
test("source upload can be retried with same file and late agreement reads cannot replace current source", () => {
  assert.match(app, /e.target.value = ""/);
  assert.match(app, /Replace your unsaved source and rules draft/);
  // openAgreement fences two awaits; resumeDraft (wizard drafts) fences one more.
  assert.equal((app.match(/request !== openRequest.current/g) || []).length, 4);
  assert.match(app, /rows=\{8\}\s*disabled=\{busy\}/);
});

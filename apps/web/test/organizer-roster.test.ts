import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const widgets = readFileSync(
  new URL("../components/agreement-widgets.tsx", import.meta.url),
  "utf8",
);
const editor = widgets.slice(widgets.indexOf("export function RulesEditor("));
test("first proposal requires explicit roster review before locking membership", () => {
  assert.match(
    editor,
    /!agreement\.value\.versions\.length\s*&&\s*f\.get\("rosterConfirmed"\)\s*!==\s*"on"/,
  );
  assert.match(editor, /name="rosterConfirmed"\s+required/);
  assert.match(editor, /even in a revised version/);
  assert.match(
    editor,
    /type="button"\s+variant="secondary"\s+disabled=\{busy\}\s+onClick=\{onReviewPeople\}/,
  );
});
test("roster confirmation resets after membership changes and permits intentional solo agreements", () => {
  assert.match(
    editor,
    /key=\{agreement\.value\.members\s*\.map\(\(member\)\s*=>\s*member\.userId\)\s*\.join\(":"\)\}/,
  );
  assert.match(
    editor,
    /A one-person agreement is allowed\s+when that is intentional/,
  );
  assert.doesNotMatch(editor, /members.length\s*[<>]=?\s*2/);
});

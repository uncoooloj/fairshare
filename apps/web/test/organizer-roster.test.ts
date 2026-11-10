import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const widgets = readFileSync(
  new URL("../components/agreement-widgets.tsx", import.meta.url),
  "utf8",
);
const editor = widgets
  .slice(widgets.indexOf("export function RulesEditor("))
  .replace(/\s+/g, " ");
test("first proposal requires explicit roster review before locking membership", () => {
  assert.match(
    editor,
    /!agreement.value.versions.length && f.get\("rosterConfirmed"\) !== "on"/,
  );
  assert.match(editor, /name="rosterConfirmed" required/);
  assert.match(editor, /even in a revised version/);
  assert.match(
    editor,
    /type="button"[\s\S]*variant="secondary"[\s\S]*disabled=\{busy\}[\s\S]*onClick=\{onReviewPeople\}/,
  );
});
test("roster confirmation resets after membership changes and permits intentional solo agreements", () => {
  assert.match(
    editor,
    /key=\{agreement.value.members\s*\.map\(\(member\) => member.userId\)\s*\.join\(":"\)\}/,
  );
  assert.match(
    editor,
    /A one-person agreement is allowed when that is intentional/,
  );
  assert.doesNotMatch(editor, /members.length\s*[<>]=?\s*2/);
});

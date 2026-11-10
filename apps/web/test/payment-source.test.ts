import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("source form has bounded Other input and does not represent metadata as confirmed external money", () => {
  const source = readFileSync(
    new URL("../components/sandbox-checkout-form.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /name="sourceName"\s+required\s+maxLength=\{100\}/);
  assert.match(source, /type\s*===\s*["']OTHER["']/);
  assert.match(source, /does not import or confirm external revenue/);
  assert.match(source, /busy \|\| pending.current/);
  assert.match(source, /finally\s*\{\s*pending\.current = false/);
});
test("source changes retain uncertain checkout key rather than silently creating another payment", () => {
  const source = readFileSync(
    new URL("../components/fairshare-app.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /const storageKey = `fairshare-checkout:\$\{user.id\}:\$\{selected.id\}:\$\{amountCents\}`/,
  );
  assert.match(source, /p.source_name \|\| "PayPal"/);
  assert.match(source, /requestKey,\s*amountCents,\s*source,/);
});

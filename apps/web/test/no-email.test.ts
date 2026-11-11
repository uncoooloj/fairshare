import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appSource } from "./app-source";
const source = (file: string) =>
  readFileSync(new URL("../" + file, import.meta.url), "utf8");
test("email controls require confirmed server capability, failing closed", () => {
  assert.match(source("lib/email-capability.ts"), /useState\(false\)/);
  assert.match(source("lib/email-capability.ts"), /auth\/capabilities/);
  assert.match(
    source("components/designer-auth.tsx"),
    /login\s*&&\s*emailDelivery/,
  );
  assert.match(
    source("components/profile-contact.tsx"),
    /emailDelivery\s*&&\s*changing/,
  );
  assert.match(
    source("components/password-recovery.tsx"),
    /reset\s*\|\|\s*emailDelivery/,
  );
  assert.match(appSource(), /emailDelivery\s*&&\s*\(?\s*<Button/);
});
test("review reminders copy locally and notification preferences are in-app only", () => {
  const reminder = source("components/review-discussion.tsx").split(
    "export function ReviewReminder",
  )[1];
  assert.match(reminder, /navigator.clipboard.writeText/);
  assert.match(reminder, /window\.location\.origin\}\/app/);
  assert.match(reminder, /Review reminder to copy/);
  assert.doesNotMatch(reminder, /\/reminders|api\(/);
  assert.match(
    source("components/settings-preferences.tsx"),
    /\(\["inApp"\]\s+as\s+const\)/,
  );
  assert.doesNotMatch(
    source("components/settings-preferences.tsx"),
    /<th scope="col">Email/,
  );
  assert.match(
    source("components/payment-account-settings.tsx"),
    /location\.origin\}\/app/,
  );
});

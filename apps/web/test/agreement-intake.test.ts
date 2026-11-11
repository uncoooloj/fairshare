import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgreementIntake } from "../components/agreement-intake";
const source = readFileSync(
  new URL("../components/agreement-intake.tsx", import.meta.url),
  "utf8",
);
test("first action is upload or paste, never title or workspace setup", () => {
  const html = renderToStaticMarkup(
    createElement(AgreementIntake, {
      busy: false,
      first: true,
      onCreate: async () => {},
    }),
  );
  assert.match(html, /type="file"/);
  assert.match(html, /<textarea/);
  assert.match(html, /create your workspace automatically/);
  assert.doesNotMatch(html, /label>Agreement name|label>Workspace name/);
  assert.match(html, /AI interpretation requires your confirmation/);
});
test("input survives errors and retries retain idempotency key until input changes", () => {
  assert.match(source, /requestId\.current\s*\|\|=\s*crypto\.randomUUID/);
  assert.match(source, /busy\s*\|\|\s*locked\.current/);
  assert.match(source, /locked\.current = true;\s*setSubmitting\(true\);/);
  assert.match(source, /const disabled = busy \|\| submitting;/);
  assert.match(source, /disabled=\{disabled\}/);
  assert.match(source, /disabled=\{disabled \|\| method !== "paste"\}/);
  assert.match(
    source,
    /finally\s*\{\s*locked\.current\s*=\s*false;\s*setSubmitting\(false\);\s*onBusyChange\?\.\(false\)/,
  );
  assert.match(source, /finally\s*\{\s*locked\.current\s*=\s*false/);
  assert.match(source, /const changed = \(\) => \{\s*requestId\.current = ""/);
  assert.doesNotMatch(source, /setFile\(null\)|setText\(""\)/);
  assert.match(source, /<Notice warning announcement="assertive">/);
});
test("a deferred local read locks its controls and the parent navigation guard", () => {
  assert.match(
    source,
    /locked\.current = true;\s*setSubmitting\(true\);\s*onBusyChange\?\.\(true\)/,
  );
  assert.match(source, /const disabled = busy \|\| submitting/);
  assert.match(source, /aria-busy=\{disabled\}/);
  assert.match(source, /<fieldset disabled=\{disabled\}/);
  assert.match(source, /disabled=\{disabled \|\| method !== "paste"\}/);
  assert.match(source, /onBusyChange\?: \(busy: boolean\) => void/);
});
test("local reads are bounded and source is not sent automatically to an AI service", () => {
  assert.match(source, /file.size > 5 \* 1024 \* 1024/);
  assert.match(source, /input.text.length > 40000/);
  assert.match(source, /await file.text\(\)/);
  assert.doesNotMatch(source, /fetch\(|consentToCloudflare: true/);
});

test("title can be edited after upload; AI naming never changes the agreement automatically", async () => {
  const { AgreementName } = await import("../components/agreement-name");
  const html = renderToStaticMarkup(
    createElement(AgreementName, {
      name: "contract",
      suggestion: "Summer Sessions",
      busy: false,
      onSave: () => {},
    }),
  );
  assert.match(html, /value="Summer Sessions"/);
  assert.match(html, /Review suggested agreement name/);
  assert.match(html, /does not change the agreement/);
  const nameSource = readFileSync(
    new URL("../components/agreement-name.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(nameSource, /useEffect|api\(|fetch\(/);
});

test("native picker advertises bounded supported extensions and MIME types", () => {
  const html = renderToStaticMarkup(
    createElement(AgreementIntake, {
      busy: false,
      first: true,
      onCreate: async () => {},
    }),
  );
  const accept = /type="file"[^>]*accept="([^"]+)"/.exec(html)?.[1];
  assert.deepEqual(accept?.split(","), [
    ".pdf",
    ".docx",
    ".txt",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
  ]);
  assert.doesNotMatch(accept ?? "", /\*/);
});

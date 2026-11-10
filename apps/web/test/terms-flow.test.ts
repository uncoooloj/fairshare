import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { initialTermsStep, nextTermsStep } from "../lib/terms-flow";
import { AgreementTermsFlow } from "../components/agreement-terms-flow";

const props = {
  busy: false,
  sourceText: "Original clause",
  source: "source draft",
  interpretation: "AI reading",
  rules: "rules draft",
};
test("unsaved source cannot advance; saved intake resumes at reading", () => {
  assert.equal(initialTermsStep(""), 0);
  assert.equal(initialTermsStep("saved"), 1);
  for (const step of [0, 1, 2] as const)
    assert.equal(nextTermsStep(step, false), 0);
  assert.equal(nextTermsStep(0, true), 1);
  assert.equal(nextTermsStep(1, true), 2);
  assert.equal(nextTermsStep(2, true), 2);
});
test("source and rules remain mounted while only reading is revealed", () => {
  const html = renderToStaticMarkup(
    createElement(AgreementTermsFlow, { ...props, documentId: "saved" }),
  );
  assert.match(html, /Step 2 of 3: Read the agreement/);
  assert.match(html, /<div hidden="">source draft/);
  assert.match(html, /<div>.*AI reading/);
  assert.match(html, /<div hidden="">.*rules draft/);
  assert.match(html, /Continue to proposed rules/);
  assert.match(html, /Continuing does not approve or activate anything/);
});
test("blank intake starts with source and disables later steps", () => {
  const html = renderToStaticMarkup(
    createElement(AgreementTermsFlow, { ...props, documentId: "" }),
  );
  assert.match(html, /Step 1 of 3: Source agreement/);
  assert.match(html, /disabled=""><span aria-hidden="true">2/);
  assert.match(html, /disabled=""><span aria-hidden="true">3/);
});
test("navigation is not a second conflicting global setup stepper", () => {
  const setup = readFileSync(
    new URL("../components/agreement-setup.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(setup, /setup-steps|<span>[123]<\/span>/);
  const flow = readFileSync(
    new URL("../components/agreement-terms-flow.tsx", import.meta.url),
    "utf8",
  );
  assert.match(flow, /focus\(\{ preventScroll: true \}\)/);
  assert.match(flow, /prefers-reduced-motion/);
  assert.match(flow, /if \(busy\) return/);
  assert.match(flow, /previousDocument.current === documentId/);
  assert.doesNotMatch(flow, /fetch\(|api\(|\/activate|\/approvals/);
});

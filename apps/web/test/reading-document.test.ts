import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ReadingDocument,
  ReadingOutcome,
} from "../components/reading-document";
import {
  extractionOutcome,
  nextActiveStep,
  readAgreement,
  READING_STEPS,
  readingAnnouncement,
  ReadingPhase,
  readingStepStatus,
  ReadingStepStatus,
} from "../lib/reading";

const cited = { citation: { quote: "split 50% to Maya" } };
const ready = {
  status: "REVIEW_REQUIRED",
  reason: null,
  requiresHumanReview: true,
  executable: false,
  facts: [cited],
  issues: [],
};

test("reading screen renders the file, four steps, polite status and copy", () => {
  const html = renderToStaticMarkup(
    createElement(ReadingDocument, {
      fileName: "Revenue Share Agreement.pdf",
      run: () => new Promise<ReadingOutcome>(() => {}),
      onDone: () => {},
    }),
  );
  assert.match(html, /Reading your agreement/);
  assert.match(html, /Revenue Share Agreement\.pdf/);
  for (const step of READING_STEPS) assert.ok(html.includes(step), step);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /Reading the document, step 1 of 4\./);
  assert.match(html, /Usually under a minute\./);
  assert.doesNotMatch(html, /Keep this tab open/);
  assert.doesNotMatch(html, /Continue to rules/);
});

test("timer never completes the last step; only a real result does", () => {
  let active = 0;
  for (let i = 0; i < 20; i++) active = nextActiveStep(active);
  assert.equal(active, READING_STEPS.length - 1);
  assert.equal(
    readingStepStatus(3, active, ReadingPhase.RUNNING),
    ReadingStepStatus.ACTIVE,
  );
  assert.equal(
    readingStepStatus(0, active, ReadingPhase.RUNNING),
    ReadingStepStatus.DONE,
  );
  assert.equal(
    readingStepStatus(3, 1, ReadingPhase.DONE),
    ReadingStepStatus.DONE,
  );
  assert.equal(
    readingStepStatus(2, 2, ReadingPhase.FALLBACK),
    ReadingStepStatus.PENDING,
  );
  assert.match(
    readingAnnouncement(2, ReadingPhase.FALLBACK),
    /Let's set it up together/,
  );
});

test("only a cited, reviewable, non-executable suggestion is READY", () => {
  assert.equal(extractionOutcome(ready), ReadingOutcome.READY);
  assert.equal(extractionOutcome(null), ReadingOutcome.MANUAL);
  assert.equal(
    extractionOutcome({
      ...ready,
      status: "MANUAL_REQUIRED",
      reason: "NOT_CONFIGURED",
      facts: [],
    }),
    ReadingOutcome.MANUAL,
  );
  assert.equal(
    extractionOutcome({ ...ready, facts: [] }),
    ReadingOutcome.MANUAL,
  );
  assert.equal(
    extractionOutcome({ ...ready, facts: [cited, { citation: null }] }),
    ReadingOutcome.MANUAL,
  );
  assert.equal(
    extractionOutcome({ ...ready, executable: true }),
    ReadingOutcome.MANUAL,
  );
});

test("readAgreement requires consent and posts the existing extract call", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(ready), { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      readAgreement({
        workspaceId: "w1",
        agreementId: "c1",
        documentId: "d1",
        consent: false,
      }),
    );
    assert.equal(calls.length, 0);
    const result = await readAgreement({
      workspaceId: "w1",
      agreementId: "c1",
      documentId: "d1",
      consent: true,
    });
    assert.equal(result.outcome, ReadingOutcome.READY);
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "/api/service/workspaces/w1/collaborations/c1/documents/d1/extract",
    );
    assert.equal(calls[0].init.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      consentToCloudflare: true,
    });
  } finally {
    globalThis.fetch = original;
  }
});

test("component runs once under StrictMode, hands failures straight to Check and avoids motion when reduced", () => {
  const source = readFileSync(
    new URL("../components/reading-document.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /if \(!request\.current\)/);
  // A failed or empty read is not an error screen: it goes on as MANUAL.
  assert.match(
    source,
    /request\.current\.then\(settle, \(\) => settle\(ReadingOutcome\.MANUAL\)\)/,
  );
  assert.doesNotMatch(source, /Continue to rules|Add the terms yourself/);
  assert.doesNotMatch(source, /\/versions|activate/i);
  const css = readFileSync(
    new URL("../app/reading-document.css", import.meta.url),
    "utf8",
  );
  assert.match(
    css,
    /prefers-reduced-motion: no-preference\)\s*\{\s*\.reading-step\.active \.reading-step-mark\s*\{\s*animation/,
  );
});

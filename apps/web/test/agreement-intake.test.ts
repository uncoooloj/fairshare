import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AgreementIntake,
  SAMPLE_PREFILL,
} from "../components/agreement-intake";
import { DocumentMode } from "../components/document-step";
import { emptyDetails } from "../components/wizard-details-step";
import {
  buildIntakeInput,
  DocumentInputError,
  isUnreadableDocument,
} from "../components/wizard-intake";
import { ApiError, Currency, sampleAgreement } from "../lib/model";

const owner = { id: "owner", name: "Maya", email: "maya@example.test" };
const created = async () => ({
  workspaceId: "w",
  agreementId: "a",
  documentId: "d",
});
const props = {
  owner,
  onCreate: created,
  onFinish: () => {},
  onClose: () => {},
  onBusyChange: () => {},
};

test("a first agreement starts with upload, sample or skip", () => {
  const html = renderToStaticMarkup(
    createElement(AgreementIntake, { ...props, first: true }),
  );
  assert.match(html, /Let’s set up your first agreement/);
  assert.match(html, /Upload an agreement/);
  assert.match(html, /Try a sample first/);
  assert.match(html, /No real money/);
  assert.match(html, /Skip for now/);
  assert.doesNotMatch(html, /type="file"|Workspace name/);
});

test("later agreements open straight on the wizard; the sample reuses existing sample text", () => {
  const html = renderToStaticMarkup(createElement(AgreementIntake, props));
  assert.match(html, /New agreement progress/);
  assert.doesNotMatch(html, /Try a sample first/);
  assert.equal(SAMPLE_PREFILL.text, sampleAgreement);
});

test("intake carries the details and USD, and bounds pasted text locally", async () => {
  const details = {
    ...emptyDetails(),
    name: "Midnight Sessions",
    effectiveFrom: "2026-10-01",
    noEndDate: true,
  };
  const input = await buildIntakeInput({
    requestId: "r",
    mode: DocumentMode.PASTE,
    file: null,
    text: "Maya receives 50%.",
    details,
  });
  assert.deepEqual(input, {
    requestId: "r",
    name: "Midnight Sessions",
    effectiveFrom: "2026-10-01",
    effectiveTo: null,
    currency: Currency.USD,
    text: "Maya receives 50%.",
  });
  await assert.rejects(
    buildIntakeInput({
      requestId: "r",
      mode: DocumentMode.PASTE,
      file: null,
      text: "x".repeat(40001),
      details,
    }),
    DocumentInputError,
  );
  const file = new File(["%PDF-1"], "deal.pdf", { type: "application/pdf" });
  const pdf = await buildIntakeInput({
    requestId: "r",
    mode: DocumentMode.UPLOAD,
    file,
    text: "",
    details,
  });
  assert.equal(pdf.mimeType, "application/pdf");
  assert.equal(pdf.filename, "deal.pdf");
  assert.equal(typeof pdf.base64, "string");
  assert.equal(pdf.text, undefined);
});

test("unreadable documents are told apart from other failures", () => {
  assert.ok(isUnreadableDocument(new ApiError("x", 400, "INVALID_PDF")));
  assert.ok(
    isUnreadableDocument(new ApiError("x", 400, "PDF_NO_EXTRACTABLE_TEXT")),
  );
  assert.ok(isUnreadableDocument(new DocumentInputError("x")));
  assert.ok(
    !isUnreadableDocument(new ApiError("x", 409, "IDEMPOTENCY_CONFLICT")),
  );
  assert.ok(!isUnreadableDocument(new Error("network")));
  const source = readFileSync(
    new URL("../components/wizard-intake.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /fetch\(|consentToCloudflare/);
});

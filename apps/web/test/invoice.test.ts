import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InvoiceForm } from "../components/invoice-form";
import { safeInvoiceUrl, validateInvoice } from "../lib/invoice";
const details = {
  customerName: " Alex ",
  customerEmail: "alex@example.com",
  description: "License",
  amount: "12.34",
  dueDate: "2026-11-12",
};
test("invoice details normalize and preserve exact cents", () => {
  assert.deepEqual(validateInvoice(details, "2026-11-10"), {
    customerName: "Alex",
    customerEmail: "alex@example.com",
    description: "License",
    amountCents: 1234,
    currency: "USD",
    dueDate: "2026-11-12",
  });
});
test("invoice rejects invalid or excessive amounts and invalid dates", () => {
  for (const amount of ["0", "-1", "1.001", "10000.01", "NaN"])
    assert.throws(() => validateInvoice({ ...details, amount }, "2026-11-10"));
  for (const dueDate of ["2026-11-09", "2026-02-31", "invalid"])
    assert.throws(() => validateInvoice({ ...details, dueDate }, "2026-11-10"));
  assert.throws(() =>
    validateInvoice({ ...details, customerEmail: "bad" }, "2026-11-10"),
  );
  assert.throws(() =>
    validateInvoice({ ...details, description: "" }, "2026-11-10"),
  );
});
test("invoice links only allow HTTPS PayPal origins with no credentials", () => {
  assert.equal(
    safeInvoiceUrl("https://www.sandbox.paypal.com/invoice/p/#ABC"),
    true,
  );
  for (const value of [
    "javascript:alert(1)",
    "https://www.paypal.com/invoice/p/#ABC",
    "https://www.sandbox.paypal.com:8443/invoice/p/#ABC",
    "https://paypal.com.evil.test/x",
    "https://evil@paypal.com/x",
    "http://paypal.com/x",
    null,
  ])
    assert.equal(safeInvoiceUrl(value), false);
});
test("invoice starts at details, not generate action or fake success", () => {
  const html = renderToStaticMarkup(
    createElement(InvoiceForm, {
      agreementName: "Release",
      onSubmit: async () => {},
      onCancel: () => {},
    }),
  );
  assert.match(html, /Review invoice/);
  assert.match(html, /no email will be sent/);
  assert.doesNotMatch(html, /Invoice created|Generate invoice|Invoice preview/);
});

test("invoice status preserves provider payment, settlement, manual and refund distinctions", async () => {
  const { invoiceStatusLabel, invoiceMoney } = await import("../lib/invoice");
  // PayPal saying "paid" is not the same as split: recorded payments stay "checking".
  assert.equal(invoiceStatusLabel("PAYMENT_RECORDED"), "Checking with PayPal");
  assert.equal(invoiceStatusLabel("PAID"), "Paid · split");
  assert.notEqual(
    invoiceStatusLabel("PAYMENT_RECORDED"),
    invoiceStatusLabel("PAID"),
  );
  assert.equal(invoiceStatusLabel("PARTIALLY_PAID"), "Partially paid");
  assert.equal(invoiceStatusLabel("CANCELLED"), "Cancelled");
  assert.equal(invoiceStatusLabel("REFUNDED"), "Refunded");
  assert.equal(invoiceStatusLabel("PARTIALLY_REFUNDED"), "Partially refunded");
  for (const status of ["MARKED_AS_PAID", "MARKED_AS_REFUNDED"])
    assert.match(invoiceStatusLabel(status), /externally/);
  assert.equal(invoiceMoney(null, "USD"), "Not verified");
  assert.equal(invoiceMoney(undefined, "USD"), "Not verified");
  assert.equal(invoiceMoney(0, "USD"), "$0.00");
  assert.equal(invoiceMoney(2000, "USD"), "$20.00");
});

test("invoice status shows paid provider evidence without claiming verified allocation", async () => {
  const { InvoiceStatus } = await import("../components/agreement-invoices");
  const invoice = {
    id: "inv1",
    customerName: "Alex",
    customerEmail: "alex@example.com",
    description: "License",
    amountCents: 2000,
    currency: "USD" as const,
    dueDate: "2026-11-12",
    shareUrl: null,
    status: "PAYMENT_RECORDED",
    providerStatus: "PAID",
    paidAmountCents: 2000,
    dueAmountCents: 0,
    settlementStatus: "UNVERIFIED" as const,
    settlementError: "Actual PayPal fees not available.",
    checkedAt: "2026-11-11T10:00:00Z",
    paidDate: "2026-11-11",
    hasCapture: true,
  };
  const html = renderToStaticMarkup(createElement(InvoiceStatus, { invoice }));
  assert.match(html, /status-chip[^"]*">Checking with PayPal</);
  assert.match(html, /PayPal says: Paid/);
  assert.match(html, /Not split yet/);
  assert.doesNotMatch(html, /Paid · split|Split done/);
  assert.match(html, /Actual PayPal fees not available/);
  assert.match(html, /Last checked Nov 11, 2026/);
  assert.doesNotMatch(html, /2026-11-11T10:00:00Z/);
  assert.match(html, /Paid Nov 11/);
  const held = renderToStaticMarkup(
    createElement(InvoiceStatus, {
      invoice: {
        ...invoice,
        status: "PARTIALLY_REFUNDED",
        settlementStatus: "HELD",
      },
    }),
  );
  assert.match(held, /Partially refunded/);
  assert.match(held, /status-chip warning">On hold</);
  assert.match(held, /Split paused for review/);
  const previouslyPaid = renderToStaticMarkup(
    createElement(InvoiceStatus, {
      invoice: { ...invoice, status: "PAID", settlementStatus: "HELD" },
    }),
  );
  assert.match(previouslyPaid, /status-chip warning">On hold</);
  assert.doesNotMatch(previouslyPaid, /Paid · split/);
  const verified = renderToStaticMarkup(
    createElement(InvoiceStatus, {
      invoice: { ...invoice, status: "PAID", settlementStatus: "VERIFIED" },
    }),
  );
  assert.match(verified, /status-chip good">Paid · split</);
  // Paid at PayPal but not yet verified is never shown as split.
  const unverifiedPaid = renderToStaticMarkup(
    createElement(InvoiceStatus, {
      invoice: { ...invoice, status: "PAID", settlementStatus: "UNVERIFIED" },
    }),
  );
  assert.doesNotMatch(unverifiedPaid, /Paid · split/);

  const cancelledWithoutCapture = renderToStaticMarkup(
    createElement(InvoiceStatus, {
      invoice: {
        ...invoice,
        status: "CANCELLED",
        settlementStatus: "HELD",
        hasCapture: false,
      },
    }),
  );
  assert.match(cancelledWithoutCapture, /status-chip">Cancelled</);
  assert.match(cancelledWithoutCapture, /Not split yet/);
  assert.doesNotMatch(cancelledWithoutCapture, /Split paused for review/);
});

test("invoice guidance remains visible and reconciliation refreshes agreement data", async () => {
  const { AgreementInvoices } = await import(
    "../components/agreement-invoices"
  );
  const html = renderToStaticMarkup(
    createElement(AgreementInvoices, {
      base: "/agreements/a",
      agreementName: "Release",
      userId: "u",
      canCreate: true,
    }),
  );
  // One header and one line; the splitting facts live in the info tooltip.
  assert.match(html, /<h2[^>]*>Invoices<\/h2>/);
  assert.match(html, /Bill someone and share the link/);
  assert.doesNotMatch(html, /Get paid|allocation|capture amounts/i);
  assert.match(
    html,
    /role="tooltip"[^>]*>[^<]*PayPal confirms the amount and its fee/,
  );
  assert.match(html, /outside PayPal isn’t split/);
  assert.match(html, /refund pauses payouts/);
  const { readFile } = await import("node:fs/promises");
  const invoices = await readFile(
    new URL("../components/agreement-invoices.tsx", import.meta.url),
    "utf8",
  );
  const payments = await readFile(
    new URL(
      "../components/sections/agreement-tabs/payments-tab.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(invoices, /await onReconciled\?\.\(\)/);
  assert.match(payments, /onReconciled=\{refresh\}/);
  assert.match(payments, /paymentReconcilePath\(p\)/);
  assert.match(payments, /!p.invoice_id/);
  assert.match(payments, /ALLOCATED: "Split"/);
  assert.doesNotMatch(payments, /<h2>Get paid<\/h2>/);
});

test("overdue and waiting invoices get one plain chip", async () => {
  const { invoiceChip, invoiceDay, InvoiceTone } = await import(
    "../lib/invoice"
  );
  const base = {
    settlementStatus: "UNVERIFIED" as const,
    dueDate: "2026-11-12",
  };
  assert.deepEqual(invoiceChip({ ...base, status: "SHARED" }, "2026-11-11"), {
    label: "Waiting for payment",
    tone: InvoiceTone.NEUTRAL,
  });
  assert.deepEqual(invoiceChip({ ...base, status: "SHARED" }, "2026-11-13"), {
    label: "Overdue",
    tone: InvoiceTone.WARNING,
  });
  assert.equal(
    invoiceChip({ ...base, status: "PAID" }, "2026-11-13").label,
    "Checking with PayPal",
  );
  assert.equal(invoiceDay("2026-11-12", new Date("2026-06-01")), "Nov 12");
  assert.equal(invoiceDay("2027-01-02", new Date("2026-06-01")), "Jan 2, 2027");
});

test("split drawer shows the payout state and only quotes real document clauses", async () => {
  const { AllocationCalculation } = await import(
    "../components/allocation-calculation"
  );
  const { PaymentGridStatus } = await import(
    "../src/components/paymentGridModel"
  );
  const trace = {
    captureId: "cap1",
    recordedAt: "2026-11-11T12:00:00Z",
    versionId: 1,
    grossCents: 400,
    providerFeeCents: 42,
    netCents: 358,
    poolCents: 358,
    recoupedCents: 0,
    shareBasisPoints: 10000,
    roundingCents: 0,
    allocation: {
      userId: "u1",
      recoupmentCents: 0,
      shareCents: 358,
      feeCents: 0,
      totalCents: 358,
      status: "ALLOCATED",
    },
    source: {
      origin: "HUMAN_PROPOSAL",
      documentId: "doc1",
      clause: "Revenue sharing proposal",
      excerpt: "Proposed split clarification: Betty White 100%.",
    },
    held: false,
  };
  const render = (props: Record<string, unknown>) =>
    renderToStaticMarkup(
      createElement(AllocationCalculation, { trace, name: "Betty", ...props }),
    );
  const team = render({ payout: PaymentGridStatus.Paid });
  assert.match(team, /status-chip good">Paid</);
  assert.doesNotMatch(team, />Owed</);
  assert.match(team, /From payment/);
  assert.match(team, /\$4\.00 · PayPal · Nov 11/);
  assert.match(team, /Split in use on Nov 11/);
  assert.doesNotMatch(team, /version-chip|v1</);
  assert.match(team, /Added by you/);
  assert.doesNotMatch(
    team,
    /§ Revenue sharing proposal|Proposed split clarification/,
  );
  assert.doesNotMatch(team, /Source clause/);
  assert.match(team, /<summary>Show working<\/summary>/);
  assert.match(
    render({ payout: PaymentGridStatus.Processing }),
    />On the way</,
  );
  assert.match(
    render({ payout: PaymentGridStatus.WaitingRecipient }),
    />Waiting for PayPal email</,
  );
  assert.match(render({}), />Owed</);
  const doc = render({
    trace: {
      ...trace,
      source: {
        origin: "SOURCE_CLAUSE",
        documentId: "doc1",
        clause: "Clause 4.2",
        excerpt: "Net revenue is split equally.",
      },
    },
  });
  assert.match(doc, /§ 4\.2/);
  assert.match(doc, /Source clause/);
  assert.match(doc, /Net revenue is split equally/);
  assert.doesNotMatch(doc, /Nothing left to split/);
  const advanceAteIt = render({
    trace: { ...trace, poolCents: 0, recoupedCents: 358 },
  });
  assert.match(advanceAteIt, /Nothing left to split after the advance/);
  const zero = render({
    trace: { ...trace, netCents: 0, poolCents: 0 },
  });
  assert.doesNotMatch(zero, /Nothing left to split|No split from this payment/);
});

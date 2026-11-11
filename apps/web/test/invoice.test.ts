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
  assert.match(invoiceStatusLabel("PAYMENT_RECORDED"), /settlement unverified/);
  assert.match(invoiceStatusLabel("PAID"), /allocation verified/);
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
  };
  const html = renderToStaticMarkup(createElement(InvoiceStatus, { invoice }));
  assert.match(html, /Payment recorded · settlement unverified/);
  assert.match(html, /PayPal: PAID/);
  assert.match(html, /Unverified · no verified allocation/);
  assert.match(html, /Actual PayPal fees not available/);
  assert.match(html, /Last checked:/);
  assert.match(html, /PayPal payment date: 2026-11-11/);
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
  assert.match(held, /On hold · review required/);
  const previouslyPaid = renderToStaticMarkup(
    createElement(InvoiceStatus, {
      invoice: { ...invoice, status: "PAID", settlementStatus: "HELD" },
    }),
  );
  assert.match(previouslyPaid, /Payment on hold/);
  assert.doesNotMatch(previouslyPaid, /Paid · allocation verified/);
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
  assert.match(html, /actual PayPal fees/);
  assert.match(html, /Manual or external payments are not allocated/);
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
});

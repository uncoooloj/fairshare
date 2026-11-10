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

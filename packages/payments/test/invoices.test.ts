import { test } from "node:test";
import assert from "node:assert/strict";
import { PayPalSandbox } from "../src/paypal.js";
import { invoiceBody, parseInvoice } from "../src/invoices.js";
const id = "INV2-ABCD-EFGH-IJKL-MNOP";
const input = {
  customerEmail: "buyer@example.test",
  customerName: "Jane",
  description: "Design services",
  amountCents: 12345,
  currency: "USD",
  dueDate: "2099-12-31",
  reference: "invoice-1",
  requestId: "invoice-1-create",
};
const invoice = (status = "DRAFT") => ({
  id,
  status,
  detail: {
    reference: "invoice-1",
    metadata: {
      recipient_view_url: `https://www.sandbox.paypal.com/invoice/p/#${id}`,
    },
  },
  amount: { currency_code: "USD", value: "123.45" },
});
function setup(responses: unknown[]) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: any, init: RequestInit) => {
    requests.push({ url: String(url), init });
    const result = responses.shift();
    if (result instanceof Error) throw result;
    return new Response(JSON.stringify(result), { status: 200 });
  }) as typeof fetch;
  return {
    client: new PayPalSandbox(
      { clientId: "id", clientSecret: "secret" },
      fetcher,
    ),
    requests,
  };
}
const token = { access_token: "token", expires_in: 3600 };
test("invoice draft uses exact cents, due date, no partial payment or tips", () => {
  const body = invoiceBody(input);
  assert.equal(body.items[0].unit_amount.value, "123.45");
  assert.equal(body.detail.payment_term.due_date, input.dueDate);
  assert.equal(body.configuration.allow_tip, false);
  assert.equal(body.configuration.partial_payment.allow_partial_payment, false);
  assert.equal(body.detail.invoice_date, undefined);
  assert.equal(parseInvoice(invoice()).shareUrl, null);
});
test("invalid amounts, date, email and reference fail before provider write", () => {
  for (const change of [
    { amountCents: 1.5 },
    { amountCents: 0 },
    { currency: "JPY" },
    { dueDate: "2099-02-31" },
    { customerEmail: "bad" },
    { reference: "" },
  ])
    assert.throws(() => invoiceBody({ ...input, ...change }));
});
test("create draft requests representation, persists request key, reads verified result", async () => {
  const { client, requests } = setup([token, { id }, invoice()]);
  const result = await client.createInvoice(input);
  assert.equal(result.id, id);
  assert.equal(result.amountCents, 12345);
  assert.equal(
    (requests[1].init.headers as any)["PayPal-Request-Id"],
    input.requestId,
  );
  assert.ok(
    requests.every((r) =>
      r.url.startsWith("https://api-m.sandbox.paypal.com/"),
    ),
  );
});
test("minimal draft response follows only verified sandbox invoice self link", async () => {
  const { client } = setup([
    token,
    { href: `https://api-m.sandbox.paypal.com/v2/invoicing/invoices/${id}` },
    invoice(),
  ]);
  assert.equal((await client.createInvoice(input)).id, id);
  const bad = setup([token, { href: `https://attacker.example/${id}` }]);
  await assert.rejects(
    bad.client.createInvoice(input),
    /PAYPAL_OUTCOME_UNKNOWN/,
  );
  assert.equal(bad.requests.length, 2);
});
test("publish disables ALL email and obtains real share URL by readback", async () => {
  const { client, requests } = setup([
    token,
    { href: "ignored" },
    invoice("SENT"),
  ]);
  const result = await client.publishInvoice(id, "invoice-1-publish");
  assert.equal(result.status, "SENT");
  assert.match(result.shareUrl!, /^https:\/\/www.sandbox.paypal.com/);
  assert.deepEqual(JSON.parse(String(requests[1].init.body)), {
    send_to_recipient: false,
    send_to_invoicer: false,
  });
});
test("marked paid remains distinct and external payments are not PayPal proof", () => {
  const result = parseInvoice({
    ...invoice("MARKED_AS_PAID"),
    payments: {
      transactions: [
        { type: "EXTERNAL", amount: { currency_code: "USD", value: "123.45" } },
      ],
    },
  });
  assert.equal(result.status, "MARKED_AS_PAID");
  assert.equal(result.payments[0].type, "EXTERNAL");
});
test("rejects live payment links, mismatched invoice identity and invalid money", () => {
  const live = invoice("SENT");
  live.detail.metadata.recipient_view_url =
    "https://www.paypal.com/invoice/p/test";
  assert.throws(() => parseInvoice(live), /INVALID_INVOICE_LINK/);
  assert.throws(
    () => parseInvoice(invoice(), "INV2-WRONG-WRONG"),
    /INVOICE_MISMATCH/,
  );
  assert.throws(
    () =>
      parseInvoice({
        ...invoice(),
        amount: { currency_code: "USD", value: "1.001" },
      }),
    /INVALID_PROVIDER_AMOUNT/,
  );
});
test("ambiguous invoice write is never replayed", async () => {
  const { client, requests } = setup([token, new Error("disconnect")]);
  await assert.rejects(client.createInvoice(input), /PAYPAL_OUTCOME_UNKNOWN/);
  assert.equal(requests.length, 2);
});

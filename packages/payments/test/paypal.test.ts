import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PayPalSandbox,
  PayPalError,
  RecipientType,
  normalizePayoutEmail,
} from "../src/paypal.js";
function setup(responses: unknown[]) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init! });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return {
    client: new PayPalSandbox(
      {
        clientId: "test-id",
        clientSecret: "test-secret",
        webhookId: "webhook-id",
        merchantId: "merchant",
      },
      fetcher,
    ),
    requests,
  };
}
const token = { access_token: "test-token", expires_in: 3600 };
test("sandbox order uses exact integer money and persistent request key", async () => {
  const { client, requests } = setup([
    token,
    {
      id: "ORDER",
      links: [
        {
          rel: "payer-action",
          href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER",
        },
      ],
    },
  ]);
  const order = await client.createOrder({
    amountCents: 12345,
    currency: "USD",
    reference: "payment-123",
    returnUrl: "https://example.test/return",
    cancelUrl: "https://example.test/cancel",
  });
  assert.equal(order.id, "ORDER");
  assert.ok(
    requests.every((r) =>
      r.url.startsWith("https://api-m.sandbox.paypal.com/"),
    ),
  );
  const body = JSON.parse(requests[1]!.init.body as string);
  assert.equal(body.purchase_units[0].amount.value, "123.45");
  assert.equal(
    (requests[1]!.init.headers as Record<string, string>)["PayPal-Request-Id"],
    "payment-123",
  );
});
test("capture returns pending without pretending money settled", async () => {
  const { client } = setup([
    token,
    {
      id: "ORDER",
      purchase_units: [
        {
          custom_id: "p1",
          payee: { merchant_id: "merchant" },
          payments: {
            captures: [
              {
                id: "CAPTURE",
                status: "PENDING",
                amount: { value: "10.01", currency_code: "USD" },
              },
            ],
          },
        },
      ],
    },
  ]);
  assert.deepEqual(await client.captureOrder("ORDER"), {
    id: "CAPTURE",
    status: "PENDING",
    amountCents: 1001,
    currency: "USD",
    reference: "p1",
    orderId: "ORDER",
  });
});
test("capture rejects mismatched merchant", async () => {
  const { client } = setup([
    token,
    { id: "ORDER", purchase_units: [{ payee: { merchant_id: "attacker" } }] },
  ]);
  await assert.rejects(client.captureOrder("ORDER"), {
    code: "CAPTURE_MERCHANT_MISMATCH",
  });
});
test("missing configuration fails closed", () =>
  assert.throws(() => new PayPalSandbox({ clientId: "", clientSecret: "" }), {
    code: "PAYPAL_NOT_CONFIGURED",
  }));
test("payout readiness reflects both explicit sandbox safeguards", () => {
  const disabled = new PayPalSandbox({
    clientId: "test-id",
    clientSecret: "test-secret",
    payoutsEnabled: true,
    payoutsEligibilityConfirmed: false,
  });
  const enabled = new PayPalSandbox({
    clientId: "test-id",
    clientSecret: "test-secret",
    payoutsEnabled: true,
    payoutsEligibilityConfirmed: true,
  });
  assert.equal(disabled.payoutsReady, false);
  assert.equal(enabled.payoutsReady, true);
});
test("invalid amounts/currencies fail before money movement", async () => {
  const { client, requests } = setup([]);
  await assert.rejects(
    client.createOrder({
      amountCents: 1.2,
      currency: "USD",
      reference: "x",
      returnUrl: "https://a.test",
      cancelUrl: "https://a.test",
    }),
    { code: "INVALID_AMOUNT" },
  );
  await assert.rejects(client.refundCapture("cap", 100, "JPY", "refund1"), {
    code: "UNSUPPORTED_CURRENCY",
  });
  assert.equal(requests.length, 0);
});
test("refund validates returned value and uses distinct stable operation key", async () => {
  const { client, requests } = setup([
    token,
    {
      id: "REFUND",
      status: "COMPLETED",
      amount: { value: "5.00", currency_code: "USD" },
    },
  ]);
  const result = await client.refundCapture(
    "CAPTURE",
    500,
    "USD",
    "refund-proof1",
  );
  assert.equal(result.status, "COMPLETED");
  assert.equal(
    (requests[1]!.init.headers as Record<string, string>)["PayPal-Request-Id"],
    "refund-proof1",
  );
});
test("webhook missing signature headers is rejected without remote request", async () => {
  const { client, requests } = setup([]);
  assert.equal(await client.verifyWebhook({}, { id: "evt" }), false);
  assert.equal(requests.length, 0);
});
test("webhook only trusted after PayPal verification SUCCESS", async () => {
  const { client, requests } = setup([
    token,
    { verification_status: "FAILURE" },
    { verification_status: "SUCCESS" },
  ]);
  const headers = {
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.paypal.com/cert",
    "paypal-transmission-id": "t",
    "paypal-transmission-sig": "sig",
    "paypal-transmission-time": "2026-11-10T00:00:00Z",
  };
  assert.equal(await client.verifyWebhook(headers, { id: "event" }), false);
  assert.equal(await client.verifyWebhook(headers, { id: "event" }), true);
  assert.equal(requests.length, 3); // OAuth token reused.
});
test("network failure after request yields unknown, never false success", async () => {
  const { client } = setup([token, new Error("network secret text")]);
  await assert.rejects(
    client.captureOrder("ORDER"),
    (error: unknown) =>
      error instanceof PayPalError &&
      error.code === "PAYPAL_OUTCOME_UNKNOWN" &&
      !error.message.includes("secret"),
  );
});

test("refund reconciliation uses GET and validates refund identity", async () => {
  const { client, requests } = setup([
    token,
    {
      id: "r1",
      status: "FAILED",
      amount: { value: "5.00", currency_code: "USD" },
    },
    {
      id: "other",
      status: "COMPLETED",
      amount: { value: "5.00", currency_code: "USD" },
    },
  ]);
  assert.equal((await client.getRefund("r1")).status, "FAILED");
  assert.equal(requests[1]!.init.method, "GET");
  assert.equal(requests[1]!.init.body, undefined);
  await assert.rejects(client.getRefund("r1"), { code: "REFUND_MISMATCH" });
});

test("payout is disabled unless both explicit gates are set", async () => {
  const { client, requests } = setup([]);
  await assert.rejects(
    client.createPayout({
      requestId: "p1",
      recipientType: RecipientType.PAYPAL_ID,
      recipientId: "ABCDEFGHIJKLM",
      amountCents: 100,
      currency: "USD",
    }),
    { code: "PAYOUT_NOT_CONFIGURED" },
  );
  assert.equal(requests.length, 0);
});
test("payout acceptance is not completion and reconciliation validates recipient", async () => {
  const responses = [
    token,
    {
      batch_header: {
        payout_batch_id: "b1",
        sender_batch_header: { sender_batch_id: "p1" },
      },
    },
    {
      batch_header: {
        payout_batch_id: "b1",
        sender_batch_header: { sender_batch_id: "p1" },
      },
      total_items: 1,
      items: [
        {
          payout_item_id: "i1",
          transaction_status: "UNCLAIMED",
          payout_item: {
            sender_item_id: "p1",
            recipient_type: "PAYPAL_ID",
            receiver: "ABCDEFGHIJKLM",
            amount: { currency: "USD", value: "1.00" },
          },
        },
      ],
    },
  ];
  const calls: string[] = [];
  const fetcher = (async (url: any) => {
    calls.push(String(url));
    return new Response(JSON.stringify(responses.shift()), { status: 200 });
  }) as typeof fetch;
  const client = new PayPalSandbox(
    {
      clientId: "id",
      clientSecret: "secret",
      payoutsEnabled: true,
      payoutsEligibilityConfirmed: true,
    },
    fetcher,
  );
  const input = {
    requestId: "p1",
    recipientType: RecipientType.PAYPAL_ID,
    recipientId: "ABCDEFGHIJKLM",
    amountCents: 100,
    currency: "USD",
  };
  assert.deepEqual(await client.createPayout(input), {
    batchId: "b1",
    status: "PENDING",
  });
  assert.equal((await client.getPayout("b1", input)).status, "UNCLAIMED");
  assert.ok(
    calls.every((x) => x.startsWith("https://api-m.sandbox.paypal.com/")),
  );
});
test("a rejected cached token is invalidated without automatic payment replay", async () => {
  let count = 0;
  const client = new PayPalSandbox(
    { clientId: "id", clientSecret: "secret" },
    (async () => {
      count++;
      return count === 1 || count === 3
        ? new Response(JSON.stringify(token), { status: 200 })
        : new Response("{}", { status: 401 });
    }) as typeof fetch,
  );
  await assert.rejects(client.captureOrder("order"), {
    code: "PAYPAL_REQUEST_REJECTED",
  });
  assert.equal(count, 2);
  await client.checkCredentials();
  assert.equal(count, 3);
});
test("credential checks return no secrets and only request token endpoint", async () => {
  const { client, requests } = setup([token]);
  assert.deepEqual(await client.checkCredentials(), {
    mode: "PAYPAL_SANDBOX",
    authenticated: true,
  });
  assert.equal(requests.length, 1);
  assert.ok(requests[0].url.endsWith("/v1/oauth2/token"));
});
test("capture fee accounting is explicit and validated, not assumed zero", async () => {
  const capture = {
    id: "CAP",
    status: "COMPLETED",
    amount: { value: "10.00", currency_code: "USD" },
    seller_receivable_breakdown: {
      gross_amount: { value: "10.00", currency_code: "USD" },
      paypal_fee: { value: "0.50", currency_code: "USD" },
      net_amount: { value: "9.50", currency_code: "USD" },
    },
  };
  const order = {
    id: "ORDER",
    purchase_units: [
      {
        custom_id: "p1",
        payee: { merchant_id: "merchant" },
        payments: { captures: [capture] },
      },
    ],
  };
  const { client } = setup([token, order]);
  assert.deepEqual((await client.captureOrder("ORDER")).accounting, {
    feeCents: 50,
    netCents: 950,
  });
  capture.seller_receivable_breakdown.net_amount.value = "9.00";
  const invalid = setup([token, order]);
  await assert.rejects(invalid.client.captureOrder("ORDER"), {
    code: "CAPTURE_ACCOUNTING_MISMATCH",
  });
});
test("refund recovery exposes original capture and request reference only from expected sandbox parent", async () => {
  const { client } = setup([
    token,
    {
      id: "r1",
      status: "COMPLETED",
      invoice_id: "refund-op",
      amount: { value: "5.00", currency_code: "USD" },
      links: [
        {
          rel: "up",
          href: "https://api-m.sandbox.paypal.com/v2/payments/captures/CAP1",
        },
      ],
    },
    {
      id: "r2",
      status: "COMPLETED",
      invoice_id: "refund-op",
      amount: { value: "5.00", currency_code: "USD" },
      links: [
        { rel: "up", href: "https://evil.test/v2/payments/captures/CAP1" },
      ],
    },
  ]);
  const good = await client.getRefund("r1");
  assert.equal(good.captureId, "CAP1");
  assert.equal(good.reference, "refund-op");
  assert.equal((await client.getRefund("r2")).captureId, undefined);
});

test("refund parent accepts exact PayPal sandbox alias but rejects lookalikes", async () => {
  for (const [origin, valid] of [
    ["https://api.sandbox.paypal.com", true],
    ["https://api.sandbox.paypal.com.evil.test", false],
    ["https://api.paypal.com", false],
    ["http://api.sandbox.paypal.com", false],
  ] as const) {
    const { client, requests } = setup([
      token,
      {
        id: "r1",
        status: "COMPLETED",
        invoice_id: "refund-op",
        amount: { value: "1.00", currency_code: "USD" },
        links: [{ rel: "up", href: origin + "/v2/payments/captures/CAP1" }],
      },
    ]);
    assert.equal(
      (await client.getRefund("r1")).captureId,
      valid ? "CAP1" : undefined,
    );
    assert.ok(
      requests.every((r) =>
        r.url.startsWith("https://api-m.sandbox.paypal.com/"),
      ),
    );
  }
});

test("email payouts send recipient_type EMAIL and reconcile the receiver case-insensitively", async () => {
  const bodies: any[] = [];
  const responses: any[] = [
    token,
    {
      batch_header: {
        payout_batch_id: "b2",
        sender_batch_header: { sender_batch_id: "p2" },
      },
    },
    {
      batch_header: {
        payout_batch_id: "b2",
        sender_batch_header: { sender_batch_id: "p2" },
      },
      items: [
        {
          payout_item_id: "i2",
          transaction_status: "UNCLAIMED",
          payout_item: {
            sender_item_id: "p2",
            recipient_type: "EMAIL",
            receiver: "Maya@Example.test",
            amount: { currency: "USD", value: "2.50" },
          },
        },
      ],
    },
  ];
  const client = new PayPalSandbox(
    {
      clientId: "id",
      clientSecret: "secret",
      payoutsEnabled: true,
      payoutsEligibilityConfirmed: true,
    },
    (async (_url: any, init: any) => {
      if (typeof init?.body === "string" && init.body.startsWith("{"))
        bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify(responses.shift()), { status: 200 });
    }) as typeof fetch,
  );
  const input = {
    requestId: "p2",
    recipientType: RecipientType.EMAIL,
    recipientId: "maya@example.test",
    amountCents: 250,
    currency: "USD",
  };
  await client.createPayout(input);
  assert.equal(bodies[0].items[0].recipient_type, "EMAIL");
  assert.equal(bodies[0].items[0].receiver, "maya@example.test");
  const batch = structuredClone(responses[0]);
  assert.equal((await client.getPayout("b2", input)).status, "UNCLAIMED");
  responses.push(batch);
  await assert.rejects(
    client.getPayout("b2", {
      ...input,
      recipientType: RecipientType.PAYPAL_ID,
    }),
    { code: "PAYOUT_MISMATCH" },
  );
});
test("payout recipients are validated per type before any provider call", async () => {
  let requests = 0;
  const gated = new PayPalSandbox(
    {
      clientId: "id",
      clientSecret: "secret",
      payoutsEnabled: true,
      payoutsEligibilityConfirmed: true,
    },
    (async () => {
      requests++;
      throw new Error("no network");
    }) as typeof fetch,
  );
  for (const [recipientType, recipientId] of [
    [RecipientType.EMAIL, "Maya@Example.test"],
    [RecipientType.EMAIL, "ABCDEFGHIJKLM"],
    [RecipientType.PAYPAL_ID, "maya@example.test"],
    ["PHONE", "5551234567"],
  ] as const)
    await assert.rejects(
      gated.createPayout({
        requestId: "p3",
        recipientType: recipientType as RecipientType,
        recipientId,
        amountCents: 1,
        currency: "USD",
      }),
      { code: "INVALID_PAYOUT_ID" },
    );
  assert.equal(
    normalizePayoutEmail("  Maya@Example.TEST "),
    "maya@example.test",
  );
  assert.equal(normalizePayoutEmail("maya@example"), null);
  assert.equal(normalizePayoutEmail(`${"x".repeat(120)}@ex.test`), null);
  assert.equal(requests, 0);
});

test("webhook configuration is reported as a boolean and still fails closed without a request", async () => {
  assert.equal(setup([]).client.webhookConfigured, true);
  let requests = 0;
  const client = new PayPalSandbox(
    { clientId: "test-id", clientSecret: "test-secret", merchantId: "m" },
    (async () => {
      requests++;
      return new Response("{}");
    }) as typeof fetch,
  );
  assert.equal(client.webhookConfigured, false);
  await assert.rejects(
    client.verifyWebhook({}, { id: "evt" }),
    (e: unknown) =>
      e instanceof PayPalError &&
      e.code === "PAYPAL_WEBHOOK_NOT_CONFIGURED" &&
      e.status === 503,
  );
  assert.equal(requests, 0);
});

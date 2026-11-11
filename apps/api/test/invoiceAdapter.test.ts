import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { AggregateStore } from "../src/fairshare.js";
import {
  createCollaboration,
  proposeVersion,
  sendForReview,
  approveVersion,
  activateVersion,
  MemberRole,
  RuleOrigin,
  FeePolicy,
} from "@fairshare/domain";
import { PayPalSandbox } from "../../../packages/payments/src/paypal.js";
import type { PaymentProvider } from "../src/paymentRoutes.js";

// Real adapter, deterministic provider HTTP fixtures. No network or live money.
async function setupAdapter() {
  const id = "INV2-ABCD-EFGH-IJKL-MNOP";
  const requests: {
    path: string;
    method: string;
    body: any;
    key: string | null;
  }[] = [];
  let reference = "",
    status = "DRAFT";
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? "GET";
    const body = init?.body
      ? JSON.parse(
          String(init.body).startsWith("{") ? String(init.body) : "null",
        )
      : null;
    const key = new Headers(init?.headers).get("PayPal-Request-Id");
    requests.push({ path, method, body, key });
    const json = (value: unknown) =>
      new Response(JSON.stringify(value), { status: 200 });
    if (path === "/v1/oauth2/token")
      return json({ access_token: "test-token", expires_in: 3600 });
    if (path === "/v2/invoicing/invoices" && method === "POST") {
      reference = body.detail.reference;
      return json({ id });
    }
    if (path === `/v2/invoicing/invoices/${id}/send` && method === "POST") {
      status = "SENT";
      return json({});
    }
    if (path === `/v2/invoicing/invoices/${id}` && method === "GET")
      return json({
        id,
        status,
        detail: {
          reference,
          metadata: {
            recipient_view_url: `https://www.sandbox.paypal.com/invoice/p/#${id}`,
          },
        },
        amount: { currency_code: "USD", value: "100.00" },
        payments: {
          transactions:
            status === "PAID"
              ? [
                  {
                    type: "PAYPAL",
                    payment_id: "CAPTURE123",
                    amount: { currency_code: "USD", value: "100.00" },
                  },
                ]
              : [],
        },
      });
    throw Error(`Unexpected provider request ${method} ${path}`);
  }) as typeof fetch;
  const provider = new PayPalSandbox(
    {
      clientId: "test-id",
      clientSecret: "test-secret",
      merchantId: "MERCHANT123",
    },
    fetcher,
  );
  const app = await buildApp({
    dbPath: ":memory:",
    payment: { provider, publicOrigin: "https://callbacks.example.test" },
  });
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const owner = app.store.register({
    name: "Maya",
    email: "maya@example.test",
    password: "Correct-Horse-123",
  });
  const other = app.store.register({
    name: "Other",
    email: "other@example.test",
    password: "Correct-Horse-123",
  });
  const w = app.store.createWorkspace(owner.user.id, "Test");
  const agg = new AggregateStore(app.store.db, (f) => app.store.tx(f));
  let c = createCollaboration(
    {
      id: "collab",
      name: "Test",
      members: [
        {
          userId: owner.user.id,
          displayName: "Maya",
          role: MemberRole.ORGANIZER,
        },
      ],
    },
    owner.user.id,
    new Date().toISOString(),
  );
  const rules = {
    currency: "USD" as const,
    feePolicy: FeePolicy.BEFORE_SPLIT,
    shares: [{ userId: owner.user.id, basisPoints: 10000 }],
    source: {
      origin: RuleOrigin.HUMAN_PROPOSAL,
      documentId: "doc",
      clause: "1",
      excerpt: "test",
    },
    unresolvedQuestions: [],
  };
  c = proposeVersion(c, rules, owner.user.id, new Date().toISOString());
  c = sendForReview(c, 1, owner.user.id, new Date().toISOString());
  c = approveVersion(c, 1, owner.user.id, new Date().toISOString());
  c = activateVersion(c, 1, owner.user.id, new Date().toISOString());
  agg.insert(w.id, c);
  const base = `/api/workspaces/${w.id}/collaborations/collab`;
  const post = (suffix: string, payload: any = {}) =>
    app.inject({
      method: "POST",
      url: base + suffix,
      headers: auth(owner.token),
      payload,
    });

  return {
    app,
    agg,
    w,
    post,
    requests,
    paid: () => {
      status = "PAID";
    },
  };
}
test("invoice API integrates real PayPal adapter create, suppressed-email publish and pending buyer-paid status", async () => {
  const s = await setupAdapter();
  try {
    const input = {
      requestKey: "adapter-invoice-1",
      customerName: "Buyer",
      customerEmail: "buyer@example.test",
      description: "Design services",
      dueDate: "2099-12-31",
      currency: "USD",
      amountCents: 10000,
    };
    const created = await s.post("/invoices", input);
    assert.equal(created.statusCode, 200, created.body);
    const invoice = created.json().invoice;
    assert.equal(invoice.status, "SHARED");
    assert.match(invoice.shareUrl, /sandbox.paypal.com/);
    const duplicate = await s.post("/invoices", input);
    assert.equal(duplicate.json().invoice.id, invoice.id);
    const writes = s.requests.filter(
      (r) => r.method === "POST" && r.path !== "/v1/oauth2/token",
    );
    assert.equal(writes.length, 2);
    assert.equal(writes[0].body.detail.reference, invoice.id);
    assert.equal(writes[0].key, invoice.id);
    assert.equal(writes[0].body.items[0].unit_amount.value, "100.00");
    assert.equal(writes[1].body.send_to_recipient, false);
    assert.equal(writes[1].body.send_to_invoicer, false);
    s.paid();
    const reconciled = await s.post(`/invoices/${invoice.id}/reconcile`);
    assert.equal(reconciled.statusCode, 200, reconciled.body);
    assert.equal(reconciled.json().invoice.status, "PAYMENT_PENDING");
    const revenue = s.agg.read(s.w.id, "collab").value.revenue;
    assert.equal(revenue.length, 0);
    assert.equal(
      (await s.post(`/invoices/${invoice.id}/reconcile`)).json().invoice.status,
      "PAYMENT_PENDING",
    );
    assert.equal(s.agg.read(s.w.id, "collab").value.revenue.length, 0);
    assert.equal(
      s.requests.filter(
        (r) => r.method === "POST" && r.path !== "/v1/oauth2/token",
      ).length,
      2,
    );
  } finally {
    await s.app.close();
  }
});

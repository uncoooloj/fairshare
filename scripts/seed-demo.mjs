/** Local synthetic fixture only. Never connects to payment, mail or AI providers. */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";
import { buildApp } from "../apps/api/src/app.ts";
import { Role } from "../apps/api/src/identity.ts";
import { FeePolicy, RuleOrigin } from "../packages/domain/src/index.ts";
const dbPath = resolve(process.argv[2] || "./data/fairshare-demo.db");
if (existsSync(dbPath))
  throw new Error(
    "Refusing to replace an existing database. Choose a new path.",
  );
mkdirSync(dirname(dbPath), { recursive: true });
const app = await buildApp({ dbPath, demo: true, logger: false });
const password = "FairshareDemo123!";
try {
  const people = ["Maya", "Jordan", "Riley"].map((name) =>
    app.store.register({
      name,
      email: `${name.toLowerCase()}@fairshare.example`,
      password,
    }),
  );
  const [owner, ...peers] = people;
  const workspace = app.store.createWorkspace(
    owner.user.id,
    "Fairshare synthetic demo",
  );
  for (const person of peers)
    app.store.accept(
      person.user,
      app.store.invite(owner.user, workspace.id, person.user.email, Role.MEMBER)
        .token,
    );
  async function request(actor, method, url, payload) {
    const r = await app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${actor.token}` },
      payload,
    });
    assert.ok(
      r.statusCode < 300,
      `${method} ${url}: ${r.statusCode} ${r.body}`,
    );
    return r.json();
  }
  const base = `/api/workspaces/${workspace.id}/collaborations`;
  let agreement = await request(owner, "POST", base, {
    name: "Midnight Sessions — synthetic demo",
  });
  const path = `${base}/${agreement.id}`;
  for (const person of peers)
    agreement = await request(owner, "POST", path + "/members", {
      expectedRevision: agreement.revision,
      userId: person.user.id,
    });
  const text =
    "SYNTHETIC DEMO AGREEMENT. Maya recoups a previously paid $2,000 advance from eligible revenue. After recoupment, remaining revenue is split 50% to Maya, 30% to Jordan and 20% to Riley. Processing fees are deducted before recoupment and splitting.";
  const doc = await request(owner, "POST", path + "/documents", { text });
  const source = {
    origin: RuleOrigin.SOURCE_CLAUSE,
    documentId: doc.documentId,
    clause: "Demo clause 1",
    excerpt: text,
  };
  agreement = await request(owner, "POST", path + "/versions", {
    expectedRevision: agreement.revision,
    rules: {
      currency: "USD",
      feePolicy: FeePolicy.BEFORE_SPLIT,
      shares: people.map((p, i) => ({
        userId: p.user.id,
        basisPoints: [5000, 3000, 2000][i],
      })),
      advance: {
        id: "synthetic-advance",
        recipientId: owner.user.id,
        amountCents: 200000,
        verified: true,
        source,
      },
      source,
      unresolvedQuestions: [],
    },
  });
  for (const [action, actor] of [
    ["send", owner],
    ...people.map((p) => ["approve", p]),
    ["activate", owner],
  ])
    agreement = await request(actor, "POST", path + "/versions/1/" + action, {
      expectedRevision: agreement.revision,
    });
  const preview = await request(owner, "POST", path + "/versions/1/preview", {
    grossCents: 300000,
    feeCents: 0,
  });
  assert.equal(preview.previewOnly, true);
  assert.deepEqual(
    preview.allocations.map((a) => a.totalCents),
    [250000, 30000, 20000],
  );
  assert.equal(agreement.value.revenue.length, 0);
  console.log(
    JSON.stringify(
      {
        mode: "DEMO",
        database: dbPath,
        agreementId: agreement.id,
        workspaceId: workspace.id,
        accounts: people.map((p) => p.user.email),
        password,
        preview: { Maya: 2500, Jordan: 300, Riley: 200, currency: "USD" },
        notice:
          "Synthetic users and approvals. Advance assertion is a fixture, not evidence of payment. No payment, payout, mail or AI call occurred.",
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
}

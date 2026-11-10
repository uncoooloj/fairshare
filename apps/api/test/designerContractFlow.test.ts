import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { Role } from "../src/identity.js";
import { FeePolicy, RuleOrigin, VersionStatus } from "@fairshare/domain";

async function fixture() {
  const app = await buildApp({ dbPath: ":memory:" });
  const password = "Correct-Horse-123";
  const owner = app.store.register({
    name: "Maya",
    email: "designer-owner@example.test",
    password,
  });
  const peer = app.store.register({
    name: "Jordan",
    email: "designer-peer@example.test",
    password,
  });
  const workspace = app.store.createWorkspace(owner.user.id, "Designer flow");
  app.store.accept(
    peer.user,
    app.store.invite(owner.user, workspace.id, peer.user.email, Role.MEMBER)
      .token,
  );
  const auth = (token = owner.token) => ({ authorization: `Bearer ${token}` });
  const base = `/api/workspaces/${workspace.id}/collaborations`;
  const created = await app.inject({
    method: "POST",
    url: base,
    headers: auth(),
    payload: { name: "Campaign" },
  });
  assert.equal(created.statusCode, 201, created.body);
  const path = `${base}/${created.json().id}`;
  const read = async () =>
    (await app.inject({ url: path, headers: auth() })).json();
  const mutate = async (
    suffix: string,
    extra: Record<string, unknown> = {},
    token = owner.token,
  ) => {
    const before = await read();
    return app.inject({
      method: "POST",
      url: path + suffix,
      headers: auth(token),
      payload: { expectedRevision: before.revision, ...extra },
    });
  };
  assert.equal(
    (await mutate("/members", { userId: peer.user.id })).statusCode,
    200,
  );
  const text = "Revenue splits 60% to Maya and 40% to Jordan after fees.";
  const document = await app.inject({
    method: "POST",
    url: path + "/documents",
    headers: auth(),
    payload: { text },
  });
  assert.equal(document.statusCode, 201, document.body);
  const rules = {
    currency: "USD",
    feePolicy: FeePolicy.BEFORE_SPLIT,
    shares: [
      { userId: owner.user.id, basisPoints: 6000 },
      { userId: peer.user.id, basisPoints: 4000 },
    ],
    source: {
      origin: RuleOrigin.SOURCE_CLAUSE,
      documentId: document.json().documentId,
      clause: "1",
      excerpt: text,
    },
    unresolvedQuestions: [] as string[],
  };
  const ok = async (
    suffix: string,
    extra: Record<string, unknown> = {},
    token = owner.token,
  ) => {
    const response = await mutate(suffix, extra, token);
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  return { app, owner, peer, path, auth, read, mutate, ok, rules };
}

test("designer clarification gate cannot send unresolved rules; preview persists nothing", async () => {
  const f = await fixture();
  try {
    await f.ok("/versions", {
      rules: {
        ...f.rules,
        unresolvedQuestions: ["Which fees count as net revenue?"],
      },
    });
    const before = await f.read();
    const send = await f.mutate("/versions/1/send");
    assert.ok(send.statusCode >= 400, send.body);
    assert.match(send.body, /UNRESOLVED_RULES/);
    const approval = await f.mutate("/versions/1/approve");
    assert.ok(approval.statusCode >= 400, approval.body);
    const preview = await f.app.inject({
      method: "POST",
      url: f.path + "/versions/1/preview",
      headers: f.auth(f.peer.token),
      payload: { grossCents: 10000, feeCents: 300 },
    });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal(preview.json().previewOnly, true);
    assert.equal(preview.json().requiresClarification, true);
    assert.deepEqual(await f.read(), before);
  } finally {
    await f.app.close();
  }
});

test("designer review preserves active terms, resets approvals on change request, and requires explicit organizer activation", async () => {
  const f = await fixture();
  try {
    await f.ok("/versions", { rules: f.rules });
    await f.ok("/versions/1/send");
    await f.ok("/versions/1/approve");
    await f.ok("/versions/1/approve", {}, f.peer.token);
    assert.equal((await f.read()).value.activeVersionId, undefined);
    await f.ok("/versions/1/activate");
    await f.ok("/versions", {
      rules: {
        ...f.rules,
        source: {
          ...f.rules.source,
          origin: RuleOrigin.HUMAN_PROPOSAL,
          excerpt: "Proposed revised split, subject to everyone approving.",
        },
        shares: [
          { userId: f.owner.user.id, basisPoints: 5000 },
          { userId: f.peer.user.id, basisPoints: 5000 },
        ],
      },
    });
    await f.ok("/versions/2/send");
    await f.ok("/versions/2/approve");
    await f.ok(
      "/versions/2/request-change",
      { reason: "Rule 2: please explain the new 50/50 split." },
      f.peer.token,
    );
    let current = (await f.read()).value;
    assert.equal(current.activeVersionId, 1);
    assert.equal(current.versions[0].status, VersionStatus.ACTIVE);
    assert.equal(current.versions[1].status, VersionStatus.DRAFT);
    assert.deepEqual(current.versions[1].approvals, {});
    assert.equal(
      current.versions[1].changeRequests[0].reason,
      "Rule 2: please explain the new 50/50 split.",
    );
    await f.ok("/versions/2/send");
    await f.ok("/versions/2/approve", {}, f.peer.token);
    assert.ok((await f.mutate("/versions/2/activate")).statusCode >= 400);
    await f.ok("/versions/2/approve");
    current = (await f.read()).value;
    assert.equal(current.activeVersionId, 1);
    assert.equal(current.versions[1].status, VersionStatus.AWAITING_APPROVAL);
    assert.ok(
      (await f.mutate("/versions/2/activate", {}, f.peer.token)).statusCode >=
        400,
    );
    await f.ok("/versions/2/activate");
    current = (await f.read()).value;
    assert.equal(current.activeVersionId, 2);
    assert.equal(current.versions[0].status, VersionStatus.SUPERSEDED);
    assert.equal(current.versions[1].status, VersionStatus.ACTIVE);
    assert.equal(current.revenue.length, 0);
  } finally {
    await f.app.close();
  }
});

test("uploading replacement source cannot mutate reviewed version or invent its approvals", async () => {
  const f = await fixture();
  try {
    await f.ok("/versions", { rules: f.rules });
    await f.ok("/versions/1/send");
    await f.ok("/versions/1/approve");
    const before = await f.read();
    const replacement = await f.app.inject({
      method: "POST",
      url: f.path + "/documents",
      headers: f.auth(),
      payload: { text: "Replacement agreement: 50/50 after fees." },
    });
    assert.equal(replacement.statusCode, 201, replacement.body);
    assert.deepEqual(await f.read(), before);
    const original = await f.app.inject({
      url: f.path + "/documents/" + f.rules.source.documentId,
      headers: f.auth(),
    });
    assert.equal(original.json().text, f.rules.source.excerpt);
    await f.ok("/versions", {
      rules: {
        ...f.rules,
        source: {
          ...f.rules.source,
          documentId: replacement.json().documentId,
          excerpt: "Replacement agreement: 50/50 after fees.",
        },
        shares: [
          { userId: f.owner.user.id, basisPoints: 5000 },
          { userId: f.peer.user.id, basisPoints: 5000 },
        ],
      },
    });
    const after = (await f.read()).value;
    assert.equal(after.versions[0].status, VersionStatus.SUPERSEDED);
    assert.deepEqual(after.versions[0].rules, before.value.versions[0].rules);
    assert.deepEqual(after.versions[1].approvals, {});
    assert.equal(after.versions[1].status, VersionStatus.DRAFT);
  } finally {
    await f.app.close();
  }
});

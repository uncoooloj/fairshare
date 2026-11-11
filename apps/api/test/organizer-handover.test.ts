import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { AuditType, FeePolicy, RuleOrigin } from "@fairshare/domain";

const TEXT =
  "Maya 50%, Jordan 30%, Riley 20%. Maya paid $2,000 upfront. Maya covers fees.";

/** Maya owns the workspace and organizes; Jordan joined from a named link; Sam is named but pending. */
async function setup() {
  const app = await buildApp({ dbPath: ":memory:" });
  const register = async (email: string) =>
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email,
          name: email.split("@")[0],
          password: "Correct-Horse-123",
        },
      })
    ).json();
  const maya = await register("maya@example.test"),
    jordan = await register("jordan@example.test"),
    riley = await register("riley@example.test"),
    sam = await register("sam@example.test");
  const headers = (user: any) => ({ authorization: `Bearer ${user.token}` });
  const workspace = app.store.createWorkspace(maya.user.id, "Team");
  const base = `/api/workspaces/${workspace.id}/collaborations`;
  const url = `${base}/${
    (
      await app.inject({
        method: "POST",
        url: base,
        headers: headers(maya),
        payload: { name: "Midnight Sessions" },
      })
    ).json().id
  }`;
  const read = async (user = maya) =>
    (await app.inject({ url, headers: headers(user) })).json();
  const documentId = (
    await app.inject({
      method: "POST",
      url: `${url}/documents`,
      headers: headers(maya),
      payload: { text: TEXT },
    })
  ).json().documentId as string;
  const addPerson = async (name: string, email: string, user = maya) =>
    app.inject({
      method: "POST",
      url: `${url}/people`,
      headers: headers(user),
      payload: { expectedRevision: (await read()).revision, name, email },
    });
  const accept = (token: string, user: any) =>
    app.inject({
      method: "POST",
      url: "/api/agreement-invitations/accept",
      headers: headers(user),
      payload: { token },
    });
  for (const [person, email] of [
    [jordan, "jordan@example.test"],
    [riley, "riley@example.test"],
  ]) {
    const added = (await addPerson(email.split("@")[0], email)).json();
    assert.equal(
      (await accept(added.invitation.token, person)).statusCode,
      200,
    );
  }
  const samLink = (await addPerson("Sam", "sam@example.test")).json()
    .invitation;
  const call = async (
    method: "POST" | "DELETE",
    suffix: string,
    user: any,
    payload: Record<string, unknown> = {},
  ) => {
    const revision = (await read()).revision;
    return app.inject({
      method,
      url:
        url +
        suffix +
        (method === "DELETE" ? `?expectedRevision=${revision}` : ""),
      headers: headers(user),
      ...(method === "POST"
        ? { payload: { expectedRevision: revision, ...payload } }
        : {}),
    });
  };
  const offer = (toUserId: string, user = maya) =>
    call("POST", "/organizer-transfer", user, { toUserId });
  const rules = (shares: Array<[string, number]>) => ({
    currency: "USD",
    feePolicy: FeePolicy.ORGANIZER_SHARE,
    feeBearerId: maya.user.id,
    shares: shares.map(([userId, basisPoints]) => ({ userId, basisPoints })),
    advance: {
      id: "adv-1",
      recipientId: maya.user.id,
      amountCents: 200000,
      verified: true,
      source: {
        origin: RuleOrigin.SOURCE_CLAUSE,
        documentId,
        clause: "1",
        excerpt: "Maya paid $2,000 upfront.",
      },
    },
    source: {
      origin: RuleOrigin.SOURCE_CLAUSE,
      documentId,
      clause: "1",
      excerpt: TEXT,
    },
    unresolvedQuestions: [],
  });
  return {
    app,
    maya,
    jordan,
    riley,
    sam,
    samLink,
    url,
    read,
    addPerson,
    accept,
    call,
    offer,
    rules,
  };
}
const role = (agreement: any, userId: string) =>
  agreement.value.members.find((m: any) => m.userId === userId).role;

test("offer rules: organizer only, joined target only, not yourself, current revision", async () => {
  const f = await setup();
  try {
    const collaborator = await f.offer(f.riley.user.id, f.jordan);
    assert.equal(collaborator.statusCode, 403);
    const pendingId = (await f.read()).value.members.find(
      (m: any) => m.pending,
    ).userId;
    const pending = await f.offer(pendingId);
    assert.equal(pending.statusCode, 409);
    assert.equal(pending.json().error.code, "PENDING_MEMBER");
    assert.equal((await f.offer(f.maya.user.id)).statusCode, 400);
    assert.equal((await f.offer("someone-else")).statusCode, 403);
    assert.equal(
      (await f.call("POST", "/organizer-transfer", f.maya, {})).statusCode,
      400,
    );
    const stale = await f.app.inject({
      method: "POST",
      url: `${f.url}/organizer-transfer`,
      headers: { authorization: `Bearer ${f.maya.token}` },
      payload: { expectedRevision: 1, toUserId: f.jordan.user.id },
    });
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().error.code, "REVISION_CONFLICT");
  } finally {
    await f.app.close();
  }
});

test("one open offer: replace, cancel, decline, and only the named person can answer", async () => {
  const f = await setup();
  try {
    const first = await f.offer(f.jordan.user.id);
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(
      first.json().value.organizerHandover.toUserId,
      f.jordan.user.id,
    );
    const replaced = await f.offer(f.riley.user.id);
    assert.equal(
      replaced.json().value.organizerHandover.toUserId,
      f.riley.user.id,
    );
    assert.equal(
      (await f.call("POST", "/organizer-transfer/accept", f.jordan)).statusCode,
      403,
    );
    assert.equal(
      (await f.call("DELETE", "/organizer-transfer", f.riley)).statusCode,
      403,
      "only the organizer cancels",
    );
    const cancelled = await f.call("DELETE", "/organizer-transfer", f.maya);
    assert.equal(cancelled.statusCode, 200, cancelled.body);
    assert.equal(cancelled.json().value.organizerHandover, undefined);
    const none = await f.call("POST", "/organizer-transfer/accept", f.riley);
    assert.equal(none.statusCode, 409);
    assert.equal(none.json().error.code, "NO_HANDOVER");

    await f.offer(f.jordan.user.id);
    const declined = await f.call(
      "POST",
      "/organizer-transfer/decline",
      f.jordan,
    );
    assert.equal(declined.statusCode, 200, declined.body);
    const value = declined.json();
    assert.equal(value.value.organizerHandover, undefined);
    assert.equal(role(value, f.maya.user.id), "ORGANIZER");
    assert.equal(
      value.value.audit.at(-1).type,
      AuditType.ORGANIZER_HANDOVER_DECLINED,
    );
  } finally {
    await f.app.close();
  }
});

test("accept swaps roles; the old organizer can no longer add people or send, the new one can send", async () => {
  const f = await setup();
  try {
    await f.offer(f.jordan.user.id);
    const accepted = await f.call(
      "POST",
      "/organizer-transfer/accept",
      f.jordan,
    );
    assert.equal(accepted.statusCode, 200, accepted.body);
    const agreement = accepted.json();
    assert.equal(role(agreement, f.jordan.user.id), "ORGANIZER");
    assert.equal(role(agreement, f.maya.user.id), "COLLABORATOR");
    assert.equal(
      agreement.value.audit.at(-1).type,
      AuditType.ORGANIZER_HANDED_OVER,
    );

    const mayaAdds = await f.addPerson("Ana", "ana@example.test", f.maya);
    assert.equal(mayaAdds.statusCode, 403, "old organizer cannot add people");
    const pendingId = agreement.value.members.find(
      (m: any) => m.pending,
    ).userId;
    const r = f.rules([
      [f.maya.user.id, 5000],
      [f.jordan.user.id, 2000],
      [f.riley.user.id, 2000],
      [pendingId, 1000],
    ]);
    const mayaSends = await f.call("POST", "/submit", f.maya, { rules: r });
    assert.equal(mayaSends.statusCode, 403);
    const jordanSends = await f.call("POST", "/submit", f.jordan, {
      rules: r,
    });
    assert.equal(jordanSends.statusCode, 200, jordanSends.body);
    assert.equal(
      jordanSends.json().value.versions[0].rules.feeBearerId,
      f.maya.user.id,
      "Maya still covers fees",
    );
    // Sam was named by Maya before the handover; his link still works.
    const samJoins = await f.accept(f.samLink.token, f.sam);
    assert.equal(samJoins.statusCode, 200, samJoins.body);
    assert.equal(
      (await f.call("POST", "/versions/1/activate", f.maya)).statusCode,
      403,
    );
  } finally {
    await f.app.close();
  }
});

test("money split unchanged after handover while awaiting approval", async () => {
  const f = await setup();
  try {
    // Sam joins first so the rules can switch on.
    assert.equal((await f.accept(f.samLink.token, f.sam)).statusCode, 200);
    const r = f.rules([
      [f.maya.user.id, 5000],
      [f.jordan.user.id, 2000],
      [f.riley.user.id, 2000],
      [f.sam.user.id, 1000],
    ]);
    const sent = await f.call("POST", "/submit", f.maya, { rules: r });
    assert.equal(sent.statusCode, 200, sent.body);
    assert.equal(
      (await f.call("POST", "/versions/1/approve", f.riley)).statusCode,
      200,
    );
    const preview = async (user: any) =>
      (
        await f.call("POST", "/versions/1/preview", user, {
          grossCents: 300000,
          feeCents: 10500,
        })
      ).json().allocations;
    const before = await f.read();
    const previewBefore = await preview(f.maya);

    await f.offer(f.jordan.user.id);
    const after = (
      await f.call("POST", "/organizer-transfer/accept", f.jordan)
    ).json();
    assert.deepEqual(after.value.versions, before.value.versions);
    assert.deepEqual(
      after.value.recoupedByAdvance,
      before.value.recoupedByAdvance,
    );
    assert.deepEqual(await preview(f.jordan), previewBefore);

    // Remaining approvals switch on the same rules.
    await f.call("POST", "/versions/1/approve", f.jordan);
    const on = (await f.call("POST", "/versions/1/approve", f.sam)).json();
    assert.equal(on.value.activeVersionId, 1);
    assert.deepEqual(
      on.value.versions[0].rules,
      before.value.versions[0].rules,
    );
    assert.equal(
      on.value.audit.filter((e: any) => e.type === AuditType.ACTIVATED).length,
      1,
    );
  } finally {
    await f.app.close();
  }
});

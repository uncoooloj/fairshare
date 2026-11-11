import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import {
  AuditType,
  FeePolicy,
  RuleOrigin,
  VersionStatus,
} from "@fairshare/domain";

const TEXT = "Revenue splits 60% to Maya and 40% to Riley after fees.";

async function setup() {
  let now = Date.now();
  const app = await buildApp({ dbPath: ":memory:", clock: () => now });
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
  const owner = await register("maya@example.test"),
    riley = await register("riley@example.test"),
    other = await register("other@example.test");
  const headers = (user = owner) => ({ authorization: `Bearer ${user.token}` });
  const workspace = app.store.createWorkspace(owner.user.id, "Team");
  const base = `/api/workspaces/${workspace.id}/collaborations`;
  const created = (
    await app.inject({
      method: "POST",
      url: base,
      headers: headers(),
      payload: { name: "Midnight" },
    })
  ).json();
  const url = `${base}/${created.id}`;
  const read = async (user = owner) =>
    (await app.inject({ url, headers: headers(user) })).json();
  const documentId = (
    await app.inject({
      method: "POST",
      url: `${url}/documents`,
      headers: headers(),
      payload: { text: TEXT },
    })
  ).json().documentId as string;
  const addPerson = async (name: string, email: string, user = owner) =>
    app.inject({
      method: "POST",
      url: `${url}/people`,
      headers: headers(user),
      payload: { expectedRevision: (await read()).revision, name, email },
    });
  const accept = async (token: string, user = riley) =>
    app.inject({
      method: "POST",
      url: "/api/agreement-invitations/accept",
      headers: headers(user),
      payload: { token },
    });
  const rules = (shares: Array<[string, number]>, extra = {}) => ({
    currency: "USD",
    feePolicy: FeePolicy.BEFORE_SPLIT,
    shares: shares.map(([userId, basisPoints]) => ({ userId, basisPoints })),
    source: {
      origin: RuleOrigin.SOURCE_CLAUSE,
      documentId,
      clause: "1",
      excerpt: TEXT,
    },
    unresolvedQuestions: [],
    ...extra,
  });
  const submit = async (r: unknown, user = owner) =>
    app.inject({
      method: "POST",
      url: `${url}/submit`,
      headers: headers(user),
      payload: { expectedRevision: (await read()).revision, rules: r },
    });
  const post = async (suffix: string, user = owner, extra = {}) =>
    app.inject({
      method: "POST",
      url: url + suffix,
      headers: headers(user),
      payload: { expectedRevision: (await read(owner)).revision, ...extra },
    });
  return {
    app,
    owner,
    riley,
    other,
    workspace,
    url,
    headers,
    read,
    documentId,
    addPerson,
    accept,
    rules,
    submit,
    post,
    expire: () => {
      now += 48 * 3600000 + 1;
    },
  };
}

test("named person: add, send with pending seat, join binds the seat, last approval switches on", async () => {
  const f = await setup();
  try {
    assert.equal(
      (await f.addPerson("Riley", "riley@example.test", f.other)).statusCode,
      404,
      "non-members cannot see the agreement",
    );
    const added = await f.addPerson("Riley", "Riley@Example.test");
    assert.equal(added.statusCode, 201, added.body);
    const { agreement, invitation } = added.json();
    assert.match(invitation.token, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(invitation.id && invitation.expiresAt);
    const pendingId = `pending:${invitation.id}`;
    assert.deepEqual(agreement.value.members[1], {
      userId: pendingId,
      displayName: "Riley",
      role: "COLLABORATOR",
      pending: { invitationId: invitation.id, email: "riley@example.test" },
    });
    const duplicate = await f.addPerson("Riley again", "riley@example.test");
    assert.equal(duplicate.statusCode, 409);
    assert.equal(duplicate.json().error.code, "DUPLICATE_PERSON");

    const r = f.rules([
      [f.owner.user.id, 6000],
      [pendingId, 4000],
    ]);
    const sent = await f.submit(r);
    assert.equal(sent.statusCode, 200, sent.body);
    let value = sent.json().value;
    assert.equal(value.versions[0].status, VersionStatus.AWAITING_APPROVAL);
    assert.deepEqual(Object.keys(value.versions[0].approvals), [
      f.owner.user.id,
    ]);
    assert.equal(value.activeVersionId, undefined);
    const previewBefore = (
      await f.post("/versions/1/preview", f.owner, {
        grossCents: 100001,
        feeCents: 2999,
      })
    ).json();

    // Sending locks the people list, but the named person can still join.
    assert.equal(
      (await f.addPerson("Sam", "sam@example.test")).statusCode,
      409,
    );
    const joined = await f.accept(invitation.token);
    assert.equal(joined.statusCode, 200, joined.body);
    value = joined.json().agreement.value;
    assert.equal(JSON.stringify(value).includes("pending:"), false);
    assert.deepEqual(value.members[1], {
      userId: f.riley.user.id,
      displayName: "riley",
      role: "COLLABORATOR",
    });
    assert.deepEqual(
      value.versions[0].rules.shares.map((s: any) => s.userId),
      [f.owner.user.id, f.riley.user.id],
    );
    // The link is single use.
    assert.equal((await f.accept(invitation.token, f.other)).statusCode, 400);

    const previewAfter = (
      await f.post("/versions/1/preview", f.riley, {
        grossCents: 100001,
        feeCents: 2999,
      })
    ).json();
    assert.deepEqual(
      previewAfter.allocations.map((a: any) => [a.shareCents, a.totalCents]),
      previewBefore.allocations.map((a: any) => [a.shareCents, a.totalCents]),
      "binding does not change the money",
    );

    const approved = await f.post("/versions/1/approve", f.riley);
    assert.equal(approved.statusCode, 200, approved.body);
    value = approved.json().value;
    assert.equal(value.activeVersionId, 1);
    assert.equal(value.versions[0].status, VersionStatus.ACTIVE);
    const last = value.audit.at(-1);
    assert.equal(last.type, AuditType.ACTIVATED);
    assert.equal(last.details.automatic, true);
    // The old manual route still answers.
    assert.equal((await f.post("/versions/1/activate")).statusCode, 200);
  } finally {
    await f.app.close();
  }
});

test("submit: organizer only, atomic on validation failure, solo organizer switches on at once", async () => {
  const f = await setup();
  try {
    const before = await f.read();
    const unresolved = await f.submit(
      f.rules([[f.owner.user.id, 10000]], {
        unresolvedQuestions: ["Who pays refunds?"],
      }),
    );
    assert.equal(unresolved.json().error.code, "UNRESOLVED_RULES");
    assert.deepEqual(await f.read(), before, "nothing persisted");
    const badSource = await f.submit(
      f.rules([[f.owner.user.id, 10000]], {
        source: {
          origin: RuleOrigin.SOURCE_CLAUSE,
          documentId: f.documentId,
          clause: "1",
          excerpt: "Not in the document",
        },
      }),
    );
    assert.equal(badSource.json().error.code, "INVALID_SOURCE");
    const solo = await f.submit(f.rules([[f.owner.user.id, 10000]]));
    assert.equal(solo.statusCode, 200, solo.body);
    assert.equal(solo.json().value.activeVersionId, 1);
    assert.equal(solo.json().value.versions[0].status, VersionStatus.ACTIVE);
  } finally {
    await f.app.close();
  }
});

test("a collaborator cannot submit, and pending people block switch-on", async () => {
  const f = await setup();
  try {
    const link = (
      await f.app.inject({
        method: "POST",
        url: `${f.url}/invitation-links`,
        headers: f.headers(),
        payload: {},
      })
    ).json().invitation;
    assert.equal((await f.accept(link.token)).statusCode, 200);
    const pending = (await f.addPerson("Sam", "sam@example.test")).json();
    const pendingId = `pending:${pending.invitation.id}`;
    const r = f.rules([
      [f.owner.user.id, 5000],
      [f.riley.user.id, 3000],
      [pendingId, 2000],
    ]);
    assert.equal((await f.submit(r, f.riley)).statusCode, 403);
    assert.equal((await f.submit(r)).statusCode, 200);
    const approved = await f.post("/versions/1/approve", f.riley);
    assert.equal(approved.statusCode, 200);
    assert.equal(approved.json().value.activeVersionId, undefined);
    const manual = await f.post("/versions/1/activate");
    assert.equal(manual.json().error.code, "PENDING_MEMBERS");
    assert.equal(manual.statusCode, 409);
  } finally {
    await f.app.close();
  }
});

test("remove a named person before sending revokes their link; after sending it is locked", async () => {
  const f = await setup();
  try {
    const first = (await f.addPerson("Riley", "riley@example.test")).json();
    const pendingId = `pending:${first.invitation.id}`;
    const del = async (userId: string, revision?: number) =>
      f.app.inject({
        method: "DELETE",
        url: `${f.url}/people/${encodeURIComponent(userId)}?expectedRevision=${revision ?? (await f.read()).revision}`,
        headers: f.headers(),
      });
    assert.equal((await del(pendingId, 1)).statusCode, 409, "stale revision");
    const removed = await del(pendingId);
    assert.equal(removed.statusCode, 200, removed.body);
    assert.equal(removed.json().agreement.value.members.length, 1);
    assert.equal((await f.accept(first.invitation.token)).statusCode, 400);
    assert.equal((await del(f.owner.user.id)).statusCode, 403);

    const second = (await f.addPerson("Riley", "riley@example.test")).json();
    const secondId = `pending:${second.invitation.id}`;
    await f.submit(
      f.rules([
        [f.owner.user.id, 6000],
        [secondId, 4000],
      ]),
    );
    const locked = await del(secondId);
    assert.equal(locked.statusCode, 409);
    assert.equal(locked.json().error.code, "MEMBERS_LOCKED");
    // A named person's link cannot be revoked out from under the rules.
    const revoke = await f.app.inject({
      method: "DELETE",
      url: `${f.url}/invitation-links/${second.invitation.id}`,
      headers: f.headers(),
    });
    assert.equal(revoke.statusCode, 409);
  } finally {
    await f.app.close();
  }
});

test("an expired named link can be replaced after sending; the new link binds the same seat", async () => {
  const f = await setup();
  try {
    const first = (await f.addPerson("Riley", "riley@example.test")).json();
    const oldId = `pending:${first.invitation.id}`;
    await f.submit(
      f.rules([
        [f.owner.user.id, 6000],
        [oldId, 4000],
      ]),
    );
    f.expire();
    assert.equal((await f.accept(first.invitation.token)).statusCode, 400);
    const reissued = await f.post(
      `/people/${encodeURIComponent(oldId)}/invitation`,
    );
    assert.equal(reissued.statusCode, 201, reissued.body);
    const { invitation, agreement } = reissued.json();
    const newId = `pending:${invitation.id}`;
    assert.equal(agreement.value.members[1].userId, newId);
    assert.equal(agreement.value.versions[0].rules.shares[1].userId, newId);
    assert.equal(
      agreement.value.versions[0].status,
      VersionStatus.AWAITING_APPROVAL,
    );
    const joined = await f.accept(invitation.token);
    assert.equal(joined.statusCode, 200, joined.body);
    assert.equal(
      joined.json().agreement.value.versions[0].rules.shares[1].userId,
      f.riley.user.id,
    );
    const joinedAlready = await f.post(`/people/${f.riley.user.id}/invitation`);
    assert.equal(joinedAlready.statusCode, 409);
    assert.equal(joinedAlready.json().error.code, "NOT_PENDING");
  } finally {
    await f.app.close();
  }
});

test("someone already in the agreement cannot take a named seat; legacy links still join before sending", async () => {
  const f = await setup();
  try {
    // Legacy open link, accepted after a draft exists: allowed until the rules are sent.
    const link = (
      await f.app.inject({
        method: "POST",
        url: `${f.url}/invitation-links`,
        headers: f.headers(),
        payload: {},
      })
    ).json().invitation;
    await f.post("/versions", f.owner, {
      rules: f.rules([[f.owner.user.id, 10000]]),
    });
    assert.equal((await f.accept(link.token)).statusCode, 200);
    const seat = (await f.addPerson("Riley 2", "riley2@example.test")).json();
    const clash = await f.accept(seat.invitation.token);
    assert.equal(clash.statusCode, 409);
    assert.equal(clash.json().error.code, "ALREADY_MEMBER");
    const stillPending = (await f.read()).value.members.find(
      (m: any) => m.pending,
    );
    assert.equal(stillPending.pending.invitationId, seat.invitation.id);
  } finally {
    await f.app.close();
  }
});

test("existing workspace members can be added after a draft exists, not after sending", async () => {
  const f = await setup();
  try {
    f.app.store.db
      .prepare("INSERT INTO memberships VALUES(?,?,?)")
      .run(f.workspace.id, f.other.user.id, "MEMBER");
    await f.post("/versions", f.owner, {
      rules: f.rules([[f.owner.user.id, 10000]]),
    });
    const added = await f.post("/members", f.owner, {
      userId: f.other.user.id,
    });
    assert.equal(added.statusCode, 200, added.body);
    await f.submit(
      f.rules([
        [f.owner.user.id, 5000],
        [f.other.user.id, 5000],
      ]),
    );
    f.app.store.db
      .prepare("INSERT INTO memberships VALUES(?,?,?)")
      .run(f.workspace.id, f.riley.user.id, "MEMBER");
    const late = await f.post("/members", f.owner, { userId: f.riley.user.id });
    assert.equal(late.json().error.code, "MEMBERS_LOCKED");
  } finally {
    await f.app.close();
  }
});

test("deleting a draft: organizer only, never sent, nothing paid; removes documents and links", async () => {
  const f = await setup();
  try {
    const seat = (await f.addPerson("Riley", "riley@example.test")).json();
    const del = async (user = f.owner, revision?: number) =>
      f.app.inject({
        method: "DELETE",
        url: `${f.url}?expectedRevision=${revision ?? (await f.read()).revision}`,
        headers: f.headers(user),
      });
    assert.equal((await del(f.owner, 1)).statusCode, 409, "stale revision");
    const noRevision = await f.app.inject({
      method: "DELETE",
      url: f.url,
      headers: f.headers(),
    });
    assert.equal(noRevision.statusCode, 400);
    assert.equal((await del(f.other)).statusCode, 404);

    const count = (table: string) =>
      (
        f.app.store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
          n: number;
        }
      ).n;
    // A recorded payment keeps the agreement, even as a draft.
    const id = f.url.split("/").at(-1)!;
    f.app.store.db
      .prepare("INSERT INTO fairshare_captures VALUES(?,?,?)")
      .run("cap-1", f.workspace.id, id);
    const paid = await del();
    assert.equal(paid.statusCode, 409);
    assert.equal(paid.json().error.code, "NOT_A_DRAFT");
    f.app.store.db.prepare("DELETE FROM fairshare_captures").run();

    const ok = await del();
    assert.equal(ok.statusCode, 200, ok.body);
    assert.deepEqual(ok.json(), { deleted: true, id });
    assert.equal(
      (await f.app.inject({ url: f.url, headers: f.headers() })).statusCode,
      404,
    );
    assert.equal(count("fairshare_collaborations"), 0);
    assert.equal(count("fairshare_documents"), 0);
    assert.equal(count("fairshare_agreement_invites"), 0);
    assert.equal((await f.accept(seat.invitation.token)).statusCode, 400);
  } finally {
    await f.app.close();
  }
});

test("a sent agreement cannot be deleted, even after a change request", async () => {
  const f = await setup();
  try {
    const link = (
      await f.app.inject({
        method: "POST",
        url: `${f.url}/invitation-links`,
        headers: f.headers(),
        payload: {},
      })
    ).json().invitation;
    await f.accept(link.token);
    await f.submit(
      f.rules([
        [f.owner.user.id, 6000],
        [f.riley.user.id, 4000],
      ]),
    );
    const del = async () =>
      f.app.inject({
        method: "DELETE",
        url: `${f.url}?expectedRevision=${(await f.read()).revision}`,
        headers: f.headers(),
      });
    assert.equal((await del()).json().error.code, "NOT_A_DRAFT");
    await f.post("/versions/1/request-change", f.riley, { reason: "Split" });
    assert.equal(
      (await f.read()).value.versions[0].status,
      VersionStatus.DRAFT,
    );
    assert.equal((await del()).json().error.code, "NOT_A_DRAFT");
  } finally {
    await f.app.close();
  }
});

test("an advance not paid yet: sent, approved, then confirmed by the organizer to switch on", async () => {
  const f = await setup();
  try {
    const link = (
      await f.app.inject({
        method: "POST",
        url: `${f.url}/invitation-links`,
        headers: f.headers(),
        payload: {},
      })
    ).json().invitation;
    assert.equal((await f.accept(link.token)).statusCode, 200);
    const advance = {
      id: "adv-1",
      recipientId: f.owner.user.id,
      amountCents: 200000,
      verified: false,
      source: {
        origin: RuleOrigin.HUMAN_PROPOSAL,
        documentId: f.documentId,
        clause: "Midnight",
        excerpt: "Maya put in $2,000 upfront and is paid back first.",
      },
    };
    const r = f.rules(
      [
        [f.owner.user.id, 6000],
        [f.riley.user.id, 4000],
      ],
      { advance },
    );
    const sent = await f.submit(r);
    assert.equal(sent.statusCode, 200, sent.body);
    const approved = await f.post("/versions/1/approve", f.riley);
    assert.equal(approved.statusCode, 200, approved.body);
    assert.equal(approved.json().value.activeVersionId, undefined);
    const manual = await f.post("/versions/1/activate");
    assert.equal(manual.statusCode, 409);
    assert.equal(manual.json().error.code, "ADVANCE_UNCONFIRMED");

    const byCollaborator = await f.post("/advance/confirm", f.riley, {
      advanceId: "adv-1",
    });
    assert.equal(byCollaborator.statusCode, 403);
    const wrong = await f.post("/advance/confirm", f.owner, {
      advanceId: "adv-2",
    });
    assert.equal(wrong.statusCode, 409);
    const stale = await f.app.inject({
      method: "POST",
      url: `${f.url}/advance/confirm`,
      headers: f.headers(),
      payload: { expectedRevision: 1, advanceId: "adv-1" },
    });
    assert.equal(stale.statusCode, 409);

    const confirmed = await f.post("/advance/confirm", f.owner, {
      advanceId: "adv-1",
    });
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    const value = confirmed.json().value;
    assert.equal(value.versions.length, 1);
    assert.equal(value.versions[0].rules.advance.verified, true);
    assert.equal(value.activeVersionId, 1);
    assert.deepEqual(
      value.audit.slice(-2).map((e: any) => e.type),
      [AuditType.ADVANCE_CONFIRMED, AuditType.ACTIVATED],
    );
    const again = await f.post("/advance/confirm", f.owner, {
      advanceId: "adv-1",
    });
    assert.equal(again.statusCode, 409);
    assert.equal(again.json().error.code, "ADVANCE_ALREADY_CONFIRMED");
  } finally {
    await f.app.close();
  }
});

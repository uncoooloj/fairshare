import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { FeePolicy, RuleOrigin, VersionStatus } from "@fairshare/domain";

const TEXT =
  "Revenue splits 50% to Maya, 30% to Jordan and 20% to Riley after fees.";

/** Maya organizes; Jordan and Riley joined through open links. */
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
    riley = await register("riley@example.test");
  const headers = (user: any) => ({ authorization: `Bearer ${user.token}` });
  const workspace = app.store.createWorkspace(maya.user.id, "Team");
  const base = `/api/workspaces/${workspace.id}/collaborations`;
  const url = `${base}/${
    (
      await app.inject({
        method: "POST",
        url: base,
        headers: headers(maya),
        payload: { name: "Midnight" },
      })
    ).json().id
  }`;
  const read = async () =>
    (await app.inject({ url, headers: headers(maya) })).json();
  const documentId = (
    await app.inject({
      method: "POST",
      url: `${url}/documents`,
      headers: headers(maya),
      payload: { text: TEXT },
    })
  ).json().documentId as string;
  for (const person of [jordan, riley]) {
    const link = (
      await app.inject({
        method: "POST",
        url: `${url}/invitation-links`,
        headers: headers(maya),
        payload: {},
      })
    ).json().invitation;
    const joined = await app.inject({
      method: "POST",
      url: "/api/agreement-invitations/accept",
      headers: headers(person),
      payload: { token: link.token },
    });
    assert.equal(joined.statusCode, 200, joined.body);
  }
  const rules = (split: [number, number, number]) => ({
    currency: "USD",
    feePolicy: FeePolicy.BEFORE_SPLIT,
    shares: [maya, jordan, riley].map((u, i) => ({
      userId: u.user.id,
      basisPoints: split[i],
    })),
    source: {
      origin: RuleOrigin.HUMAN_PROPOSAL,
      documentId,
      clause: "Midnight",
      excerpt: `The money is split ${split.map((b) => b / 100).join(" / ")}.`,
    },
    unresolvedQuestions: [],
  });
  const post = async (suffix: string, user: any, extra = {}) =>
    app.inject({
      method: "POST",
      url: url + suffix,
      headers: headers(user),
      payload: { expectedRevision: (await read()).revision, ...extra },
    });
  return { app, maya, jordan, riley, read, rules, post };
}

test("revise after a change request: submit sends the new version and resolves the request", async () => {
  const f = await setup();
  try {
    assert.equal(
      (await f.post("/submit", f.maya, { rules: f.rules([5000, 3000, 2000]) }))
        .statusCode,
      200,
    );
    await f.post("/versions/1/approve", f.jordan);
    const asked = await f.post("/versions/1/request-change", f.riley, {
      reason: "Revenue split: I agreed to 25%.",
    });
    assert.equal(asked.statusCode, 200, asked.body);
    assert.equal(asked.json().value.versions[0].status, VersionStatus.DRAFT);

    // A collaborator can't send the fix; a stale revision is refused.
    const fix = f.rules([5000, 2500, 2500]);
    assert.equal(
      (await f.post("/submit", f.riley, { rules: fix })).statusCode,
      403,
    );
    const before = await f.read();
    const stale = await f.app.inject({
      method: "POST",
      url: `/api/workspaces/${before.workspaceId}/collaborations/${before.id}/submit`,
      headers: { authorization: `Bearer ${f.maya.token}` },
      payload: { expectedRevision: before.revision - 1, rules: fix },
    });
    assert.equal(stale.statusCode, 409);
    assert.deepEqual(await f.read(), before, "nothing persisted");

    const sent = await f.post("/submit", f.maya, { rules: fix });
    assert.equal(sent.statusCode, 200, sent.body);
    const value = sent.json().value;
    assert.deepEqual(
      value.versions.map((v: any) => v.status),
      [VersionStatus.SUPERSEDED, VersionStatus.AWAITING_APPROVAL],
    );
    assert.deepEqual(value.versions[1].changeRequests, []);
    assert.deepEqual(Object.keys(value.versions[1].approvals), [
      f.maya.user.id,
    ]);
    assert.equal(value.activeVersionId, undefined);

    await f.post("/versions/2/approve", f.jordan);
    const last = await f.post("/versions/2/approve", f.riley);
    assert.equal(last.json().value.activeVersionId, 2);
    assert.equal(last.json().value.versions[1].status, VersionStatus.ACTIVE);
  } finally {
    await f.app.close();
  }
});

test("revise an agreement that is already on: the current split stays on until everyone approves", async () => {
  const f = await setup();
  try {
    await f.post("/submit", f.maya, { rules: f.rules([5000, 3000, 2000]) });
    await f.post("/versions/1/approve", f.jordan);
    await f.post("/versions/1/approve", f.riley);
    assert.equal((await f.read()).value.activeVersionId, 1);

    const sent = await f.post("/submit", f.maya, {
      rules: f.rules([4000, 3000, 3000]),
    });
    assert.equal(sent.statusCode, 200, sent.body);
    let value = sent.json().value;
    assert.equal(value.activeVersionId, 1);
    assert.deepEqual(
      value.versions.map((v: any) => v.status),
      [VersionStatus.ACTIVE, VersionStatus.AWAITING_APPROVAL],
    );

    // Changing it again while the first change waits replaces that change.
    const again = await f.post("/submit", f.maya, {
      rules: f.rules([4000, 2000, 4000]),
    });
    value = again.json().value;
    assert.deepEqual(
      value.versions.map((v: any) => v.status),
      [
        VersionStatus.ACTIVE,
        VersionStatus.SUPERSEDED,
        VersionStatus.AWAITING_APPROVAL,
      ],
    );
    await f.post("/versions/3/approve", f.jordan);
    value = (await f.post("/versions/3/approve", f.riley)).json().value;
    assert.equal(value.activeVersionId, 3);
    assert.deepEqual(
      value.versions.map((v: any) => v.status),
      [
        VersionStatus.SUPERSEDED,
        VersionStatus.SUPERSEDED,
        VersionStatus.ACTIVE,
      ],
    );
  } finally {
    await f.app.close();
  }
});

test("submit rolls back details when a revised advance is below what was recouped", async () => {
  const f = await setup();
  try {
    const first = f.rules([5000, 3000, 2000]);
    first.advance = {
      id: "advance-1",
      recipientId: f.jordan.user.id,
      amountCents: 50_000,
      verified: true,
      source: first.source,
    };
    await f.post("/submit", f.maya, { rules: first });
    await f.post("/versions/1/approve", f.jordan);
    await f.post("/versions/1/approve", f.riley);
    const active = await f.read();
    active.value.recoupedByAdvance["advance-1"] = 40_000;
    f.app.store.db
      .prepare(
        "UPDATE fairshare_collaborations SET value=? WHERE workspace_id=? AND id=?",
      )
      .run(JSON.stringify(active.value), active.workspaceId, active.id);
    const before = await f.read();
    const invalid = structuredClone(first);
    invalid.advance!.id = "advance-2";
    invalid.advance!.amountCents = 30_000;
    const response = await f.app.inject({
      method: "POST",
      url: `/api/workspaces/${before.workspaceId}/collaborations/${before.id}/submit`,
      headers: { authorization: `Bearer ${f.maya.token}` },
      payload: {
        expectedRevision: before.revision,
        rules: invalid,
        details: { name: "Changed title", effectiveFrom: "2026-12-01" },
      },
    });
    assert.equal(response.statusCode, 409, response.body);
    assert.equal(response.json().error.code, "ADVANCE_BELOW_RECOUPED");
    assert.deepEqual(await f.read(), before);
    assert.equal(
      f.app.store.db
        .prepare("SELECT count(*) AS count FROM audit WHERE action=?")
        .get("AGREEMENT_DETAILS_UPDATED").count,
      0,
    );
  } finally {
    await f.app.close();
  }
});

test("submit records details audit only with a committed proposal", async () => {
  const f = await setup();
  try {
    const before = await f.read();
    const response = await f.app.inject({
      method: "POST",
      url: `/api/workspaces/${before.workspaceId}/collaborations/${before.id}/submit`,
      headers: { authorization: `Bearer ${f.maya.token}` },
      payload: {
        expectedRevision: before.revision,
        rules: f.rules([5000, 3000, 2000]),
        details: { name: "Revised title", effectiveFrom: "2026-12-01" },
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(
      JSON.parse(
        f.app.store.db
          .prepare("SELECT detail FROM audit WHERE action=?")
          .get("AGREEMENT_DETAILS_UPDATED").detail,
      ),
      {
        agreementId: before.id,
        fields: ["name", "effectiveFrom"],
      },
    );
  } finally {
    await f.app.close();
  }
});

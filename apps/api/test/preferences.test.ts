import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.js";
import {
  defaultPreferences,
  requireApprovalEmail,
} from "../src/preferences.js";

const password = "Preference-test-12345";
test("preferences are authenticated, strictly validated, user-isolated and durable", async () => {
  const directory = mkdtempSync(join(tmpdir(), "fairshare-preferences-"));
  let app = await buildApp({ dbPath: join(directory, "db") });
  try {
    const a = app.store.register({
      name: "A",
      email: "a@example.test",
      password,
    });
    const b = app.store.register({
      name: "B",
      email: "b@example.test",
      password,
    });
    const headers = { authorization: `Bearer ${a.token}` };
    assert.equal(
      (await app.inject({ url: "/api/auth/preferences" })).statusCode,
      401,
    );
    const preferences = defaultPreferences();
    preferences.numberFormat = "de-DE";
    preferences.dateFormat = "iso";
    preferences.notifications.approvalRequests.email = false;
    const save = () =>
      app.inject({
        method: "PUT",
        url: "/api/auth/preferences",
        headers,
        payload: preferences,
      });
    assert.equal((await save()).statusCode, 200);
    assert.throws(
      () => requireApprovalEmail(app.store, a.user.id),
      /turned off/,
    );
    assert.doesNotThrow(() => requireApprovalEmail(app.store, b.user.id));
    for (const extra of [
      { defaultCurrency: "EUR" },
      { numberFormat: "invalid" },
      { userId: b.user.id },
      { notifications: { approvalRequests: { email: "false", inApp: true } } },
    ]) {
      assert.equal(
        (
          await app.inject({
            method: "PUT",
            url: "/api/auth/preferences",
            headers,
            payload: { ...preferences, ...extra },
          })
        ).statusCode,
        400,
      );
    }
    assert.deepEqual(
      (
        await app.inject({
          url: "/api/auth/preferences",
          headers: { authorization: `Bearer ${b.token}` },
        })
      ).json().preferences,
      defaultPreferences(),
    );
    await app.close();
    app = await buildApp({ dbPath: join(directory, "db") });
    assert.deepEqual(
      (await app.inject({ url: "/api/auth/preferences", headers })).json()
        .preferences,
      preferences,
    );
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("in-app notifications respect channels, workspace and agreement membership, and provider success only", async () => {
  const app = await buildApp({ dbPath: ":memory:" });
  try {
    const a = app.store.register({
      name: "A",
      email: "a@example.test",
      password,
    });
    const b = app.store.register({
      name: "B",
      email: "b@example.test",
      password,
    });
    const w = app.store.createWorkspace(a.user.id, "My workspace");
    const headers = { authorization: `Bearer ${a.token}` };
    const agreement = {
      id: "agreement-a",
      name: "Song",
      members: [{ userId: a.user.id }],
      versions: [{ id: 1, status: "AWAITING_APPROVAL" }],
      audit: [
        {
          sequence: 1,
          type: "SENT_FOR_REVIEW",
          at: "2026-11-10T12:00:00Z",
          details: { versionId: 1 },
        },
      ],
    };
    app.store.db
      .prepare("INSERT INTO fairshare_collaborations VALUES(?,?,?,?)")
      .run(w.id, agreement.id, 1, JSON.stringify(agreement));
    app.store.db
      .prepare(
        "INSERT INTO fairshare_payout_ops(id,workspace_id,collaboration_id,capture_id,user_id,recipient_id,amount,status) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        "payout-a",
        w.id,
        agreement.id,
        "capture-a",
        a.user.id,
        "recipient",
        100,
        "PENDING",
      );
    let events = (
      await app.inject({ url: "/api/auth/notifications", headers })
    ).json().events;
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "approvalRequests");
    assert.equal(
      (
        await app.inject({
          url: "/api/auth/notifications",
          headers: { authorization: `Bearer ${b.token}` },
        })
      ).json().events.length,
      0,
    );
    app.store.db
      .prepare("UPDATE fairshare_payout_ops SET status='SUCCESS'")
      .run();
    events = (
      await app.inject({ url: "/api/auth/notifications", headers })
    ).json().events;
    assert.equal(events.length, 2);
    const secondWorkspace = app.store.createWorkspace(a.user.id, "Second");
    const duplicateAgreement = {
      ...agreement,
      name: "Second song",
      audit: [
        {
          sequence: 1,
          type: "SENT_FOR_REVIEW",
          at: "2026-11-10T13:00:00Z",
          details: { versionId: 1 },
        },
      ],
    };
    app.store.db
      .prepare("INSERT INTO fairshare_collaborations VALUES(?,?,?,?)")
      .run(
        secondWorkspace.id,
        duplicateAgreement.id,
        1,
        JSON.stringify(duplicateAgreement),
      );
    app.store.db
      .prepare(
        "INSERT INTO fairshare_payout_ops(id,workspace_id,collaboration_id,capture_id,user_id,recipient_id,amount,status) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        "payout-second",
        secondWorkspace.id,
        duplicateAgreement.id,
        "capture-second",
        a.user.id,
        "recipient",
        100,
        "SUCCESS",
      );
    events = (
      await app.inject({ url: "/api/auth/notifications", headers })
    ).json().events;
    const duplicateEvents = events.filter(
      (event: any) => event.agreementId === agreement.id,
    );
    assert.equal(duplicateEvents.length, 4);
    assert.deepEqual(
      new Set(duplicateEvents.map((event: any) => event.workspaceId)),
      new Set([w.id, secondWorkspace.id]),
    );
    assert.deepEqual(
      new Set(duplicateEvents.map((event: any) => event.agreementName)),
      new Set([agreement.name, duplicateAgreement.name]),
    );
    assert.equal(
      new Set(
        duplicateEvents.map((event: any) => `${event.workspaceId}:${event.id}`),
      ).size,
      duplicateEvents.length,
    );
    const preferences = defaultPreferences();
    preferences.notifications.approvalRequests.inApp = false;
    preferences.notifications.payoutCompleted.inApp = false;
    await app.inject({
      method: "PUT",
      url: "/api/auth/preferences",
      headers,
      payload: preferences,
    });
    assert.equal(
      (await app.inject({ url: "/api/auth/notifications", headers })).json()
        .events.length,
      0,
    );
    app.store.db
      .prepare("DELETE FROM memberships WHERE user_id=?")
      .run(a.user.id);
    assert.equal(
      (await app.inject({ url: "/api/auth/notifications", headers })).json()
        .events.length,
      0,
    );
  } finally {
    await app.close();
  }
});

test("in-app notifications share the limited feed between audit events and payout states", async () => {
  const app = await buildApp({ dbPath: ":memory:" });
  try {
    const user = app.store.register({
      name: "A",
      email: "a@example.test",
      password,
    });
    const workspace = app.store.createWorkspace(user.user.id, "My workspace");
    const agreement = {
      id: "agreement-a",
      name: "Song",
      members: [{ userId: user.user.id }],
      versions: [{ id: 1, status: "AWAITING_APPROVAL" }],
      audit: Array.from({ length: 101 }, (_, index) => ({
        sequence: index + 1,
        type: "SENT_FOR_REVIEW",
        at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
        details: { versionId: 1 },
      })),
    };
    app.store.db
      .prepare("INSERT INTO fairshare_collaborations VALUES(?,?,?,?)")
      .run(workspace.id, agreement.id, 1, JSON.stringify(agreement));
    app.store.db
      .prepare(
        "INSERT INTO fairshare_payout_ops(id,workspace_id,collaboration_id,capture_id,user_id,recipient_id,amount,status) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        "failed-payout",
        workspace.id,
        agreement.id,
        "capture-a",
        user.user.id,
        "recipient",
        100,
        "FAILED",
      );
    const insertPayout = app.store.db.prepare(
      "INSERT INTO fairshare_payout_ops(id,workspace_id,collaboration_id,capture_id,user_id,recipient_id,amount,status) VALUES(?,?,?,?,?,?,?,?)",
    );
    for (let index = 0; index < 100; index++)
      insertPayout.run(
        `successful-payout-${index}`,
        workspace.id,
        agreement.id,
        `capture-${index}`,
        user.user.id,
        "recipient",
        100,
        "SUCCESS",
      );

    const events = (
      await app.inject({
        url: "/api/auth/notifications",
        headers: { authorization: `Bearer ${user.token}` },
      })
    ).json().events;

    assert.equal(events.length, 100);
    assert.ok(
      events.some(
        (event: { id: string }) => event.id === "payout:failed-payout:FAILED",
      ),
    );
    assert.ok(
      events.some((event: { id: string }) => event.id === "agreement-a:101"),
    );
  } finally {
    await app.close();
  }
});

test("in-app notification copy describes events and payout outcomes accurately", async () => {
  const app = await buildApp({ dbPath: ":memory:" });
  try {
    const owner = app.store.register({
      name: "Owner",
      email: "owner@example.test",
      password,
    });
    const member = app.store.register({
      name: "Member",
      email: "member@example.test",
      password,
    });
    const workspace = app.store.createWorkspace(owner.user.id, "My workspace");
    app.store.db
      .prepare("INSERT INTO memberships VALUES(?,?,?)")
      .run(workspace.id, member.user.id, "MEMBER");
    const agreement = {
      id: "agreement-copy",
      name: "Song",
      members: [{ userId: owner.user.id }, { userId: member.user.id }],
      versions: [
        {
          id: 2,
          status: "AWAITING_APPROVAL",
          // The organizer has already approved the version as part of send.
          approvals: { [owner.user.id]: "2026-11-10T12:00:00Z" },
        },
      ],
      audit: [
        {
          sequence: 1,
          type: "VERSION_PROPOSED",
          at: "2026-11-10T11:59:00Z",
          details: { versionId: 2 },
        },
        {
          sequence: 2,
          type: "SENT_FOR_REVIEW",
          at: "2026-11-10T12:00:00Z",
          details: { versionId: 2 },
        },
      ],
    };
    app.store.db
      .prepare("INSERT INTO fairshare_collaborations VALUES(?,?,?,?)")
      .run(workspace.id, agreement.id, 2, JSON.stringify(agreement));
    const insertPayout = app.store.db.prepare(
      "INSERT INTO fairshare_payout_ops(id,workspace_id,collaboration_id,capture_id,user_id,recipient_id,amount,status) VALUES(?,?,?,?,?,?,?,?)",
    );
    for (const status of [
      "SUCCESS",
      "FAILED",
      "BLOCKED",
      "DENIED",
      "RETURNED",
      "REFUNDED",
    ]) {
      insertPayout.run(
        `payout-copy-${status}`,
        workspace.id,
        agreement.id,
        `capture-copy-${status}`,
        owner.user.id,
        "recipient",
        100,
        status,
      );
    }

    const read = (token: string) =>
      app.inject({
        url: "/api/auth/notifications",
        headers: { authorization: `Bearer ${token}` },
      });
    const ownerEvents = (await read(owner.token)).json().events;
    const memberEvents = (await read(member.token)).json().events;
    const ownerApproval = ownerEvents.find(
      (event: any) => event.kind === "approvalRequests",
    );
    const memberApproval = memberEvents.find(
      (event: any) => event.kind === "approvalRequests",
    );
    assert.ok(ownerApproval);
    assert.ok(memberApproval);
    assert.equal(
      ownerApproval.message,
      "An agreement version was sent for review",
    );
    assert.equal(memberApproval.message, ownerApproval.message);
    assert.equal(
      ownerEvents.find((event: any) => event.kind === "versionChanges")
        ?.message,
      "A new agreement version was proposed",
    );

    const expectedPayoutMessages: Record<string, string> = {
      SUCCESS: "Your payout was sent",
      FAILED: "Your payout was not completed",
      BLOCKED: "Your payout was not completed",
      DENIED: "Your payout was not completed",
      RETURNED: "Your payout was returned after being sent",
      REFUNDED: "Your payout was refunded after being sent",
    };
    for (const [status, message] of Object.entries(expectedPayoutMessages)) {
      assert.equal(
        ownerEvents.find(
          (event: any) => event.id === `payout:payout-copy-${status}:${status}`,
        )?.message,
        message,
      );
    }
  } finally {
    await app.close();
  }
});

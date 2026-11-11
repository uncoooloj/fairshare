import test from "node:test";
import assert from "node:assert/strict";
import {
  addPerson,
  deleteDraft,
  isPendingMember,
  pendingUserId,
  removePerson,
  replacePersonLink,
  submitForApproval,
} from "../lib/agreement-api";
import type { Rules } from "../lib/model";

function capture(response: unknown, status = 200) {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify(response), { status });
  }) as typeof fetch;
  return calls;
}
const base = "/api/service/workspaces/w%201/collaborations/a%2F1";

test("agreement API helpers call the right endpoints with revisions", async () => {
  const original = globalThis.fetch;
  try {
    let calls = capture({ agreement: { id: "a" }, invitation: { id: "i" } });
    const added = await addPerson("w 1", "a/1", 3, {
      name: "Riley",
      email: "riley@example.test",
    });
    assert.equal(added.invitation.id, "i");
    assert.deepEqual(calls, [
      {
        url: `${base}/people`,
        method: "POST",
        body: {
          expectedRevision: 3,
          name: "Riley",
          email: "riley@example.test",
        },
      },
    ]);

    calls = capture({ agreement: { id: "a", revision: 5 } });
    const after = await removePerson("w 1", "a/1", 4, "pending:i");
    assert.equal(after.revision, 5);
    assert.deepEqual(calls[0], {
      url: `${base}/people/pending%3Ai?expectedRevision=4`,
      method: "DELETE",
      body: undefined,
    });

    calls = capture({ agreement: {}, invitation: { id: "j" } });
    await replacePersonLink("w 1", "a/1", 6, "pending:i");
    assert.equal(calls[0].url, `${base}/people/pending%3Ai/invitation`);
    assert.deepEqual(calls[0].body, { expectedRevision: 6 });

    calls = capture({ id: "a", revision: 8 });
    const rules = { currency: "USD" } as Rules;
    await submitForApproval("w 1", "a/1", 7, rules);
    assert.deepEqual(calls[0], {
      url: `${base}/submit`,
      method: "POST",
      body: { expectedRevision: 7, rules },
    });

    calls = capture({ deleted: true, id: "a" });
    await deleteDraft("w 1", "a/1", 9);
    assert.deepEqual(calls[0], {
      url: `${base}?expectedRevision=9`,
      method: "DELETE",
      body: undefined,
    });

    capture({ error: { code: "MEMBERS_LOCKED", message: "Locked" } }, 409);
    await assert.rejects(
      addPerson("w", "a", 1, { name: "x", email: "x@example.test" }),
      (err: any) => err.code === "MEMBERS_LOCKED" && err.status === 409,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("pending people are recognisable and keyed by invitation", () => {
  assert.equal(pendingUserId("inv-1"), "pending:inv-1");
  assert.equal(
    isPendingMember({
      userId: "pending:inv-1",
      displayName: "Riley",
      role: "COLLABORATOR",
      pending: { invitationId: "inv-1", email: "riley@example.test" },
    }),
    true,
  );
  assert.equal(
    isPendingMember({ userId: "u", displayName: "Maya", role: "ORGANIZER" }),
    false,
  );
});

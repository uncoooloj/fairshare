import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptOrganizerHandover,
  cancelOrganizerHandover,
  declineOrganizerHandover,
  offerOrganizerHandover,
  organizerHandoverOf,
} from "../lib/agreement-api";
import type { Agreement } from "../lib/model";

const base =
  "/api/service/workspaces/w%201/collaborations/a%2F1/organizer-transfer";

test("organizer handover helpers call the right endpoints with revisions", async () => {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify({ id: "a", revision: 9 }));
  }) as typeof fetch;
  try {
    await offerOrganizerHandover("w 1", "a/1", 3, "jordan");
    await cancelOrganizerHandover("w 1", "a/1", 4);
    await acceptOrganizerHandover("w 1", "a/1", 5);
    await declineOrganizerHandover("w 1", "a/1", 6);
    assert.deepEqual(calls, [
      {
        url: base,
        method: "POST",
        body: { expectedRevision: 3, toUserId: "jordan" },
      },
      { url: `${base}?expectedRevision=4`, method: "DELETE", body: undefined },
      { url: `${base}/accept`, method: "POST", body: { expectedRevision: 5 } },
      { url: `${base}/decline`, method: "POST", body: { expectedRevision: 6 } },
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

test("the open offer is read from the agreement", () => {
  const agreement = { value: { members: [] } } as unknown as Agreement;
  assert.equal(organizerHandoverOf(agreement), undefined);
  const offer = { fromUserId: "maya", toUserId: "jordan", at: "2026-11-11" };
  assert.deepEqual(
    organizerHandoverOf({
      value: { ...agreement.value, organizerHandover: offer },
    } as unknown as Agreement),
    offer,
  );
});

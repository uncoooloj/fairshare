import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advanceAwaitingConfirmation,
  readyButForAdvance,
} from "../lib/advance-status";
import type { Agreement } from "../lib/model";

function sent(verified: boolean, approvals: string[]): Agreement {
  return {
    workspaceId: "w",
    id: "a",
    revision: 3,
    value: {
      name: "Midnight",
      members: [
        { userId: "maya", displayName: "Maya", role: "ORGANIZER" },
        { userId: "jordan", displayName: "Jordan", role: "COLLABORATOR" },
      ],
      versions: [
        {
          id: 1,
          status: "AWAITING_APPROVAL",
          rules: {
            advance: {
              id: "adv-1",
              recipientId: "maya",
              amountCents: 200000,
              verified,
            },
          },
          approvals: Object.fromEntries(approvals.map((id) => [id, "t"])),
        },
      ],
      revenue: [],
      recoupedByAdvance: {},
      reviewHold: false,
      audit: [],
    },
  } as unknown as Agreement;
}

test("an unconfirmed advance on a sent agreement is reported with its person", () => {
  assert.deepEqual(advanceAwaitingConfirmation(sent(false, ["maya"])), {
    advanceId: "adv-1",
    recipientName: "Maya",
    amountCents: 200000,
  });
  assert.equal(advanceAwaitingConfirmation(sent(true, ["maya"])), null);
});

test("ready but for the advance only once everyone approved", () => {
  assert.equal(readyButForAdvance(sent(false, ["maya"])), false);
  assert.equal(readyButForAdvance(sent(false, ["maya", "jordan"])), true);
  assert.equal(readyButForAdvance(sent(true, ["maya", "jordan"])), false);
});

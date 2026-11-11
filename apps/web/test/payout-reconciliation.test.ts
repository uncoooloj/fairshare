import test from "node:test";
import assert from "node:assert/strict";
import { reconcileOrganizerPayouts } from "../lib/payout-reconciliation";
import type { Agreement } from "../lib/model";

const agreement = (
  workspaceId: string,
  id: string,
  organizerId = "organizer",
) =>
  ({
    workspaceId,
    id,
    value: { members: [{ userId: organizerId, role: "ORGANIZER" }] },
  }) as Agreement;

test("reconciles current organizer payout batches sequentially with workspace-qualified identity", async () => {
  const current = agreement("workspace-b", "shared-id");
  const calls: string[] = [];
  let inFlight = 0;
  await reconcileOrganizerPayouts({
    agreements: [current],
    userId: "organizer",
    payouts: [
      {
        id: "wrong-workspace",
        batch_id: "batch-1",
        agreement: agreement("workspace-a", "shared-id"),
      },
      { id: "no-batch", agreement: current },
      { id: "first", batch_id: "batch-2", agreement: current },
      { id: "second", batch_id: "batch-3", agreement: current },
    ],
    reconcile: async (payout) => {
      assert.equal(inFlight, 0, "reconciliation must stay sequential");
      inFlight++;
      calls.push(
        `${payout.agreement.workspaceId}/${payout.agreement.id}/${payout.id}`,
      );
      await Promise.resolve();
      inFlight--;
    },
  });
  assert.deepEqual(calls, [
    "workspace-b/shared-id/first",
    "workspace-b/shared-id/second",
  ]);
});

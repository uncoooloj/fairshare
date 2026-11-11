import test from "node:test";
import assert from "node:assert/strict";
import {
  fullAgreementHistoryState,
  isFullAgreementHistoryState,
} from "../lib/full-agreement-history";

test("full agreement history closes on Back and reopens on Forward for the same agreement", () => {
  const reviewerEntry = { nextRouter: { path: "/app" } };
  const fullEntry = fullAgreementHistoryState(
    reviewerEntry,
    "workspace-a",
    "a",
  );

  assert.deepEqual(fullEntry.nextRouter, reviewerEntry.nextRouter);
  assert.equal(
    isFullAgreementHistoryState(fullEntry, "workspace-a", "a"),
    true,
  );
  // Back returns to the unmarked reviewer entry; Forward returns to the marker.
  assert.equal(
    isFullAgreementHistoryState(reviewerEntry, "workspace-a", "a"),
    false,
  );
  assert.equal(
    isFullAgreementHistoryState(fullEntry, "workspace-a", "a"),
    true,
  );
  assert.equal(
    isFullAgreementHistoryState(fullEntry, "workspace-b", "a"),
    false,
  );
  assert.equal(
    isFullAgreementHistoryState(fullEntry, "workspace-a", "other"),
    false,
  );
});

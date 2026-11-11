import test from "node:test";
import assert from "node:assert/strict";
import { versionSummary } from "../lib/version-summary";
import type { Agreement, Version } from "../lib/model";
const v1 = {
  id: 1,
  status: "ACTIVE",
  approvals: { a: "yes", b: "yes" },
} as unknown as Version;
const v2 = {
  id: 2,
  status: "AWAITING_APPROVAL",
  approvals: { a: "yes", removed: "yes" },
} as unknown as Version;
const agreement = {
  value: {
    members: [{ userId: "a" }, { userId: "b" }],
    versions: [v1, v2],
    activeVersionId: 1,
  },
} as unknown as Agreement;
test("latest version is not confused with active rules", () => {
  assert.equal(versionSummary(agreement, v1).active, true);
  assert.equal(versionSummary(agreement, v1).latest, false);
  assert.equal(versionSummary(agreement, v2).active, false);
  assert.equal(versionSummary(agreement, v2).latest, true);
  assert.match(
    versionSummary(agreement, v2).description,
    /Waiting for everyone to approve/,
  );
});
test("approval count includes only current members", () => {
  assert.equal(versionSummary(agreement, v2).approved, 1);
  assert.equal(versionSummary(agreement, v2).total, 2);
});
test("approved inactive rules are not described as active or historical", () => {
  const result = versionSummary(agreement, { ...v2, status: "APPROVED" });
  assert.match(result.description, /Not switched on yet/);
});

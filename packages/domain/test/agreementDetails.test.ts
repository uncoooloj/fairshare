import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agreementDetails,
  createCollaboration,
  Currency,
  DomainError,
  MemberRole,
  updateAgreementDetails,
  validateAgreementDetails,
} from "../src/index.ts";

const at = "2026-11-10T12:00:00.000Z";
const members = [
  { userId: "a", displayName: "A", role: MemberRole.ORGANIZER },
  { userId: "b", displayName: "B", role: MemberRole.COLLABORATOR },
];
const code = (fn: () => unknown, expected: string) =>
  assert.throws(
    fn,
    (error: unknown) => error instanceof DomainError && error.code === expected,
  );

test("details validate strict calendar dates, ordering and currency", () => {
  assert.deepEqual(
    validateAgreementDetails({
      currency: Currency.USD,
      effectiveFrom: "2024-02-29",
      effectiveTo: "2024-02-29",
    }),
    {
      currency: Currency.USD,
      effectiveFrom: "2024-02-29",
      effectiveTo: "2024-02-29",
    },
  );
  assert.deepEqual(
    validateAgreementDetails({ currency: "USD", effectiveTo: null }),
    { currency: Currency.USD, effectiveTo: null },
  );
  for (const date of [
    "2023-02-29",
    "2026-13-01",
    "2026-1-01",
    "2026-01-01T00:00:00Z",
    "",
    20260101,
  ])
    code(
      () => validateAgreementDetails({ currency: "USD", effectiveFrom: date }),
      "INVALID_DATE",
    );
  code(
    () =>
      validateAgreementDetails({
        currency: "USD",
        effectiveFrom: "2026-02-01",
        effectiveTo: "2026-01-31",
      }),
    "INVALID_DATE_RANGE",
  );
  for (const currency of ["EUR", "usd", undefined])
    code(() => validateAgreementDetails({ currency }), "INVALID_CURRENCY");
  code(
    () => validateAgreementDetails({ currency: "USD", extra: 1 }),
    "INVALID_INPUT",
  );
});

test("legacy agreements default to USD; updates merge and stay organizer-only", () => {
  const legacy = createCollaboration(
    { id: "c1", name: "Legacy", members },
    "a",
    at,
  );
  assert.equal(legacy.details, undefined);
  assert.deepEqual(agreementDetails(legacy), { currency: Currency.USD });
  const dated = updateAgreementDetails(
    legacy,
    { effectiveFrom: "2026-01-01" },
    "a",
  );
  assert.equal(legacy.details, undefined);
  const ended = updateAgreementDetails(dated, { effectiveTo: null }, "a");
  assert.deepEqual(ended.details, {
    currency: Currency.USD,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
  });
  code(
    () => updateAgreementDetails(ended, { effectiveTo: "2025-12-31" }, "a"),
    "INVALID_DATE_RANGE",
  );
  code(
    () => updateAgreementDetails(ended, { effectiveTo: "2026-06-01" }, "b"),
    "FORBIDDEN",
  );
  const created = createCollaboration(
    {
      id: "c2",
      name: "New",
      members,
      details: { currency: Currency.USD, effectiveFrom: "2026-03-01" },
    },
    "a",
    at,
  );
  assert.deepEqual(created.details, {
    currency: Currency.USD,
    effectiveFrom: "2026-03-01",
  });
});

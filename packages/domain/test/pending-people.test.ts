import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activateVersion,
  addMember,
  addPendingMember,
  allocateConfirmedRevenue,
  approveAndSwitchOn,
  approveVersion,
  assertDraftDeletable,
  AuditType,
  bindPendingMember,
  computeAllocations,
  createCollaboration,
  DomainError,
  FeePolicy,
  MemberRole,
  pendingUserId,
  previewVersion,
  proposeVersion,
  removeMember,
  replaceUserId,
  requestChange,
  RuleOrigin,
  rulesEverSent,
  sendForReview,
  submitForApproval,
  VersionStatus,
  type Collaboration,
  type Rules,
} from "../src/index.ts";

const at = "2026-11-11T09:00:00.000Z";
const code = (expected: string) => (err: unknown) =>
  err instanceof DomainError && err.code === expected;
const source = {
  origin: RuleOrigin.HUMAN_PROPOSAL,
  documentId: "doc1",
  clause: "Midnight",
  excerpt: "Maya 50%, Jordan 30%, Riley 20% after Riley's $2,000 advance.",
};
const RILEY_INVITE = "inv-riley";
const RILEY_PENDING = pendingUserId(RILEY_INVITE);

function withOrganizer(): Collaboration {
  return createCollaboration(
    {
      id: "c1",
      name: "Midnight",
      members: [
        { userId: "maya", displayName: "Maya", role: MemberRole.ORGANIZER },
      ],
    },
    "maya",
    at,
  );
}
/** Maya organizes; Jordan has joined; Riley is invited but has not joined. */
function withPendingRiley(): Collaboration {
  const c = addMember(
    withOrganizer(),
    { userId: "jordan", displayName: "Jordan" },
    "maya",
    at,
  );
  return addPendingMember(
    c,
    { invitationId: RILEY_INVITE, name: "Riley", email: "Riley@Example.test" },
    "maya",
    at,
  );
}
const rulesFor = (riley: string, overrides: Partial<Rules> = {}): Rules => ({
  currency: "USD",
  shares: [
    { userId: "maya", basisPoints: 5000 },
    { userId: "jordan", basisPoints: 3000 },
    { userId: riley, basisPoints: 2000 },
  ],
  feePolicy: FeePolicy.ORGANIZER_SHARE,
  feeBearerId: "maya",
  advance: {
    id: "adv-1",
    recipientId: riley,
    amountCents: 50000,
    verified: true,
    source,
  },
  source,
  unresolvedQuestions: [],
  ...overrides,
});
const noPlaceholderLeft = (c: Collaboration) =>
  assert.equal(JSON.stringify(c).includes("pending:"), false);

test("an invited person gets a placeholder seat the rules can name", () => {
  const c = withPendingRiley();
  const riley = c.members.find((m) => m.displayName === "Riley")!;
  assert.deepEqual(riley, {
    userId: RILEY_PENDING,
    displayName: "Riley",
    role: MemberRole.COLLABORATOR,
    pending: { invitationId: RILEY_INVITE, email: "riley@example.test" },
  });
  assert.equal(c.audit.at(-1)!.type, AuditType.PERSON_ADDED);
  const proposed = proposeVersion(c, rulesFor(RILEY_PENDING), "maya", at);
  assert.equal(proposed.versions[0].rules.advance!.recipientId, RILEY_PENDING);
});

test("adding invited people validates organizer, email and duplicates", () => {
  const c = withPendingRiley();
  assert.throws(
    () =>
      addPendingMember(
        c,
        { invitationId: "x", name: "Sam", email: "sam@example.test" },
        "jordan",
        at,
      ),
    code("FORBIDDEN"),
  );
  assert.throws(
    () =>
      addPendingMember(
        c,
        { invitationId: "x", name: "Sam", email: "not-an-email" },
        "maya",
        at,
      ),
    code("INVALID_MEMBERS"),
  );
  assert.throws(
    () =>
      addPendingMember(
        c,
        { invitationId: "x", name: "Sam", email: undefined as never },
        "maya",
        at,
      ),
    code("INVALID_MEMBERS"),
  );
  assert.throws(
    () =>
      addPendingMember(
        c,
        { invitationId: "x", name: "R", email: " riley@example.test " },
        "maya",
        at,
      ),
    code("DUPLICATE_PERSON"),
  );
  assert.throws(
    () =>
      addPendingMember(
        c,
        { invitationId: "x", name: "  ", email: "sam@example.test" },
        "maya",
        at,
      ),
    code("INVALID_INPUT"),
  );
  assert.throws(
    () =>
      addMember(c, { userId: "pending:forged", displayName: "F" }, "maya", at),
    code("INVALID_MEMBERS"),
  );
});

test("create rejects forged or organizer placeholders", () => {
  assert.throws(
    () =>
      createCollaboration(
        {
          id: "x",
          name: "X",
          members: [
            { userId: "maya", displayName: "M", role: MemberRole.ORGANIZER },
            {
              userId: "pending:a",
              displayName: "A",
              role: MemberRole.COLLABORATOR,
            },
          ],
        },
        "maya",
        at,
      ),
    code("INVALID_MEMBERS"),
  );
  assert.throws(
    () =>
      createCollaboration(
        {
          id: "x",
          name: "X",
          members: [
            {
              userId: "pending:a",
              displayName: "A",
              role: MemberRole.ORGANIZER,
              pending: { invitationId: "a", email: "a@example.test" },
            },
          ],
        },
        "pending:a",
        at,
      ),
    code("INVALID_MEMBERS"),
  );
});

test("rules with a pending person can be sent, but pending people cannot act and nothing switches on", () => {
  let c = submitForApproval(
    withPendingRiley(),
    rulesFor(RILEY_PENDING),
    "maya",
    at,
  );
  assert.equal(c.versions[0].status, VersionStatus.AWAITING_APPROVAL);
  assert.deepEqual(Object.keys(c.versions[0].approvals), ["maya"]);
  for (const attempt of [
    () => approveVersion(c, 1, RILEY_PENDING, at),
    () => approveAndSwitchOn(c, 1, RILEY_PENDING, at),
    () => requestChange(c, 1, "No", RILEY_PENDING, at),
    () => proposeVersion(c, rulesFor(RILEY_PENDING), RILEY_PENDING, at),
    () => previewVersion(c, 1, { grossCents: 100, feeCents: 0 }, RILEY_PENDING),
  ])
    assert.throws(attempt, code("PENDING_MEMBER"));
  c = approveAndSwitchOn(c, 1, "jordan", at);
  assert.equal(c.versions[0].status, VersionStatus.AWAITING_APPROVAL);
  assert.equal(c.activeVersionId, undefined);
  assert.throws(
    () => activateVersion(c, 1, "maya", at),
    code("PENDING_MEMBERS"),
  );
  // Illustrative previews still work while someone is pending.
  const preview = previewVersion(
    c,
    1,
    { grossCents: 100000, feeCents: 3000 },
    "jordan",
  );
  assert.equal(
    preview.allocations.find((a) => a.userId === RILEY_PENDING)!.totalCents,
    50000 + 10000, // advance back first, then 20% of the remaining $500
  );
});

test("allocation never runs while anyone is pending", () => {
  const c = submitForApproval(
    withOrganizer(),
    {
      ...rulesFor("maya"),
      shares: [{ userId: "maya", basisPoints: 10000 }],
      advance: undefined,
    },
    "maya",
    at,
  );
  assert.equal(c.activeVersionId, 1);
  const forced = structuredClone(c);
  forced.members.push({
    userId: RILEY_PENDING,
    displayName: "Riley",
    role: MemberRole.COLLABORATOR,
    pending: { invitationId: RILEY_INVITE, email: "riley@example.test" },
  });
  assert.throws(
    () =>
      allocateConfirmedRevenue(
        forced,
        {
          providerCaptureId: "cap",
          currency: "USD",
          grossCents: 1000,
          feeCents: 0,
        },
        at,
      ),
    code("PENDING_MEMBERS"),
  );
});

test("joining rewrites the placeholder everywhere, clears pending, then the last approval switches on", () => {
  let c = withPendingRiley();
  c = proposeVersion(c, rulesFor(RILEY_PENDING), "maya", at);
  c = submitForApproval(
    c,
    rulesFor(RILEY_PENDING, { unresolvedQuestions: [] }),
    "maya",
    at,
  );
  c = approveAndSwitchOn(c, 2, "jordan", at);
  const joined = bindPendingMember(
    c,
    RILEY_INVITE,
    { id: "riley", displayName: "Riley Account" },
    at,
  );
  noPlaceholderLeft(joined);
  assert.deepEqual(joined.members.at(-1), {
    userId: "riley",
    displayName: "Riley Account",
    role: MemberRole.COLLABORATOR,
  });
  for (const v of joined.versions) {
    assert.deepEqual(
      v.rules.shares.map((s) => s.userId),
      ["maya", "jordan", "riley"],
    );
    assert.equal(v.rules.advance!.recipientId, "riley");
  }
  assert.deepEqual(Object.keys(joined.versions[1].approvals), [
    "maya",
    "jordan",
  ]);
  assert.equal(joined.audit.at(-1)!.type, AuditType.PERSON_JOINED);
  assert.equal(joined.audit.at(-1)!.actorId, "riley");
  assert.equal(c.members.at(-1)!.userId, RILEY_PENDING, "input not mutated");

  const on = approveAndSwitchOn(joined, 2, "riley", at);
  assert.equal(on.activeVersionId, 2);
  assert.equal(on.versions[1].status, VersionStatus.ACTIVE);
  const activated = on.audit.at(-1)!;
  assert.equal(activated.type, AuditType.ACTIVATED);
  assert.deepEqual(activated.details, { versionId: 2, automatic: true });
  // The old manual route stays harmless.
  assert.deepEqual(activateVersion(on, 2, "maya", at), on);
});

test("joining is refused for an unknown invitation or someone already in the agreement", () => {
  const c = withPendingRiley();
  assert.throws(
    () => bindPendingMember(c, "nope", { id: "x", displayName: "X" }, at),
    code("NOT_FOUND"),
  );
  assert.throws(
    () =>
      bindPendingMember(
        c,
        RILEY_INVITE,
        { id: "jordan", displayName: "J" },
        at,
      ),
    code("ALREADY_MEMBER"),
  );
  assert.throws(
    () =>
      bindPendingMember(
        c,
        RILEY_INVITE,
        { id: "pending:other", displayName: "J" },
        at,
      ),
    code("INVALID_INPUT"),
  );
});

test("replaceUserId covers approvals, change requests, fee bearer, allocations and audit", () => {
  let c = withOrganizer();
  c = addMember(c, { userId: "old", displayName: "Old" }, "maya", at);
  const r: Rules = {
    ...rulesFor("old"),
    shares: [
      { userId: "maya", basisPoints: 6000 },
      { userId: "old", basisPoints: 4000 },
    ],
  };
  c = submitForApproval(c, r, "maya", at);
  c = requestChange(c, 1, "Fix", "old", at);
  c = sendForReview(c, 1, "maya", at);
  c = approveVersion(c, 1, "old", at);
  c = approveAndSwitchOn(c, 1, "maya", at);
  c = allocateConfirmedRevenue(
    c,
    {
      providerCaptureId: "cap",
      currency: "USD",
      grossCents: 500000,
      feeCents: 0,
    },
    at,
  );
  const out = replaceUserId(c, "old", "new");
  assert.equal(JSON.stringify(out).includes('"old"'), false);
  assert.ok(Object.hasOwn(out.versions[0].approvals, "new"));
  assert.equal(out.versions[0].changeRequests[0].userId, "new");
  assert.equal(out.versions[0].rules.advance!.recipientId, "new");
  assert.deepEqual(
    out.revenue[0].allocations.map((a) => a.userId),
    ["maya", "new"],
  );
  assert.deepEqual(out.recoupedByAdvance, c.recoupedByAdvance);
  const swapped = replaceUserId(c, "maya", "boss");
  assert.equal(swapped.versions[0].rules.feeBearerId, "boss");
});

test("money splits identically for a person who was pending then joined vs one who joined first", () => {
  const payments = [
    { grossCents: 150000, feeCents: 4650 },
    { grossCents: 123457, feeCents: 3829 },
    { grossCents: 999999, feeCents: 0 },
  ];
  function run(c: Collaboration) {
    for (const [i, p] of payments.entries())
      c = allocateConfirmedRevenue(
        c,
        { providerCaptureId: `cap-${i}`, currency: "USD", ...p },
        at,
      );
    return c;
  }
  for (const feePolicy of [FeePolicy.BEFORE_SPLIT, FeePolicy.ORGANIZER_SHARE]) {
    // Pending first, bound after sending.
    let pending = submitForApproval(
      withPendingRiley(),
      rulesFor(RILEY_PENDING, { feePolicy }),
      "maya",
      at,
    );
    pending = approveAndSwitchOn(pending, 1, "jordan", at);
    pending = bindPendingMember(
      pending,
      RILEY_INVITE,
      { id: "riley", displayName: "Riley" },
      at,
    );
    pending = approveAndSwitchOn(pending, 1, "riley", at);
    // Joined before any rules existed.
    let joined = addMember(
      addMember(
        withOrganizer(),
        { userId: "jordan", displayName: "Jordan" },
        "maya",
        at,
      ),
      { userId: "riley", displayName: "Riley" },
      "maya",
      at,
    );
    joined = submitForApproval(
      joined,
      rulesFor("riley", { feePolicy }),
      "maya",
      at,
    );
    joined = approveAndSwitchOn(joined, 1, "jordan", at);
    joined = approveAndSwitchOn(joined, 1, "riley", at);
    assert.equal(pending.activeVersionId, 1);
    assert.equal(joined.activeVersionId, 1);
    const a = run(pending);
    const b = run(joined);
    assert.deepEqual(a.revenue, b.revenue);
    assert.deepEqual(a.recoupedByAdvance, b.recoupedByAdvance);
    assert.deepEqual(a.versions[0].rules, b.versions[0].rules);
    // And the pure maths agrees with the stored allocations.
    assert.deepEqual(
      computeAllocations(b.versions[0].rules, payments[0]).allocations,
      b.revenue[0].allocations,
    );
  }
});

test("one-shot submit: organizer only, validated, solo organizer switches on immediately", () => {
  const solo: Rules = {
    ...rulesFor("maya"),
    shares: [{ userId: "maya", basisPoints: 10000 }],
    advance: undefined,
  };
  const on = submitForApproval(withOrganizer(), solo, "maya", at);
  assert.equal(on.activeVersionId, 1);
  assert.deepEqual(
    on.audit.map((e) => e.type),
    [
      AuditType.CREATED,
      AuditType.VERSION_PROPOSED,
      AuditType.SENT_FOR_REVIEW,
      AuditType.APPROVED,
      AuditType.ACTIVATED,
    ],
  );
  const c = withPendingRiley();
  assert.throws(
    () => submitForApproval(c, rulesFor(RILEY_PENDING), "jordan", at),
    code("FORBIDDEN"),
  );
  assert.throws(
    () =>
      submitForApproval(
        c,
        rulesFor(RILEY_PENDING, { unresolvedQuestions: ["Refunds?"] }),
        "maya",
        at,
      ),
    code("UNRESOLVED_RULES"),
  );
  assert.equal(c.versions.length, 0, "input untouched on failure");
});

test("people can change until the rules are first sent, even after a change request", () => {
  let c = withPendingRiley();
  c = proposeVersion(c, rulesFor(RILEY_PENDING), "maya", at);
  assert.equal(rulesEverSent(c), false);
  // A draft exists: people can still be added or removed.
  c = addPendingMember(
    c,
    { invitationId: "inv-sam", name: "Sam", email: "sam@example.test" },
    "maya",
    at,
  );
  // The old draft no longer covers everyone, so it cannot be sent.
  assert.throws(() => sendForReview(c, 1, "maya", at), code("INVALID_SHARES"));
  c = removeMember(c, pendingUserId("inv-sam"), "maya", at);
  assert.equal(c.audit.at(-1)!.type, AuditType.PERSON_REMOVED);
  assert.throws(() => removeMember(c, "maya", "maya", at), code("FORBIDDEN"));
  assert.throws(
    () => removeMember(c, "jordan", "jordan", at),
    code("FORBIDDEN"),
  );
  c = sendForReview(c, 1, "maya", at);
  assert.equal(rulesEverSent(c), true);
  const locked = (x: Collaboration) => {
    assert.throws(
      () =>
        addPendingMember(
          x,
          { invitationId: "i2", name: "Z", email: "z@example.test" },
          "maya",
          at,
        ),
      code("MEMBERS_LOCKED"),
    );
    assert.throws(
      () => addMember(x, { userId: "z", displayName: "Z" }, "maya", at),
      code("MEMBERS_LOCKED"),
    );
    assert.throws(
      () => removeMember(x, RILEY_PENDING, "maya", at),
      code("MEMBERS_LOCKED"),
    );
  };
  locked(c);
  c = requestChange(c, 1, "Wrong split", "jordan", at);
  assert.equal(c.versions[0].status, VersionStatus.DRAFT);
  locked(c);
});

test("an advance can be corrected with a new ID, never by changing an existing one", () => {
  let c = proposeVersion(
    withPendingRiley(),
    rulesFor(RILEY_PENDING),
    "maya",
    at,
  );
  const sameId = rulesFor(RILEY_PENDING);
  sameId.advance!.amountCents = 40000;
  assert.throws(
    () => proposeVersion(c, sameId, "maya", at),
    code("ADVANCE_CHANGED"),
  );
  const corrected = rulesFor(RILEY_PENDING);
  corrected.advance = {
    ...corrected.advance!,
    id: "adv-2",
    amountCents: 40000,
    recipientId: "jordan",
  };
  c = proposeVersion(c, corrected, "maya", at);
  assert.equal(c.versions[1].rules.advance!.amountCents, 40000);
});

test("only an unsent, unpaid draft can be deleted, by its organizer", () => {
  const c = proposeVersion(
    withPendingRiley(),
    rulesFor(RILEY_PENDING),
    "maya",
    at,
  );
  assert.doesNotThrow(() => assertDraftDeletable(c, "maya"));
  assert.throws(() => assertDraftDeletable(c, "jordan"), code("FORBIDDEN"));
  assert.throws(
    () => assertDraftDeletable(c, RILEY_PENDING),
    code("PENDING_MEMBER"),
  );
  const sent = sendForReview(c, 1, "maya", at);
  assert.throws(() => assertDraftDeletable(sent, "maya"), code("NOT_A_DRAFT"));
  const backToDraft = requestChange(sent, 1, "No", "jordan", at);
  assert.throws(
    () => assertDraftDeletable(backToDraft, "maya"),
    code("NOT_A_DRAFT"),
  );
  const paid = structuredClone(c);
  paid.revenue.push({} as never);
  assert.throws(() => assertDraftDeletable(paid, "maya"), code("NOT_A_DRAFT"));
});

test("replacing an invited person's link moves the placeholder with it", async () => {
  const { reissuePendingInvite } = await import("../src/index.ts");
  let c = submitForApproval(
    withPendingRiley(),
    rulesFor(RILEY_PENDING),
    "maya",
    at,
  );
  c = reissuePendingInvite(c, RILEY_PENDING, "inv-2", "maya", at);
  const nextId = pendingUserId("inv-2");
  assert.equal(JSON.stringify(c).includes(RILEY_PENDING), false);
  assert.deepEqual(c.members.at(-1)!.pending, {
    invitationId: "inv-2",
    email: "riley@example.test",
  });
  assert.equal(c.versions[0].rules.advance!.recipientId, nextId);
  assert.equal(c.versions[0].status, VersionStatus.AWAITING_APPROVAL);
  assert.throws(
    () => reissuePendingInvite(c, "jordan", "inv-3", "maya", at),
    code("NOT_PENDING"),
  );
  assert.throws(
    () => reissuePendingInvite(c, nextId, "inv-3", "jordan", at),
    code("FORBIDDEN"),
  );
  const bound = bindPendingMember(
    c,
    "inv-2",
    { id: "riley", displayName: "Riley" },
    at,
  );
  noPlaceholderLeft(bound);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acceptOrganizerHandover,
  activateVersion,
  addMember,
  addPendingMember,
  allocateConfirmedRevenue,
  approveAndSwitchOn,
  AuditType,
  cancelOrganizerHandover,
  createCollaboration,
  declineOrganizerHandover,
  DomainError,
  FeePolicy,
  MemberRole,
  offerOrganizerHandover,
  pendingUserId,
  proposeVersion,
  removeMember,
  RuleOrigin,
  sendForReview,
  submitForApproval,
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
  excerpt: "Maya 50%, Jordan 30%, Riley 20%; Maya covers fees.",
};
const rules = (overrides: Partial<Rules> = {}): Rules => ({
  currency: "USD",
  shares: [
    { userId: "maya", basisPoints: 5000 },
    { userId: "jordan", basisPoints: 3000 },
    { userId: "riley", basisPoints: 2000 },
  ],
  feePolicy: FeePolicy.ORGANIZER_SHARE,
  feeBearerId: "maya",
  advance: {
    id: "adv-1",
    recipientId: "maya",
    amountCents: 200000,
    verified: true,
    source,
  },
  source,
  unresolvedQuestions: [],
  ...overrides,
});
/** Maya organizes; Jordan and Riley have joined. */
function draft(): Collaboration {
  let c = createCollaboration(
    {
      id: "c1",
      name: "Midnight Sessions",
      members: [
        { userId: "maya", displayName: "Maya", role: MemberRole.ORGANIZER },
      ],
    },
    "maya",
    at,
  );
  c = addMember(c, { userId: "jordan", displayName: "Jordan" }, "maya", at);
  return addMember(c, { userId: "riley", displayName: "Riley" }, "maya", at);
}
const roleOf = (c: Collaboration, id: string) =>
  c.members.find((m) => m.userId === id)!.role;
/** Everything money-related, which a handover must never touch. */
const money = (c: Collaboration) =>
  JSON.stringify({
    versions: c.versions,
    activeVersionId: c.activeVersionId,
    revenue: c.revenue,
    recoupedByAdvance: c.recoupedByAdvance,
  });

test("organizer offers, target accepts: roles swap and an audit entry is recorded", () => {
  const offered = offerOrganizerHandover(draft(), "jordan", "maya", at);
  assert.deepEqual(offered.organizerHandover, {
    fromUserId: "maya",
    toUserId: "jordan",
    at,
  });
  assert.equal(
    offered.audit.at(-1)!.type,
    AuditType.ORGANIZER_HANDOVER_OFFERED,
  );
  assert.equal(roleOf(offered, "maya"), MemberRole.ORGANIZER);
  const done = acceptOrganizerHandover(offered, "jordan", at);
  assert.equal(roleOf(done, "jordan"), MemberRole.ORGANIZER);
  assert.equal(roleOf(done, "maya"), MemberRole.COLLABORATOR);
  assert.equal(roleOf(done, "riley"), MemberRole.COLLABORATOR);
  assert.equal(
    done.members.filter((m) => m.role === MemberRole.ORGANIZER).length,
    1,
  );
  assert.equal(done.organizerHandover, undefined);
  assert.deepEqual(done.audit.at(-1), {
    sequence: done.audit.length,
    type: AuditType.ORGANIZER_HANDED_OVER,
    actorId: "jordan",
    at,
    details: { fromUserId: "maya", toUserId: "jordan" },
  });
});

test("only the organizer offers, only to a joined member other than themselves", () => {
  const c = draft();
  assert.throws(
    () => offerOrganizerHandover(c, "riley", "jordan", at),
    code("FORBIDDEN"),
  );
  assert.throws(
    () => offerOrganizerHandover(c, "maya", "maya", at),
    code("INVALID_INPUT"),
  );
  assert.throws(
    () => offerOrganizerHandover(c, "nobody", "maya", at),
    code("FORBIDDEN"),
  );
  const withPending = addPendingMember(
    c,
    { invitationId: "inv-sam", name: "Sam", email: "sam@example.test" },
    "maya",
    at,
  );
  assert.throws(
    () =>
      offerOrganizerHandover(withPending, pendingUserId("inv-sam"), "maya", at),
    code("PENDING_MEMBER"),
  );
});

test("one open offer: offering again replaces it, and the replaced target cannot accept", () => {
  let c = offerOrganizerHandover(draft(), "jordan", "maya", at);
  c = offerOrganizerHandover(c, "riley", "maya", at);
  assert.equal(c.organizerHandover!.toUserId, "riley");
  assert.throws(
    () => acceptOrganizerHandover(c, "jordan", at),
    code("FORBIDDEN"),
  );
  assert.throws(
    () => declineOrganizerHandover(c, "jordan", at),
    code("FORBIDDEN"),
  );
  const done = acceptOrganizerHandover(c, "riley", at);
  assert.equal(roleOf(done, "riley"), MemberRole.ORGANIZER);
});

test("organizer cancels; the target declines; neither changes roles", () => {
  const offered = offerOrganizerHandover(draft(), "jordan", "maya", at);
  assert.throws(
    () => cancelOrganizerHandover(offered, "jordan", at),
    code("FORBIDDEN"),
  );
  const cancelled = cancelOrganizerHandover(offered, "maya", at);
  assert.equal(cancelled.organizerHandover, undefined);
  assert.equal(
    cancelled.audit.at(-1)!.type,
    AuditType.ORGANIZER_HANDOVER_CANCELLED,
  );
  assert.throws(
    () => acceptOrganizerHandover(cancelled, "jordan", at),
    code("NO_HANDOVER"),
  );
  assert.throws(
    () => cancelOrganizerHandover(cancelled, "maya", at),
    code("NO_HANDOVER"),
  );
  const declined = declineOrganizerHandover(offered, "jordan", at);
  assert.equal(declined.organizerHandover, undefined);
  assert.equal(
    declined.audit.at(-1)!.type,
    AuditType.ORGANIZER_HANDOVER_DECLINED,
  );
  assert.equal(roleOf(declined, "maya"), MemberRole.ORGANIZER);
  assert.equal(roleOf(declined, "jordan"), MemberRole.COLLABORATOR);
});

test("removing the person an offer was made to clears the offer", () => {
  const offered = offerOrganizerHandover(draft(), "riley", "maya", at);
  const removed = removeMember(offered, "riley", "maya", at);
  assert.equal(removed.organizerHandover, undefined);
});

test("handover while awaiting approval keeps the split, fee bearer and approvals", () => {
  const sent = submitForApproval(draft(), rules(), "maya", at);
  const before = money(sent);
  const done = acceptOrganizerHandover(
    offerOrganizerHandover(sent, "jordan", "maya", at),
    "jordan",
    at,
  );
  assert.equal(money(done), before);
  const v = done.versions.at(-1)!;
  assert.equal(v.rules.feeBearerId, "maya");
  assert.deepEqual(Object.keys(v.approvals), ["maya"]);
  // Approvals carry on and the last one switches the unchanged rules on.
  let on = approveAndSwitchOn(done, v.id, "jordan", at);
  on = approveAndSwitchOn(on, v.id, "riley", at);
  assert.equal(on.activeVersionId, v.id);
});

test("handover after switch-on: payments split exactly as before", () => {
  let c = submitForApproval(draft(), rules(), "maya", at);
  c = approveAndSwitchOn(c, 1, "jordan", at);
  c = approveAndSwitchOn(c, 1, "riley", at);
  const payment = {
    providerCaptureId: "cap-1",
    currency: "USD" as const,
    grossCents: 300000,
    feeCents: 10500,
  };
  const without = allocateConfirmedRevenue(c, payment, at).revenue[0];
  const handed = acceptOrganizerHandover(
    offerOrganizerHandover(c, "jordan", "maya", at),
    "jordan",
    at,
  );
  assert.equal(money(handed), money(c));
  const withHandover = allocateConfirmedRevenue(handed, payment, at).revenue[0];
  assert.deepEqual(withHandover.allocations, without.allocations);
  // Maya still covers the fee from her share.
  assert.equal(
    withHandover.allocations.find((a) => a.userId === "maya")!.feeCents,
    10500,
  );
});

test("organizer-only actions follow the new organizer", () => {
  const done = acceptOrganizerHandover(
    offerOrganizerHandover(draft(), "jordan", "maya", at),
    "jordan",
    at,
  );
  assert.throws(
    () =>
      addPendingMember(
        done,
        { invitationId: "inv-sam", name: "Sam", email: "sam@example.test" },
        "maya",
        at,
      ),
    code("FORBIDDEN"),
  );
  assert.throws(
    () => submitForApproval(done, rules(), "maya", at),
    code("FORBIDDEN"),
  );
  assert.throws(
    () => offerOrganizerHandover(done, "riley", "maya", at),
    code("FORBIDDEN"),
  );
  // Jordan can send rules where Maya, now a former organizer, still covers fees.
  const sent = submitForApproval(done, rules(), "jordan", at);
  assert.equal(sent.versions.at(-1)!.approvals.jordan, at);
  assert.throws(() => activateVersion(sent, 1, "maya", at), code("FORBIDDEN"));
});

test("a draft written before the handover can still be sent by the new organizer", () => {
  const drafted = proposeVersion(draft(), rules(), "maya", at);
  const done = acceptOrganizerHandover(
    offerOrganizerHandover(drafted, "jordan", "maya", at),
    "jordan",
    at,
  );
  const sent = sendForReview(done, 1, "jordan", at);
  assert.equal(sent.versions[0].status, "AWAITING_APPROVAL");
});

test("a collaborator who never organized still cannot be the fee bearer", () => {
  assert.throws(
    () => proposeVersion(draft(), rules({ feeBearerId: "riley" }), "maya", at),
    code("FORBIDDEN"),
  );
});

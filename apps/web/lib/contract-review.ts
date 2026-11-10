import type { Agreement, Version } from "./model";

function reviewHeading(
  version: Version,
  reviewing: boolean,
  allApproved: boolean,
  approvedCount: number,
  memberCount: number,
  blockerCount: number,
) {
  if (version.status === "ACTIVE") return "These rules are active";
  if (reviewing && allApproved) return "Everyone approved. Ready to activate.";
  if (reviewing) return `${approvedCount} of ${memberCount} approved`;
  if (blockerCount) return "Resolve before review";
  if (version.status === "DRAFT") return "Ready for everyone’s review";
  return "Historical version";
}

function reviewEffect(version: Version, activeId: number | undefined) {
  if (activeId && activeId !== version.id) {
    return `Version ${activeId} still governs incoming payments. This proposal changes nothing until everyone approves and the organizer activates it.`;
  }
  if (version.status === "ACTIVE") {
    return "Incoming payments use these agreed rules. Approval of terms is not a payment or payout.";
  }
  return "No payments can be allocated under this proposal until everyone approves and the organizer activates it.";
}

/** Presentation gates mirror domain rules, but the API remains authoritative. */
export function contractReviewState(
  agreement: Agreement,
  version: Version,
  userId: string,
) {
  const members = agreement.value.members;
  const participant = members.find((member) => member.userId === userId);
  const current = agreement.value.versions.at(-1)?.id === version.id;
  const blockers = [...version.rules.unresolvedQuestions];
  if (version.rules.advance && !version.rules.advance.verified)
    blockers.push("Verify the existing advance before requesting approval.");
  const approved = members.filter((member) =>
    Object.hasOwn(version.approvals, member.userId),
  );
  const pending = members.filter(
    (member) => !Object.hasOwn(version.approvals, member.userId),
  );
  const allApproved = members.length > 0 && pending.length === 0;
  const reviewing = current && version.status === "AWAITING_APPROVAL";
  const activeId = agreement.value.activeVersionId;
  return {
    blockers,
    approved,
    pending,
    allApproved,
    canSend:
      !!participant &&
      current &&
      version.status === "DRAFT" &&
      blockers.length === 0,
    canApprove:
      !!participant && reviewing && !Object.hasOwn(version.approvals, userId),
    canRequestChange: !!participant && reviewing,
    canActivate: participant?.role === "ORGANIZER" && reviewing && allApproved,
    heading: reviewHeading(
      version,
      reviewing,
      allApproved,
      approved.length,
      members.length,
      blockers.length,
    ),
    effect: reviewEffect(version, activeId),
  };
}

export function formatRuleChange(rule: string, reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("Explain what needs to change.");
  const formatted = rule ? `${rule}: ${trimmed}` : trimmed;
  if (formatted.length > 2000)
    throw new Error("Keep your change request within 2,000 characters.");
  return formatted;
}

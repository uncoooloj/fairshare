import type { Agreement, Version } from "./model";

function reviewHeading(
  version: Version,
  reviewing: boolean,
  allApproved: boolean,
  advanceNeedsConfirmation: boolean,
  approvedCount: number,
  memberCount: number,
  blockerCount: number,
) {
  if (version.status === "ACTIVE") return "These rules are active";
  if (reviewing && allApproved)
    return advanceNeedsConfirmation
      ? "Everyone approved. Confirm the advance first."
      : "Everyone approved. Ready to switch on.";
  if (reviewing) return `${approvedCount} of ${memberCount} approved`;
  if (blockerCount) return "Answer questions first";
  if (version.status === "DRAFT") return "Ready for everyone’s review";
  return "Older version";
}

function reviewEffect(
  version: Version,
  activeId: number | undefined,
  advanceNeedsConfirmation: boolean,
) {
  const activation = advanceNeedsConfirmation
    ? "everyone approves and the organizer confirms the advance is paid"
    : "everyone approves and it’s switched on";
  if (activeId && activeId !== version.id) {
    return `Version ${activeId} is still in use. This change starts once ${activation}.`;
  }
  if (version.status === "ACTIVE") {
    return "New payments are split this way.";
  }
  return `Nothing is split until ${activation}.`;
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
  const advanceNeedsConfirmation = version.rules.advance?.verified === false;
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
    canActivate:
      participant?.role === "ORGANIZER" &&
      reviewing &&
      allApproved &&
      !advanceNeedsConfirmation,
    heading: reviewHeading(
      version,
      reviewing,
      allApproved,
      advanceNeedsConfirmation,
      approved.length,
      members.length,
      blockers.length,
    ),
    effect: reviewEffect(version, activeId, advanceNeedsConfirmation),
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

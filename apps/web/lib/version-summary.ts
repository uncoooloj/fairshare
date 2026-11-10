import type { Agreement, Version } from "./model";

function versionDescription(active: boolean, status: Version["status"]) {
  if (active) return "Active rules for incoming payments.";

  switch (status) {
    case "AWAITING_APPROVAL":
      return "Everyone reviews this version before the organizer can activate it.";
    case "APPROVED":
      return "Approved by everyone. Not active until the organizer activates it.";
    case "DRAFT":
      return "Draft only. Not used to split payments.";
    default:
      return "Historical version. Past allocations keep their original rules.";
  }
}

export function versionSummary(agreement: Agreement, version: Version) {
  const approved = agreement.value.members.filter((member) =>
    Object.hasOwn(version.approvals, member.userId),
  ).length;
  const total = agreement.value.members.length;
  const active = agreement.value.activeVersionId === version.id;
  return {
    approved,
    total,
    active,
    latest: agreement.value.versions.at(-1)?.id === version.id,
    description: versionDescription(active, version.status),
  };
}

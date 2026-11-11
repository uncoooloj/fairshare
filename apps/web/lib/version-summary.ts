import type { Agreement, Version } from "./model";

function versionDescription(active: boolean, status: Version["status"]) {
  if (active) return "In use for new payments.";

  switch (status) {
    case "AWAITING_APPROVAL":
      return "Waiting for everyone to approve.";
    case "APPROVED":
      return "Everyone approved. Not switched on yet.";
    case "DRAFT":
      return "Draft. Not in use.";
    default:
      return "Older version.";
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

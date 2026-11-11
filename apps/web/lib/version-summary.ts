import type { Agreement, Version } from "./model";

/** Plain name for a set of terms: the first ones sent, then each update. */
export function termsLabel(versionId: number) {
  return versionId <= 1 ? "Original terms" : `Update ${versionId - 1}`;
}

/** Plain status for a set of terms. */
export function termsStatusLabel(status: Version["status"]) {
  switch (status) {
    case "ACTIVE":
      return "In use";
    case "AWAITING_APPROVAL":
      return "Waiting for approvals";
    case "DRAFT":
      return "Not sent";
    case "SUPERSEDED":
      return "Replaced";
    default:
      return "Earlier terms";
  }
}

function versionDescription(active: boolean, status: Version["status"]) {
  if (active) return "In use. New payments split this way.";

  switch (status) {
    case "AWAITING_APPROVAL":
      return "Waiting for everyone to approve. Nothing is paid this way until then.";
    case "APPROVED":
      return "Everyone approved. Not in use yet.";
    case "DRAFT":
      return "Not sent yet. Not used to split payments.";
    default:
      return "Earlier terms. Past payments keep the split they were paid under.";
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

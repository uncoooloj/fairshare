import type { Version } from "./model";
export function approvalLabel(version: Version | undefined, userId: string) {
  if (!version) return "No proposal yet";
  if (version.approvals[userId]) return "Approved";
  if (version.changeRequests.some((request) => request.userId === userId))
    return "Changes requested";
  if (version.status === "DRAFT") return "Not sent for review";
  if (version.status === "SUPERSEDED") return "Version replaced";
  return "Awaiting review";
}
export function payoutReadinessLabel(status: string | undefined) {
  if (status === "SAVED_UNVERIFIED") return "Destination saved · not verified";
  if (status === "MISSING") return "Needs payout destination";
  return "Status unavailable";
}

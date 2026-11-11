import type { Version } from "./model";
export function approvalLabel(version: Version | undefined, userId: string) {
  if (!version) return "No proposal yet";
  if (version.approvals[userId]) return "Approved";
  if (version.changeRequests.some((request) => request.userId === userId))
    return "Changes requested";
  if (version.status === "DRAFT") return "Not sent for review";
  if (version.status === "SUPERSEDED") return "Replaced by newer terms";
  return "Awaiting review";
}
/** Organizers see readiness only ("Ready to be paid" / "Needs a payout email"), never an address. */
export { payoutReadinessLabel } from "../components/payout-email-step";

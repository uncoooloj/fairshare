import type { Agreement, Version } from "./model";
export const discussionTopics = {
  AGREEMENT: "Agreement overall",
  SPLIT: "Revenue split",
  FEES: "Fees",
  ADVANCE: "Advance and recoupment",
  SOURCE: "Source interpretation",
} as const;
export type Topic = keyof typeof discussionTopics;
export interface ReviewComment {
  id: string;
  versionId: number;
  ruleKey: Topic;
  parentId: string | null;
  authorId: string;
  body: string;
  createdAt: number;
}
export function commentPayload(
  body: string,
  ruleKey: Topic,
  parent?: ReviewComment,
) {
  const text = body.trim();
  if (!text || text.length > 2000)
    throw new Error("Write a comment between 1 and 2,000 characters.");
  if (parent?.parentId)
    throw new Error("Reply to the original comment instead.");
  return {
    body: text,
    ruleKey: parent?.ruleKey ?? ruleKey,
    ...(parent ? { parentId: parent.id } : {}),
  };
}
export function canRemind(
  agreement: Agreement,
  version: Version,
  userId: string,
  recipientId: string,
) {
  return (
    agreement.value.members.some(
      (m) => m.userId === userId && m.role === "ORGANIZER",
    ) &&
    agreement.value.versions.at(-1)?.id === version.id &&
    version.status === "AWAITING_APPROVAL" &&
    recipientId !== userId &&
    agreement.value.members.some((m) => m.userId === recipientId) &&
    !Object.hasOwn(version.approvals, recipientId)
  );
}
export function reminderNotice(result: { status: string; repeated?: boolean }) {
  const prefix = result.repeated
    ? "A reminder was already attempted in the last 24 hours. No additional email was sent. "
    : "";
  switch (result.status) {
    case "PROVIDER_ACCEPTED":
      return (
        prefix +
        "The email provider accepted the reminder. Inbox delivery is not confirmed."
      );
    case "SENDING":
      return (
        prefix + "The reminder request is still processing. Do not resend."
      );
    default:
      return (
        prefix +
        "Delivery is unconfirmed. Do not resend; another attempt is blocked for 24 hours to avoid duplicates."
      );
  }
}

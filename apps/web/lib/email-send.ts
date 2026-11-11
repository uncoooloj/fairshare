import { ApiError, api } from "./model";

export interface EmailReceipt {
  status: "PROVIDER_ACCEPTED" | "SENDING" | "UNCONFIRMED";
  repeated?: boolean;
  notice?: string;
}

export function emailReceiptNotice(receipt: EmailReceipt) {
  const repeated = receipt.repeated ? "No additional email was sent. " : "";
  if (receipt.status === "PROVIDER_ACCEPTED")
    return (
      repeated +
      "The email provider accepted the message. Inbox delivery is not confirmed."
    );
  if (receipt.status === "SENDING")
    return repeated + "The email request is in progress. Do not resend.";
  return (
    repeated +
    "Email delivery is unconfirmed. Do not resend; share the link directly instead."
  );
}

/** Only read the existing bearer link. Never create or replace an invitation here. */
export function invitationEmailToken(link: string) {
  try {
    const token = new URLSearchParams(new URL(link).hash.slice(1)).get("token");
    return token?.startsWith("agreement:") &&
      /^[A-Za-z0-9_-]{43}$/.test(token.slice(10))
      ? token.slice(10)
      : undefined;
  } catch {
    return undefined;
  }
}

/** These server errors are raised before a provider send is reserved or attempted. */
export function emailRejectedBeforeSend(error: unknown) {
  return (
    error instanceof ApiError &&
    [
      "EMAIL_UNVERIFIED",
      "EMAIL_VERIFICATION_REQUIRED",
      "EMAIL_NOT_VERIFIED",
      "NOTIFICATIONS_DISABLED",
      "EMAIL_UNAVAILABLE",
      "INVALID_INVITATION",
      "INVITATION_EMAIL_MISMATCH",
      "NOT_PENDING",
      "NOT_IN_REVIEW",
      "INVALID_RECIPIENT",
      "RECIPIENT_UNVERIFIED",
      "FORBIDDEN",
      "UNAUTHORIZED",
      "VALIDATION_ERROR",
      "RATE_LIMITED",
    ].includes(error.code ?? "")
  );
}

/** One component lifetime only: no prior user's outcomes survive logout/remount.
 * The backend owns durable idempotency across navigation and sessions. */
export function createEmailSender() {
  const attempts = new Map<string, Promise<EmailReceipt>>();
  return (path: string, payload: object) => {
    const key = `${path}:${"recipientId" in payload ? payload.recipientId : ""}`;
    const existing = attempts.get(key);
    if (existing) return existing;
    const request = api<EmailReceipt>(path, "POST", payload).catch(
      (error: unknown) => {
        if (emailRejectedBeforeSend(error)) attempts.delete(key);
        throw error;
      },
    );
    attempts.set(key, request);
    return request;
  };
}

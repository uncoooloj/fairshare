/** Server-only email adapters. No transport is selected implicitly. */
export enum MailKind {
  CHANGE_EMAIL = "CHANGE_EMAIL",
  RESET_PASSWORD = "RESET_PASSWORD",
  VERIFY_EMAIL = "VERIFY_EMAIL",
  WORKSPACE_INVITATION = "WORKSPACE_INVITATION",
  AGREEMENT_INVITATION = "AGREEMENT_INVITATION",
  AGREEMENT_REVIEW = "AGREEMENT_REVIEW",
}
export interface MailMessage {
  kind: MailKind;
  to: string;
  link: string;
  expiresAt: number;
  workspaceName?: string;
  agreementName?: string;
  inviterName?: string;
  operationId: string;
}
export interface MailTransport {
  send(message: MailMessage): Promise<{ providerId: string }>;
}
export function publicAppOrigin(value: string) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    throw new Error(
      "PUBLIC_APP_ORIGIN must be a trusted HTTPS origin (loopback HTTP allowed for development).",
    );
  return url.origin;
}
export function emailDeliveryOrigin(value: string | undefined) {
  if (!value)
    throw new Error("Enabled email requires explicit PUBLIC_APP_ORIGIN.");
  const origin = publicAppOrigin(value);
  if (!origin.startsWith("https://"))
    throw new Error(
      "Enabled email requires a trusted HTTPS PUBLIC_APP_ORIGIN.",
    );
  return origin;
}
export function emailLink(origin: string, kind: MailKind, token: string) {
  return `${publicAppOrigin(origin)}/${kind === MailKind.CHANGE_EMAIL ? "change-email" : kind === MailKind.RESET_PASSWORD ? "reset-password" : kind === MailKind.VERIFY_EMAIL ? "verify-email" : "invitation"}#token=${encodeURIComponent(token)}`;
}
function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function renderMessage(message: MailMessage) {
  const subject =
    message.kind === MailKind.AGREEMENT_INVITATION
      ? `${message.inviterName || "Someone"} invited you to ${message.agreementName || "an agreement"} on Fairshare`
          .replace(/[\r\n]/g, " ")
          .slice(0, 180)
      : message.kind === MailKind.CHANGE_EMAIL
        ? "Confirm your new Fairshare email"
        : message.kind === MailKind.RESET_PASSWORD
          ? "Reset your Fairshare password"
          : message.kind === MailKind.AGREEMENT_REVIEW
            ? "Review your Fairshare agreement"
            : message.kind === MailKind.VERIFY_EMAIL
              ? "Verify your Fairshare email"
              : "Your Fairshare workspace invitation";
  const text =
    message.kind === MailKind.AGREEMENT_INVITATION
      ? `${message.inviterName || "An organizer"} invited you to ${message.agreementName || "an agreement"}. Review the agreement in Fairshare using this single-use link:\n\n${message.link}\n\nSign in with ${message.to}. This link expires at ${new Date(message.expiresAt).toISOString()}. Joining does not approve the agreement or move money. If you were not expecting this invitation, you can ignore it.`
      : message.kind === MailKind.CHANGE_EMAIL
        ? `Confirm this as your new Fairshare email using this single-use link while signed in to the account that requested the change:\n\n${message.link}\n\nExpires at ${new Date(message.expiresAt).toISOString()}. Your current email stays active until confirmation, which signs out all sessions. If you did not request this, ignore it.`
        : message.kind === MailKind.RESET_PASSWORD
          ? `Reset your Fairshare password using this single-use link:\n\n${message.link}\n\nExpires at ${new Date(message.expiresAt).toISOString()}. Resetting signs out every session. If you did not request this, ignore it; your password has not changed.`
          : message.kind === MailKind.AGREEMENT_REVIEW
            ? `An agreement organizer has asked you to review pending terms in Fairshare. Sign in, open Agreements, and review the version awaiting your approval.\n\n${message.link}\n\nThis reminder does not approve an agreement or move money. If you have already reviewed it, no further action is needed.`
            : message.kind === MailKind.VERIFY_EMAIL
              ? `Verify your email to join Fairshare workspaces. Open this link while signed in to the same email:\n\n${message.link}\n\nThis link expires at ${new Date(message.expiresAt).toISOString()}. If you did not request this, ignore it.`
              : `You were invited to a Fairshare workspace${message.workspaceName ? ` (${message.workspaceName})` : ""}. Sign in with ${message.to}, verify your email, then review and accept this invitation:\n\n${message.link}\n\nExpires at ${new Date(message.expiresAt).toISOString()}. This invitation does not approve an agreement or move money.`;
  const label =
    message.kind === MailKind.RESET_PASSWORD
      ? "Reset password"
      : message.kind === MailKind.VERIFY_EMAIL
        ? "Verify email"
        : message.kind === MailKind.CHANGE_EMAIL
          ? "Confirm email"
          : "Review in Fairshare";
  const paragraphs = text
    .split("\n\n")
    .filter((part) => part !== message.link)
    .map(
      (part) =>
        `<p style="margin:0 0 20px;color:#444;line-height:1.6">${escapeHtml(part)}</p>`,
    )
    .join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f5f6fa;font-family:Arial,sans-serif;color:#171717"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:white;border:1px solid #e5e5e5;border-radius:16px"><tr><td style="padding:32px"><p style="color:#2148da;font-weight:700;margin:0 0 24px">Fairshare</p><h1 style="font-size:24px;line-height:1.3;margin:0 0 24px">${escapeHtml(subject)}</h1>${paragraphs}<p style="margin:28px 0"><a href="${escapeHtml(message.link)}" style="display:inline-block;background:#2148da;color:white;text-decoration:none;border-radius:8px;padding:16px 24px;font-weight:700">${label}</a></p><p style="font-size:12px;line-height:1.6;color:#666">If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(message.link)}" style="color:#2148da;word-break:break-all">${escapeHtml(message.link)}</a></p></td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}
async function parseProviderResponse(response: Response) {
  if (!response.ok) throw new Error("EMAIL_PROVIDER_REJECTED");
  let body: { id?: unknown };
  try {
    body = (await response.json()) as { id?: unknown };
  } catch {
    throw new Error("EMAIL_PROVIDER_RESPONSE_INVALID");
  }
  if (!body || typeof body.id !== "string" || !body.id)
    throw new Error("EMAIL_PROVIDER_RESPONSE_INVALID");
  return { providerId: body.id };
}
export function createResendTransport(options: {
  apiKey: string;
  from: string;
  fetch?: typeof fetch;
  appOrigin?: string;
}): MailTransport {
  const mailbox = /^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/;
  const sender =
    options.from.match(/^[^<>\r\n]+<([^<>]+)>$/)?.[1] ?? options.from;
  if (
    !options.apiKey.trim() ||
    /\s/.test(options.apiKey) ||
    !mailbox.test(sender) ||
    /[\r\n]/.test(options.from)
  )
    throw new Error("Email sender and API key required.");
  const request = options.fetch ?? fetch;
  return {
    async send(message) {
      let link: URL;
      try {
        link = new URL(message.link);
      } catch {
        throw new Error("EMAIL_MESSAGE_INVALID");
      }
      if (
        !mailbox.test(message.to) ||
        link.protocol !== "https:" ||
        link.username ||
        link.password ||
        (options.appOrigin && link.origin !== options.appOrigin) ||
        !/^[\x21-\x7e]{1,256}$/.test(message.operationId)
      )
        throw new Error("EMAIL_MESSAGE_INVALID");
      const { subject, text, html } = renderMessage(message);
      // Do not include credentials, message bodies or provider response bodies in errors/logs.
      let response: Response;
      try {
        response = await request("https://api.resend.com/emails", {
          method: "POST",
          redirect: "manual",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": message.operationId,
          },
          body: JSON.stringify({
            from: options.from,
            to: [message.to],
            subject,
            text,
            html,
          }),
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        throw new Error("EMAIL_PROVIDER_UNCONFIRMED");
      }
      return parseProviderResponse(response);
    },
  };
}
export interface MailEnvironment {
  EMAIL_DELIVERY_ENABLED?: string;
  EMAIL_PROVIDER?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  PUBLIC_APP_ORIGIN?: string;
  DEMO_MODE?: string;
}
export function configuredMailTransport(
  env: MailEnvironment = process.env,
): MailTransport | undefined {
  if (env.DEMO_MODE === "true" || env.EMAIL_DELIVERY_ENABLED !== "true")
    return undefined;
  const origin = emailDeliveryOrigin(env.PUBLIC_APP_ORIGIN);
  if (env.EMAIL_PROVIDER !== "resend")
    throw new Error("Enabled email requires EMAIL_PROVIDER=resend.");
  return createResendTransport({
    apiKey: env.RESEND_API_KEY ?? "",
    from: env.EMAIL_FROM ?? "",
    appOrigin: origin,
  });
}

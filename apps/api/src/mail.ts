/** Server-only email adapters. No transport is selected implicitly. */
export enum MailKind {
  RESET_PASSWORD = "RESET_PASSWORD",
  VERIFY_EMAIL = "VERIFY_EMAIL",
  WORKSPACE_INVITATION = "WORKSPACE_INVITATION",
  AGREEMENT_REVIEW = "AGREEMENT_REVIEW",
}
export interface MailMessage {
  kind: MailKind;
  to: string;
  link: string;
  expiresAt: number;
  workspaceName?: string;
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
  return `${publicAppOrigin(origin)}/${kind === MailKind.RESET_PASSWORD ? "reset-password" : kind === MailKind.VERIFY_EMAIL ? "verify-email" : "invitation"}#token=${encodeURIComponent(token)}`;
}
function renderMessage(message: MailMessage) {
  const subject =
    message.kind === MailKind.RESET_PASSWORD
      ? "Reset your Fairshare password"
      : message.kind === MailKind.AGREEMENT_REVIEW
        ? "Review your Fairshare agreement"
        : message.kind === MailKind.VERIFY_EMAIL
          ? "Verify your Fairshare email"
          : "Your Fairshare workspace invitation";
  const text =
    message.kind === MailKind.RESET_PASSWORD
      ? `Reset your Fairshare password using this single-use link:\n\n${message.link}\n\nExpires at ${new Date(message.expiresAt).toISOString()}. Resetting signs out every session. If you did not request this, ignore it; your password has not changed.`
      : message.kind === MailKind.AGREEMENT_REVIEW
        ? `An agreement organizer has asked you to review pending terms in Fairshare. Sign in, open Agreements, and review the version awaiting your approval.\n\n${message.link}\n\nThis reminder does not approve an agreement or move money. If you have already reviewed it, no further action is needed.`
        : message.kind === MailKind.VERIFY_EMAIL
          ? `Verify your email to join Fairshare workspaces. Open this link while signed in to the same email:\n\n${message.link}\n\nThis link expires at ${new Date(message.expiresAt).toISOString()}. If you did not request this, ignore it.`
          : `You were invited to a Fairshare workspace${message.workspaceName ? ` (${message.workspaceName})` : ""}. Sign in with ${message.to}, verify your email, then review and accept this invitation:\n\n${message.link}\n\nExpires at ${new Date(message.expiresAt).toISOString()}. This invitation does not approve an agreement or move money.`;
  return { subject, text };
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
}): MailTransport {
  if (!options.apiKey || !options.from || /[\r\n]/.test(options.from))
    throw new Error("Email sender and API key required.");
  const request = options.fetch ?? fetch;
  return {
    async send(message) {
      const { subject, text } = renderMessage(message);
      // Do not include credentials, message bodies or provider response bodies in errors/logs.
      let response: Response;
      try {
        response = await request("https://api.resend.com/emails", {
          method: "POST",
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
export function configuredMailTransport(
  env: NodeJS.ProcessEnv = process.env,
): MailTransport | undefined {
  if (env.EMAIL_DELIVERY_ENABLED !== "true") return undefined;
  emailDeliveryOrigin(env.PUBLIC_APP_ORIGIN);
  if (env.EMAIL_PROVIDER !== "resend")
    throw new Error("Enabled email requires EMAIL_PROVIDER=resend.");
  return createResendTransport({
    apiKey: env.RESEND_API_KEY ?? "",
    from: env.EMAIL_FROM ?? "",
  });
}

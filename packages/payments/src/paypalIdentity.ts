import { PayPalError, normalizePayoutEmail } from "./paypal.js";

/** "Log in with PayPal" (PayPal Identity), SANDBOX only. Used to confirm where a
 * collaborator is paid, never to sign in to Fairshare.
 * https://developer.paypal.com/log-in/build/ */
const AUTHORIZE = "https://www.sandbox.paypal.com/connect";
const API = "https://api-m.sandbox.paypal.com";
/** `paypalattributes` returns account verification status and the payer ID
 * ("used in PayPal APIs such as the Payouts API").
 * https://developer.paypal.com/log-in/references#scope-attributes */
export const PAYPAL_IDENTITY_SCOPES =
  "openid email https://uri.paypal.com/services/paypalattributes";
const PAYER_ID = /^[A-Z0-9]{8,20}$/;

export type PayPalIdentityConfig = {
  clientId: string;
  clientSecret: string;
  returnUrl: string;
};
/** What Fairshare keeps from userinfo. Nothing else is read or stored. */
export type PayPalIdentityProfile = {
  email: string | null;
  emailVerified: boolean;
  payerId: string | null;
};
/** The two calls the connect flow needs; tests replace it with a fake. */
export interface PayPalIdentityProvider {
  authorizeUrl(state: string): string;
  exchange(code: string): Promise<PayPalIdentityProfile>;
}

/**
 * Maps userinfo defensively. The OpenID sample returns `email`/`email_verified`;
 * the older paypalv1.1 shape returns `emails[]` with `confirmed`. The payer ID key
 * is not shown in PayPal's sample, so it is optional and only kept when well formed.
 * https://developer.paypal.com/api/identity/v1/userinfo-get
 */
export function mapPayPalUserInfo(body: unknown): PayPalIdentityProfile {
  const info = (body && typeof body === "object" ? body : {}) as Record<
    string,
    any
  >;
  let email = normalizePayoutEmail(info.email);
  let emailVerified = !!email && info.email_verified === true;
  if (!email && Array.isArray(info.emails)) {
    const entry =
      info.emails.find((e: any) => e?.primary === true) ?? info.emails[0];
    email = normalizePayoutEmail(entry?.value);
    emailVerified = !!email && entry?.confirmed === true;
  }
  const payerId =
    typeof info.payer_id === "string" && PAYER_ID.test(info.payer_id)
      ? info.payer_id
      : null;
  return { email, emailVerified, payerId };
}

export class PayPalIdentitySandbox implements PayPalIdentityProvider {
  constructor(
    private config: PayPalIdentityConfig,
    private fetcher: typeof fetch = (...args) => fetch(...args),
  ) {
    if (!config.clientId || !config.clientSecret || !config.returnUrl)
      throw new PayPalError("PAYPAL_IDENTITY_NOT_CONFIGURED", 503);
  }
  authorizeUrl(state: string) {
    const url = new URL(AUTHORIZE);
    url.search = new URLSearchParams({
      flowEntry: "static",
      client_id: this.config.clientId,
      response_type: "code",
      scope: PAYPAL_IDENTITY_SCOPES,
      redirect_uri: this.config.returnUrl,
      state,
    }).toString();
    return url.toString();
  }
  /** Server-side code exchange, then userinfo. The access token never leaves this method. */
  async exchange(code: string): Promise<PayPalIdentityProfile> {
    const token = await this.json(`${API}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
      }).toString(),
    });
    if (typeof token.access_token !== "string")
      throw new PayPalError("INVALID_PROVIDER_RESPONSE");
    return mapPayPalUserInfo(
      await this.json(`${API}/v1/identity/openidconnect/userinfo`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          "Content-Type": "application/json",
        },
      }),
    );
  }
  private async json(url: string, init: RequestInit) {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        ...init,
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new PayPalError("PAYPAL_UNAVAILABLE");
    }
    // Provider messages can carry account details; never pass them on.
    if (!response.ok) throw new PayPalError("PAYPAL_IDENTITY_REJECTED", 502);
    try {
      return (await response.json()) as Record<string, any>;
    } catch {
      throw new PayPalError("INVALID_PROVIDER_RESPONSE");
    }
  }
}

import {
  invoiceBody,
  invoiceId,
  parseInvoice,
  parseInvoiceSettlement,
  type CreateInvoice,
} from "./invoices.js";
/** PayPal SANDBOX adapter. Captured payments are not escrow or guaranteed prizes. */
export class PayPalError extends Error {
  constructor(
    public code: string,
    public status = 502,
  ) {
    super(code);
    this.name = "PayPalError";
  }
}
type Json = Record<string, any>;
export type PayPalConfig = {
  clientId: string;
  clientSecret: string;
  webhookId?: string;
  merchantId?: string;
  payoutsEnabled?: boolean;
  payoutsEligibilityConfirmed?: boolean;
};
export type CreateOrder = {
  amountCents: number;
  currency: string;
  reference: string;
  returnUrl: string;
  cancelUrl: string;
  requestId?: string;
};
const BASE = "https://api-m.sandbox.paypal.com";
/** Payouts `recipient_type`. EMAIL is the default for new destinations; PAYPAL_ID is
 * kept for destinations saved before email payouts. Add a verified payer type here
 * when "Connect with PayPal" lands. */
export enum RecipientType {
  EMAIL = "EMAIL",
  PAYPAL_ID = "PAYPAL_ID",
}
// PayPal caps EMAIL receivers at 127 characters. Shape check only: PayPal is the authority.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// PayPal documents no fixed length for encrypted account IDs; accept legacy uppercase IDs.
const PAYPAL_ID_PATTERN = /^[A-Z0-9]{8,20}$/;
/** Trimmed, lowercased payout email, or null when it is not a plausible address. */
export function normalizePayoutEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 127 && EMAIL_PATTERN.test(email) ? email : null;
}
export function isValidRecipient(type: unknown, receiver: unknown): boolean {
  if (typeof receiver !== "string") return false;
  if (type === RecipientType.EMAIL)
    return normalizePayoutEmail(receiver) === receiver;
  if (type === RecipientType.PAYPAL_ID) return PAYPAL_ID_PATTERN.test(receiver);
  return false;
}
function cents(value: unknown): number {
  if (typeof value !== "string" || !/^\d+\.\d{2}$/.test(value))
    throw new PayPalError("INVALID_PROVIDER_AMOUNT");
  const n = Number(value.replace(".", ""));
  if (!Number.isSafeInteger(n))
    throw new PayPalError("INVALID_PROVIDER_AMOUNT");
  return n;
}
function money(amount: number, currency: string) {
  if (!Number.isSafeInteger(amount) || amount <= 0)
    throw new PayPalError("INVALID_AMOUNT", 400);
  // Fairshare's initial contract is USD-only. Never silently apply 2-digit rounding to JPY etc.
  if (currency !== "USD") throw new PayPalError("UNSUPPORTED_CURRENCY", 400);
  return {
    currency_code: currency,
    value: `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, "0")}`,
  };
}
function requestKey(value: string) {
  if (!value || value.length > 108 || !/^[\w.:-]+$/.test(value))
    throw new PayPalError("INVALID_REQUEST_ID", 400);
  return value;
}
function callbackUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:")
    throw new PayPalError("HTTPS_CALLBACK_REQUIRED", 400);
  return url.toString();
}
export class PayPalSandbox {
  private token?: { value: string; expiresAt: number };
  private tokenPromise?: Promise<string>;
  constructor(
    private config: PayPalConfig,
    private fetcher: typeof fetch = (...args) => fetch(...args),
  ) {
    if (!config.clientId || !config.clientSecret)
      throw new PayPalError("PAYPAL_NOT_CONFIGURED", 503);
  }
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now())
      return this.token.value;
    if (this.tokenPromise) return this.tokenPromise;
    this.tokenPromise = (async () => {
      let response: Response;
      try {
        response = await this.fetcher(`${BASE}/v1/oauth2/token`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "grant_type=client_credentials",
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        throw new PayPalError("PAYPAL_UNAVAILABLE");
      }
      if (!response.ok) throw new PayPalError("PAYPAL_AUTH_FAILED", 503);
      const body = (await response.json()) as Json;
      if (
        typeof body.access_token !== "string" ||
        !Number.isFinite(body.expires_in)
      )
        throw new PayPalError("INVALID_PROVIDER_RESPONSE");
      this.token = {
        value: body.access_token,
        expiresAt: Date.now() + Math.max(0, body.expires_in - 60) * 1000,
      };
      return body.access_token as string;
    })();
    try {
      return await this.tokenPromise;
    } finally {
      this.tokenPromise = undefined;
    }
  }
  /** Token-only sandbox preflight: no payment operation and no token disclosure. */
  async checkCredentials(): Promise<{
    mode: "PAYPAL_SANDBOX";
    authenticated: true;
  }> {
    await this.accessToken();
    return { mode: "PAYPAL_SANDBOX", authenticated: true };
  }
  private async call(
    path: string,
    body: Json | undefined,
    key?: string,
  ): Promise<Json> {
    const token = await this.accessToken();
    let response: Response;
    try {
      response = await this.fetcher(`${BASE}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
          ...(key ? { "PayPal-Request-Id": requestKey(key) } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new PayPalError("PAYPAL_OUTCOME_UNKNOWN");
    }
    // APIMatic authentication guidance: invalidate a rejected cached token, but
    // never automatically replay a payment write. The next explicit call reauthenticates.
    if (response.status === 401) this.token = undefined;
    // Do not expose provider messages, payer details, or credentials to clients.
    if (!response.ok)
      throw new PayPalError(
        response.status >= 500
          ? "PAYPAL_OUTCOME_UNKNOWN"
          : "PAYPAL_REQUEST_REJECTED",
        response.status >= 500 ? 502 : 422,
      );
    try {
      return (await response.json()) as Json;
    } catch {
      throw new PayPalError("PAYPAL_OUTCOME_UNKNOWN");
    }
  }
  async createInvoice(input: CreateInvoice) {
    const body = invoiceBody(input);
    requestKey(input.requestId);
    const result = await this.call(
      "/v2/invoicing/invoices",
      body,
      input.requestId,
    );
    // Some PayPal deployments return only a self link even with return=representation.
    if (result.id) return this.getInvoice(invoiceId(result.id));
    const href =
      result.href ??
      result.links?.find((link: Json) => link.rel === "self")?.href;
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      throw new PayPalError("PAYPAL_OUTCOME_UNKNOWN");
    }
    if (
      url.origin !== BASE ||
      !/^\/v2\/invoicing\/invoices\/INV2-[A-Z0-9-]+$/.test(url.pathname)
    )
      throw new PayPalError("PAYPAL_OUTCOME_UNKNOWN");
    return this.getInvoice(invoiceId(url.pathname.split("/").at(-1)!));
  }
  async getInvoice(id: string) {
    invoiceId(id);
    return parseInvoice(
      await this.call(`/v2/invoicing/invoices/${id}`, undefined),
      id,
    );
  }
  /** Read-only invoice settlement verification; never captures or moves money. */
  async getInvoiceSettlement(id: string, transactionId: string) {
    invoiceId(id);
    if (!/^[A-Za-z0-9]{1,22}$/.test(transactionId))
      throw new PayPalError("INVALID_TRANSACTION_ID", 400);
    if (!this.config.merchantId)
      throw new PayPalError("MERCHANT_VERIFICATION_REQUIRED");
    return parseInvoiceSettlement(
      await this.call(`/v2/payments/captures/${transactionId}`, undefined),
      id,
      transactionId,
      this.config.merchantId,
    );
  }
  /** Publishes a payable link without notifying customer or merchant by email. */
  async publishInvoice(id: string, requestId: string) {
    invoiceId(id);
    await this.call(
      `/v2/invoicing/invoices/${id}/send`,
      {
        send_to_recipient: false,
        send_to_invoicer: false,
      },
      requestKey(requestId),
    );
    return this.getInvoice(id);
  }
  async createOrder(input: CreateOrder) {
    if (!input.reference || input.reference.length > 127)
      throw new PayPalError("INVALID_REFERENCE", 400);
    const result = await this.call(
      "/v2/checkout/orders",
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: input.reference,
            custom_id: input.reference,
            amount: money(input.amountCents, input.currency),
            ...(this.config.merchantId
              ? { payee: { merchant_id: this.config.merchantId } }
              : {}),
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              return_url: callbackUrl(input.returnUrl),
              cancel_url: callbackUrl(input.cancelUrl),
              user_action: "PAY_NOW",
              shipping_preference: "NO_SHIPPING",
            },
          },
        },
      },
      input.requestId ?? input.reference,
    );
    const approval = result.links?.find((link: Json) =>
      ["payer-action", "approve"].includes(link.rel),
    );
    if (typeof result.id !== "string" || typeof approval?.href !== "string")
      throw new PayPalError("INVALID_PROVIDER_RESPONSE");
    const url = new URL(approval.href);
    if (
      url.protocol !== "https:" ||
      !(
        url.hostname === "sandbox.paypal.com" ||
        url.hostname.endsWith(".sandbox.paypal.com")
      )
    )
      throw new PayPalError("INVALID_APPROVAL_URL");
    return { id: result.id as string, approvalUrl: url.toString() };
  }
  async captureOrder(orderId: string, requestId = `capture-${orderId}`) {
    const result = await this.call(
      `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
      {},
      requestId,
    );
    return this.parseCapture(orderId, result);
  }
  private parseCapture(orderId: string, result: Json) {
    if (result.id !== orderId || result.purchase_units?.length !== 1)
      throw new PayPalError("CAPTURE_MISMATCH");
    const unit = result.purchase_units[0];
    if (
      this.config.merchantId &&
      unit.payee?.merchant_id !== this.config.merchantId
    )
      throw new PayPalError("CAPTURE_MERCHANT_MISMATCH");
    if (unit.payments?.captures?.length !== 1)
      throw new PayPalError("CAPTURE_MISMATCH");
    const capture = unit.payments.captures[0];
    if (!capture.id || !capture.status || !capture.amount?.currency_code)
      throw new PayPalError("INVALID_PROVIDER_RESPONSE");
    const breakdown = capture.seller_receivable_breakdown;
    let accounting: { feeCents: number; netCents: number } | undefined;
    if (breakdown) {
      const currency = capture.amount.currency_code;
      if (
        breakdown.gross_amount?.currency_code !== currency ||
        breakdown.paypal_fee?.currency_code !== currency ||
        breakdown.net_amount?.currency_code !== currency
      )
        throw new PayPalError("CAPTURE_ACCOUNTING_MISMATCH");
      const gross = cents(breakdown.gross_amount.value),
        fee = cents(breakdown.paypal_fee.value),
        net = cents(breakdown.net_amount.value);
      if (gross !== cents(capture.amount.value) || net + fee !== gross)
        throw new PayPalError("CAPTURE_ACCOUNTING_MISMATCH");
      accounting = { feeCents: fee, netCents: net };
    }
    return {
      id: capture.id as string,
      status: capture.status as string,
      amountCents: cents(capture.amount.value),
      currency: capture.amount.currency_code as string,
      reference: (unit.custom_id ??
        capture.custom_id ??
        unit.reference_id) as string,
      orderId,
      ...(accounting ? { accounting } : {}),
    };
  }
  /** Read-only recovery: never issues a second capture after an uncertain response. */
  async getOrder(orderId: string) {
    const result = await this.call(
      `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
      undefined,
    );
    if (
      result.id !== orderId ||
      ![
        "CREATED",
        "SAVED",
        "APPROVED",
        "PAYER_ACTION_REQUIRED",
        "COMPLETED",
        "VOIDED",
      ].includes(result.status)
    )
      throw new PayPalError("INVALID_PROVIDER_RESPONSE");
    const captures =
      result.purchase_units?.flatMap(
        (unit: Json) => unit.payments?.captures ?? [],
      ) ?? [];
    return {
      status: result.status as string,
      capture: captures.length ? this.parseCapture(orderId, result) : null,
    };
  }
  /** PayPal's seller_payable_breakdown: what the refund cost the merchant. paypal_fee is the
   * part of the original fee PayPal gave back; absent breakdown means nothing is known returned. */
  private refundAccounting(result: Json, amountCents: number) {
    const breakdown = result.seller_payable_breakdown;
    if (!breakdown) return undefined;
    const currency = result.amount?.currency_code;
    if (
      breakdown.gross_amount?.currency_code !== currency ||
      (breakdown.paypal_fee &&
        breakdown.paypal_fee.currency_code !== currency) ||
      breakdown.net_amount?.currency_code !== currency
    )
      throw new PayPalError("REFUND_ACCOUNTING_MISMATCH");
    const gross = cents(breakdown.gross_amount.value),
      fee = breakdown.paypal_fee ? cents(breakdown.paypal_fee.value) : 0,
      net = cents(breakdown.net_amount.value);
    if (gross !== amountCents || net + fee !== gross)
      throw new PayPalError("REFUND_ACCOUNTING_MISMATCH");
    return { grossCents: gross, feeReturnedCents: fee, netCents: net };
  }
  async refundCapture(
    captureId: string,
    amountCents: number,
    currency: string,
    requestId: string,
  ) {
    requestKey(requestId);
    const result = await this.call(
      `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
      { amount: money(amountCents, currency), invoice_id: requestId },
      requestId,
    );
    if (
      !result.id ||
      !result.status ||
      cents(result.amount?.value) !== amountCents ||
      result.amount?.currency_code !== currency
    )
      throw new PayPalError("REFUND_MISMATCH");
    const accounting = this.refundAccounting(result, amountCents);
    return {
      id: result.id as string,
      status: result.status as string,
      amountCents,
      currency,
      ...(accounting ? { accounting } : {}),
    };
  }
  async getRefund(refundId: string) {
    const result = await this.call(
      `/v2/payments/refunds/${encodeURIComponent(refundId)}`,
      undefined,
    );
    if (
      result.id !== refundId ||
      !["COMPLETED", "PENDING", "FAILED", "CANCELLED"].includes(
        result.status,
      ) ||
      result.amount?.currency_code !== "USD"
    )
      throw new PayPalError("REFUND_MISMATCH");
    let captureId: string | undefined;
    const parent = result.links?.find((link: Json) => link.rel === "up")?.href;
    if (typeof parent === "string") {
      const url = new URL(parent);
      if (
        [BASE, "https://api.sandbox.paypal.com"].includes(url.origin) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        /^\/v2\/payments\/captures\/[A-Za-z0-9_-]+$/.test(url.pathname)
      )
        captureId = url.pathname.split("/").at(-1);
    }
    const amountCents = cents(result.amount.value);
    const accounting = this.refundAccounting(result, amountCents);
    return {
      id: result.id as string,
      status: result.status as string,
      amountCents,
      currency: result.amount.currency_code as string,
      ...(accounting ? { accounting } : {}),
      captureId,
      reference:
        typeof result.invoice_id === "string" ? result.invoice_id : undefined,
    };
  }
  /** One recipient per persisted operation. Capability is OFF unless explicitly gated. */
  async createPayout(input: {
    requestId: string;
    recipientType: RecipientType;
    recipientId: string;
    amountCents: number;
    currency: string;
  }) {
    this.requirePayouts();
    const key = requestKey(input.requestId);
    if (
      key.length > 30 ||
      !isValidRecipient(input.recipientType, input.recipientId)
    )
      throw new PayPalError("INVALID_PAYOUT_ID", 400);
    const result = await this.call(
      "/v1/payments/payouts",
      {
        sender_batch_header: { sender_batch_id: key },
        items: [
          {
            recipient_type: input.recipientType,
            receiver: input.recipientId,
            amount: {
              currency: input.currency,
              value: money(input.amountCents, input.currency).value,
            },
            sender_item_id: key,
          },
        ],
      },
      key,
    );
    const header = result.batch_header;
    if (
      typeof header?.payout_batch_id !== "string" ||
      !header.payout_batch_id ||
      header.sender_batch_header?.sender_batch_id !== key
    )
      throw new PayPalError("PAYPAL_OUTCOME_UNKNOWN");
    // Acceptance is NOT payment completion. Only a matched item read can settle it.
    return {
      batchId: header.payout_batch_id as string,
      status: "PENDING" as const,
    };
  }
  async getPayout(
    batchId: string,
    expected: {
      requestId: string;
      recipientType: RecipientType;
      recipientId: string;
      amountCents: number;
      currency: string;
    },
  ) {
    this.requirePayouts();
    const result = await this.call(
      `/v1/payments/payouts/${encodeURIComponent(batchId)}?page_size=1000`,
      undefined,
    );
    const header = result.batch_header;
    if (
      header?.payout_batch_id !== batchId ||
      header.sender_batch_header?.sender_batch_id !== expected.requestId ||
      result.items?.length !== 1 ||
      (result.total_items !== undefined && result.total_items !== 1)
    )
      throw new PayPalError("PAYOUT_MISMATCH");
    const item = result.items[0];
    const payout = item.payout_item;
    if (
      typeof item.payout_item_id !== "string" ||
      payout?.sender_item_id !== expected.requestId ||
      payout?.recipient_type !== expected.recipientType ||
      typeof payout?.receiver !== "string" ||
      (expected.recipientType === RecipientType.EMAIL
        ? payout.receiver.toLowerCase() !== expected.recipientId.toLowerCase()
        : payout.receiver !== expected.recipientId) ||
      payout?.amount?.currency !== expected.currency ||
      cents(payout?.amount?.value) !== expected.amountCents
    )
      throw new PayPalError("PAYOUT_MISMATCH");
    const status = item.transaction_status;
    if (
      ![
        "SUCCESS",
        "FAILED",
        "PENDING",
        "UNCLAIMED",
        "RETURNED",
        "ONHOLD",
        "BLOCKED",
        "REFUNDED",
        "REVERSED",
        "DENIED",
      ].includes(status)
    )
      throw new PayPalError("INVALID_PROVIDER_RESPONSE");
    return {
      batchId,
      itemId: item.payout_item_id as string,
      status: status as string,
    };
  }
  /** True when webhook signatures can be verified. Exposes no configuration value. */
  get webhookConfigured(): boolean {
    return Boolean(this.config.webhookId);
  }
  /** True when this adapter is permitted to submit sandbox payouts. Exposes no configuration values. */
  get payoutsReady(): boolean {
    return Boolean(
      this.config.payoutsEnabled && this.config.payoutsEligibilityConfirmed,
    );
  }
  private requirePayouts() {
    if (!this.payoutsReady) throw new PayPalError("PAYOUT_NOT_CONFIGURED", 503);
  }
  async verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    event: unknown,
  ): Promise<boolean> {
    if (!this.config.webhookId)
      throw new PayPalError("PAYPAL_WEBHOOK_NOT_CONFIGURED", 503);
    const normalized = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
    );
    const required = [
      "paypal-auth-algo",
      "paypal-cert-url",
      "paypal-transmission-id",
      "paypal-transmission-sig",
      "paypal-transmission-time",
    ];
    if (
      required.some(
        (key) => typeof normalized[key] !== "string" || !normalized[key],
      )
    )
      return false;
    if (
      !event ||
      typeof event !== "object" ||
      typeof (event as Json).id !== "string"
    )
      return false;
    const result = await this.call(
      "/v1/notifications/verify-webhook-signature",
      {
        auth_algo: normalized["paypal-auth-algo"],
        cert_url: normalized["paypal-cert-url"],
        transmission_id: normalized["paypal-transmission-id"],
        transmission_sig: normalized["paypal-transmission-sig"],
        transmission_time: normalized["paypal-transmission-time"],
        webhook_id: this.config.webhookId,
        webhook_event: event,
      },
    );
    return result.verification_status === "SUCCESS";
  }
}

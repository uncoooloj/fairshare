import { PayPalError } from "./paypal.js";

export type CreateInvoice = {
  customerEmail: string;
  customerName?: string;
  description: string;
  amountCents: number;
  currency: string;
  dueDate: string;
  reference: string;
  requestId: string;
};
export type ProviderInvoice = {
  id: string;
  status: string;
  reference: string;
  currency: string;
  amountCents: number;
  shareUrl: string | null;
  paidAmountCents?: number;
  dueAmountCents?: number;
  payments: {
    transactionId: string;
    type: string;
    amountCents: number;
    currency: string;
    status?: string;
    paidDate?: string;
  }[];
};
type Json = Record<string, any>;

export function invoiceId(value: string): string {
  if (!/^INV2-[A-Z0-9-]{8,40}$/.test(value))
    throw new PayPalError("INVALID_INVOICE_ID", 400);
  return value;
}
function exactCents(value: unknown): number {
  if (typeof value !== "string" || !/^\d+\.\d{2}$/.test(value))
    throw new PayPalError("INVALID_PROVIDER_AMOUNT");
  const amount = Number(value.replace(".", ""));
  if (!Number.isSafeInteger(amount))
    throw new PayPalError("INVALID_PROVIDER_AMOUNT");
  return amount;
}
export function invoiceBody(input: CreateInvoice): Json {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0)
    throw new PayPalError("INVALID_AMOUNT", 400);
  if (input.currency !== "USD")
    throw new PayPalError("UNSUPPORTED_CURRENCY", 400);
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.customerEmail) ||
    input.customerEmail.length > 254
  )
    throw new PayPalError("INVALID_CUSTOMER_EMAIL", 400);
  if (
    !input.description.trim() ||
    input.description.length > 1000 ||
    !input.reference ||
    input.reference.length > 120 ||
    (input.customerName?.length ?? 0) > 140
  )
    throw new PayPalError("INVALID_INVOICE_DETAILS", 400);
  const date = new Date(`${input.dueDate}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== input.dueDate ||
    input.dueDate < new Date().toISOString().slice(0, 10)
  )
    throw new PayPalError("INVALID_INVOICE_DUE_DATE", 400);
  return {
    detail: {
      currency_code: input.currency,
      reference: input.reference,
      // Never set a future issue date: PayPal would schedule an email despite suppression flags.
      payment_term: {
        term_type: "DUE_ON_DATE_SPECIFIED",
        due_date: input.dueDate,
      },
    },
    primary_recipients: [
      {
        billing_info: {
          email_address: input.customerEmail,
          ...(input.customerName?.trim()
            ? { name: { full_name: input.customerName.trim() } }
            : {}),
        },
      },
    ],
    items: [
      {
        name: input.description.trim().slice(0, 200),
        description: input.description.trim(),
        quantity: "1",
        unit_amount: {
          currency_code: input.currency,
          value: `${Math.floor(input.amountCents / 100)}.${String(input.amountCents % 100).padStart(2, "0")}`,
        },
      },
    ],
    configuration: {
      allow_tip: false,
      partial_payment: { allow_partial_payment: false },
    },
  };
}
/** Provider state is evidence, not authorization to allocate money. EXTERNAL/marked paid is never settlement. */
export function parseInvoice(
  result: Json,
  expectedId?: string,
): ProviderInvoice {
  const id = invoiceId(result.id ?? "");
  if (expectedId && id !== expectedId)
    throw new PayPalError("INVOICE_MISMATCH");
  const statuses = [
    "DRAFT",
    "SENT",
    "SCHEDULED",
    "PAID",
    "MARKED_AS_PAID",
    "CANCELLED",
    "REFUNDED",
    "PARTIALLY_PAID",
    "PARTIALLY_REFUNDED",
    "MARKED_AS_REFUNDED",
    "UNPAID",
    "PAYMENT_PENDING",
  ];
  const amount = result.amount?.total_amount ?? result.amount;
  if (
    !statuses.includes(result.status) ||
    amount?.currency_code !== "USD" ||
    typeof result.detail?.reference !== "string"
  )
    throw new PayPalError("INVALID_PROVIDER_RESPONSE");
  let shareUrl: string | null = null;
  const rawUrl = result.detail?.metadata?.recipient_view_url;
  if (rawUrl && result.status !== "DRAFT") {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new PayPalError("INVALID_INVOICE_LINK");
    }
    if (
      url.protocol !== "https:" ||
      !["www.sandbox.paypal.com", "sandbox.paypal.com"].includes(
        url.hostname,
      ) ||
      url.username ||
      url.password ||
      url.port
    )
      throw new PayPalError("INVALID_INVOICE_LINK");
    shareUrl = url.toString();
  }
  const transactions = result.payments?.transactions ?? [];
  if (!Array.isArray(transactions))
    throw new PayPalError("INVALID_PROVIDER_RESPONSE");
  return {
    id,
    status: result.status,
    reference: result.detail.reference,
    currency: "USD",
    amountCents: exactCents(amount.value),
    shareUrl,
    ...(result.payments?.paid_amount
      ? { paidAmountCents: invoiceMoney(result.payments.paid_amount) }
      : {}),
    ...(result.due_amount
      ? { dueAmountCents: invoiceMoney(result.due_amount) }
      : {}),
    payments: transactions.map((payment: Json) => {
      if (
        !["PAYPAL", "EXTERNAL"].includes(payment.type) ||
        payment.amount?.currency_code !== "USD" ||
        (payment.type === "PAYPAL" &&
          (typeof payment.payment_id !== "string" ||
            !/^[A-Za-z0-9]{1,22}$/.test(payment.payment_id)))
      )
        throw new PayPalError("INVALID_PROVIDER_RESPONSE");
      return {
        transactionId: payment.payment_id ?? "",
        type: payment.type,
        amountCents: exactCents(payment.amount.value),
        currency: "USD",
        ...(typeof payment.payment_date === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(payment.payment_date)
          ? { paidDate: payment.payment_date }
          : {}),
        ...(typeof payment.transaction_status === "string"
          ? { status: payment.transaction_status }
          : {}),
      };
    }),
  };
}

function invoiceMoney(amount: Json): number {
  if (amount.currency_code !== "USD")
    throw new PayPalError("INVALID_PROVIDER_AMOUNT");
  return exactCents(amount.value);
}

export type InvoiceSettlement = {
  id: string;
  invoiceId: string;
  status: string;
  currency: string;
  amountCents: number;
  accounting?: { feeCents: number; netCents: number };
};

/** A fresh merchant-authorized capture must explicitly identify this invoice.
 * Invoice payment_id is only a lookup candidate, never presumed settlement proof. */
export function parseInvoiceSettlement(
  result: Json,
  expectedInvoiceId: string,
  expectedTransactionId: string,
  merchantId: string,
): InvoiceSettlement {
  if (
    !merchantId ||
    result.id !== expectedTransactionId ||
    result.invoice_id !== expectedInvoiceId ||
    result.payee?.merchant_id !== merchantId ||
    result.amount?.currency_code !== "USD" ||
    ![
      "COMPLETED",
      "PENDING",
      "REFUNDED",
      "PARTIALLY_REFUNDED",
      "DECLINED",
      "FAILED",
      "DENIED",
    ].includes(result.status)
  )
    throw new PayPalError("INVOICE_SETTLEMENT_MISMATCH");
  const amountCents = invoiceMoney(result.amount);
  const breakdown = result.seller_receivable_breakdown;
  let accounting: InvoiceSettlement["accounting"];
  if (breakdown) {
    const gross = invoiceMoney(breakdown.gross_amount ?? {});
    const fee = invoiceMoney(breakdown.paypal_fee ?? {});
    const net = invoiceMoney(breakdown.net_amount ?? {});
    if (gross !== amountCents || fee + net !== gross)
      throw new PayPalError("CAPTURE_ACCOUNTING_MISMATCH");
    accounting = { feeCents: fee, netCents: net };
  }
  return {
    id: result.id,
    invoiceId: result.invoice_id,
    status: result.status,
    currency: "USD",
    amountCents,
    ...(accounting ? { accounting } : {}),
  };
}

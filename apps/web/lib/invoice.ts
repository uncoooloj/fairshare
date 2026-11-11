import { parseCents } from "./model";

export interface InvoiceDetails {
  customerName: string;
  customerEmail: string;
  description: string;
  amountCents: number;
  currency: "USD";
  dueDate: string;
}

export function validateInvoice(
  input: Omit<InvoiceDetails, "amountCents" | "currency"> & { amount: string },
  today = new Date().toISOString().slice(0, 10),
): InvoiceDetails {
  const customerName = input.customerName.trim();
  const customerEmail = input.customerEmail.trim();
  const description = input.description.trim();
  if (!customerName || customerName.length > 100)
    throw new Error("Enter a customer name of up to 100 characters.");
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail) ||
    customerEmail.length > 254
  )
    throw new Error("Enter a valid customer email address.");
  if (!description || description.length > 500)
    throw new Error(
      "Describe what this invoice is for in up to 500 characters.",
    );
  const amountCents = parseCents(input.amount);
  if (amountCents < 1 || amountCents > 1_000_000)
    throw new Error("Enter an amount from $0.01 to $10,000.00.");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) ||
    Number.isNaN(Date.parse(input.dueDate)) ||
    new Date(input.dueDate).toISOString().slice(0, 10) !== input.dueDate ||
    input.dueDate < today
  )
    throw new Error("Choose a valid due date today or later.");
  return {
    customerName,
    customerEmail,
    description,
    amountCents,
    currency: "USD",
    dueDate: input.dueDate,
  };
}

export function safeInvoiceUrl(
  value: string | null | undefined,
): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      ["www.sandbox.paypal.com", "sandbox.paypal.com"].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port
    );
  } catch {
    return false;
  }
}

export interface Invoice extends InvoiceDetails {
  id: string;
  status: string;
  shareUrl: string | null;
  providerStatus: string | null;
  paidAmountCents: number | null;
  dueAmountCents: number | null;
  settlementStatus: "UNVERIFIED" | "VERIFIED" | "HELD";
  settlementError: string | null;
  checkedAt: string | null;
  paidDate?: string | null;
}

export function invoiceStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    CREATING: "Creating",
    DRAFT: "Draft",
    PUBLISHING: "Preparing link",
    SHARED: "Waiting for payment",
    PAYMENT_PENDING: "Payment pending",
    // PayPal says it's paid, but the amount and fee aren't confirmed, so nothing is split yet.
    PAYMENT_RECORDED: "Checking with PayPal",
    PAID: "Paid · split",
    PARTIALLY_PAID: "Partially paid",
    CANCELLED: "Cancelled",
    REFUNDED: "Refunded",
    PARTIALLY_REFUNDED: "Partially refunded",
    MARKED_AS_PAID: "Paid externally · not split",
    MARKED_AS_REFUNDED: "Refunded externally",
    FAILED: "Needs attention",
    UNKNOWN: "Checking with PayPal",
  };
  return labels[status] || status;
}

export enum InvoiceTone {
  NEUTRAL = "",
  GOOD = "good",
  WARNING = "warning",
}

/** Statuses where the customer still owes money, so a past due date means overdue. */
const AWAITING_PAYMENT = new Set([
  "SHARED",
  "PAYMENT_PENDING",
  "PARTIALLY_PAID",
]);
const NEEDS_LOOK = new Set([
  "FAILED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "MARKED_AS_PAID",
  "MARKED_AS_REFUNDED",
]);

/** Today as a calendar date in the viewer's own time zone. */
export function localToday(now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The one chip an invoice row shows. A hold always wins: nothing is split while held. */
export function invoiceChip(
  invoice: Pick<Invoice, "status" | "settlementStatus" | "dueDate">,
  today = localToday(),
): { label: string; tone: InvoiceTone } {
  if (invoice.settlementStatus === "HELD")
    return { label: "On hold", tone: InvoiceTone.WARNING };
  if (invoice.status === "PAID" && invoice.settlementStatus === "VERIFIED")
    return { label: invoiceStatusLabel("PAID"), tone: InvoiceTone.GOOD };
  if (invoice.status === "PAID")
    return { label: "Checking with PayPal", tone: InvoiceTone.NEUTRAL };
  if (AWAITING_PAYMENT.has(invoice.status) && invoice.dueDate < today)
    return { label: "Overdue", tone: InvoiceTone.WARNING };
  return {
    label: invoiceStatusLabel(invoice.status),
    tone: NEEDS_LOOK.has(invoice.status)
      ? InvoiceTone.WARNING
      : InvoiceTone.NEUTRAL,
  };
}

/** What the split side of an invoice looks like, in plain words. */
export function invoiceSplitLabel(settlement: Invoice["settlementStatus"]) {
  return settlement === "VERIFIED"
    ? "Split done"
    : settlement === "HELD"
      ? "Split paused for review"
      : "Not split yet";
}

/** Calendar dates (YYYY-MM-DD) read the same in every time zone: "Nov 12", or "Nov 12, 2027". */
export function invoiceDay(value: string, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
    ...(date.getUTCFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Unknown provider balances must not be represented as zero. */
export function invoiceMoney(
  value: number | null | undefined,
  currency: string,
) {
  return value == null
    ? "Not verified"
    : (value / 100).toLocaleString("en-US", { style: "currency", currency });
}

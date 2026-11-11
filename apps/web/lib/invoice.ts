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
    SHARED: "Ready to share",
    PAYMENT_PENDING: "Payment pending",
    PAYMENT_RECORDED: "Payment recorded · settlement unverified",
    PAID: "Paid · allocation verified",
    PARTIALLY_PAID: "Partially paid",
    CANCELLED: "Cancelled",
    REFUNDED: "Refunded",
    PARTIALLY_REFUNDED: "Partially refunded",
    MARKED_AS_PAID: "Marked as paid externally",
    MARKED_AS_REFUNDED: "Marked as refunded externally",
    FAILED: "Needs attention",
    UNKNOWN: "Check status",
  };
  return labels[status] || status;
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

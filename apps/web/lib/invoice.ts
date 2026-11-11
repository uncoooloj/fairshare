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

import { DomainError } from "@fairshare/domain";

export interface PaymentSource {
  type: "PAYPAL" | "OTHER";
  name: string;
}

/** Organizer-entered attribution only, never payment-provider evidence. */
export function paymentSource(value: unknown): PaymentSource {
  if (value === undefined) return { type: "PAYPAL", name: "PayPal" };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError(
      "INVALID_PAYMENT_SOURCE",
      "Choose PayPal or Other as the source label",
    );
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["type", "name"].includes(key))) {
    throw new DomainError(
      "INVALID_PAYMENT_SOURCE",
      "Source metadata cannot set payment status or evidence",
    );
  }
  if (
    input.type === "PAYPAL" &&
    (input.name === undefined || input.name === "PayPal")
  ) {
    return { type: "PAYPAL", name: "PayPal" };
  }
  if (input.type === "OTHER" && typeof input.name === "string") {
    const name = input.name.trim();
    if (
      name.length >= 1 &&
      name.length <= 100 &&
      !/[\x00-\x1f\x7f]/.test(name)
    ) {
      return { type: "OTHER", name };
    }
  }
  throw new DomainError(
    "INVALID_PAYMENT_SOURCE",
    "Other requires a source name of 1–100 characters",
  );
}

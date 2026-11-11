import { title } from "./model";

/** Plain-language labels for status codes from the API. Raw codes such as
 * REVIEW_REQUIRED or OUTCOME_UNKNOWN should never reach the screen. */
const statusLabels: Record<string, string> = {
  // Agreement versions
  DRAFT: "Draft",
  AWAITING_APPROVAL: "Waiting for approval",
  APPROVED: "Approved",
  ACTIVE: "In use",
  SUPERSEDED: "Replaced",
  // Payments and their shares
  CONFIRMED: "Received",
  REVIEW_REQUIRED: "Needs attention",
  ALLOCATED: "Owed",
  HELD: "Paused",
  AUTO_HELD: "Paused",
  // AI reading of the agreement
  MANUAL_REQUIRED: "Fill in yourself",
  // Checkout, invoices and refunds
  CREATED: "Created",
  AWAITING_BUYER: "Waiting for payment",
  CHECKOUT_RETURNED: "Ready to collect",
  PAYMENT_PROCESSING: "Processing",
  PAYMENT_PENDING: "Payment pending",
  SENT: "Sent",
  SCHEDULED: "Scheduled",
  UNPAID: "Unpaid",
  PAID: "Paid",
  MARKED_AS_PAID: "Marked as paid",
  PARTIALLY_PAID: "Part paid",
  REFUNDED: "Refunded",
  PARTIALLY_REFUNDED: "Part refunded",
  MARKED_AS_REFUNDED: "Marked as refunded",
  CANCELLED: "Cancelled",
  // Payouts and checks with PayPal
  PENDING: "Pending",
  PROCESSING: "Processing",
  WAITING_RECIPIENT: "Waiting for PayPal details",
  UNCLAIMED: "Not collected",
  REVERSED: "Reversed",
  COMPLETED: "Done",
  SUCCESS: "Done",
  FAILED: "Failed",
  UNKNOWN: "Being checked",
  OUTCOME_UNKNOWN: "Not sure yet",
};

/** Friendly label for a status code. Unknown codes fall back to sentence case. */
export function statusLabel(code: string) {
  return statusLabels[code] ?? title(code);
}

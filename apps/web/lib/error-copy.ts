/** Keep technical diagnostics in the API; tell people what they can do next. */
export function errorCopy(
  status: number,
  code?: string,
  message?: string,
): string {
  const messages: Record<string, string> = {
    EMAIL_VERIFICATION_REQUIRED:
      "Verify your email before sending invitations or review reminders.",
    EMAIL_UNAVAILABLE:
      "Email is not available right now. No email was sent. Copy or share the link directly instead.",
    EMAIL_DELIVERY_UNCONFIRMED:
      "Email delivery is unconfirmed. Do not resend; copy or share the link directly instead.",
    OCR_UNAVAILABLE:
      "We can’t read this scan right now. Try again later, or paste the agreement text.",
    OCR_BUSY:
      "We’re reading other documents right now. Please try again in a moment.",
    OCR_FAILED:
      "We couldn’t read this scan. Try a clearer copy, or paste the agreement text.",
    OCR_TIMEOUT:
      "This scan took too long to read. Try fewer pages, or paste the agreement text.",
    OCR_PAGE_LIMIT:
      "Please upload a scan with no more than 5 pages, or paste the agreement text.",
    OCR_NO_TEXT:
      "We couldn’t find readable text in this scan. Try a clearer copy, or paste the agreement text.",
    OCR_ENCRYPTED:
      "Remove this document’s password before uploading, or paste the agreement text.",
    OCR_IMAGE_LIMIT:
      "The images in this scan are too large. Try a smaller file, or paste the agreement text.",
    OCR_OUTPUT_LIMIT:
      "This scan contains too much text. Try a shorter document, or paste the relevant agreement text.",
    OCR_TEXT_LIMIT:
      "This scan contains too much text. Try a shorter document, or paste the relevant agreement text.",
    PDF_NO_EXTRACTABLE_TEXT:
      "We couldn’t read this document. Try a clearer copy, or paste the agreement text.",
    REVISION_CONFLICT:
      "Someone else just changed this. Check the latest, then try again.",
    STALE_VERSION: "There’s a newer version. Open it first.",
    PARSER_NOT_CONFIGURED:
      "We can’t read agreements automatically right now. Please try again later, or enter the terms yourself.",
    PARSER_UNAVAILABLE:
      "We couldn’t read this agreement. Try again, or enter the terms yourself.",
    PDF_EXTRACTION_FAILED:
      "We couldn’t read this PDF. Try a clearer copy, or paste the agreement text.",
    PDF_EXTRACTION_TIMEOUT:
      "This document took too long to read. Try a smaller file, or paste its text.",
    PDF_BUSY:
      "We’re reading other documents right now. Please try again in a moment.",
    PDF_TOO_LARGE: "Choose a PDF smaller than 5 MB.",
    INVALID_PDF:
      "This file couldn’t be opened as a PDF. Please upload a new copy.",
    PAYPAL_NOT_CONFIGURED:
      "Payments aren’t ready yet. Please try again once PayPal is connected.",
    PAYOUT_NOT_CONFIGURED: "Payouts aren’t set up yet. Connect PayPal first.",
    UNAUTHORIZED: "Please sign in to continue.",
    FORBIDDEN:
      "You don’t have access to this action. Ask the agreement organizer for help.",
  };
  if (code && messages[code]) return messages[code];
  if (status >= 500)
    return "Something went wrong. Refresh to see what saved, then try again.";
  if (status === 429)
    return "Too many tries at once. Wait a moment, then try again.";
  if (message && /workspace/i.test(message))
    return "You don’t have access to that. Ask whoever invited you.";
  if (message && !/^[A-Z][A-Z_\d]+$/.test(message)) return message;
  return "That didn’t go through. Check your details and try again.";
}

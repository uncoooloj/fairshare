import test from "node:test";
import assert from "node:assert/strict";
import { errorCopy } from "../lib/error-copy";

test("document errors explain a next step without infrastructure jargon", () => {
  for (const code of [
    "PARSER_NOT_CONFIGURED",
    "PARSER_UNAVAILABLE",
    "PDF_EXTRACTION_FAILED",
    "PDF_EXTRACTION_TIMEOUT",
    "PDF_BUSY",
  ]) {
    const text = errorCopy(503, code, "Cloudflare provider fallback");
    assert.doesNotMatch(text, /Cloudflare|provider|fallback|OCR|PARSER/);
    assert.match(text, /try|Try|paste|enter/);
  }
});
test("unexpected errors never leak diagnostics or encourage repeating payments blindly", () => {
  const text = errorCopy(
    500,
    "INTERNAL_ERROR",
    "Database postgres connection refused",
  );
  assert.doesNotMatch(text, /Database|postgres/);
  assert.match(text, /Refresh to check what was saved/);
});
test("actionable validation messages survive while raw codes do not", () => {
  assert.equal(
    errorCopy(400, "INVALID_EMAIL", "Enter a valid email address."),
    "Enter a valid email address.",
  );
  assert.doesNotMatch(
    errorCopy(400, "UNKNOWN_CODE", "UNKNOWN_CODE"),
    /UNKNOWN_CODE/,
  );
  assert.match(errorCopy(409, "REVISION_CONFLICT"), /latest version/);
});

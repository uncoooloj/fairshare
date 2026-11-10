import { createHash } from "node:crypto";
import { DomainError } from "@fairshare/domain";
import type { DocumentReaders } from "../src/documentReaders.js";

export interface ParserBinding {
  fetch(request: Request): Promise<Response>;
}
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const MAX_PARSER_RESPONSE_BYTES = 300_000;
const REJECTED_DOCUMENT_CODES = new Set([
  "INVALID_PDF",
  "INVALID_DOCX",
  "PDF_PASSWORD_REQUIRED",
  "PDF_PAGE_LIMIT",
  "PDF_TEXT_LIMIT",
  "PDF_NO_EXTRACTABLE_TEXT",
  "DOCX_PASSWORD_REQUIRED",
  "DOCX_TEXT_LIMIT",
  "DOCX_NO_EXTRACTABLE_TEXT",
  "OCR_PAGE_LIMIT",
  "OCR_ENCRYPTED",
  "OCR_IMAGE_LIMIT",
  "OCR_TEXT_LIMIT",
  "OCR_NO_TEXT",
]);
const parserUnavailable = () =>
  new DomainError(
    "PARSER_UNAVAILABLE",
    "Document processing is unavailable. Retry shortly or paste the agreement text.",
  );

/** Only a private service binding is accepted: never a caller-controlled URL. */
export function cloudflareDocumentReaders(
  binding?: ParserBinding,
): DocumentReaders {
  async function parse(
    kind: "pdf" | "docx" | "ocr",
    bytes: Buffer,
  ): Promise<any> {
    if (!binding)
      throw new DomainError(
        "PARSER_NOT_CONFIGURED",
        "Document processing is not configured. Paste the agreement text.",
      );
    if (bytes.byteLength > MAX_DOCUMENT_BYTES)
      throw new DomainError(
        "DOCUMENT_TOO_LARGE",
        "Use a document no larger than 5 MiB.",
      );
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      kind === "ocr" ? 65_000 : 12_000,
    );
    try {
      const response = await binding.fetch(
        new Request(`http://parser.internal/${kind}`, {
          method: "POST",
          body: new Uint8Array(bytes),
          signal: controller.signal,
          headers: { "Content-Type": "application/octet-stream" },
        }),
      );
      if (!response.body) throw parserUnavailable();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_PARSER_RESPONSE_BYTES) {
            await reader.cancel();
            throw parserUnavailable();
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!response.ok) {
        // Never reflect arbitrary backend messages or document fragments.
        if (response.status === 429)
          throw new DomainError(
            "PDF_BUSY",
            "Document processing is busy. Retry shortly.",
          );
        if (
          response.status === 422 &&
          REJECTED_DOCUMENT_CODES.has(result?.error)
        )
          throw new DomainError(
            result.error,
            result.error === "PDF_NO_EXTRACTABLE_TEXT"
              ? "This PDF has no readable text layer. Choose OCR if available or paste the agreement text."
              : "This document could not be read safely. Try another file or paste the agreement text.",
          );
        throw parserUnavailable();
      }
      if (
        !result ||
        typeof result.text !== "string" ||
        !result.text.trim() ||
        result.text.length > 40_000 ||
        result.sourceFileSha256 !==
          createHash("sha256").update(bytes).digest("hex") ||
        result.extraction?.offsetUnit !== "UTF16_CODE_UNITS" ||
        typeof result.extraction?.engine !== "string" ||
        result.extraction.engine.length > 80 ||
        result.extraction.ocr !== (kind === "ocr") ||
        result.extraction.readingOrder !==
          { pdf: "PDF_TEXT_LAYER", docx: "DOCUMENT_XML", ocr: "OCR" }[kind]
      )
        throw parserUnavailable();
      if (kind !== "docx") {
        if (
          !Array.isArray(result.pages) ||
          !result.pages.length ||
          result.pages.length > (kind === "ocr" ? 5 : 20)
        )
          throw parserUnavailable();
        let end = 0;
        for (const [index, page] of result.pages.entries()) {
          if (
            page.page !== index + 1 ||
            !Number.isInteger(page.start) ||
            !Number.isInteger(page.end) ||
            page.start < end ||
            page.end < page.start ||
            page.end > result.text.length
          )
            throw parserUnavailable();
          end = page.end;
        }
      }
      if (
        kind === "ocr" &&
        (result.extraction.reviewRequired !== true ||
          result.extraction.language !== "eng")
      )
        throw parserUnavailable();
      return result;
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw parserUnavailable();
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    processingLocation: "CLOUDFLARE_CONTAINER",
    pdf: (bytes) => parse("pdf", bytes),
    docx: (bytes) => parse("docx", bytes),
    ocr: (bytes) => parse("ocr", bytes),
  };
}

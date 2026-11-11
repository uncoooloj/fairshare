import { extractPdf } from "./pdf.js";
import { extractDocx } from "./docx.js";
import { extractPdfOcr } from "./ocr.js";

/** A parser never receives account credentials, payment state or database access. */
export interface DocumentReaders {
  processingLocation?: "SERVER" | "CLOUDFLARE_CONTAINER";
  pdf: typeof extractPdf;
  docx: typeof extractDocx;
  ocr: typeof extractPdfOcr;
}
export const localDocumentReaders: DocumentReaders = {
  pdf: extractPdf,
  docx: extractDocx,
  ocr: extractPdfOcr,
};

/** Read native text first; only a textless scan may use the enabled image reader. */
export async function readUploadedPdf(
  readers: DocumentReaders,
  bytes: Buffer,
  options: { ocrEnabled: boolean; forceOcr?: boolean },
) {
  // Retain the existing explicit API option for older clients. Callers validate
  // availability before reaching this helper; never bypass the server setting.
  if (options.forceOcr && options.ocrEnabled) return readers.ocr(bytes);
  try {
    return await readers.pdf(bytes);
  } catch (error) {
    if (
      options.ocrEnabled &&
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "PDF_NO_EXTRACTABLE_TEXT"
    ) {
      return readers.ocr(bytes);
    }
    // Passwords, limits, timeouts and parser failures are not scans. Preserve
    // these errors instead of silently retrying a different processing path.
    throw error;
  }
}

import { DomainError } from "@fairshare/domain";
import { extractPdf, SCANNED_PDF_MESSAGE, ScanErrorCode } from "./pdf.js";
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
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "PDF_NO_EXTRACTABLE_TEXT"
    ) {
      // A textless PDF is a scan: read it automatically when OCR is enabled,
      // otherwise say so plainly instead of suggesting a clearer copy.
      if (options.ocrEnabled) return readers.ocr(bytes);
      throw new DomainError(
        ScanErrorCode.SCANNED_PDF_UNSUPPORTED,
        SCANNED_PDF_MESSAGE,
      );
    }
    // Passwords, limits, timeouts and parser failures are not scans. Preserve
    // these errors instead of silently retrying a different processing path.
    throw error;
  }
}

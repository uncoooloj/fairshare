import { extractPdf } from './pdf.js';
import { extractDocx } from './docx.js';
import { extractPdfOcr } from './ocr.js';

/** A parser never receives account credentials, payment state or database access. */
export interface DocumentReaders {
  processingLocation?: 'SERVER' | 'CLOUDFLARE_CONTAINER';
  pdf: typeof extractPdf;
  docx: typeof extractDocx;
  ocr: typeof extractPdfOcr;
}
export const localDocumentReaders: DocumentReaders = {
  pdf: extractPdf, docx: extractDocx, ocr: extractPdfOcr,
};

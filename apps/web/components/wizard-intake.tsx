import { ApiError, Currency, type Agreement } from "../lib/model";
import { DocumentMode, MAX_DOCUMENT_TEXT_LENGTH } from "./document-step";

export type AgreementIntakeInput = {
  requestId: string;
  text?: string;
  base64?: string;
  mimeType?: string;
  filename?: string;
  useLocalOcr?: boolean;
  name?: string;
  currency?: Currency;
  effectiveFrom?: string;
  effectiveTo?: string | null;
};

/** What the app hands back once intake committed the workspace, agreement and source. */
export interface CreatedAgreement {
  workspaceId: string;
  agreementId: string;
  documentId: string;
  /** The stored document text, used to check quotes. */
  documentText: string;
  /** The agreement as saved, for its revision, name and members. */
  agreement: Agreement;
  /** OCR read some words with low confidence: Check shows one warning. */
  lowConfidence?: boolean;
}

/** The unreadable card's line, unless the server says something more specific (scans). */
export const UNREADABLE_DETAIL =
  "It might be password-protected or a scan we can’t read.";

/** What the unreadable card says under "We couldn’t open this file". */
export function unreadableDetail(cause: unknown): string {
  if (cause instanceof DocumentInputError) return cause.message;
  return cause instanceof ApiError &&
    cause.code === "SCANNED_PDF_UNSUPPORTED" &&
    cause.message
    ? cause.message
    : UNREADABLE_DETAIL;
}

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** A problem with the document itself: the wizard returns to the Document step. */
export class DocumentInputError extends Error {}

/** Codes the API uses when it can't read the uploaded document. */
const UNREADABLE = /^(PDF_|DOCX_|OCR_|SCANNED_|INVALID_PDF|INVALID_DOCX)/;

export function isUnreadableDocument(cause: unknown) {
  if (cause instanceof DocumentInputError) return true;
  if (!(cause instanceof ApiError)) return false;
  if (cause.code && UNREADABLE.test(cause.code)) return true;
  return (
    cause.code === "INVALID_INPUT" &&
    /readable text|40,000 characters|PDF or DOCX/i.test(cause.message)
  );
}

/** Reads the chosen file locally and builds one intake request. Nothing is uploaded here. */
export async function buildIntakeInput({
  requestId,
  mode,
  file,
  text,
}: {
  requestId: string;
  mode: DocumentMode;
  file: File | null;
  text: string;
}): Promise<AgreementIntakeInput> {
  // No name: the server titles the draft from the file name or heading; Check can change it.
  const input: AgreementIntakeInput = { requestId, currency: Currency.USD };
  if (mode === DocumentMode.UPLOAD) {
    if (!file) throw new DocumentInputError("Choose a document to continue.");
    input.filename = file.name;
    if (/\.txt$/i.test(file.name) || file.type === "text/plain") {
      input.text = await file.text();
    } else {
      if (!/\.(pdf|docx)$/i.test(file.name))
        throw new DocumentInputError("Choose a PDF, Word or text file.");
      input.mimeType = /\.docx$/i.test(file.name)
        ? DOCX_MIME
        : "application/pdf";
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await file.arrayBuffer());
      } catch {
        throw new DocumentInputError(
          "We couldn’t open this file. Choose it again.",
        );
      }
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      input.base64 = btoa(binary);
    }
  } else input.text = text;
  if (
    input.text !== undefined &&
    (!input.text.trim() || input.text.length > MAX_DOCUMENT_TEXT_LENGTH)
  )
    throw new DocumentInputError(
      "Use between 1 and 40,000 characters of agreement text.",
    );
  return input;
}

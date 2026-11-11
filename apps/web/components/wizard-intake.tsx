import { ApiError, Currency } from "../lib/model";
import { DocumentMode, MAX_DOCUMENT_TEXT_LENGTH } from "./document-step";
import { detailsPayload, type DetailsDraft } from "./wizard-details-step";

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
}

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** A problem with the document itself: the wizard returns to the Document step. */
export class DocumentInputError extends Error {}

/** Codes the API uses when it can't read the uploaded document. */
const UNREADABLE = /^(PDF_|DOCX_|OCR_|INVALID_PDF|INVALID_DOCX)/;

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
  details,
}: {
  requestId: string;
  mode: DocumentMode;
  file: File | null;
  text: string;
  details: DetailsDraft;
}): Promise<AgreementIntakeInput> {
  const input: AgreementIntakeInput = {
    requestId,
    ...detailsPayload(details),
    currency: Currency.USD,
  };
  if (mode === DocumentMode.UPLOAD) {
    if (!file) throw new DocumentInputError("Choose a document to continue.");
    input.filename = file.name;
    if (/\.txt$/i.test(file.name) || file.type === "text/plain") {
      input.text = await file.text();
    } else {
      if (!/\.(pdf|docx)$/i.test(file.name))
        throw new DocumentInputError("Choose a PDF, DOCX or TXT document.");
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

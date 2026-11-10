import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { DomainError } from "@fairshare/domain";
export const MAX_PDF_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_REQUEST_BYTES = Math.ceil(MAX_PDF_BYTES / 3) * 4 + 1024;
export interface PdfExtraction {
  text: string;
  pages: Array<{ page: number; start: number; end: number }>;
  sourceFileSha256: string;
  extraction: {
    engine: string;
    version: string;
    readingOrder: "PDF_TEXT_LAYER";
    offsetUnit: "UTF16_CODE_UNITS";
    ocr: false;
  };
}
let activeParsers = 0;
const messages: Record<string, string> = {
  PDF_BUSY: "PDF processing is busy. Try again shortly.",
  PDF_TOO_LARGE: "Choose a PDF smaller than 5 MB.",
  INVALID_PDF:
    "This is not a readable PDF. Try another file or paste the agreement text.",
  PDF_PASSWORD_REQUIRED:
    "Remove the PDF password locally before uploading, or paste the agreement text.",
  PDF_PAGE_LIMIT: "Use a PDF with at most 20 pages.",
  PDF_TEXT_LIMIT:
    "This agreement exceeds 40,000 characters. Use a shorter document.",
  PDF_NO_EXTRACTABLE_TEXT:
    "This PDF has no readable text layer. Choose local OCR if available, paste the text, or upload a text-based PDF.",
  PDF_EXTRACTION_TIMEOUT:
    "PDF processing took too long. Try a simpler file or paste the text.",
  PDF_EXTRACTION_FAILED:
    "The PDF could not be read. Try another file or paste the text.",
};
function fail(code: string): never {
  throw new DomainError(code, messages[code] ?? messages.PDF_EXTRACTION_FAILED);
}
export function decodePdfBase64(value: unknown): Buffer {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > Math.ceil(MAX_PDF_BYTES / 3) * 4
  )
    fail("PDF_TOO_LARGE");
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
    fail("INVALID_PDF");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) fail("INVALID_PDF");
  if (bytes.length > MAX_PDF_BYTES) fail("PDF_TOO_LARGE");
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) fail("INVALID_PDF");
  return bytes;
}
/** Bounded local parser, no cloud upload, shell, credential environment or external URLs. */
export async function extractPdf(
  bytes: Buffer,
  options: { timeoutMs?: number } = {},
): Promise<PdfExtraction> {
  if (bytes.length > MAX_PDF_BYTES) fail("PDF_TOO_LARGE");
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) fail("INVALID_PDF");
  if (activeParsers >= 2) fail("PDF_BUSY");
  const compiled = fileURLToPath(new URL("./pdfWorker.js", import.meta.url));
  const worker = existsSync(compiled)
    ? compiled
    : fileURLToPath(new URL("./pdfWorker.ts", import.meta.url));
  activeParsers++;
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--max-old-space-size=128",
        ...(worker.endsWith(".ts") ? ["--experimental-strip-types"] : []),
        worker,
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: { NODE_ENV: "production" },
        windowsHide: true,
      },
    );
    let finished = false,
      size = 0;
    const chunks: Buffer[] = [];
    const finish = (error?: DomainError, result?: PdfExtraction) => {
      if (finished) return;
      finished = true;
      activeParsers--;
      clearTimeout(timer);
      child.kill("SIGKILL");
      if (error) reject(error);
      else resolve(result!);
    };
    const failure = (code: string) =>
      finish(
        new DomainError(code, messages[code] ?? messages.PDF_EXTRACTION_FAILED),
      );
    const timer = setTimeout(
      () => failure("PDF_EXTRACTION_TIMEOUT"),
      options.timeoutMs ?? 8000,
    );
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 300000) {
        failure("PDF_TEXT_LIMIT");
        return;
      }
      chunks.push(chunk);
    });
    // Drain but never retain or relay parser errors that could contain confidential source text.
    child.stderr.on("data", () => {});
    child.on("error", () => failure("PDF_EXTRACTION_FAILED"));
    child.stdin.on("error", () => failure("PDF_EXTRACTION_FAILED"));
    child.on("close", (code) => {
      if (finished) return;
      if (code !== 0) {
        failure("PDF_EXTRACTION_FAILED");
        return;
      }
      try {
        const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (result.ok !== true) {
          failure(
            Object.hasOwn(messages, result.code)
              ? result.code
              : "PDF_EXTRACTION_FAILED",
          );
          return;
        }
        if (
          typeof result.text !== "string" ||
          result.text.length > 40000 ||
          !Array.isArray(result.pages) ||
          result.pages.length > 20
        ) {
          failure("PDF_EXTRACTION_FAILED");
          return;
        }
        const { ok, ...extracted } = result;
        finish(undefined, extracted);
      } catch {
        failure("PDF_EXTRACTION_FAILED");
      }
    });
    child.stdin.end(bytes);
  });
}

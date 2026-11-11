import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { DomainError } from "@fairshare/domain";
import { normalizeExtractedText } from "./textLayout.js";
export const MAX_DOCX_BYTES = 5 * 1024 * 1024;
export const MAX_DOCX_REQUEST_BYTES = Math.ceil(MAX_DOCX_BYTES / 3) * 4 + 1024;
export interface DocxExtraction {
  text: string;
  sourceFileSha256: string;
  extraction: {
    engine: string;
    version: string;
    readingOrder: "DOCUMENT_XML";
    offsetUnit: "UTF16_CODE_UNITS";
    ocr: false;
  };
}
let activeParsers = 0;
const messages: Record<string, string> = {
  DOCX_BUSY: "DOCX processing is busy. Try again shortly.",
  DOCX_TOO_LARGE: "Choose a DOCX smaller than 5 MB.",
  INVALID_DOCX:
    "This is not a readable DOCX. Try another file or paste the agreement text.",
  DOCX_PASSWORD_REQUIRED:
    "Remove the DOCX password locally before uploading, or paste the agreement text.",
  DOCX_TEXT_LIMIT:
    "This agreement exceeds 40,000 characters. Use a shorter document.",
  DOCX_NO_EXTRACTABLE_TEXT:
    "This DOCX has no readable text. Paste the agreement text instead.",
  DOCX_EXTRACTION_TIMEOUT:
    "DOCX processing took too long. Try a simpler file or paste the text.",
  DOCX_EXTRACTION_FAILED:
    "The DOCX could not be read. Try another file or paste the text.",
};
function fail(code: string): never {
  throw new DomainError(
    code,
    messages[code] ?? messages.DOCX_EXTRACTION_FAILED,
  );
}
export function decodeDocxBase64(value: unknown): Buffer {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > Math.ceil(MAX_DOCX_BYTES / 3) * 4
  )
    fail("DOCX_TOO_LARGE");
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
    fail("INVALID_DOCX");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) fail("INVALID_DOCX");
  if (bytes.length > MAX_DOCX_BYTES) fail("DOCX_TOO_LARGE");
  if (!bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])))
    fail("INVALID_DOCX");
  return bytes;
}
/** Bounded local parser, no cloud upload, shell, credential environment or external URLs. */
export async function extractDocx(
  bytes: Buffer,
  options: { timeoutMs?: number } = {},
): Promise<DocxExtraction> {
  if (bytes.length > MAX_DOCX_BYTES) fail("DOCX_TOO_LARGE");
  if (!bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])))
    fail("INVALID_DOCX");
  if (activeParsers >= 2) fail("DOCX_BUSY");
  const compiled = fileURLToPath(new URL("./docxWorker.js", import.meta.url));
  const worker = existsSync(compiled)
    ? compiled
    : fileURLToPath(new URL("./docxWorker.ts", import.meta.url));
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
    const finish = (error?: DomainError, result?: DocxExtraction) => {
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
        new DomainError(
          code,
          messages[code] ?? messages.DOCX_EXTRACTION_FAILED,
        ),
      );
    const timer = setTimeout(
      () => failure("DOCX_EXTRACTION_TIMEOUT"),
      options.timeoutMs ?? 8000,
    );
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 300000) {
        failure("DOCX_TEXT_LIMIT");
        return;
      }
      chunks.push(chunk);
    });
    // Drain but never retain or relay parser errors that could contain confidential source text.
    child.stderr.on("data", () => {});
    child.on("error", () => failure("DOCX_EXTRACTION_FAILED"));
    child.stdin.on("error", () => failure("DOCX_EXTRACTION_FAILED"));
    child.on("close", (code) => {
      if (finished) return;
      if (code !== 0) {
        failure("DOCX_EXTRACTION_FAILED");
        return;
      }
      try {
        const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (result.ok !== true) {
          failure(
            Object.hasOwn(messages, result.code)
              ? result.code
              : "DOCX_EXTRACTION_FAILED",
          );
          return;
        }
        if (typeof result.text !== "string" || result.text.length > 40000) {
          failure("DOCX_EXTRACTION_FAILED");
          return;
        }
        const { ok, ...extracted } = result;
        // One blank line between paragraphs; empty Word paragraphs add no extra gaps.
        extracted.text = normalizeExtractedText(extracted.text);
        if (!extracted.text) {
          failure("DOCX_NO_EXTRACTABLE_TEXT");
          return;
        }
        finish(undefined, extracted);
      } catch {
        failure("DOCX_EXTRACTION_FAILED");
      }
    });
    child.stdin.end(bytes);
  });
}

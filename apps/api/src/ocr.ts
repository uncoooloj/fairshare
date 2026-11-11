import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { DomainError } from "@fairshare/domain";
import { MAX_PDF_BYTES } from "./pdf.js";
import { layoutPage, type LayoutLine, type TextRange } from "./textLayout.js";
const limits = { pages: 5, characters: 40000, imageBytes: 20 * 1024 * 1024 };
let active = 0;
const fail = (code: string, message: string) => new DomainError(code, message);
/** Local-only subprocesses. No shell, application credentials or source-bearing logs. */
function command(
  binary: string,
  args: string[],
  timeoutMs: number,
  maxBytes = 200000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      env: {
        PATH: "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin",
        LANG: "C",
        OMP_THREAD_LIMIT: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let finished = false,
      size = 0;
    const chunks: Buffer[] = [];
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      error ? reject(error) : resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const timer = setTimeout(
      () =>
        finish(
          fail(
            "OCR_TIMEOUT",
            "Local OCR took too long. Use a shorter document or paste its text.",
          ),
        ),
      timeoutMs,
    );
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        finish(
          fail(
            "OCR_OUTPUT_LIMIT",
            "OCR output is too large. Use a shorter document.",
          ),
        );
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on("data", () => {});
    child.on("error", () =>
      finish(
        fail(
          "OCR_UNAVAILABLE",
          "Local OCR tools are unavailable. Ask the server operator to install Poppler and Tesseract, or paste text.",
        ),
      ),
    );
    child.on("close", (code) =>
      finish(
        code === 0
          ? undefined
          : fail(
              "OCR_FAILED",
              "The scan could not be read safely. Remove password protection locally or paste the agreement text.",
            ),
      ),
    );
  });
}
// Apple Vision is local OS functionality, not an external OCR service. Compile
// the bundled helper with installed Xcode tools, in a private per-process cache.
let nativeTool: Promise<string> | undefined;
function prepareNativeTool(): Promise<string> {
  return (nativeTool ??= (async () => {
    const directory = await mkdtemp(join(tmpdir(), "fairshare-vision-"));
    process.once("exit", () => {
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch {}
    });
    const binary = join(directory, "vision-ocr");
    try {
      await command(
        "/usr/bin/xcrun",
        [
          "swiftc",
          "-module-cache-path",
          join(directory, "modules"),
          fileURLToPath(new URL("./vision-ocr.swift", import.meta.url)),
          "-o",
          binary,
        ],
        60000,
      );
      return binary;
    } catch {
      await rm(directory, { recursive: true, force: true });
      nativeTool = undefined;
      throw fail(
        "OCR_UNAVAILABLE",
        "Local OCR requires installed Apple Xcode command-line tools on this Mac. Paste text instead.",
      );
    }
  })());
}
/** A recognized line with the engine's confidence (0 to 1) for its words. */
export interface OcrLine extends LayoutLine {
  confidence: number;
  /** Another reading of this line contained an amount. */
  amountHint?: boolean;
}
export interface OcrPage {
  lines: OcrLine[];
}
export interface LowConfidenceRange extends TextRange {
  /** The line contains digits, a percent sign or a currency symbol. */
  amount: boolean;
}
/** Lines with amounts are held to a stricter bar than prose. */
export const OCR_AMOUNT_LINE_THRESHOLD = 0.9;
export const OCR_LINE_THRESHOLD = 0.7;
export const OCR_LOW_DOCUMENT_CONFIDENCE = 0.9;
const MAX_REPORTED_RANGES = 100;
const AMOUNT = /[\d%\p{Sc}]/u;
const ocrMessages = {
  OCR_TEXT_LIMIT: "OCR text exceeds 40,000 characters. Use a shorter document.",
  OCR_NO_TEXT:
    "No readable text was found. Upload a clearer scan or paste the text.",
};

function editDistance(a: string, b: string): number {
  a = a.slice(0, 400);
  b = b.slice(0, 400);
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++)
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    previous = current;
  }
  return previous[b.length];
}
const squash = (value: string) => value.replace(/\s+/g, " ").trim();

/**
 * Apple Vision reports near-certain confidence even for misreads such as
 * "S. Payments" for "5. Payments", so each line is also checked against a
 * second, independent pass. Lines the passes disagree on, or that only one
 * pass found, lose confidence in proportion to the difference.
 */
export function crossCheckLines(
  lines: OcrLine[],
  check: Array<Pick<OcrLine, "text" | "y" | "size">>,
): OcrLine[] {
  return lines.map((line) => {
    const text = squash(line.text);
    let best = 0,
      amountHint = false;
    for (const other of check) {
      if (Math.abs(other.y - line.y) > Math.max(line.size, other.size) * 0.6)
        continue;
      const candidate = squash(other.text);
      if (AMOUNT.test(candidate)) amountHint = true;
      if (candidate === text) {
        best = 1;
        break;
      }
      const length = Math.max(candidate.length, text.length, 1);
      const similarity = 1 - editDistance(candidate, text) / length;
      // "5." read as "S." in one pass: only one pass saw an amount.
      const score =
        similarity * (AMOUNT.test(candidate) !== AMOUNT.test(text) ? 0.5 : 0.7);
      best = Math.max(best, score);
    }
    const agreement = best === 0 ? 0.5 : best;
    return {
      ...line,
      confidence: Math.min(line.confidence, agreement),
      amountHint,
    };
  });
}

/** Group Tesseract TSV words into lines; confidence is the weakest word. */
export function parseTesseractTsv(tsv: string): OcrLine[] {
  let pageHeight = 0;
  const lines = new Map<
    string,
    {
      words: string[];
      x: number;
      top: number;
      bottom: number;
      right: number;
      size: number;
      confidence: number;
    }
  >();
  for (const row of tsv.split("\n").slice(1)) {
    const cells = row.split("\t");
    if (cells.length < 12) continue;
    const [level, , block, paragraph, lineNo, , ...rest] = cells;
    const [left, top, width, height, conf] = rest.slice(0, 5).map(Number);
    const word = cells.slice(11).join("\t").trim();
    if (level === "1") pageHeight = top + height;
    if (
      level !== "5" ||
      !word ||
      ![left, top, width, height].every(Number.isFinite)
    )
      continue;
    const key = `${block}.${paragraph}.${lineNo}`;
    const line = lines.get(key) ?? {
      words: [],
      x: left,
      top,
      bottom: top + height,
      right: left + width,
      size: height,
      confidence: 1,
    };
    line.words.push(word);
    line.x = Math.min(line.x, left);
    line.top = Math.min(line.top, top);
    line.bottom = Math.max(line.bottom, top + height);
    line.right = Math.max(line.right, left + width);
    line.size = Math.max(line.size, height);
    if (Number.isFinite(conf) && conf >= 0)
      line.confidence = Math.min(line.confidence, conf / 100);
    lines.set(key, line);
  }
  return [...lines.values()].map((line) => ({
    text: line.words.join(" "),
    x: line.x,
    // Image rows grow downwards; layout expects y to grow upwards.
    y: pageHeight - line.bottom,
    right: line.right,
    size: line.size,
    confidence: line.confidence,
  }));
}

/** Rebuild paragraphs and report confidence over the exact persisted text. */
export function assembleOcrPages(ocrPages: OcrPage[]) {
  let text = "";
  const pages: Array<{ page: number; start: number; end: number }> = [];
  const ranges: LowConfidenceRange[] = [];
  let weighted = 0,
    characters = 0,
    lowConfidenceLines = 0;
  for (const [index, page] of ocrPages.entries()) {
    if (index > 0) text += "\n\n";
    const start = text.length;
    const layout = layoutPage(page.lines);
    for (const [position, lineIndex] of layout.lineIndexes.entries()) {
      const line = page.lines[lineIndex];
      const range = layout.lineRanges[position];
      const length = range.end - range.start;
      const lineText = layout.text.slice(range.start, range.end);
      const confidence = Math.max(0, Math.min(1, line.confidence));
      weighted += confidence * length;
      characters += length;
      const amount = AMOUNT.test(lineText) || line.amountHint === true;
      if (
        confidence < (amount ? OCR_AMOUNT_LINE_THRESHOLD : OCR_LINE_THRESHOLD)
      ) {
        lowConfidenceLines++;
        if (ranges.length < MAX_REPORTED_RANGES)
          ranges.push({
            start: start + range.start,
            end: start + range.end,
            amount,
          });
      }
    }
    text += layout.text;
    if (text.length > limits.characters)
      throw fail("OCR_TEXT_LIMIT", ocrMessages.OCR_TEXT_LIMIT);
    pages.push({ page: index + 1, start, end: text.length });
  }
  if (!text.trim()) throw fail("OCR_NO_TEXT", ocrMessages.OCR_NO_TEXT);
  const confidence = characters
    ? Math.round((weighted / characters) * 100) / 100
    : 0;
  return {
    text,
    pages,
    quality: {
      confidence,
      lowConfidenceLines,
      // Keep the text but let the UI warn that some words may be wrong.
      lowConfidence:
        lowConfidenceLines > 0 || confidence < OCR_LOW_DOCUMENT_CONFIDENCE,
      lowConfidenceRanges: ranges,
    },
  };
}

const finite = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value);
function readLine(value: unknown): OcrLine | null {
  if (value === null || typeof value !== "object") return null;
  const line = value as Record<string, unknown>;
  if (
    typeof line.text !== "string" ||
    !finite(line.x) ||
    !finite(line.y) ||
    !finite(line.right) ||
    !finite(line.size)
  )
    return null;
  return {
    text: line.text,
    x: line.x as number,
    y: line.y as number,
    right: line.right as number,
    size: line.size as number,
    confidence: finite(line.confidence) ? (line.confidence as number) : 0,
  };
}
async function nativePages(
  source: string,
  timeout: number,
): Promise<OcrPage[]> {
  const binary = await prepareNativeTool();
  const response = JSON.parse(
    await command(binary, [source], timeout, 1_000_000),
  );
  const messages: Record<string, string> = {
    INVALID_PDF: "Choose a readable PDF no larger than 5 MiB.",
    OCR_PAGE_LIMIT:
      "Local OCR supports at most 5 pages. Split the document or paste its text.",
    OCR_ENCRYPTED: "Remove PDF password protection locally before OCR.",
    OCR_TEXT_LIMIT:
      "OCR text exceeds 40,000 characters. Use a shorter document.",
    OCR_FAILED:
      "The scan could not be read safely. Upload a clearer scan or paste its text.",
  };

  if (typeof response.error === "string")
    throw fail(
      response.error in messages ? response.error : "OCR_FAILED",
      messages[response.error] ?? messages.OCR_FAILED,
    );
  if (
    !Array.isArray(response.pages) ||
    response.pages.length < 1 ||
    response.pages.length > limits.pages
  )
    throw fail("OCR_FAILED", messages.OCR_FAILED);
  return response.pages.map((page: { lines?: unknown; check?: unknown }) => {
    if (!Array.isArray(page?.lines) || !Array.isArray(page.check))
      throw fail("OCR_FAILED", messages.OCR_FAILED);
    const lines = page.lines.map(readLine);
    const check = page.check.map(readLine);
    if (lines.includes(null) || check.includes(null))
      throw fail("OCR_FAILED", messages.OCR_FAILED);
    return {
      lines: crossCheckLines(lines as OcrLine[], check as OcrLine[]),
    };
  });
}
export async function extractPdfOcr(
  bytes: Buffer,
  options: { timeoutMs?: number } = {},
) {
  if (
    bytes.length > MAX_PDF_BYTES ||
    !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
  )
    throw fail("INVALID_PDF", "Choose a PDF no larger than 5 MiB.");
  if (active >= 1)
    throw fail(
      "OCR_BUSY",
      "Local OCR is processing another document. Try again shortly.",
    );
  active++;
  let sourceDirectory: string | undefined;
  const deadline = Date.now() + (options.timeoutMs ?? 60000);
  const remainingTimeout = () => {
    const remainingMs = deadline - Date.now();
    if (remainingMs < 1)
      throw fail("OCR_TIMEOUT", "Local OCR timed out. Use a shorter document.");
    return Math.min(remainingMs, 15000);
  };
  try {
    sourceDirectory = await mkdtemp(join(tmpdir(), "fairshare-ocr-"));
    const source = join(sourceDirectory, "source.pdf");
    await writeFile(source, bytes, { mode: 0o600 });
    if (process.platform === "darwin") {
      // Prepare before computing the extraction timeout; startup normally warms this.
      await prepareNativeTool();
      const ocrPages = await nativePages(source, remainingTimeout());
      const { text, pages, quality } = assembleOcrPages(ocrPages);
      return {
        text,
        pages,
        sourceFileSha256: createHash("sha256").update(bytes).digest("hex"),
        extraction: {
          engine: "apple-vision+pdfkit",
          readingOrder: "OCR" as const,
          offsetUnit: "UTF16_CODE_UNITS" as const,
          ocr: true as const,
          language: "eng",
          reviewRequired: true,
          ...quality,
        },
      };
    }
    const pdfInfo = await command("pdfinfo", [source], remainingTimeout());
    const pageCount = Number(/^Pages:\s+(\d+)\s*$/m.exec(pdfInfo)?.[1]);
    if (
      !Number.isSafeInteger(pageCount) ||
      pageCount < 1 ||
      pageCount > limits.pages
    )
      throw fail(
        "OCR_PAGE_LIMIT",
        "Local OCR supports at most 5 pages. Split the document or paste its text.",
      );
    if (/^Encrypted:\s+yes/m.test(pdfInfo))
      throw fail(
        "OCR_ENCRYPTED",
        "Remove PDF password protection locally before OCR.",
      );
    const ocrPages: OcrPage[] = [];
    let characters = 0;
    for (let page = 1; page <= pageCount; page++) {
      const imagePrefix = join(sourceDirectory, `page-${page}`);
      await command(
        "pdftoppm",
        [
          "-f",
          String(page),
          "-l",
          String(page),
          "-singlefile",
          "-scale-to",
          "2000",
          "-png",
          source,
          imagePrefix,
        ],
        remainingTimeout(),
        1000,
      );
      const imagePath = imagePrefix + ".png";
      if ((await stat(imagePath)).size > limits.imageBytes)
        throw fail(
          "OCR_IMAGE_LIMIT",
          "The scanned page is too large to process.",
        );
      // TSV carries per-word confidence and positions alongside the text.
      const lines = parseTesseractTsv(
        await command(
          "tesseract",
          [imagePath, "stdout", "-l", "eng", "--psm", "3", "tsv"],
          remainingTimeout(),
          1_000_000,
        ),
      );
      characters += lines.reduce((sum, line) => sum + line.text.length + 1, 2);
      if (characters > limits.characters)
        throw fail("OCR_TEXT_LIMIT", ocrMessages.OCR_TEXT_LIMIT);
      ocrPages.push({ lines });
      await rm(imagePath, { force: true });
    }
    const { text, pages, quality } = assembleOcrPages(ocrPages);
    return {
      text,
      pages,
      sourceFileSha256: createHash("sha256").update(bytes).digest("hex"),
      extraction: {
        engine: "poppler+tesseract",
        readingOrder: "OCR" as const,
        offsetUnit: "UTF16_CODE_UNITS" as const,
        ocr: true as const,
        language: "eng",
        reviewRequired: true,
        ...quality,
      },
    };
  } finally {
    try {
      if (sourceDirectory)
        await rm(sourceDirectory, { recursive: true, force: true });
    } finally {
      active--;
    }
  }
}
/** Fail startup rather than advertise OCR when local dependencies are missing. */
export async function verifyLocalOcrTools() {
  if (process.platform === "darwin") {
    await prepareNativeTool();
    return;
  }
  await command("pdfinfo", ["-v"], 3000);
  await command("pdftoppm", ["-v"], 3000);
  await command("tesseract", ["--version"], 3000);
}

import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { DomainError } from "@fairshare/domain";
import { MAX_PDF_BYTES } from "./pdf.js";
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
async function nativePages(source: string, timeout: number): Promise<string[]> {
  const binary = await prepareNativeTool();
  const raw = JSON.parse(await command(binary, [source], timeout, 320200));
  const errors: Record<string, string> = {
    INVALID_PDF: "Choose a readable PDF no larger than 5 MiB.",
    OCR_PAGE_LIMIT:
      "Local OCR supports at most 5 pages. Split the document or paste its text.",
    OCR_ENCRYPTED: "Remove PDF password protection locally before OCR.",
    OCR_TEXT_LIMIT:
      "OCR text exceeds 40,000 characters. Use a shorter document.",
    OCR_FAILED:
      "The scan could not be read safely. Upload a clearer scan or paste its text.",
  };
  if (typeof raw.error === "string")
    throw fail(
      raw.error in errors ? raw.error : "OCR_FAILED",
      errors[raw.error] ?? errors.OCR_FAILED,
    );
  if (
    !Array.isArray(raw.pages) ||
    raw.pages.length < 1 ||
    raw.pages.length > limits.pages ||
    raw.pages.some((value: unknown) => typeof value !== "string")
  )
    throw fail("OCR_FAILED", errors.OCR_FAILED);
  return raw.pages;
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
  let directory: string | undefined;
  const deadline = Date.now() + (options.timeoutMs ?? 60000);
  const remaining = () => {
    const time = deadline - Date.now();
    if (time < 1)
      throw fail("OCR_TIMEOUT", "Local OCR timed out. Use a shorter document.");
    return Math.min(time, 15000);
  };
  try {
    directory = await mkdtemp(join(tmpdir(), "fairshare-ocr-"));
    const source = join(directory, "source.pdf");
    await writeFile(source, bytes, { mode: 0o600 });
    if (process.platform === "darwin") {
      // Prepare before computing the extraction timeout; startup normally warms this.
      await prepareNativeTool();
      const extracted = await nativePages(source, remaining());
      let text = "";
      const pages: Array<{ page: number; start: number; end: number }> = [];
      for (const [index, result] of extracted.entries()) {
        if (text) text += "\n\n";
        const start = text.length;
        text += result.trim();
        if (text.length > limits.characters)
          throw fail(
            "OCR_TEXT_LIMIT",
            "OCR text exceeds 40,000 characters. Use a shorter document.",
          );
        pages.push({ page: index + 1, start, end: text.length });
      }
      if (!text.trim())
        throw fail(
          "OCR_NO_TEXT",
          "No readable text was found. Upload a clearer scan or paste the text.",
        );
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
        },
      };
    }
    const info = await command("pdfinfo", [source], remaining());
    const count = Number(/^Pages:\s+(\d+)\s*$/m.exec(info)?.[1]);
    if (!Number.isSafeInteger(count) || count < 1 || count > limits.pages)
      throw fail(
        "OCR_PAGE_LIMIT",
        "Local OCR supports at most 5 pages. Split the document or paste its text.",
      );
    if (/^Encrypted:\s+yes/m.test(info))
      throw fail(
        "OCR_ENCRYPTED",
        "Remove PDF password protection locally before OCR.",
      );
    let text = "";
    const pages: Array<{ page: number; start: number; end: number }> = [];
    for (let page = 1; page <= count; page++) {
      const prefix = join(directory, `page-${page}`);
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
          prefix,
        ],
        remaining(),
        1000,
      );
      const image = prefix + ".png";
      if ((await stat(image)).size > limits.imageBytes)
        throw fail(
          "OCR_IMAGE_LIMIT",
          "The scanned page is too large to process.",
        );
      const result = (
        await command(
          "tesseract",
          [image, "stdout", "-l", "eng", "--psm", "3"],
          remaining(),
          160100,
        )
      ).trim();
      if (text.length + result.length + 2 > limits.characters)
        throw fail(
          "OCR_TEXT_LIMIT",
          "OCR text exceeds 40,000 characters. Use a shorter document.",
        );
      if (text) text += "\n\n";
      const start = text.length;
      text += result;
      pages.push({ page, start, end: text.length });
      await rm(image, { force: true });
    }
    if (!text.trim())
      throw fail(
        "OCR_NO_TEXT",
        "No readable text was found. Upload a clearer scan or paste the text.",
      );
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
      },
    };
  } finally {
    try {
      if (directory) await rm(directory, { recursive: true, force: true });
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

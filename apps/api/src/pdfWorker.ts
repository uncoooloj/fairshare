/** Untrusted PDF parsing subprocess. Never print document text to stderr or application logs. */
import { createHash } from "node:crypto";
const MAX_BYTES = 5 * 1024 * 1024,
  MAX_PAGES = 20,
  MAX_CHARS = 40000;
const respond = (value: unknown) => process.stdout.write(JSON.stringify(value));
let chunks: Buffer[] = [];
let size = 0;
try {
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error("PDF_TOO_LARGE");
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  chunks = [];
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-")))
    throw new Error("INVALID_PDF");
  // Warnings may contain source content. Suppress all parser console output; protocol uses stdout directly.
  console.log =
    console.warn =
    console.error =
    console.info =
    console.debug =
      () => {};
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    enableXfa: false,
    stopAtErrors: true,
    verbosity: 0,
    maxImageSize: 0,
    disableAutoFetch: true,
    disableStream: true,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    throw new Error(
      (e as { name?: string })?.name === "PasswordException"
        ? "PDF_PASSWORD_REQUIRED"
        : "INVALID_PDF",
    );
  }
  try {
    if (doc.numPages < 1 || doc.numPages > MAX_PAGES)
      throw new Error("PDF_PAGE_LIMIT");
    // Lines keep their geometry so the parent can rebuild paragraphs and offsets.
    type Line = {
      text: string;
      x: number;
      y: number;
      right: number;
      size: number;
    };
    const round = (value: number) => Math.round(value * 10) / 10;
    let characters = 0;
    const pages: Array<{ lines: Line[] }> = [];
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      const page = await doc.getPage(pageNo);
      const content = await page.getTextContent({
        disableNormalization: false,
      });
      const lines: Line[] = [];
      let current: Line | undefined;
      let endOfLine = false;
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const str = item.str.replace(
          /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,
          "",
        );
        if (characters + str.length + 1 > MAX_CHARS)
          throw new Error("PDF_TEXT_LIMIT");
        characters += str.length + 1;
        const [, , c = 0, d = 0, x = 0, y = 0] = item.transform as number[];
        const size = Math.hypot(c, d) || item.height || 1;
        const width = Number.isFinite(item.width) ? item.width : 0;
        if (str) {
          // Same baseline and no backwards jump: one visual line. Glyph runs split
          // at ligatures ("fi" + "fty") touch, so only a real gap becomes a space.
          if (
            current &&
            !endOfLine &&
            Math.abs(y - current.y) <= Math.max(size, current.size) * 0.5 &&
            x >= current.right - size * 0.5
          ) {
            const spaced =
              x - current.right > size * 0.15 &&
              !/\s$/.test(current.text) &&
              !/^\s/.test(str);
            current.text += (spaced ? " " : "") + str;
            current.right = Math.max(current.right, x + width);
            current.size = Math.max(current.size, size);
          } else {
            if (current) lines.push(current);
            current = { text: str, x, y, right: x + width, size };
          }
        }
        endOfLine = item.hasEOL || (endOfLine && !str);
      }
      if (current) lines.push(current);
      pages.push({
        lines: lines.map((line) => ({
          text: line.text,
          x: round(line.x),
          y: round(line.y),
          right: round(line.right),
          size: round(line.size),
        })),
      });
      page.cleanup();
    }
    const text = pages
      .flatMap((page) => page.lines.map((line) => line.text))
      .join("");
    if (!text.trim()) throw new Error("PDF_NO_EXTRACTABLE_TEXT");
    respond({
      ok: true,
      pages,
      sourceFileSha256: createHash("sha256").update(bytes).digest("hex"),
      extraction: {
        engine: "pdfjs-dist",
        version: "5.4.624",
        readingOrder: "PDF_TEXT_LAYER",
        offsetUnit: "UTF16_CODE_UNITS",
        ocr: false,
      },
    });
  } finally {
    await doc.destroy();
  }
} catch (e) {
  const allowed = new Set([
    "PDF_TOO_LARGE",
    "INVALID_PDF",
    "PDF_PASSWORD_REQUIRED",
    "PDF_PAGE_LIMIT",
    "PDF_TEXT_LIMIT",
    "PDF_NO_EXTRACTABLE_TEXT",
  ]);
  const code =
    e instanceof Error && allowed.has(e.message)
      ? e.message
      : "PDF_EXTRACTION_FAILED";
  respond({ ok: false, code });
}

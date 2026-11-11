/** How the Agreement tab shows the file: the real PDF pages, or the text we read. */
export enum DocumentViewMode {
  Pdf = "PDF",
  Text = "TEXT",
}
/** Where loading the original PDF got to in this browser. */
export enum PdfLoadState {
  Loading = "LOADING",
  Ready = "READY",
  Failed = "FAILED",
}

/** Real pages only for an uploaded PDF we still hold that loaded here.
 * Word files, pasted text, a failed load or a blocked worker show the text pages. */
export function documentViewMode({
  inputType,
  originalUrl,
  pdfState,
}: {
  inputType?: string;
  originalUrl?: string;
  pdfState: PdfLoadState;
}): DocumentViewMode {
  return inputType === "PDF" && originalUrl && pdfState !== PdfLoadState.Failed
    ? DocumentViewMode.Pdf
    : DocumentViewMode.Text;
}

/** Part of one pdf.js text item: characters [start, end) of item `item`. */
export interface ItemSpan {
  item: number;
  start: number;
  end: number;
}

interface Compact {
  text: string;
  /** For each compact character, the item and character it came from. */
  at: { item: number; offset: number }[];
}

/** PDF text and our extracted text differ in spacing, line breaks, quotes and
 * dashes. Compare without whitespace, lowercased, with those folded. */
function fold(char: string) {
  return char
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[\s­​]/g, "");
}

function compact(items: string[]): Compact {
  const result: Compact = { text: "", at: [] };
  items.forEach((value, item) => {
    for (let offset = 0; offset < value.length; offset++) {
      const folded = fold(value[offset]);
      for (const char of folded) {
        result.text += char;
        result.at.push({ item, offset });
      }
    }
  });
  return result;
}

/** Turn a compact range back into item spans, one per text item touched. */
function spansOf(source: Compact, from: number, to: number): ItemSpan[] {
  const spans: ItemSpan[] = [];
  for (let index = from; index < to; index++) {
    const { item, offset } = source.at[index];
    const last = spans.at(-1);
    if (last && last.item === item) last.end = offset + 1;
    else spans.push({ item, start: offset, end: offset + 1 });
  }
  return spans;
}

/** Shortest head/tail used when the full quote is not on the page (scans). */
const ANCHOR = 24;

/** Where a quote sits among one page's text items, or [] when it is not there.
 * Exact (ignoring spacing and case) first; then, best effort for scanned or
 * re-flowed text, the span from the quote's opening words to its closing ones. */
export function locateQuote(items: string[], quote: string): ItemSpan[] {
  const needle = compact([quote]).text;
  if (needle.length < 2) return [];
  const page = compact(items);
  const exact = page.text.indexOf(needle);
  if (exact >= 0) return spansOf(page, exact, exact + needle.length);
  if (needle.length < ANCHOR * 2) return [];
  const head = page.text.indexOf(needle.slice(0, ANCHOR));
  if (head < 0) return [];
  const tail = page.text.indexOf(needle.slice(-ANCHOR), head + ANCHOR);
  if (tail < 0 || tail + ANCHOR - head > needle.length * 1.5) return [];
  return spansOf(page, head, tail + ANCHOR);
}

/** Every case-insensitive occurrence of the search words on one page. */
export function locateAll(
  items: string[],
  query: string,
  limit = 200,
): ItemSpan[][] {
  const needle = compact([query]).text;
  if (needle.length < 2) return [];
  const page = compact(items);
  const found: ItemSpan[][] = [];
  for (
    let at = page.text.indexOf(needle);
    at !== -1 && found.length < limit;
    at = page.text.indexOf(needle, at + needle.length)
  )
    found.push(spansOf(page, at, at + needle.length));
  return found;
}

/** Pages to look on for a quote: the one we recorded first, then the rest. */
export function pageSearchOrder(pageCount: number, recorded?: number) {
  const all = Array.from({ length: pageCount }, (_, index) => index + 1);
  return recorded && recorded >= 1 && recorded <= pageCount
    ? [recorded, ...all.filter((page) => page !== recorded)]
    : all;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Join the boxes of one highlight that sit on the same line, so a clause reads
 * as one band per line rather than one per text item. */
export function mergeLineBoxes(boxes: Box[]): Box[] {
  const sorted = boxes
    .filter((box) => box.width > 0 && box.height > 0)
    .sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: Box[] = [];
  for (const box of sorted) {
    const line = lines.find(
      (item) =>
        Math.abs(item.top + item.height / 2 - (box.top + box.height / 2)) <
        Math.min(item.height, box.height) / 2,
    );
    if (!line) {
      lines.push({ ...box });
      continue;
    }
    const right = Math.max(line.left + line.width, box.left + box.width);
    const bottom = Math.max(line.top + line.height, box.top + box.height);
    line.left = Math.min(line.left, box.left);
    line.top = Math.min(line.top, box.top);
    line.width = right - line.left;
    line.height = bottom - line.top;
  }
  return lines;
}

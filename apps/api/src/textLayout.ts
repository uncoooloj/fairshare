/**
 * Turns positioned text lines (PDF text layer or OCR) into faithful plain text:
 * soft-wrapped lines are joined, paragraph gaps, headings and numbered clause
 * starts keep their own lines, and Unicode is normalized without changing
 * meaning-bearing characters such as §, curly quotes or currency symbols.
 */
export interface LayoutLine {
  text: string;
  /** Left edge, in page units. */
  x: number;
  /** Baseline or bottom edge; larger values are higher on the page. */
  y: number;
  /** Right edge, in page units. */
  right: number;
  /** Font size or line height, in page units. */
  size: number;
}

export interface TextRange {
  start: number;
  end: number;
}

export interface PageLayout {
  text: string;
  /** Offsets of each non-empty input line in `text`, aligned with `lineIndexes`. */
  lineRanges: TextRange[];
  lineIndexes: number[];
}

/** Line separators chosen between two consecutive lines. */
export enum LineJoin {
  SPACE = " ",
  HYPHEN = "",
  LINE_BREAK = "\n",
  PARAGRAPH_BREAK = "\n\n",
}

const LIGATURES = /[ﬀ-ﬆ]/g;
const INVISIBLE = /[­​-‍⁠﻿]/g;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const SPACES = /[\t  -   　]/g;

/**
 * NFKC only for typographic ligatures (ﬁ → fi). Full NFKC would also rewrite
 * characters a contract may rely on (½, ™, superscripts, ellipses), so the rest
 * of the text keeps its original code points.
 */
export function normalizeExtractedText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL, "")
    .replace(INVISIBLE, "")
    .replace(LIGATURES, (ligature) => ligature.normalize("NFKC"))
    .replace(SPACES, " ")
    .replace(/ {2,}/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Numbered clauses, lettered/roman sub-clauses, bullets and section labels. */
const BLOCK_START =
  /^(?:§+\s*\d|\d+(?:\.\d+)+\.?\s|\d+\.\s|\(?[a-z]\)\s|\((?:[ivx]+)\)\s|[•●▪◦‣∙·*–—-]\s)|^(?:ARTICLE|Article|SECTION|Section|CLAUSE|Clause|SCHEDULE|Schedule)\s+[\dIVX]+\b/;

export function startsBlock(text: string): boolean {
  return BLOCK_START.test(text);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function percentile(values: number[], fraction: number): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  ];
}

export function chooseJoin(
  prev: LayoutLine,
  cur: LayoutLine,
  page: { bodySize: number; lineGap: number; maxRight: number },
): LineJoin {
  const gap = prev.y - cur.y;
  // A larger vertical gap is a real paragraph break; moving up the page starts a new block.
  if (gap > page.lineGap * 1.35 || gap < -page.bodySize * 0.5)
    return LineJoin.PARAGRAPH_BREAK;
  // OCR line boxes vary with ascenders and descenders, so only a clear size
  // change (a heading) counts.
  const larger = Math.max(prev.size, cur.size, 1);
  if (Math.abs(prev.size - cur.size) > larger * 0.25)
    return LineJoin.LINE_BREAK;
  if (startsBlock(cur.text)) return LineJoin.LINE_BREAK;
  if (prev.size > page.bodySize * 1.25) return LineJoin.LINE_BREAK;
  // A soft wrap happens when the next word would not have fitted on the line.
  const firstWord = cur.text.split(" ", 1)[0] ?? "";
  const wordWidth = firstWord.length * cur.size * 0.45;
  if (prev.right + wordWidth < page.maxRight - page.bodySize)
    return LineJoin.LINE_BREAK;
  if (/\p{L}-$/u.test(prev.text) && /^\p{Ll}/u.test(cur.text))
    return LineJoin.HYPHEN;
  return LineJoin.SPACE;
}

/** Lines must be in reading order. Empty lines are dropped. */
export function layoutPage(input: LayoutLine[]): PageLayout {
  const lineIndexes: number[] = [];
  const lines: Array<LayoutLine & { softHyphenWrap: boolean }> = [];
  for (const [index, line] of input.entries()) {
    const softHyphenWrap = /\u00ad\s*$/.test(line.text);
    const text = normalizeExtractedText(line.text).replace(/\n/g, " ");
    if (!text) continue;
    lines.push({ ...line, text, softHyphenWrap });
    lineIndexes.push(index);
  }
  if (!lines.length) return { text: "", lineRanges: [], lineIndexes };
  const bodySize = median(lines.map((line) => line.size)) || 1;
  const bodyLines = lines.filter(
    (line) => Math.abs(line.size - bodySize) <= bodySize * 0.25,
  );
  const maxRight = Math.max(...bodyLines.map((line) => line.right));
  const gaps: number[] = [];
  for (let index = 1; index < lines.length; index++) {
    const gap = lines[index - 1].y - lines[index].y;
    if (gap > bodySize * 0.5) gaps.push(gap);
  }
  const lineGap = percentile(gaps, 0.25) ?? bodySize * 1.2;
  const page = { bodySize, lineGap, maxRight };
  let text = lines[0].text;
  const lineRanges: TextRange[] = [{ start: 0, end: text.length }];
  for (let index = 1; index < lines.length; index++) {
    const previous = lines[index - 1];
    const current = lines[index];
    const join =
      previous.softHyphenWrap && /^\p{L}/u.test(current.text)
        ? LineJoin.HYPHEN
        : chooseJoin(previous, current, page);
    text += join;
    const start = text.length;
    text += lines[index].text;
    lineRanges.push({ start, end: text.length });
  }
  return { text, lineRanges, lineIndexes };
}

import type { Source, Version } from "./model";
import { formatMoneyHeadline } from "./preferences";
import { highlightSegments, type SourceHighlight } from "./source-highlights";
export interface DocumentCitation {
  id: string;
  label: string;
  reference: Source;
  /** A caller-provided rule summary, used before a draft has a Version. */
  summary?: string;
  /** A question, not an agreed rule; use an attention treatment in both readers. */
  attention?: boolean;
  highlight?: SourceHighlight;
  page?: number;
  unavailable?: string;
}
/** Which saved quote a rule points at in the document. */
export enum CitationId {
  Rules = "rules-source",
  Advance = "advance-source",
}
/** Window event: a rule's clause chip asks the document to show that quote.
 * The listener calls preventDefault() once it has handled it. */
export const OPEN_CITATION_EVENT = "fairshare:open-citation";
/** A citation request may carry the version and document that produced it.
 * Older callers can continue to send the citation ID string alone. */
export interface OpenCitationDetail {
  id: string;
  versionId?: number;
  documentId?: string;
}
export function matchesCitationTarget(
  request: OpenCitationDetail,
  versionId: number | undefined,
  documentId: string,
) {
  return (
    (request.versionId === undefined || request.versionId === versionId) &&
    (request.documentId === undefined || request.documentId === documentId)
  );
}
type PageRange = { page: number; start: number; end: number };

/** Saved rules carry quotes, not extraction offsets. Only a unique exact quote is locatable. */
export function documentCitations(
  version: Version | undefined,
  document: {
    documentId: string;
    text: string;
    provenance?: { pages?: number | PageRange[] };
  },
): DocumentCitation[] {
  if (!version) return [];
  const references: { id: string; label: string; reference: Source }[] = [
    {
      id: CitationId.Rules,
      label: "Revenue rules",
      reference: version.rules.source,
    },
  ];
  if (version.rules.advance)
    references.push({
      id: CitationId.Advance,
      label: "Recoupment",
      reference: version.rules.advance.source,
    });
  return references.map((item): DocumentCitation => {
    const quote = item.reference.excerpt;
    if (item.reference.documentId !== document.documentId)
      return {
        ...item,
        unavailable: "This clause refers to a different document.",
      };
    if (!quote?.trim())
      return {
        ...item,
        unavailable: "No source quote was saved for this rule.",
      };
    const start = document.text.indexOf(quote);
    if (start < 0)
      return {
        ...item,
        unavailable: "This wording does not exactly match the saved document.",
      };
    if (document.text.indexOf(quote, start + 1) !== -1)
      return {
        ...item,
        unavailable:
          "This wording appears more than once. Check the clause in the document.",
      };
    const end = start + quote.length;
    const pages = document.provenance?.pages;
    const matches = Array.isArray(pages)
      ? pages.filter(
          (page) =>
            Number.isInteger(page.page) &&
            page.page > 0 &&
            Number.isInteger(page.start) &&
            Number.isInteger(page.end) &&
            page.start >= 0 &&
            page.end > page.start &&
            page.end <= document.text.length &&
            page.start <= start &&
            page.end >= end,
        )
      : [];
    return {
      ...item,
      highlight: {
        id: item.id,
        label: item.label,
        kind: "SAVED_RULE",
        rawValue: quote,
        quote,
        start,
        end,
      },
      ...(matches.length === 1 ? { page: matches[0].page } : {}),
    };
  });
}

/** Where a saved rule came from. Only clauses from the file are citations. */
export enum SourceOrigin {
  Document = "SOURCE_CLAUSE",
  Team = "HUMAN_PROPOSAL",
}

export const fromDocument = (citation: DocumentCitation) =>
  citation.reference.origin !== SourceOrigin.Team;

/** "4.2" from "Clause 4.2", "§ 4.2" or "Section 4.2". */
export function clauseLabel(clause: string) {
  return clause.replace(/^(clause|section|§)\s*/i, "").trim();
}

/** One plain line per cited rule, in the words the rules card uses. */
export function citationSummary(
  id: string,
  version: Version,
  nameOf: (userId: string) => string,
) {
  const { rules } = version;
  if (id === CitationId.Advance && rules.advance)
    return `${nameOf(rules.advance.recipientId)}'s ${formatMoneyHeadline(
      rules.advance.amountCents,
    )} advance is paid back first`;
  const after = rules.advance ? " after the advance is paid back" : "";
  if (rules.shares.length === 1)
    return `${nameOf(rules.shares[0].userId)} gets ${
      rules.shares[0].basisPoints / 100
    }%${after}`;
  return `Split ${rules.shares
    .map((share) => share.basisPoints / 100)
    .join(" / ")}${after}`;
}

export interface DocumentPage {
  page: number;
  start: number;
  end: number;
}

/** Real page ranges when the file had them; otherwise the whole text is one page. */
export function documentPages(
  text: string,
  pages?: number | PageRange[],
): { pages: DocumentPage[]; paged: boolean } {
  const valid = Array.isArray(pages)
    ? pages
        .filter(
          (page) =>
            Number.isInteger(page.page) &&
            page.page > 0 &&
            Number.isInteger(page.start) &&
            Number.isInteger(page.end) &&
            page.start >= 0 &&
            page.end >= page.start &&
            page.end <= text.length,
        )
        .sort((a, b) => a.start - b.start)
    : [];
  const overlapping = valid.some(
    (page, index) => index > 0 && page.start < valid[index - 1].end,
  );
  if (valid.length && !overlapping)
    return {
      pages: valid.map(({ page, start, end }) => ({ page, start, end })),
      paged: true,
    };
  return { pages: [{ page: 1, start: 0, end: text.length }], paged: false };
}

/** Index of the page holding this offset, or -1. */
export function pageIndexOf(pages: DocumentPage[], offset: number) {
  return pages.findIndex((page) => offset >= page.start && offset < page.end);
}

/** Every case-insensitive match of the search words, as highlights. */
export function searchHighlights(
  text: string,
  query: string,
): SourceHighlight[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  const haystack = text.toLowerCase();
  const found: SourceHighlight[] = [];
  for (
    let at = haystack.indexOf(needle);
    at !== -1 && found.length < 500;
    at = haystack.indexOf(needle, at + needle.length)
  )
    found.push({
      id: `${SEARCH_PREFIX}${found.length}`,
      label: query,
      kind: "SEARCH",
      rawValue: query,
      quote: text.slice(at, at + needle.length),
      start: at,
      end: at + needle.length,
    });
  return found;
}
export const SEARCH_PREFIX = "search-";

export interface PageBlock {
  start: number;
  segments: { start: number; text: string; ids: string[] }[];
}

/** A page as paragraphs (one per line), each split where a highlight starts or ends. */
export function pageBlocks(
  text: string,
  page: DocumentPage,
  highlights: SourceHighlight[],
): PageBlock[] {
  const blocks: PageBlock[] = [];
  let start = page.start;
  for (const line of text.slice(page.start, page.end).split("\n")) {
    const end = start + line.length;
    if (line.trim()) {
      const local = highlights
        .filter((item) => item.start < end && item.end > start)
        .map((item) => ({
          ...item,
          start: Math.max(item.start, start) - start,
          end: Math.min(item.end, end) - start,
        }));
      blocks.push({
        start,
        segments: highlightSegments(line, local).map((segment) => ({
          ...segment,
          start: segment.start + start,
        })),
      });
    }
    start = end + 1;
  }
  return blocks;
}

/** Cycle every clause owning the clicked segment, including nested/overlapping questions. */
export function nextCitationId(
  ids: string[],
  selected: string | null,
): string | undefined {
  const clauses = ids.filter((id) => !id.startsWith(SEARCH_PREFIX));
  return clauses.length
    ? clauses[(clauses.indexOf(selected ?? "") + 1) % clauses.length]
    : undefined;
}

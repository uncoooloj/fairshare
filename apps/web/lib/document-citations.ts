import type { Source, Version } from "./model";
import type { SourceHighlight } from "./source-highlights";
export interface DocumentCitation {
  id: string;
  label: string;
  reference: Source;
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

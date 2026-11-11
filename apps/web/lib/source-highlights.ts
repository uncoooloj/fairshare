export interface SourceHighlight {
  id: string;
  label: string;
  kind: string;
  rawValue: string;
  quote: string;
  start: number;
  end: number;
}
/** Only exact ranges in this saved document may be presented as source evidence. */
export function sourceHighlights(
  extraction: unknown,
  documentId: string,
  source: string,
): SourceHighlight[] {
  const result: SourceHighlight[] = [];
  const data = extraction as any;
  if (
    !data ||
    data.documentId !== documentId ||
    data.status !== "REVIEW_REQUIRED" ||
    data.requiresHumanReview !== true ||
    data.executable !== false
  )
    return result;
  for (const [index, fact] of (Array.isArray(data.facts)
    ? data.facts
    : []
  ).entries()) {
    const citation = fact?.citation;
    if (
      !citation ||
      !Number.isInteger(citation.start) ||
      !Number.isInteger(citation.end) ||
      citation.start < 0 ||
      citation.end <= citation.start ||
      citation.end > source.length ||
      typeof citation.quote !== "string" ||
      source.slice(citation.start, citation.end) !== citation.quote ||
      typeof fact.kind !== "string" ||
      typeof fact.subject !== "string" ||
      typeof fact.rawValue !== "string"
    )
      continue;
    result.push({
      id: `fact-${index}`,
      label: fact.subject,
      kind: fact.kind,
      rawValue: fact.rawValue,
      quote: citation.quote,
      start: citation.start,
      end: citation.end,
    });
  }
  return result;
}
/** Non-overlapping segments keep overlapping/shared citations clickable without duplicating text. */
export function highlightSegments(
  source: string,
  highlights: SourceHighlight[],
) {
  const boundaries = [
    ...new Set([
      0,
      source.length,
      ...highlights.flatMap((item) => [item.start, item.end]),
    ]),
  ].sort((a, b) => a - b);
  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    return {
      start,
      text: source.slice(start, end),
      ids: highlights
        .filter((item) => item.start <= start && item.end >= end)
        .map((item) => item.id),
    };
  });
}

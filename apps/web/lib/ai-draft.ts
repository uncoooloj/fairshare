import { parseShare, type Member } from "./model";

/** Only prepare source-bound, exact-name matches. This never saves/approves rules. */
export function suggestedShares(
  extraction: unknown,
  documentId: string,
  source: string,
  members: Member[],
): Record<string, string> {
  const e = extraction as any;
  if (
    !e ||
    e.status !== "REVIEW_REQUIRED" ||
    e.documentId !== documentId ||
    e.requiresHumanReview !== true ||
    e.executable !== false ||
    !Array.isArray(e.facts)
  )
    return {};
  const candidates = new Map<string, string[]>();
  for (const f of e.facts) {
    if (
      f?.kind !== "SHARE" ||
      typeof f.subject !== "string" ||
      typeof f.rawValue !== "string"
    )
      continue;
    const c = f.citation;
    if (
      !c ||
      !Number.isInteger(c.start) ||
      !Number.isInteger(c.end) ||
      c.start < 0 ||
      c.end <= c.start ||
      typeof c.quote !== "string" ||
      source.slice(c.start, c.end) !== c.quote ||
      !c.quote.includes(f.subject) ||
      !c.quote.includes(f.rawValue)
    )
      continue;
    const match = members.filter(
      (m) =>
        m.displayName.trim().toLocaleLowerCase() ===
        f.subject.trim().toLocaleLowerCase(),
    );
    if (match.length !== 1 || !/^\d+(\.\d{1,2})?%$/.test(f.rawValue)) continue;
    const value = f.rawValue.slice(0, -1);
    try {
      parseShare(value);
    } catch {
      continue;
    }
    const id = match[0].userId;
    candidates.set(id, [...(candidates.get(id) || []), value]);
  }
  // Duplicate/conflicting facts require manual review, even when numbers agree.
  return Object.fromEntries(
    [...candidates]
      .filter(([, values]) => values.length === 1)
      .map(([id, values]) => [id, values[0]]),
  );
}

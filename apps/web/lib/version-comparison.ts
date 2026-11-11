import type { Rules } from "./model";

export type ComparisonField =
  | "shares"
  | "fees"
  | "advance"
  | "source"
  | "questions";
const canonical = (value: unknown) => JSON.stringify(value);
const source = (value: Rules["source"]) => [
  value.documentId,
  value.clause,
  value.excerpt,
  value.origin,
];

/** Compare meaning, not object-key or participant display order. */
export function changedRuleFields(
  before: Rules,
  after: Rules,
): ComparisonField[] {
  const values = (rules: Rules) => ({
    shares: [...rules.shares]
      .map(({ userId, basisPoints }) => [userId, basisPoints])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    fees: [
      rules.feePolicy,
      rules.feePolicy === "BEFORE_SPLIT" ? null : (rules.feeBearerId ?? null),
    ],
    advance: rules.advance
      ? [
          rules.advance.id,
          rules.advance.recipientId,
          rules.advance.amountCents,
          rules.advance.verified,
          source(rules.advance.source),
        ]
      : null,
    source: source(rules.source),
    questions: [...new Set(rules.unresolvedQuestions)].sort(),
  });
  const left = values(before),
    right = values(after);
  return (Object.keys(left) as ComparisonField[]).filter(
    (field) => canonical(left[field]) !== canonical(right[field]),
  );
}

export function changedShares(before: Rules, after: Rules) {
  const ids = new Set(
    [...before.shares, ...after.shares].map((share) => share.userId),
  );
  return [...ids].flatMap((userId) => {
    const previous = before.shares.find(
      (share) => share.userId === userId,
    )?.basisPoints;
    const next = after.shares.find(
      (share) => share.userId === userId,
    )?.basisPoints;
    return previous === next ? [] : [{ userId, before: previous, after: next }];
  });
}

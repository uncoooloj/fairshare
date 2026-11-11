export type TermsStep = 0 | 1 | 2;
/** Proposed rules opens first only for a saved source that already has a suggestion. */
export function initialTermsStep(
  documentId: string,
  hasSuggestion = false,
): TermsStep {
  if (!documentId) return 0;
  return hasSuggestion ? 2 : 1;
}
export function nextTermsStep(
  step: TermsStep,
  sourceSaved: boolean,
): TermsStep {
  if (!sourceSaved) return 0;
  return Math.min(step + 1, 2) as TermsStep;
}

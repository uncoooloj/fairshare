export type TermsStep = 0 | 1 | 2;
export function initialTermsStep(documentId: string): TermsStep {
  return documentId ? 1 : 0;
}
export function nextTermsStep(
  step: TermsStep,
  sourceSaved: boolean,
): TermsStep {
  if (!sourceSaved) return 0;
  return Math.min(step + 1, 2) as TermsStep;
}

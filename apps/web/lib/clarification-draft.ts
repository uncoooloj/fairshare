/** Extraction issues are non-executable suggestions. They must never disappear
 * merely because the proposal form was opened before an AI response arrived. */
export function extractionQuestions(extraction: unknown, documentId: string): string[] {
  const value = extraction as {documentId?:unknown;status?:unknown;requiresHumanReview?:unknown;executable?:unknown;issues?:unknown} | null;
  if (!value || value.documentId !== documentId || value.status !== 'REVIEW_REQUIRED' || value.requiresHumanReview !== true || value.executable !== false || !Array.isArray(value.issues)) return [];
  return [...new Set(value.issues.flatMap((issue:unknown)=> {
    const question = (issue as {question?:unknown} | null)?.question;
    return typeof question === 'string' && question.trim() ? [question.trim()] : [];
  }))];
}

export function proposalQuestions(manual: string, extraction: unknown, documentId: string, resolved: Set<string>): string[] {
  return [...new Set([...manual.split('\n').map(value=>value.trim()).filter(Boolean), ...extractionQuestions(extraction,documentId).filter(question=>!resolved.has(question))])];
}

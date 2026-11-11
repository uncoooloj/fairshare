import { api } from "./model";
import { workspaceBase } from "./workspace-base";

export enum ReadingOutcome {
  READY = "ready",
  MANUAL = "manual",
}

export enum ReadingPhase {
  RUNNING = "running",
  DONE = "done",
  FALLBACK = "fallback",
}

export enum ReadingStepStatus {
  DONE = "done",
  ACTIVE = "active",
  PENDING = "pending",
}

export const READING_STEPS = [
  "Reading document",
  "Finding revenue clauses",
  "Building rules",
  "Checking for ambiguities",
] as const;

/** Timer-driven progress may reach the last step but never complete it. */
export function nextActiveStep(active: number): number {
  return Math.min(active + 1, READING_STEPS.length - 1);
}

export function readingStepStatus(
  index: number,
  active: number,
  phase: ReadingPhase,
): ReadingStepStatus {
  if (phase === ReadingPhase.DONE) return ReadingStepStatus.DONE;
  if (index < active) return ReadingStepStatus.DONE;
  if (index === active && phase === ReadingPhase.RUNNING)
    return ReadingStepStatus.ACTIVE;
  return ReadingStepStatus.PENDING;
}

export function readingAnnouncement(
  active: number,
  phase: ReadingPhase,
): string {
  if (phase === ReadingPhase.DONE) return "Finished reading your agreement.";
  if (phase === ReadingPhase.FALLBACK)
    return "We couldn't read every term. You can add them yourself.";
  return `${READING_STEPS[active]}, step ${active + 1} of ${READING_STEPS.length}.`;
}

/** Same shape the API returns from POST .../documents/:documentId/extract. */
export interface ExtractionResponse {
  status?: string;
  reason?: string | null;
  requiresHumanReview?: boolean;
  executable?: boolean;
  facts?: { citation?: { quote?: unknown } | null }[];
  issues?: unknown[];
  [key: string]: unknown;
}

/**
 * READY only for a reviewable, non-executable suggestion with at least one fact, where every fact cites
 * the source. Anything else (MANUAL_REQUIRED, a fallback reason, no facts, missing citations) is MANUAL.
 */
export function extractionOutcome(
  extraction: ExtractionResponse | null | undefined,
): ReadingOutcome {
  if (!extraction) return ReadingOutcome.MANUAL;
  const facts = Array.isArray(extraction.facts) ? extraction.facts : [];
  const ready =
    extraction.status === "REVIEW_REQUIRED" &&
    !extraction.reason &&
    extraction.requiresHumanReview === true &&
    extraction.executable === false &&
    facts.length > 0 &&
    facts.every(
      (fact) =>
        typeof fact?.citation?.quote === "string" &&
        fact.citation.quote.trim().length > 0,
    );
  return ready ? ReadingOutcome.READY : ReadingOutcome.MANUAL;
}

/**
 * Runs the existing AI extraction for a saved document. Call only after the user ticked the AI consent
 * checkbox; the server rejects requests without `consentToCloudflare: true`. Extraction only stores a
 * suggestion on the document; it never creates or activates rules. API errors are thrown.
 */
export async function readAgreement({
  workspaceId,
  agreementId,
  documentId,
  consent,
}: {
  workspaceId: string;
  agreementId: string;
  documentId: string;
  consent: boolean;
}): Promise<{ outcome: ReadingOutcome; extraction: ExtractionResponse }> {
  if (consent !== true)
    throw new Error("Confirm Fairshare can read this agreement first.");
  const extraction = await api<ExtractionResponse>(
    `${workspaceBase(workspaceId)}/collaborations/${agreementId}/documents/${documentId}/extract`,
    "POST",
    { consentToCloudflare: true },
  );
  return { outcome: extractionOutcome(extraction), extraction };
}

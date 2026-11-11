import { api, type Member } from "./model";
import { DraftStatus, extractionDraft, RulesSection } from "./ai-draft";
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
  "Reading the document",
  "Finding who gets paid",
  "Working out the split",
  "Checking for anything unclear",
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
    return "We couldn't read the split. Let's set it up together.";
  return `${READING_STEPS[active]}, step ${active + 1} of ${READING_STEPS.length}.`;
}

/** Same shape the API returns from POST .../documents/:documentId/extract. */
export interface ExtractionResponse {
  status?: string;
  documentId?: string;
  reason?: string | null;
  requiresHumanReview?: boolean;
  executable?: boolean;
  facts?: { citation?: { quote?: unknown } | null }[];
  issues?: unknown[];
  sections?: Record<string, { status?: string } | undefined>;
  [key: string]: unknown;
}

export interface ReadingContext {
  /** Saved source text; null skips the exact-range re-check (the server already did it). */
  source: string | null;
  /** Agreement members, or null when people are not set up yet (upload-first). */
  members: Member[] | null;
}

/**
 * READY when at least the split can be SHOWN: the server read it from sentence-level quotes, the
 * shares add up to 100% and, when members are known, every name maps to one member. Anything else
 * (MANUAL_REQUIRED, a fallback reason, an unread or ambiguous split) is MANUAL, and the flow asks.
 */
export function extractionOutcome(
  extraction: ExtractionResponse | null | undefined,
  context: ReadingContext = { source: null, members: null },
): ReadingOutcome {
  if (!extraction || extraction.reason) return ReadingOutcome.MANUAL;
  const draft = extractionDraft(
    extraction,
    typeof extraction.documentId === "string" ? extraction.documentId : "",
    context.source,
    context.members,
  );
  return draft.sections[RulesSection.SPLIT].status === DraftStatus.SHOWN
    ? ReadingOutcome.READY
    : ReadingOutcome.MANUAL;
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
  context,
}: {
  workspaceId: string;
  agreementId: string;
  documentId: string;
  consent: boolean;
  context?: ReadingContext;
}): Promise<{ outcome: ReadingOutcome; extraction: ExtractionResponse }> {
  if (consent !== true)
    throw new Error("Confirm Fairshare can read this agreement first.");
  const extraction = await api<ExtractionResponse>(
    `${workspaceBase(workspaceId)}/collaborations/${agreementId}/documents/${documentId}/extract`,
    "POST",
    { consentToCloudflare: true },
  );
  return { outcome: extractionOutcome(extraction, context), extraction };
}

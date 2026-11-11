import {
  createCollaboration,
  proposeVersion,
  previewVersion,
  FeePolicy,
  DomainError,
  type Member,
  type AgreementVersion,
  type Rules as DomainRules,
} from "../../../packages/domain/src/index";
import { parseCents, parseShare, type Agreement, type Rules } from "./model";

export const isRulesDraftChange = (
  target: { dataset?: { illustrative?: string } } | null,
) => target?.dataset?.illustrative !== "true";

/** Read only supported financial terms. Never infer missing shares or advances. */
export function impactDraft(
  agreement: Agreement,
  form: FormData,
  advance: boolean,
): Rules {
  const source = {
    origin: "HUMAN_PROPOSAL",
    documentId: "illustration",
    clause: "Illustrative comparison",
    excerpt: "Unsaved draft comparison, not an approved agreement.",
  };
  const oldAdvance = agreement.value.versions.at(-1)?.rules.advance;
  return {
    currency: "USD",
    feePolicy: "BEFORE_SPLIT",
    source,
    unresolvedQuestions: [],
    shares: agreement.value.members.map((member) => ({
      userId: member.userId,
      basisPoints: parseShare(String(form.get(member.userId) ?? "")),
    })),
    ...(advance
      ? {
          advance: {
            id: oldAdvance?.id ?? "illustrative-advance",
            recipientId: String(form.get("recipient") ?? ""),
            amountCents: parseCents(String(form.get("advance") ?? "")),
            verified: form.get("verified") === "on",
            source,
          },
        }
      : {}),
  };
}

/** Uses the same exact-cent engine as settlement, on a detached scratch aggregate. */
export function compareFeePolicies(
  agreement: Agreement,
  draft: Rules,
  grossCents: number,
  feeCents: number,
) {
  const organizer = agreement.value.members.find(
    (member) => member.role === "ORGANIZER",
  );
  if (!organizer)
    throw new Error("An organizer is required to compare fee policies.");
  const scratch = createCollaboration(
    {
      id: agreement.id,
      name: agreement.value.name,
      members: agreement.value.members as Member[],
    },
    organizer.userId,
    "2000-01-01T00:00:00Z",
  );
  // Keep prior advance identities so the preview rejects amendments settlement rejects.
  scratch.versions = agreement.value.versions.map((version) => ({
    ...structuredClone(version),
    createdAt: "2000-01-01T00:00:00Z",
  })) as AgreementVersion[];
  scratch.recoupedByAdvance = structuredClone(
    agreement.value.recoupedByAdvance,
  );
  return [FeePolicy.BEFORE_SPLIT, FeePolicy.ORGANIZER_SHARE].map((policy) => {
    const rules = {
      ...draft,
      feePolicy: policy,
      feeBearerId:
        policy === FeePolicy.ORGANIZER_SHARE ? organizer.userId : undefined,
    } as DomainRules;
    const proposed = proposeVersion(
      scratch,
      rules,
      organizer.userId,
      "2000-01-01T00:00:00Z",
    );
    try {
      return {
        policy,
        preview: previewVersion(
          proposed,
          proposed.versions.at(-1)!.id,
          { grossCents, feeCents },
          organizer.userId,
        ),
        error: null,
      };
    } catch (error) {
      if (error instanceof DomainError && error.code === "FEE_EXCEEDS_SHARE") {
        return { policy, preview: null, error: error.message };
      }
      throw error;
    }
  });
}

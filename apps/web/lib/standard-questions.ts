import {
  AnswerSource,
  FeeChoice,
  exampleSplit,
  type AgreementAnswers,
  type Question,
  type QuestionChoice,
} from "./rules-answers";

/** Ids of the questions with a fixed meaning. Fees are only asked when the document wants
 * something Fairshare can't do; refunds are never asked (any refund pauses payouts while
 * it's checked), the id stays so older saved drafts drop it cleanly. */
export enum StandardQuestionId {
  FEES = "fees",
  REFUNDS = "refunds",
}

export const MAX_QUESTIONS = 3;
/** The spec's example payment and the matching PayPal fee ($105 on $3,000). */
export const SAMPLE_GROSS_CENTS = 300_000;
const FEE_RATE = 0.035;

/** PayPal-style fee for a sample payment, so a changed sample keeps the same ratio. */
export function sampleFeeCents(grossCents: number): number {
  return Math.round(grossCents * FEE_RATE);
}

function organizerName(answers: AgreementAnswers): string {
  const self = answers.people.value.find((p) => p.isSelf);
  return self?.name.trim().split(/\s+/)[0] || "You";
}

const fromPerson = <T>(value: T) => ({ value, source: AnswerSource.PERSON });

export function feeQuestion(answers: AgreementAnswers): Question {
  const organizer = organizerName(answers);
  const choice = (
    value: FeeChoice,
    label: string,
    explanation: string,
  ): QuestionChoice => ({
    id: value,
    label,
    explanation,
    apply: (a) => {
      if (value !== FeeChoice.ORGANIZER_SHARE)
        return { ...a, fees: fromPerson(value) };
      // A new answer selects today's organizer, so the old bearer must not be
      // reused by the Check or Send copy while the rules use the new one.
      const { feeBearerId: _priorBearer, ...next } = a;
      return {
        ...next,
        fees: fromPerson(value),
        feeBearerChoice: "ORGANIZER",
      };
    },
  });
  return {
    id: StandardQuestionId.FEES,
    text: "Who covers the PayPal fee?",
    choices: [
      choice(
        FeeChoice.BEFORE_SPLIT,
        "Everyone, before the split (most common)",
        "The fee comes off the top, then the rest is split.",
      ),
      choice(
        FeeChoice.ORGANIZER_SHARE,
        `${organizer} covers it from their share`,
        `Everyone else gets their full share. The fee comes out of ${organizer}'s.`,
      ),
    ],
  };
}

export interface PersonEffect {
  key: string;
  name: string;
  cents: number;
}

/** What each person is owed on a sample payment after applying a choice (via the real split maths). */
export function choiceEffect(
  answers: AgreementAnswers,
  choice: QuestionChoice,
  grossCents: number,
  feeCents = sampleFeeCents(grossCents),
): PersonEffect[] | undefined {
  try {
    return exampleSplit(choice.apply(answers), grossCents, feeCents);
  } catch {
    return undefined;
  }
}

const isStandard = (id: string) =>
  (Object.values(StandardQuestionId) as string[]).includes(id);

/** True when the choices lead to different dollars for someone. */
export function changesMoney(
  answers: AgreementAnswers,
  question: Question,
): boolean {
  if (isStandard(question.id)) return true;
  const outcomes = question.choices.map((c) =>
    JSON.stringify(choiceEffect(answers, c, SAMPLE_GROSS_CENTS) ?? null),
  );
  return new Set(outcomes).size > 1;
}

/**
 * The questions after Check: only what the document raised that Fairshare can't settle on
 * its own (fees default to before the split; refunds are never asked), money-relevant
 * first, at most three.
 */
export function questionsFor(
  answers: AgreementAnswers,
  extractedIssues: Question[] = [],
): Question[] {
  const all: Question[] = [];
  const seen = new Set<string>();
  for (const q of extractedIssues) {
    if (!q.choices.length || seen.has(q.id)) continue;
    if (q.id === StandardQuestionId.REFUNDS) continue;
    if (
      q.id === StandardQuestionId.FEES &&
      answers.fees &&
      !q.requiresExplicitAnswer
    )
      continue;
    seen.add(q.id);
    all.push(q);
  }
  const money = all.filter((q) => changesMoney(answers, q));
  const other = all.filter((q) => !money.includes(q));
  return [...money, ...other].slice(0, MAX_QUESTIONS);
}

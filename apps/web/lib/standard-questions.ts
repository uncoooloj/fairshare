import {
  AnswerSource,
  FeeChoice,
  RefundChoice,
  exampleSplit,
  type AgreementAnswers,
  type Question,
  type QuestionChoice,
} from "./rules-answers";

/** Ids of the questions Fairshare asks itself when the document is silent or unclear. */
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

function advanceRecipientName(answers: AgreementAnswers): string | undefined {
  const advance = answers.advance?.value;
  if (!advance) return undefined;
  const person = answers.people.value.find(
    (p) => p.key === advance.recipientKey,
  );
  return person?.name.trim().split(/\s+/)[0];
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
    apply: (a) => ({ ...a, fees: fromPerson(value) }),
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

/** Only makes sense when someone is paid back first; otherwise every refund comes off the split. */
export function refundQuestion(
  answers: AgreementAnswers,
): Question | undefined {
  const recipient = advanceRecipientName(answers);
  if (!recipient) return undefined;
  const choice = (
    value: RefundChoice,
    label: string,
    explanation: string,
  ): QuestionChoice => ({
    id: value,
    label,
    explanation,
    apply: (a) => ({ ...a, refunds: fromPerson(value) }),
  });
  return {
    id: StandardQuestionId.REFUNDS,
    text: "Do refunds come off the advance or the split?",
    choices: [
      choice(
        RefundChoice.SPLIT,
        "Off the split",
        "Everyone shares a refund by their split.",
      ),
      choice(
        RefundChoice.ADVANCE,
        "Off the advance",
        `A refund counts against ${recipient}'s advance.`,
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
 * The questions for step 4: fees and refunds when the answers don't settle them, plus
 * extracted issues (already shaped as Questions), money-relevant first, at most three.
 */
export function questionsFor(
  answers: AgreementAnswers,
  extractedIssues: Question[] = [],
): Question[] {
  const all: Question[] = [];
  const seen = new Set<string>();
  const add = (q: Question | undefined) => {
    if (!q || seen.has(q.id)) return;
    seen.add(q.id);
    all.push(q);
  };
  const standard: Question[] = [];
  if (!answers.fees) standard.push(feeQuestion(answers));
  if (!answers.refunds) {
    const refunds = refundQuestion(answers);
    if (refunds) standard.push(refunds);
  }
  // An extracted question on the same subject wins when it has its own choices;
  // otherwise only its quote and clause carry over onto the standard one.
  for (const q of standard) {
    const extracted = extractedIssues.find((e) => e.id === q.id);
    add(
      extracted?.choices.length
        ? extracted
        : extracted
          ? { ...q, quote: extracted.quote, clause: extracted.clause }
          : q,
    );
  }
  for (const q of extractedIssues) {
    if (!q.choices.length) continue;
    if (q.id === StandardQuestionId.FEES && answers.fees) continue;
    if (q.id === StandardQuestionId.REFUNDS && answers.refunds) continue;
    add(q);
  }
  const money = all.filter((q) => changesMoney(answers, q));
  const other = all.filter((q) => !money.includes(q));
  return [...money, ...other].slice(0, MAX_QUESTIONS);
}

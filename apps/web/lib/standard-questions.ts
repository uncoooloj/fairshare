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
/** The refund used to show who loses how much. */
export const SAMPLE_REFUND_CENTS = 10_000;

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
        "Everyone's share shrinks a little.",
      ),
      choice(
        RefundChoice.ADVANCE,
        "Off the advance",
        `${recipient} gets paid back less.`,
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

/**
 * Who loses how much on a refund (negative cents). Off the split: shared by percentage,
 * using the same split maths with no advance or fee. Off the advance: the person paid back first.
 */
export function refundEffect(
  answers: AgreementAnswers,
  choice: QuestionChoice,
  refundCents = SAMPLE_REFUND_CENTS,
): PersonEffect[] | undefined {
  const applied = choice.apply(answers);
  if (applied.refunds?.value === RefundChoice.ADVANCE) {
    const advance = applied.advance?.value;
    const person = applied.people.value.find(
      (p) => p.key === advance?.recipientKey,
    );
    if (!person) return undefined;
    return [{ key: person.key, name: person.name, cents: -refundCents }];
  }
  try {
    return exampleSplit(
      {
        ...applied,
        advance: undefined,
        fees: fromPerson(FeeChoice.BEFORE_SPLIT),
      },
      refundCents,
      0,
    )
      .filter((row) => row.cents !== 0)
      .map((row) => ({ ...row, cents: -row.cents }));
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
  // An extracted issue on the same subject keeps its quote and clause.
  for (const q of standard) {
    const extracted = extractedIssues.find((e) => e.id === q.id);
    add(
      extracted
        ? { ...q, quote: extracted.quote, clause: extracted.clause }
        : q,
    );
  }
  for (const q of extractedIssues) {
    if (q.id === StandardQuestionId.FEES && answers.fees) continue;
    if (q.id === StandardQuestionId.REFUNDS && answers.refunds) continue;
    add(q);
  }
  const money = all.filter((q) => changesMoney(answers, q));
  const other = all.filter((q) => !money.includes(q));
  return [...money, ...other].slice(0, MAX_QUESTIONS);
}

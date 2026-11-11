import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AnswerSource,
  FeeChoice,
  type AgreementAnswers,
  type Question,
} from "../lib/rules-answers";
import {
  StandardQuestionId,
  choiceEffect,
  feeQuestion,
  questionsFor,
  sampleFeeCents,
} from "../lib/standard-questions";
import {
  WizardQuestionsStep,
  answerQuestion,
} from "../components/wizard-questions-step";

const doc = <T>(value: T) => ({ value, source: AnswerSource.DOCUMENT });

function midnight(overrides: Partial<AgreementAnswers> = {}): AgreementAnswers {
  return {
    name: doc("Midnight Sessions"),
    people: doc([
      { key: "maya", name: "Maya Okafor", basisPoints: 5000, isSelf: true },
      { key: "jordan", name: "Jordan Reyes", basisPoints: 3000, isSelf: false },
      { key: "riley", name: "Riley Chen", basisPoints: 2000, isSelf: false },
    ]),
    advance: doc({ recipientKey: "maya", amountCents: 200_000 }),
    questions: [],
    ...overrides,
  };
}

const byKey = (rows: { key: string; cents: number }[] | undefined) =>
  Object.fromEntries((rows ?? []).map((r) => [r.key, r.cents]));

/** The fee question as the reading raises it when the document wants someone we can't charge. */
const cantCharge = (a: AgreementAnswers): Question => ({
  ...feeQuestion(a),
  text: "We can't have Jordan pay the PayPal fee yet. Who covers it?",
});

test("nothing is asked on its own: fees default to before the split, refunds never", () => {
  assert.deepEqual(questionsFor(midnight()), []);
  assert.deepEqual(questionsFor(midnight({ advance: undefined })), []);
  const fees = feeQuestion(midnight());
  assert.equal(fees.text, "Who covers the PayPal fee?");
  assert.deepEqual(
    fees.choices.map((c) => c.id),
    [FeeChoice.BEFORE_SPLIT, FeeChoice.ORGANIZER_SHARE],
  );
  assert.equal(fees.choices[1].label, "Maya covers it from their share");
});

test("extracted issues are capped at three, money questions first; refunds dropped", () => {
  const wordOnly: Question = {
    id: "credit",
    text: "How should the credits read?",
    choices: [
      { id: "a", label: "A", explanation: "", apply: (a) => a },
      { id: "b", label: "B", explanation: "", apply: (a) => a },
    ],
  };
  const money: Question = {
    id: "net",
    text: "What counts as the money to split?",
    quote: "less applicable costs",
    clause: "§ 4.3",
    choices: [
      {
        id: "all",
        label: "Everything",
        explanation: "",
        apply: (a) => ({ ...a, fees: doc(FeeChoice.BEFORE_SPLIT) }),
      },
      {
        id: "maya",
        label: "Maya pays",
        explanation: "",
        apply: (a) => ({ ...a, fees: doc(FeeChoice.ORGANIZER_SHARE) }),
      },
    ],
  };
  const refunds: Question = {
    id: StandardQuestionId.REFUNDS,
    text: "Refunds?",
    quote: "Refunds shall be deducted from future Net Revenue.",
    choices: money.choices,
  };
  const fees = cantCharge(midnight());
  assert.deepEqual(
    questionsFor(midnight(), [wordOnly, money, refunds, fees]).map((q) => q.id),
    ["net", StandardQuestionId.FEES, "credit"],
  );
  // Fees already settled: the fee question goes.
  assert.deepEqual(
    questionsFor(midnight({ fees: doc(FeeChoice.BEFORE_SPLIT) }), [
      wordOnly,
      fees,
    ]).map((q) => q.id),
    ["credit"],
  );
});

test("fee choices show real dollars on $3,000 with a $105 fee", () => {
  const answers = midnight();
  const fees = cantCharge(answers);
  assert.equal(sampleFeeCents(300_000), 10_500);
  // Maya is paid back $2,000 first; the remaining $1,000 less the fee is split.
  const before = byKey(choiceEffect(answers, fees.choices[0], 300_000));
  const organizer = byKey(choiceEffect(answers, fees.choices[1], 300_000));
  assert.equal(before.maya + before.jordan + before.riley, 300_000 - 10_500);
  assert.equal(
    organizer.maya + organizer.jordan + organizer.riley,
    300_000 - 10_500,
  );
  assert.equal(organizer.jordan, 30_000);
  assert.equal(organizer.riley, 20_000);
  assert.ok(before.jordan < 30_000);
});

test("answering records the choice and applies it", () => {
  const answers = midnight();
  answers.questions = [cantCharge(answers)];
  const next = answerQuestion(answers, 0, answers.questions[0].choices[1]);
  assert.equal(next.fees?.value, FeeChoice.ORGANIZER_SHARE);
  assert.equal(next.fees?.source, AnswerSource.PERSON);
  assert.equal(next.questions[0].answeredChoiceId, FeeChoice.ORGANIZER_SHARE);
  assert.equal(answers.fees, undefined);
});

test("the step renders one question as radio cards with dollars", () => {
  const answers = midnight();
  answers.questions = [cantCharge(answers)];
  const noop = () => {};
  const html = renderToStaticMarkup(
    createElement(WizardQuestionsStep, {
      answers,
      onChange: noop,
      index: 0,
      onNext: noop,
      onBack: noop,
    }),
  );
  assert.match(html, /Question 1 of 1/);
  assert.match(html, /We can(’|'|&#x27;)t have Jordan pay the PayPal fee yet/);
  assert.match(html, /role="radiogroup"/);
  assert.equal(html.match(/role="radio"/g)?.length, 2);
  assert.match(html, /On a \$3,000 payment/);
  assert.match(html, /With a \$105 PayPal fee, each person gets:/);
  assert.match(html, /\$300/);
  assert.doesNotMatch(html, /[Rr]efund/);
  assert.match(html, /Not sure\? Skip for now/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Use this<\/button>/);
  assert.doesNotMatch(
    html,
    /recoup|allocation|basis points|provenance|activate/i,
  );
});

test("an extracted question with its own choices replaces the standard one", () => {
  const own: Question = {
    id: StandardQuestionId.FEES,
    text: "Who pays the processing fee?",
    quote: "Fees are shared.",
    choices: [
      {
        id: FeeChoice.BEFORE_SPLIT,
        label: "Shared",
        explanation: "",
        apply: (a) => ({ ...a, fees: doc(FeeChoice.BEFORE_SPLIT) }),
      },
      {
        id: FeeChoice.ORGANIZER_SHARE,
        label: "Maya",
        explanation: "",
        apply: (a) => ({ ...a, fees: doc(FeeChoice.ORGANIZER_SHARE) }),
      },
    ],
  };
  const [fees] = questionsFor(midnight(), [own]);
  assert.equal(fees.text, "Who pays the processing fee?");
  assert.deepEqual(
    fees.choices.map((c) => c.label),
    ["Shared", "Maya"],
  );
});

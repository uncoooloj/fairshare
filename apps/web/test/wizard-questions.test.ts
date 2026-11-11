import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AnswerSource,
  FeeChoice,
  RefundChoice,
  type AgreementAnswers,
  type Question,
} from "../lib/rules-answers";
import {
  StandardQuestionId,
  choiceEffect,
  questionsFor,
  refundEffect,
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

test("silent fees and refunds become the two standard questions", () => {
  const questions = questionsFor(midnight());
  assert.deepEqual(
    questions.map((q) => q.id),
    [StandardQuestionId.FEES, StandardQuestionId.REFUNDS],
  );
  const fees = questions[0];
  assert.equal(fees.text, "Who covers the PayPal fee?");
  assert.deepEqual(
    fees.choices.map((c) => c.id),
    [FeeChoice.BEFORE_SPLIT, FeeChoice.ORGANIZER_SHARE],
  );
  assert.equal(fees.choices[1].label, "Maya covers it from their share");
  assert.deepEqual(
    questions[1].choices.map((c) => c.id),
    [RefundChoice.SPLIT, RefundChoice.ADVANCE],
  );
});

test("settled answers ask nothing; no advance means no refunds question", () => {
  assert.deepEqual(
    questionsFor(
      midnight({
        fees: doc(FeeChoice.BEFORE_SPLIT),
        refunds: doc(RefundChoice.SPLIT),
      }),
    ),
    [],
  );
  assert.deepEqual(
    questionsFor(midnight({ advance: undefined })).map((q) => q.id),
    [StandardQuestionId.FEES],
  );
});

test("extracted issues are capped at three, money questions first", () => {
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
  const fromDoc: Question = {
    id: StandardQuestionId.REFUNDS,
    text: "ignored",
    quote: "Refunds shall be deducted from future Net Revenue.",
    clause: "§ 5.2",
    choices: [],
  };
  const questions = questionsFor(midnight(), [wordOnly, money, fromDoc]);
  assert.deepEqual(
    questions.map((q) => q.id),
    ["fees", "refunds", "net"],
  );
  assert.equal(questions[1].clause, "§ 5.2");
  assert.equal(
    questions[1].text,
    "Do refunds come off the advance or the split?",
  );
  assert.equal(questions[1].choices.length, 2);
  const settled = midnight({
    fees: doc(FeeChoice.BEFORE_SPLIT),
    refunds: doc(RefundChoice.SPLIT),
  });
  assert.deepEqual(
    questionsFor(settled, [wordOnly, money]).map((q) => q.id),
    ["net", "credit"],
  );
});

test("fee choices show real dollars on $3,000 with a $105 fee", () => {
  const answers = midnight();
  const [fees] = questionsFor(answers);
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

test("refund choices show who loses how much on $100", () => {
  const answers = midnight();
  const [, refunds] = questionsFor(answers);
  assert.deepEqual(byKey(refundEffect(answers, refunds.choices[0])), {
    maya: -5000,
    jordan: -3000,
    riley: -2000,
  });
  assert.deepEqual(byKey(refundEffect(answers, refunds.choices[1])), {
    maya: -10_000,
  });
});

test("answering records the choice and applies it", () => {
  const answers = midnight();
  answers.questions = questionsFor(answers);
  const next = answerQuestion(answers, 0, answers.questions[0].choices[1]);
  assert.equal(next.fees?.value, FeeChoice.ORGANIZER_SHARE);
  assert.equal(next.fees?.source, AnswerSource.PERSON);
  assert.equal(next.questions[0].answeredChoiceId, FeeChoice.ORGANIZER_SHARE);
  assert.equal(next.questions[1].answeredChoiceId, undefined);
  assert.equal(answers.fees, undefined);
});

test("the step renders one question as radio cards with dollars", () => {
  const answers = midnight();
  answers.questions = questionsFor(answers);
  const noop = () => {};
  const html = renderToStaticMarkup(
    createElement(WizardQuestionsStep, {
      answers,
      onChange: noop,
      index: 1,
      onNext: noop,
      onBack: noop,
    }),
  );
  assert.match(html, /Question 2 of 2/);
  assert.match(html, /Do refunds come off the advance or the split\?/);
  assert.match(html, /role="radiogroup"/);
  assert.equal(html.match(/role="radio"/g)?.length, 2);
  assert.match(html, /On a \$3,000 payment/);
  assert.match(html, /With a \$100 refund/);
  assert.match(html, /−\$50/);
  assert.match(html, /−\$100/);
  assert.match(html, /Not sure\? Skip for now/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Use this<\/button>/);
  assert.doesNotMatch(
    html,
    /recoup|allocation|basis points|provenance|activate/i,
  );
});

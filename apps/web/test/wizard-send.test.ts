import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AnswerSource,
  blockingReasons,
  toRules,
  type AgreementAnswers,
  type PersonAnswer,
} from "../lib/rules-answers";
import { feeQuestion } from "../lib/standard-questions";
import { WizardSendStep } from "../components/wizard-send-step";

const person = (
  key: string,
  name: string,
  basisPoints: number,
  extra: Partial<PersonAnswer> = {},
): PersonAnswer => ({ key, name, basisPoints, isSelf: false, ...extra });

function midnight(alreadyPaid?: boolean): AgreementAnswers {
  return {
    name: { value: "Midnight Sessions", source: AnswerSource.PERSON },
    people: {
      value: [
        person("maya", "Maya", 5000, { isSelf: true, userId: "u-maya" }),
        person("jordan", "Jordan", 3000, {
          email: "j@x.test",
          invitationId: "i-j",
        }),
        person("riley", "Riley", 2000, {
          email: "r@x.test",
          invitationId: "i-r",
        }),
      ],
      source: AnswerSource.PERSON,
    },
    advance: {
      value: { recipientKey: "maya", amountCents: 200000, alreadyPaid },
      source: AnswerSource.PERSON,
    },
    questions: [],
  };
}

const render = (answers: AgreementAnswers, fixable = true) =>
  renderToStaticMarkup(
    createElement(WizardSendStep, {
      answers,
      ...(fixable ? { onChange: () => {}, onFixPeople: () => {} } : {}),
    }),
  );

test("the advance is asked right on Send, and only an unanswered one blocks", () => {
  const html = render(midnight());
  assert.match(html, /Has Maya already paid the \$2,000\?/);
  assert.match(html, />Yes</);
  assert.match(html, />Not yet</);
  assert.deepEqual(blockingReasons(midnight()), [
    "Has Maya already paid the $2,000?",
  ]);
  assert.deepEqual(blockingReasons(midnight(true)), []);
  assert.deepEqual(blockingReasons(midnight(false)), []);
  assert.doesNotMatch(html, /needs to have paid/);
});

test("Not yet: Send is open, the rules say unconfirmed, and one plain line says what's next", () => {
  const html = render(midnight(false));
  assert.match(html, /Ready to send/);
  assert.match(
    html,
    /You(’|'|&#x27;)ll confirm it once it(’|'|&#x27;)s paid\. Nothing is split until then\./,
  );
  assert.match(html, /type="radio"[^>]*checked=""/);
  assert.doesNotMatch(html, /wiz-blocking/);
  const rules = toRules(midnight(false), {
    documentId: "d",
    organizerId: "u-maya",
  });
  assert.equal(rules.advance?.verified, false);
  assert.equal(
    toRules(midnight(true), { documentId: "d", organizerId: "u-maya" }).advance
      ?.verified,
    true,
  );
});

test("other blockers are fixed in place, or jump to People for emails", () => {
  const a = midnight(true);
  a.name = { value: "", source: AnswerSource.PERSON };
  a.questions = [
    {
      ...feeQuestion(a),
      text: "We can't have Jordan pay the PayPal fee yet. Who covers it?",
    },
  ];
  a.people.value[2] = person("riley", "Riley", 2000);
  const html = render(a);
  assert.match(html, /Almost ready to send/);
  assert.match(html, /A few things before you send/);
  assert.match(html, /<label[^>]*>Name the agreement<\/label>/);
  assert.match(html, /We can(’|'|&#x27;)t have Jordan pay the PayPal fee yet/);
  assert.match(html, />Everyone, before the split \(most common\)</);
  assert.match(html, /Add Riley(’|'|&#x27;)s email/);
  assert.match(html, />Fix it</);
  const split = midnight(true);
  split.people.value[0] = { ...split.people.value[0], basisPoints: 4000 };
  assert.match(render(split), /Make the split add up to 100%/);
});

test("without handlers it still lists what blocks, in plain words", () => {
  const html = render(midnight(), false);
  assert.match(html, /One thing before you send/);
  assert.match(html, /Has Maya already paid the \$2,000\?/);
  assert.doesNotMatch(
    html.toLowerCase(),
    /allocation|recoup|basis point|version|activate|refund/,
  );
});

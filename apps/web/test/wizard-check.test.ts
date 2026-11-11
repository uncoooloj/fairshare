import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AnswerSource,
  FeeChoice,
  type AgreementAnswers,
  type PersonAnswer,
} from "../lib/rules-answers";
import {
  CheckMode,
  WizardCheckStep,
  checkHeadline,
  clauseLabel,
  dateRange,
  exampleLine,
  feeLine,
  splitSummary,
} from "../components/wizard-check-step";
import {
  addPerson,
  equalSplit,
  moveShare,
  parsePercent,
  removePerson,
} from "../components/split-drawer";

const person = (
  key: string,
  name: string,
  basisPoints: number,
  isSelf = false,
): PersonAnswer => ({ key, name, basisPoints, isSelf });

const people = [
  person("maya", "Maya Okafor", 5000, true),
  person("jordan", "Jordan Reyes", 3000),
  person("riley", "Riley Chen", 2000),
];

function midnight(extra: Partial<AgreementAnswers> = {}): AgreementAnswers {
  return {
    name: {
      value: "Midnight Sessions",
      source: AnswerSource.DOCUMENT,
      clause: "1",
    },
    effectiveFrom: { value: "2026-10-01", source: AnswerSource.DOCUMENT },
    effectiveTo: { value: "2027-09-30", source: AnswerSource.DOCUMENT },
    people: { value: people, source: AnswerSource.DOCUMENT, clause: "4.2" },
    questions: [],
    ...extra,
  };
}

const withAdvance = (alreadyPaid?: boolean) =>
  midnight({
    advance: {
      value: { recipientKey: "maya", amountCents: 200000, alreadyPaid },
      source: AnswerSource.DOCUMENT,
      clause: "§ 4.1",
    },
  });

const render = (
  answers: AgreementAnswers,
  mode = CheckMode.FOUND_ALL,
  equalSplitGuessed = false,
) =>
  renderToStaticMarkup(
    createElement(WizardCheckStep, {
      answers,
      mode,
      equalSplitGuessed,
      onChange() {},
    }),
  );

test("the headline follows how much was read", () => {
  assert.equal(
    checkHeadline(CheckMode.FOUND_ALL).title,
    "Here's what your agreement says",
  );
  assert.equal(
    checkHeadline(CheckMode.FOUND_SOME).title,
    "Here's what we found. A couple of things need you.",
  );
  assert.equal(checkHeadline(CheckMode.MANUAL).title, "Let's set up the split");
});

test("the card lines read like the spec", () => {
  assert.equal(splitSummary(people), "Maya 50% · Jordan 30% · Riley 20%");
  assert.equal(dateRange(midnight()), "Oct 1, 2026 to Sep 30, 2027");
  assert.equal(
    dateRange(
      midnight({
        effectiveTo: { value: null, source: AnswerSource.DOCUMENT },
      }),
    ),
    "From Oct 1, 2026 · No end date",
  );
  assert.equal(clauseLabel(midnight().people), "§ 4.2");
  assert.equal(clauseLabel(withAdvance().advance), "§ 4.1");
  assert.equal(
    clauseLabel({ value: 1, source: AnswerSource.PERSON, clause: "4.2" }),
    undefined,
  );
});

test("the $3,000 example comes from the engine and names the advance only when there is one", () => {
  assert.equal(
    exampleLine(midnight()),
    "On a $3,000 payment: Maya $1,500, Jordan $900, Riley $600.",
  );
  assert.equal(
    exampleLine(withAdvance()),
    "On a $3,000 payment: Maya $1,500, Jordan $900, Riley $600 (after the advance is paid back).",
  );
  const broken = midnight({
    people: {
      value: [person("a", "A", 4000), person("b", "B", 4000)],
      source: AnswerSource.PERSON,
    },
  });
  assert.equal(exampleLine(broken), undefined);
});

test("fees show as a line only when stated", () => {
  assert.equal(feeLine(midnight()), undefined);
  assert.equal(
    feeLine(
      midnight({
        fees: { value: FeeChoice.BEFORE_SPLIT, source: AnswerSource.DOCUMENT },
      }),
    ),
    "PayPal fees come off the top, before the split.",
  );
  assert.equal(
    feeLine(
      midnight({
        fees: {
          value: FeeChoice.ORGANIZER_SHARE,
          source: AnswerSource.PERSON,
        },
      }),
    ),
    "PayPal fees come out of Maya's share.",
  );
});

test("the screen renders the cards, the paid-back question and plain words only", () => {
  const html = render(withAdvance(true));
  assert.match(html, /Here&#x27;s what your agreement says/);
  assert.match(html, /Midnight Sessions/);
  assert.match(html, /Split: Maya 50%, Jordan 30%, Riley 20%/);
  assert.match(html, /§ 4\.2/);
  assert.match(
    html,
    /Maya put in \$2,000 upfront and is paid back first, before anyone splits\./,
  );
  assert.match(html, /Has Maya already paid the \$2,000\?/);
  assert.match(html, /type="radio"[^>]*checked=""/);
  assert.doesNotMatch(html, /Someone paid upfront\?/);
  assert.doesNotMatch(
    html.toLowerCase(),
    /allocation|recoup|basis point|version|activate/,
  );
});

test("without an advance there is no card, only the quiet link", () => {
  const html = render(midnight());
  assert.doesNotMatch(html, /Paid back first/);
  assert.match(html, /Someone paid upfront\?/);
  assert.doesNotMatch(html, /after the advance/);
});

test("names without percentages get the equal-split note", () => {
  const html = render(midnight(), CheckMode.FOUND_SOME, true);
  assert.match(
    html,
    /We didn&#x27;t find the percentages\. Here&#x27;s an equal split to start from\./,
  );
});

test("split drawer maths always totals 100%", () => {
  const total = (rows: PersonAnswer[]) =>
    rows.reduce((sum, row) => sum + row.basisPoints, 0);
  assert.deepEqual(
    equalSplit(people).map((p) => p.basisPoints),
    [3334, 3333, 3333],
  );
  const added = addPerson(people, person("sam", "Sam", 0));
  assert.equal(total(added), 10000);
  assert.equal(added.at(-1)!.basisPoints, 2500);
  const removed = removePerson(people, "riley");
  assert.equal(removed.length, 2);
  assert.equal(total(removed), 10000);
  assert.equal(removePerson([people[0]], "maya").length, 1);
  // Sliders keep everyone on whole percents.
  assert.deepEqual(
    addPerson(moveShare(people, "jordan", 3200), person("sam", "Sam", 0)).map(
      (p) => p.basisPoints,
    ),
    [3700, 2400, 1400, 2500],
  );
  assert.deepEqual(
    removePerson(people, "riley").map((p) => p.basisPoints),
    [6300, 3700],
  );
  assert.equal(moveShare(people, "jordan", 1250)[1].basisPoints, 1250);
  assert.equal(parsePercent("30"), 3000);
  assert.equal(parsePercent("12.5%"), 1250);
  assert.equal(parsePercent("101"), undefined);
  assert.equal(parsePercent("abc"), undefined);
});

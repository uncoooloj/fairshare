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
  feesNeedSave,
  splitSummary,
  wizardCitations,
  REFUND_LINE,
} from "../components/wizard-check-step";
import { StandardQuestionId } from "../lib/standard-questions";
import {
  addPerson,
  equalSplit,
  evenSplit,
  moveShare,
  parsePercent,
  removePerson,
  slideShare,
  totalProblem,
  typeShare,
  type SplitState,
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

test("Check reader only maps unique exact document quotes to highlights", () => {
  const text = "1. Midnight Sessions\n4.2 Maya 50%, Jordan 30%, Riley 20%.";
  const answers = midnight({
    name: {
      value: "Midnight Sessions",
      source: AnswerSource.DOCUMENT,
      clause: "1",
      quote: "Midnight Sessions",
    },
    people: {
      value: people,
      source: AnswerSource.DOCUMENT,
      clause: "4.2",
      quote: "Maya 50%, Jordan 30%, Riley 20%.",
    },
  });
  const citations = wizardCitations(answers, {
    documentId: "draft-source",
    text,
    provenance: { pages: [{ page: 1, start: 0, end: text.length }] },
  }, { agreement: "draft-source", advance: "draft-source" });
  assert.deepEqual(citations.map((citation) => citation.id), [
    "wizard-agreement",
    "wizard-split",
  ]);
  assert.equal(citations[1].highlight?.start, text.indexOf("Maya"));
  assert.equal(citations[1].page, 1);
  assert.deepEqual(
    wizardCitations(
      { ...answers, people: { ...answers.people, quote: "Maya 50%" } },
      { documentId: "draft-source", text: `${text}\nMaya 50%` },
      { agreement: "draft-source", advance: "draft-source" },
    ).map((citation) => citation.id),
    ["wizard-agreement"],
  );
  assert.deepEqual(
    wizardCitations(
      {
        ...answers,
        fees: {
          value: FeeChoice.BEFORE_SPLIT,
          source: AnswerSource.DOCUMENT,
          quote: answers.people.quote,
        },
      },
      { documentId: "draft-source", text },
      { agreement: "draft-source", advance: "draft-source" },
    ).map((citation) => citation.id),
    ["wizard-agreement"],
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

test("fees are always a line: before the split unless someone covers them", () => {
  assert.equal(
    feeLine(midnight()),
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

test("an explicit current-organizer fee choice can replace a kept former bearer", () => {
  const handedOver = midnight({
    fees: { value: FeeChoice.ORGANIZER_SHARE, source: AnswerSource.PERSON },
    feeBearerId: "former-organizer",
    feeBearerChoice: "KEEP",
  });
  assert.equal(
    feesNeedSave(handedOver, FeeChoice.ORGANIZER_SHARE, false),
    false,
  );
  assert.equal(feesNeedSave(handedOver, FeeChoice.ORGANIZER_SHARE, true), true);
  assert.equal(feesNeedSave(midnight(), FeeChoice.BEFORE_SPLIT, false), false);
  assert.equal(
    feesNeedSave(midnight(), FeeChoice.ORGANIZER_SHARE, false),
    true,
  );
});

test("Check states fees with a Change link and the true refund line, no refund question", () => {
  const html = render(midnight());
  assert.match(html, /PayPal fees come off the top, before the split\./);
  assert.match(html, /aria-label="Change who covers the PayPal fees"/);
  assert.match(
    html,
    /If a payment is refunded, payouts pause while it(’|'|&#x27;)s checked\./,
  );
  assert.match(
    REFUND_LINE,
    /^If a payment is refunded, payouts pause while it.s checked\.$/,
  );
  // A fee the document gives to someone we can't charge is asked next, not changed here.
  const asked = render(
    midnight({
      questions: [
        {
          id: StandardQuestionId.FEES,
          text: "We can't have Jordan pay the PayPal fee yet. Who covers it?",
          choices: [],
        },
      ],
    }),
  );
  assert.match(asked, /We(’|'|&#x27;)ll ask you about the PayPal fees next\./);
  assert.doesNotMatch(asked, /Change who covers the PayPal fees/);
});

test("someone outside the split shows no 0%", () => {
  const outside = midnight({
    people: {
      value: [
        person("maya", "Maya Okafor", 0, true),
        person("jordan", "Jordan Reyes", 3334),
        person("riley", "Riley Chen", 3333),
        person("sam", "Sam Lee", 3333),
      ],
      source: AnswerSource.PERSON,
    },
  });
  assert.equal(
    splitSummary(outside.people.value),
    "Jordan 33.34% · Riley 33.33% · Sam 33.33%",
  );
  const html = render(outside);
  assert.match(html, /Not in the split/);
  assert.doesNotMatch(html, />0%</);
  assert.doesNotMatch(exampleLine(outside) ?? "", /Maya/);
});

test("not an agreement: a plain headline, two ways on, nothing guessed", () => {
  assert.equal(
    checkHeadline(CheckMode.NOT_AGREEMENT).title,
    "This doesn't look like a revenue-share agreement",
  );
  const alone = midnight({
    name: { value: "", source: AnswerSource.PERSON },
    people: {
      value: [person("maya", "Maya Okafor", 10000, true)],
      source: AnswerSource.PERSON,
    },
  });
  const html = renderToStaticMarkup(
    createElement(WizardCheckStep, {
      answers: alone,
      onChange: () => {},
      mode: CheckMode.NOT_AGREEMENT,
      onUploadAgain: () => {},
    }),
  );
  assert.match(html, /Upload a different file/);
  assert.match(html, /Set it up myself/);
  assert.doesNotMatch(html, /Who gets what|wc-card/);
  const busy = renderToStaticMarkup(
    createElement(WizardCheckStep, {
      answers: alone,
      onChange: () => {},
      mode: CheckMode.NOT_AGREEMENT,
      onUploadAgain: () => {},
      busy: true,
    }),
  );
  assert.equal((busy.match(/disabled=""/g) || []).length, 2);
  // People already added (back from a later step): it's a manual setup now.
  const manual = renderToStaticMarkup(
    createElement(WizardCheckStep, {
      answers: midnight(),
      onChange: () => {},
      mode: CheckMode.NOT_AGREEMENT,
    }),
  );
  assert.doesNotMatch(manual, /Upload a different file/);
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

/** Types a number the way a person does: one keystroke at a time. */
function typed(state: SplitState, key: string, text: string): SplitState {
  let next = state;
  for (let i = 1; i <= text.length; i++) {
    const basisPoints = parsePercent(text.slice(0, i));
    if (basisPoints !== undefined) next = typeShare(next, key, basisPoints);
  }
  return next;
}
const shares = (state: SplitState) => state.people.map((p) => p.basisPoints);
const fresh = (n: number): SplitState => ({
  people: equalSplit(
    ["a", "b", "c", "d"].slice(0, n).map((k) => person(k, k.toUpperCase(), 0)),
  ),
  set: [],
});

test("typing 50, 30, 20 gives exactly 50/30/20 in any order", () => {
  const orders = [
    ["a", "b", "c"],
    ["a", "c", "b"],
    ["b", "a", "c"],
    ["b", "c", "a"],
    ["c", "a", "b"],
    ["c", "b", "a"],
  ];
  const want: Record<string, string> = { a: "50", b: "30", c: "20" };
  for (const order of orders) {
    let state = fresh(3);
    for (const key of order) state = typed(state, key, want[key]);
    assert.deepEqual(shares(state), [5000, 3000, 2000], order.join(""));
    assert.equal(totalProblem(state.people), undefined);
  }
});

test("after two typed numbers the third is already right; nothing set moves", () => {
  let state = typed(fresh(3), "a", "50");
  assert.deepEqual(shares(state), [5000, 2500, 2500]);
  state = typed(state, "b", "30");
  assert.deepEqual(shares(state), [5000, 3000, 2000]);
  // Everyone set: changing one moves nobody else and Save waits.
  state = typed(state, "c", "19");
  assert.deepEqual(shares(state), [5000, 3000, 1900]);
  assert.equal(
    totalProblem(state.people),
    "Adds up to 99%. Make it 100% to continue.",
  );
  state = typed(state, "a", "60");
  assert.equal(
    totalProblem(state.people),
    "Adds up to 109%. Make it 100% to continue.",
  );
  // Even split resets everything, including who counts as set.
  state = evenSplit(state);
  assert.deepEqual(shares(state), [3334, 3333, 3333]);
  assert.deepEqual(state.set, []);
  assert.deepEqual(shares(typed(state, "c", "20")), [4000, 4000, 2000]);
});

test("slider then typing: sliders snap to whole percents and respect set people", () => {
  let state = slideShare(fresh(3), "a", 4730);
  assert.deepEqual(shares(state), [4700, 2700, 2600]);
  // Dragging on through many values only moves people not set yet.
  for (const v of [4800, 4900, 5049]) state = slideShare(state, "a", v);
  assert.deepEqual(shares(state), [5000, 2500, 2500]);
  state = typed(state, "b", "30");
  assert.deepEqual(shares(state), [5000, 3000, 2000]);
  state = slideShare(state, "c", 2300);
  assert.deepEqual(shares(state), [5000, 3000, 2300]);
  assert.equal(
    totalProblem(state.people),
    "Adds up to 103%. Make it 100% to continue.",
  );
  state = typed(state, "c", "20");
  assert.deepEqual(shares(state), [5000, 3000, 2000]);
});

test("four-way split: typed numbers stick and the rest share what is left", () => {
  let state = typed(fresh(4), "b", "40");
  assert.deepEqual(shares(state), [2000, 4000, 2000, 2000]);
  state = typed(state, "d", "10");
  assert.deepEqual(shares(state), [2500, 4000, 2500, 1000]);
  state = typed(state, "a", "35.5");
  assert.deepEqual(shares(state), [3550, 4000, 1450, 1000]);
  state = typed(state, "c", "14.5");
  assert.deepEqual(shares(state), [3550, 4000, 1450, 1000]);
  assert.equal(totalProblem(state.people), undefined);
  for (const p of state.people) {
    assert.ok(Number.isInteger(p.basisPoints) && p.basisPoints >= 0);
  }
});

test("over 100% never pushes anyone negative", () => {
  let state = typed(fresh(3), "a", "80");
  state = typed(state, "b", "70");
  assert.deepEqual(shares(state), [8000, 7000, 0]);
  assert.equal(
    totalProblem(state.people),
    "Adds up to 150%. Make it 100% to continue.",
  );
});

test("adding or removing someone only moves people not set yet", () => {
  const state = typed(fresh(3), "a", "50");
  const added = addPerson(state.people, person("d", "D", 0), state.set);
  assert.deepEqual(
    added.map((p) => p.basisPoints),
    [5000, 1300, 1200, 2500],
  );
  const allSet = typed(typed(state, "b", "30"), "c", "20");
  const late = addPerson(allSet.people, person("d", "D", 0), allSet.set);
  assert.deepEqual(
    late.map((p) => p.basisPoints),
    [5000, 3000, 2000, 0],
  );
  assert.deepEqual(
    removePerson(allSet.people, "c", allSet.set).map((p) => p.basisPoints),
    [5000, 3000],
  );
  assert.deepEqual(
    removePerson(state.people, "c", state.set).map((p) => p.basisPoints),
    [5000, 5000],
  );
});

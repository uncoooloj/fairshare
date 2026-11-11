import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  answersFromExtraction,
  clauseFor,
  ReadingQuestionId,
} from "../lib/answers-from-extraction";
import { CheckMode, WizardCheckStep } from "../components/wizard-check-step";
import {
  AnswerSource,
  FeeChoice,
  RefundChoice,
  exampleSplit,
} from "../lib/rules-answers";
import {
  MAX_QUESTIONS,
  StandardQuestionId,
  choiceEffect,
} from "../lib/standard-questions";
import {
  MIDNIGHT,
  Status,
  advance,
  cite,
  fullReading,
  namesOnlyReading,
  partialReading,
  person,
  reading,
  share,
} from "./extraction-v2-fixtures";

const self = { name: "Maya Okafor", userId: "owner" };

test("everything read: name, dates, people, advance and fees, each with its clause and quote", () => {
  const read = answersFromExtraction(fullReading(), MIDNIGHT, self);
  const a = read.answers;
  assert.equal(read.mode, CheckMode.FOUND_ALL);
  assert.equal(read.equalSplitGuessed, false);
  assert.equal(a.name.value, "Midnight Sessions");
  assert.equal(a.name.source, AnswerSource.DOCUMENT);
  assert.equal(a.effectiveFrom?.value, "2026-10-01");
  assert.equal(a.effectiveTo?.value, "2027-09-30");
  assert.equal(a.effectiveFrom?.clause, "1");
  assert.deepEqual(
    a.people.value.map((p) => [p.name, p.basisPoints, p.isSelf]),
    [
      ["Maya Okafor", 5000, true],
      ["Jordan Reyes", 3000, false],
      ["Riley Chen", 2000, false],
    ],
  );
  assert.equal(a.people.value[0].key, "owner");
  assert.equal(a.people.source, AnswerSource.DOCUMENT);
  assert.equal(a.people.clause, "4.2");
  assert.match(a.people.quote ?? "", /50% to Maya Okafor/);
  assert.deepEqual(a.advance?.value, {
    recipientKey: "owner",
    amountCents: 200_000,
  });
  assert.equal(a.advance?.clause, "4.1");
  assert.equal(a.fees?.value, FeeChoice.BEFORE_SPLIT);
  assert.equal(a.fees?.clause, "4.3");
  // Silent on refunds, and there is an advance: only the refunds question is left.
  assert.deepEqual(
    a.questions.map((q) => q.id),
    [StandardQuestionId.REFUNDS],
  );
  // The example dollars come from the real split engine.
  const rows = exampleSplit(a, 300_000, 10_500);
  assert.equal(
    rows.reduce((s, r) => s + r.cents, 0),
    300_000 - 10_500,
  );
});

test("wizard answers retain server-valid case and curly-quote facts with exact source ranges", () => {
  const doc = "“MAYA OKAFOR” receives 100% of Net Revenue.";
  const quote = doc;
  const extraction = reading(doc, {
    facts: [
      {
        kind: "SHARE",
        subject: "maya okafor",
        rawValue: "100%",
        basisPoints: 10_000,
        citation: cite(doc, quote),
      },
    ],
    sections: { SPLIT: Status.READ },
  });
  const read = answersFromExtraction(extraction, doc, self);
  assert.equal(read.mode, CheckMode.FOUND_ALL);
  assert.deepEqual(read.answers.people.value, [
    {
      key: "owner",
      name: "maya okafor",
      userId: "owner",
      basisPoints: 10_000,
      isSelf: true,
    },
  ]);
});

test("term dates keep their own verified clause citations", () => {
  const term = "1.1 Start: October 1, 2026.\n2.1 End: September 30, 2027.";
  const doc = MIDNIGHT.replace(
    "This agreement starts on October 1, 2026 and ends on September 30, 2027.",
    term,
  );
  const extraction = fullReading(MIDNIGHT);
  extraction.facts = extraction.facts.map((fact: any) => {
    if (fact.kind === "TERM") {
      const quote =
        fact.boundary === "START"
          ? "Start: October 1, 2026."
          : "End: September 30, 2027.";
      return { ...fact, citation: cite(doc, quote) };
    }
    return { ...fact, citation: cite(doc, fact.citation.quote) };
  });
  const answers = answersFromExtraction(extraction, doc, self).answers;
  assert.equal(answers.effectiveFrom?.quote, "Start: October 1, 2026.");
  assert.equal(answers.effectiveFrom?.clause, "1.1");
  assert.equal(answers.effectiveTo?.quote, "End: September 30, 2027.");
  assert.equal(answers.effectiveTo?.clause, "2.1");
});

test("a unique abbreviated organizer fee bearer resolves, while an ambiguous one stays open", () => {
  const ownDoc = MIDNIGHT.replace(
    "PayPal fees come off the top before the split.",
    "PayPal fees are paid by Maya.",
  );
  const own = fullReading(MIDNIGHT);
  own.facts = own.facts.map((fact: any) =>
    fact.kind === "FEES"
      ? {
          ...fact,
          subject: "Maya",
          rawValue: "Maya",
          feePolicy: "ORGANIZER_SHARE",
          feeBearer: "Maya",
          citation: cite(ownDoc, "PayPal fees are paid by Maya."),
        }
      : { ...fact, citation: cite(ownDoc, fact.citation.quote) },
  );
  assert.equal(
    answersFromExtraction(own, ownDoc, self).answers.fees?.value,
    FeeChoice.ORGANIZER_SHARE,
  );

  const ambiguousDoc = `${ownDoc}\nMaya Chen is a collaborator.`;
  const ambiguous = {
    ...own,
    facts: [
      ...own.facts.map((fact: any) => ({
        ...fact,
        citation: cite(ambiguousDoc, fact.citation.quote),
      })),
      person(ambiguousDoc, "Maya Chen", "Maya Chen is a collaborator."),
    ],
  };
  const answers = answersFromExtraction(ambiguous, ambiguousDoc, self).answers;
  assert.equal(answers.fees, undefined);
  assert.match(
    answers.questions.find(
      (question) => question.id === StandardQuestionId.FEES,
    )?.text ?? "",
    /can't have Maya pay/,
  );
});

test("a partial reading: the split is read, the advance becomes a question with dollar choices", () => {
  const { doc, extraction } = partialReading();
  const read = answersFromExtraction(extraction, doc, self);
  const a = read.answers;
  assert.equal(read.mode, CheckMode.FOUND_SOME);
  // Not settled, so not repaid first until someone says so.
  assert.equal(a.advance, undefined);
  assert.equal(a.fees, undefined);
  const ids = a.questions.map((q) => q.id);
  assert.ok(ids.includes(ReadingQuestionId.ADVANCE));
  assert.ok(ids.includes(StandardQuestionId.FEES));
  const q = a.questions.find((x) => x.id === ReadingQuestionId.ADVANCE)!;
  assert.equal(q.text, "Is Maya's $2,000 paid back before the split?");
  assert.equal(q.quote, "Maya Okafor paid a $2,000 advance.");
  assert.equal(q.clause, "4.1");
  assert.deepEqual(
    q.choices.map((c) => c.label),
    ["Paid back first", "Not paid back"],
  );
  const paidBack = q.choices[0].apply(a);
  assert.deepEqual(paidBack.advance?.value, {
    recipientKey: "owner",
    amountCents: 200_000,
  });
  assert.equal(q.choices[1].apply(a).advance, undefined);
  // The Questions step shows different dollars for each choice.
  const cents = (c: (typeof q.choices)[number]) =>
    choiceEffect(a, c, 300_000)?.find((r) => r.key !== "owner")?.cents;
  assert.notEqual(cents(q.choices[0]), cents(q.choices[1]));
});

test("no percentages: an equal split to start from, with the spec's line", () => {
  const { doc, extraction } = namesOnlyReading();
  const read = answersFromExtraction(extraction, doc, self);
  assert.equal(read.mode, CheckMode.FOUND_SOME);
  assert.ok(read.equalSplitGuessed);
  assert.deepEqual(
    read.answers.people.value.map((p) => [p.name, p.basisPoints]),
    [
      ["Maya Okafor", 3334],
      ["Jordan Reyes", 3333],
      ["Riley Chen", 3333],
    ],
  );
  assert.equal(read.answers.people.source, AnswerSource.PERSON);
  const html = renderToStaticMarkup(
    createElement(WizardCheckStep, {
      answers: read.answers,
      onChange: () => {},
      mode: read.mode,
      equalSplitGuessed: read.equalSplitGuessed,
    }),
  );
  assert.match(
    html,
    /We didn(’|'|&#x27;)t find the percentages\. Here(’|'|&#x27;)s an equal split to start from\./,
  );
});

test("a split issue becomes a question whose choices set the split", () => {
  const doc =
    "3. Split\nMaya Okafor gets 50%, Jordan Reyes gets 30% and Riley Chen gets 30%.";
  const quote =
    "Maya Okafor gets 50%, Jordan Reyes gets 30% and Riley Chen gets 30%.";
  const extraction = reading(doc, {
    facts: [
      share(doc, "Maya Okafor", 50, quote),
      share(doc, "Jordan Reyes", 30, quote),
      share(doc, "Riley Chen", 30, quote),
    ],
    issues: [
      {
        topic: "SPLIT",
        question: "The shares add up to 110%. Which is right?",
        citation: cite(doc, quote),
        readings: [
          {
            label: "Riley gets 20%",
            explanation: "50 / 30 / 20",
            setting: {
              shares: [
                { name: "Maya Okafor", basisPoints: 5000 },
                { name: "Jordan Reyes", basisPoints: 3000 },
                { name: "Riley Chen", basisPoints: 2000 },
              ],
            },
          },
          {
            label: "Maya gets 40%",
            explanation: "40 / 30 / 30",
            setting: {
              shares: [
                { name: "Maya Okafor", basisPoints: 4000 },
                { name: "Jordan Reyes", basisPoints: 3000 },
                { name: "Riley Chen", basisPoints: 3000 },
              ],
            },
          },
          // Doesn't add up: never offered.
          {
            label: "Broken",
            explanation: "",
            setting: { shares: [{ name: "Maya Okafor", basisPoints: 9000 }] },
          },
        ],
      },
    ],
    sections: { SPLIT: Status.ASK },
  });
  const read = answersFromExtraction(extraction, doc, self);
  assert.equal(read.mode, CheckMode.FOUND_SOME);
  const q = read.answers.questions.find(
    (x) => x.id === ReadingQuestionId.SPLIT,
  )!;
  assert.equal(q.text, "The shares add up to 110%. Which is right?");
  assert.equal(q.clause, "3");
  assert.deepEqual(
    q.choices.map((c) => c.label),
    ["Riley gets 20%", "Maya gets 40%"],
  );
  const applied = q.choices[1].apply(read.answers);
  assert.deepEqual(
    applied.people.value.map((p) => [p.name, p.basisPoints]),
    [
      ["Maya Okafor", 4000],
      ["Jordan Reyes", 3000],
      ["Riley Chen", 3000],
    ],
  );
  assert.ok(read.answers.questions.length <= MAX_QUESTIONS);
});

test("an advance the document says is NOT paid back never becomes one", () => {
  const doc = MIDNIGHT.replace(
    "which is paid back before any split",
    "which is not paid back",
  );
  const quote = "Maya Okafor paid a $2,000 advance, which is not paid back.";
  const extraction = reading(doc, {
    facts: [
      share(doc, "Maya Okafor", 50),
      share(doc, "Jordan Reyes", 30),
      share(doc, "Riley Chen", 20),
      advance(doc, false, quote),
    ],
    sections: { SPLIT: Status.READ, ADVANCE: Status.ASK },
  });
  const read = answersFromExtraction(extraction, doc, self);
  assert.equal(read.answers.advance, undefined);
  const q = read.answers.questions.find(
    (x) => x.id === ReadingQuestionId.ADVANCE,
  )!;
  assert.equal(q.quote, quote);
  // The document's reading is first, and it leaves the advance out.
  assert.equal(q.choices[0].label, "No, split from the first dollar");
  assert.equal(q.choices[0].apply(read.answers).advance, undefined);
  assert.equal(
    q.choices[1].apply(read.answers).advance?.value.amountCents,
    200_000,
  );
});

test("fees paid by a collaborator aren't coerced: a question quotes the clause", () => {
  const doc = MIDNIGHT.replace(
    "PayPal fees come off the top before the split.",
    "PayPal fees are paid by Jordan Reyes.",
  );
  // The fees line is the last one any fact cites, so the other offsets still hold.
  const extraction = fullReading();
  extraction.facts = extraction.facts.map((f: any) =>
    f.kind === "FEES"
      ? {
          ...f,
          subject: "PayPal fees",
          rawValue: "PayPal fees",
          feePolicy: "ORGANIZER_SHARE",
          feeBearer: "Jordan Reyes",
          citation: cite(doc, "PayPal fees are paid by Jordan Reyes."),
        }
      : f,
  );
  const read = answersFromExtraction(extraction, doc, self);
  assert.equal(read.answers.fees, undefined);
  const q = read.answers.questions.find(
    (x) => x.id === StandardQuestionId.FEES,
  )!;
  assert.match(q.text, /We can't have Jordan pay the PayPal fee yet/);
  assert.equal(q.quote, "PayPal fees are paid by Jordan Reyes.");
  assert.equal(q.clause, "4.3");
  assert.deepEqual(
    q.choices.map((c) => c.id),
    [FeeChoice.BEFORE_SPLIT, FeeChoice.ORGANIZER_SHARE],
  );
  // When the organizer is the one named, it is simply read.
  const own = answersFromExtraction(extraction, doc, {
    name: "Jordan Reyes",
    userId: "owner",
  });
  assert.equal(own.answers.fees?.value, FeeChoice.ORGANIZER_SHARE);
});

test("the organizer is only matched on the full name, never a shared first name", () => {
  const read = answersFromExtraction(fullReading(), MIDNIGHT, {
    name: "Jordan Lee",
    userId: "owner",
  });
  const people = read.answers.people.value;
  assert.deepEqual(
    people.map((p) => [p.name, p.isSelf, p.basisPoints]),
    [
      ["Jordan Lee", true, 0],
      ["Maya Okafor", false, 5000],
      ["Jordan Reyes", false, 3000],
      ["Riley Chen", false, 2000],
    ],
  );
  assert.equal(people.filter((p) => p.isSelf).length, 1);
  assert.equal(
    people.find((p) => p.name === "Jordan Reyes")?.userId,
    undefined,
  );
});

test("refunds read as 'before the split' are recorded, with their clause", () => {
  const extraction = fullReading();
  extraction.facts.push({
    kind: "REFUNDS",
    subject: "Refunds",
    rawValue: "Refunds",
    refundStep: "BEFORE_SPLIT",
    chargedTo: null,
    citation: cite(
      MIDNIGHT,
      "Refunds shall be deducted from future Net Revenue.",
    ),
  });
  extraction.sections.REFUNDS.status = Status.READ;
  const read = answersFromExtraction(extraction, MIDNIGHT, self);
  assert.equal(read.answers.refunds?.value, RefundChoice.SPLIT);
  assert.equal(read.answers.refunds?.clause, "5.2");
  assert.equal(read.answers.questions.length, 0);
});

test("nothing usable is MANUAL; a misplaced quote is ignored", () => {
  const moved = fullReading();
  moved.facts = moved.facts.map((f: any) => ({
    ...f,
    citation: { ...f.citation, start: f.citation.start + 1 },
  }));
  delete (moved as any).suggestedTitle;
  for (const nothing of [
    null,
    { status: "MANUAL_REQUIRED", reason: "NOT_CONFIGURED", facts: [] },
    moved,
  ]) {
    const read = answersFromExtraction(nothing, MIDNIGHT, self);
    assert.equal(read.mode, CheckMode.MANUAL);
    assert.equal(read.answers.people.value.length, 1);
    assert.ok(read.answers.people.value[0].isSelf);
  }
});

test("clause numbers come from the nearest numbered line", () => {
  assert.equal(clauseFor(MIDNIGHT, "PayPal fees come off the top"), "4.3");
  assert.equal(clauseFor("No numbers here.", "No numbers"), undefined);
  assert.equal(clauseFor(MIDNIGHT, "not in it"), undefined);
  assert.ok(person(MIDNIGHT, "Riley Chen", "Riley Chen").citation.start > 0);
});

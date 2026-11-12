import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  answersFromExtraction,
  CheckMode,
} from "../lib/answers-from-extraction";
import {
  AnswerSource,
  FeeChoice,
  sendBlockers,
  toRules,
} from "../lib/rules-answers";
import { questionsFor } from "../lib/standard-questions";
import {
  WizardCheckStep,
  wizardCitations,
} from "../components/wizard-check-step";
import {
  answerQuestion,
  WizardQuestionsStep,
} from "../components/wizard-questions-step";
import { mergeQuestions } from "../components/agreement-creation-wizard";
import { restoreQuestions } from "../lib/wizard-persistence";
import { fullReading, MIDNIGHT, cite, Status } from "./extraction-v2-fixtures";

const unclear =
  "PayPal fees may be shared or paid by Maya Okafor, as appropriate.";
const text = `${MIDNIGHT}\n6. Unclear fees\n${unclear}`;
const document = { documentId: "doc-1", text };
const identity = { agreement: "doc-1", advance: "doc-1" };
function fixture(bearer = "Maya Okafor", quote: string | null = unclear) {
  const extraction = fullReading();
  extraction.sections.FEES.status = Status.ASK;
  extraction.issues = [
    {
      topic: "FEES",
      question: "Who should cover the PayPal fees?",
      citation: quote ? cite(text, quote) : null,
      readings: [
        {
          label: "Share the fee",
          explanation: "Take it off the top before splitting.",
          setting: { feePolicy: "BEFORE_SPLIT" },
        },
        {
          label: `${bearer} pays`,
          explanation: "Take it from that person's share.",
          setting: { feePolicy: "ORGANIZER_SHARE", feeBearer: bearer },
        },
      ],
    },
  ];
  return answersFromExtraction(extraction, text, {
    name: "Maya Okafor",
    userId: "owner",
  });
}

test("a fee ambiguity reaches Check and blocks sending instead of using the default", () => {
  const read = fixture();
  const a = read.answers;
  assert.equal(read.mode, CheckMode.FOUND_SOME);
  assert.equal(a.fees, undefined);
  assert.equal(a.questions.length, 1);
  assert.equal(a.questions[0].quote, unclear);
  assert.equal(a.questions[0].documentId, document.documentId);
  assert.ok(sendBlockers(a).some((b) => b.questionId === "fees"));
  const citations = wizardCitations(a, document, identity);
  const issue = citations.find((c) => c.id === "wizard-question-fees")!;
  assert.equal(issue.reference.excerpt, unclear);
  assert.equal(issue.attention, true);
  assert.equal(issue.highlight?.kind, "AMBIGUITY");
  assert.equal(
    text.slice(issue.highlight!.start, issue.highlight!.end),
    unclear,
  );
  const html = renderToStaticMarkup(
    createElement(WizardCheckStep, {
      answers: a,
      onChange() {},
      mode: read.mode,
      document,
      sourceDocumentIds: identity,
    }),
  );
  assert.match(html, /Needs clarification/);
  assert.match(html, /Compare possible fixes/);
  assert.match(html, /Show unclear clause/);
  assert.match(html, /is-ambiguous/);
  assert.match(html, /isn&#x27;t a full legal review/);
});

test("a default, drawer edit, or reopening cannot silently resolve an extracted ambiguity", () => {
  const a = fixture().answers;
  const edited = {
    ...a,
    fees: { value: FeeChoice.BEFORE_SPLIT, source: AnswerSource.PERSON },
  };
  assert.equal(questionsFor(edited, a.questions).length, 1);
  assert.equal(mergeQuestions(edited).questions.length, 1);
  assert.equal(restoreQuestions([], a.questions).length, 1);
  assert.ok(sendBlockers(edited).some((b) => b.questionId === "fees"));
});

test("choosing a fix changes only proposed rules, preserves the question, and states everyone's review", () => {
  const a = fixture().answers;
  const originalQuote = a.questions[0].quote;
  const next = answerQuestion(a, 0, a.questions[0].choices[1]);
  assert.equal(next.fees?.value, FeeChoice.ORGANIZER_SHARE);
  assert.equal(next.fees?.source, AnswerSource.PERSON);
  assert.equal(next.questions[0].quote, originalQuote);
  assert.equal(a.questions[0].answeredChoiceId, undefined);
  assert.equal(
    sendBlockers(next).some((b) => b.questionId === "fees"),
    false,
  );
  assert.equal(mergeQuestions(next).questions.length, 1);
  const html = renderToStaticMarkup(
    createElement(WizardQuestionsStep, {
      answers: a,
      onChange() {},
      index: 0,
      onBack() {},
      onNext() {},
    }),
  );
  assert.match(html, /possible fixes, not a decision about what is fair/);
  assert.match(html, /Everyone must approve/);
  assert.match(html, /original contract stays unchanged/);
  assert.match(html, /Not sure\? Skip for now/);
});

test("unavailable interpretations become clearly labeled proposals, never disappear", () => {
  const a = fixture("Jordan Reyes").answers;
  assert.equal(a.questions.length, 1);
  assert.match(
    a.questions[0].proposalNote ?? "",
    /can't apply every interpretation/,
  );
  assert.equal(a.questions[0].choices.length, 2);
  assert.equal(a.questions[0].quote, unclear);
});

test("missing, stale, repeated and mismatched source quotes never produce false highlights", () => {
  assert.equal(
    fixture("Maya Okafor", null).answers.questions[0].quote,
    undefined,
  );
  const a = fixture().answers;
  for (const source of [
    { ...document, documentId: "another" },
    { ...document, text: text.replace(unclear, "Different wording.") },
    { ...document, text: `${text}\n${unclear}` },
  ])
    assert.equal(
      wizardCitations(a, source, identity).some((c) => c.attention),
      false,
    );
  assert.equal(wizardCitations(a, document).length, 0);
});

test("an unclear clause remains locatable when it overlaps a settled rule citation", () => {
  const read = fixture(
    "Maya Okafor",
    "PayPal fees come off the top before the split.",
  );
  const a = {
    ...read.answers,
    fees: {
      value: FeeChoice.BEFORE_SPLIT,
      source: AnswerSource.DOCUMENT,
      quote: "PayPal fees come off the top before the split.",
    },
  };
  const citations = wizardCitations(a, document, identity);
  assert.ok(citations.some((c) => c.id === "wizard-question-fees"));
  assert.equal(
    citations.some((c) => c.id === "wizard-fees"),
    false,
  );
});

test("a later manual edit reopens its confirmation and cannot send mismatched proposed terms", async () => {
  const { reopenChangedQuestions } = await import("../lib/rules-answers");
  const a = fixture().answers;
  const chosen = answerQuestion(a, 0, a.questions[0].choices[1]);
  const changed = reopenChangedQuestions(chosen, {
    ...chosen,
    fees: { value: FeeChoice.BEFORE_SPLIT, source: AnswerSource.PERSON },
  });
  assert.equal(changed.questions[0].answeredChoiceId, undefined);
  assert.ok(sendBlockers(changed).some((b) => b.questionId === "fees"));
  const identified = {
    ...changed,
    people: {
      ...changed.people,
      value: changed.people.value.map((person, i) => ({
        ...person,
        userId: `person-${i}`,
      })),
    },
  };
  const rules = toRules(identified, {
    documentId: "doc-1",
    organizerId: "person-0",
    documentText: text,
  });
  assert.deepEqual(rules.unresolvedQuestions, [a.questions[0].text]);
  assert.equal(rules.source.origin, "HUMAN_PROPOSAL");
  // Unrelated display metadata does not erase a deliberate decision.
  assert.equal(
    reopenChangedQuestions(chosen, {
      ...chosen,
      name: { value: "New name", source: AnswerSource.PERSON },
    }).questions[0].answeredChoiceId,
    chosen.questions[0].answeredChoiceId,
  );
});

test("a choice that no longer applies cannot be marked answered after a roster edit", () => {
  const a = fixture().answers;
  const changed = {
    ...a,
    people: {
      ...a.people,
      value: a.people.value.map((p) =>
        p.isSelf ? { ...p, name: "A different organizer" } : p,
      ),
    },
  };
  const choice = a.questions[0].choices[1];
  assert.equal(choice.available?.(changed), false);
  assert.equal(
    answerQuestion(changed, 0, choice).questions[0].answeredChoiceId,
    undefined,
  );
});

test("nested and shared source highlights cycle each owner without selecting search hits", async () => {
  const { nextCitationId } = await import("../lib/document-citations");
  const ids = ["wizard-question-split", "wizard-question-fees", "search-0"];
  assert.equal(nextCitationId(ids, null), ids[0]);
  assert.equal(nextCitationId(ids, ids[0]), ids[1]);
  assert.equal(nextCitationId(ids, ids[1]), ids[0]);
  assert.equal(nextCitationId(["search-0"], null), undefined);
});

test("an answered choice reopens when a roster edit makes that choice unavailable", async () => {
  const { reopenChangedQuestions } = await import("../lib/rules-answers");
  const a = fixture().answers;
  const chosen = answerQuestion(a, 0, a.questions[0].choices[1]);
  const edited = {
    ...chosen,
    people: {
      ...chosen.people,
      value: chosen.people.value.map((p) =>
        p.isSelf ? { ...p, name: "A different organizer" } : p,
      ),
    },
  };
  const reopened = reopenChangedQuestions(chosen, edited);
  assert.equal(reopened.questions[0].answeredChoiceId, undefined);
  assert.ok(sendBlockers(reopened).some((b) => b.questionId === "fees"));
});

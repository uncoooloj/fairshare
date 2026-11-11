import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import {
  AgreementCreationWizard,
  checkProblem,
  detailsPatch,
  mergeQuestions,
  resumedAnswers,
  STAGE_STEP,
  WizardStage,
} from "../components/agreement-creation-wizard";
import { WizardStep, WizardStepper } from "../components/wizard-chrome";
import { WizardSendStep } from "../components/wizard-send-step";
import { joinNames } from "../components/wizard-sent-step";
import {
  answersFromDraft,
  answersFromExtraction,
} from "../lib/answers-from-extraction";
import { CheckMode } from "../components/wizard-check-step";
import { emptyAnswers, FeeChoice, AnswerSource } from "../lib/rules-answers";
import { StandardQuestionId } from "../lib/standard-questions";
import type { Agreement } from "../lib/model";
import { saveDraftAnswers } from "../lib/wizard-draft-store";
import { appSource } from "./app-source";

const wizard = readFileSync(
  new URL("../components/agreement-creation-wizard.tsx", import.meta.url),
  "utf8",
);
const owner = { id: "owner", name: "Maya Okafor", email: "maya@example.test" };
const self = { name: owner.name, userId: owner.id };
const noop = () => {};

const doc =
  "Revenue is split 50% to Maya, 30% to Jordan and 20% to Riley. Maya paid a $2,000 advance.";
const cite = (quote: string) => {
  const start = doc.indexOf(quote);
  return { start, end: start + quote.length, quote };
};
const extraction = {
  status: "REVIEW_REQUIRED",
  documentId: "d",
  requiresHumanReview: true,
  executable: false,
  suggestedTitle: "Midnight Sessions",
  facts: [
    {
      kind: "SHARE",
      subject: "Maya",
      rawValue: "50%",
      citation: cite("50% to Maya"),
    },
    {
      kind: "SHARE",
      subject: "Jordan",
      rawValue: "30%",
      citation: cite("30% to Jordan"),
    },
    {
      kind: "SHARE",
      subject: "Riley",
      rawValue: "20%",
      citation: cite("20% to Riley"),
    },
    {
      kind: "ADVANCE",
      subject: "Maya",
      rawValue: "$2,000",
      citation: cite("Maya paid a $2,000 advance"),
    },
  ],
  issues: [],
};

test("four progress dots: Upload · Check · People · Send", () => {
  const html = renderToStaticMarkup(
    createElement(WizardStepper, { step: WizardStep.PEOPLE }),
  );
  for (const label of ["Upload", "Check", "People", "Send"])
    assert.match(html, new RegExp(`>${label}<`));
  assert.equal((html.match(/aria-current="step"/g) || []).length, 1);
  assert.equal(STAGE_STEP[WizardStage.READING], WizardStep.UPLOAD);
  assert.equal(STAGE_STEP[WizardStage.QUESTIONS], WizardStep.CHECK);
  assert.equal(STAGE_STEP[WizardStage.SENT], undefined);
});

test("the wizard opens on Upload with the spec's copy and one privacy line", () => {
  const html = renderToStaticMarkup(
    createElement(AgreementCreationWizard, {
      owner,
      onCreate: async () => {
        throw new Error("not called");
      },
      onFinish: noop,
      onKeepDraft: noop,
      onClose: noop,
      onBusyChange: noop,
    }),
  );
  assert.match(html, /Upload your agreement/);
  assert.match(html, /We’ll read it and set up the split for you\./);
  assert.match(html, /Drop the signed agreement here or/);
  assert.match(html, /PDF, Word or text, up to 5 MB/);
  assert.match(html, /Paste the text instead/);
  assert.match(html, /Read my agreement/);
  assert.match(html, /Set it up myself/);
  assert.equal(
    (html.match(/Your document is read by AI to suggest the split/g) || [])
      .length,
    1,
  );
  assert.doesNotMatch(html, /sandbox|Agreement name|Details/i);
});

test("today's extraction maps to answers, honestly: full split → FOUND_ALL", () => {
  const read = answersFromExtraction(extraction, doc, self);
  assert.equal(read.mode, CheckMode.FOUND_ALL);
  assert.equal(read.answers.name.value, "Midnight Sessions");
  const people = read.answers.people.value;
  assert.deepEqual(
    people.map((p) => [p.name, p.basisPoints, p.isSelf]),
    [
      ["Maya", 5000, true],
      ["Jordan", 3000, false],
      ["Riley", 2000, false],
    ],
  );
  assert.equal(people[0].userId, "owner");
  assert.equal(read.answers.advance?.value.amountCents, 200000);
  assert.equal(read.answers.advance?.value.recipientKey, "owner");
  assert.equal(read.answers.advance?.source, AnswerSource.DOCUMENT);
  // The document is silent on fees and refunds: both become questions.
  assert.deepEqual(
    read.answers.questions.map((q) => q.id),
    [StandardQuestionId.FEES, StandardQuestionId.REFUNDS],
  );
});

test("names without percentages start equal; nothing read is MANUAL", () => {
  const names = answersFromExtraction(
    {
      ...extraction,
      facts: extraction.facts.map((f) =>
        f.kind === "SHARE"
          ? { ...f, kind: "RECIPIENT", rawValue: f.subject }
          : f,
      ),
    },
    doc,
    self,
  );
  assert.equal(names.mode, CheckMode.FOUND_SOME);
  assert.ok(names.equalSplitGuessed);
  assert.deepEqual(
    names.answers.people.value.map((p) => p.basisPoints),
    [3334, 3333, 3333],
  );
  for (const nothing of [
    null,
    { status: "MANUAL_REQUIRED", reason: "NOT_CONFIGURED", facts: [] },
    // A quote that isn't in the document is ignored.
    {
      ...extraction,
      facts: [
        {
          ...extraction.facts[0],
          citation: { start: 0, end: 3, quote: "50%" },
        },
      ],
    },
  ]) {
    const read = answersFromExtraction(nothing, doc, self);
    assert.equal(read.mode, CheckMode.MANUAL);
    assert.equal(read.answers.people.value.length, 1);
    assert.ok(read.answers.people.value[0].isSelf);
  }
});

test("a resumed draft keeps its dates and pending people", () => {
  const agreement = {
    workspaceId: "w",
    id: "a",
    revision: 3,
    value: {
      name: "Midnight Sessions",
      details: {
        currency: "USD",
        effectiveFrom: "2026-10-01",
        effectiveTo: null,
      },
      members: [
        { userId: "owner", displayName: "Maya Okafor", role: "ORGANIZER" },
        {
          userId: "pending:i1",
          displayName: "Jordan",
          role: "COLLABORATOR",
          pending: { invitationId: "i1", email: "jordan@example.test" },
        },
      ],
      versions: [],
    },
  } as unknown as Agreement;
  const read = answersFromDraft(agreement, extraction, doc, self);
  assert.equal(read.answers.effectiveFrom?.value, "2026-10-01");
  assert.equal(read.answers.effectiveTo?.value, null);
  const jordan = read.answers.people.value.find((p) => p.name === "Jordan");
  assert.equal(jordan?.invitationId, "i1");
  assert.equal(jordan?.email, "jordan@example.test");
  assert.equal(detailsPatch(agreement, read.answers), undefined);
  assert.deepEqual(
    detailsPatch(agreement, {
      ...read.answers,
      name: { value: "Night Sessions", source: AnswerSource.PERSON },
    }),
    { name: "Night Sessions" },
  );
});

test("Check needs two people at 100%; questions keep answers and skip when settled", () => {
  const solo = emptyAnswers(self);
  assert.match(checkProblem(solo) ?? "", /Add the people/);
  const read = answersFromExtraction(extraction, doc, self).answers;
  assert.equal(checkProblem(read), undefined);
  const answered = mergeQuestions({
    ...read,
    fees: { value: FeeChoice.BEFORE_SPLIT, source: AnswerSource.PERSON },
    questions: [{ ...read.questions[0], answeredChoiceId: "BEFORE_SPLIT" }],
  });
  assert.deepEqual(
    answered.questions.map((q) => [q.id, q.answeredChoiceId]),
    [
      [StandardQuestionId.FEES, "BEFORE_SPLIT"],
      [StandardQuestionId.REFUNDS, undefined],
    ],
  );
});

test("Send shows the summary, what blocks it, and the one safety line", () => {
  const read = answersFromExtraction(extraction, doc, self).answers;
  const html = renderToStaticMarkup(
    createElement(WizardSendStep, { answers: read }),
  );
  assert.match(html, /Ready to send/);
  assert.match(html, /Midnight Sessions/);
  assert.match(html, /Answer the refunds question|Answer the fees question/);
  assert.match(
    html,
    /Nothing is paid until everyone approves\. You can still change things if someone asks\./,
  );
  assert.equal(joinNames(["Jordan", "Riley"]), "Jordan and Riley");
  assert.equal(joinNames(["A", "B", "C"]), "A, B and C");
});

test("the draft is saved on Read my agreement; people on People; one submit on Send", () => {
  assert.match(wizard, /requestId\.current \|\|= crypto\.randomUUID\(\)/);
  assert.match(wizard, /isUnreadableDocument\(cause\)/);
  assert.match(wizard, /await addPerson\(/);
  assert.match(wizard, /await removePerson\(/);
  assert.match(wizard, /await deleteDraft\(/);
  const send = wizard.slice(wizard.indexOf("async function send()"));
  const rules = send.indexOf("toRules(answers");
  const submit = send.indexOf("await submitForApproval(");
  assert.ok(rules > 0 && submit > rules);
  assert.doesNotMatch(wizard, /consentToCloudflare|fetch\(/);
});

test("finishing lands on the agreement Overview; drafts reopen the wizard", () => {
  const app = appSource();
  assert.match(app, /function finishCreation\(agreement: Agreement\)/);
  assert.match(
    app,
    /isDraftAgreement\(a, user\.id\)\) return resumeDraft\(a\)/,
  );
  const finish = app.slice(
    app.indexOf("function finishCreation("),
    app.indexOf("async function refresh()"),
  );
  assert.match(finish, /openAgreement\(agreement\)/);
  assert.doesNotMatch(finish, /AgreementTab\.Terms/);
  assert.match(app, /onBusyChange=\{setBusy\}/);
});

test("Keep as draft keeps this device's split; resuming reconciles pending people", () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  };
  try {
    const agreement = {
      workspaceId: "w",
      id: "a",
      revision: 2,
      value: {
        name: "Untitled agreement",
        members: [
          { userId: "owner", displayName: "Maya Okafor", role: "ORGANIZER" },
          {
            userId: "pending:i2",
            displayName: "Kemi",
            role: "COLLABORATOR",
            pending: { invitationId: "i2", email: "kemi@example.test" },
          },
        ],
        versions: [],
      },
    } as unknown as Agreement;
    const resume = {
      created: {
        workspaceId: "w",
        agreementId: "a",
        documentId: "d",
        documentText: doc,
        agreement,
      },
      extraction: null,
    };
    // Nothing stored: the document's answers, titled with the draft's name.
    const fresh = resumedAnswers(resume, self);
    assert.equal(fresh.answers.name.value, "Untitled agreement");
    const set = {
      ...emptyAnswers(self),
      name: { value: "Night", source: AnswerSource.PERSON },
      people: {
        value: [
          { ...emptyAnswers(self).people.value[0], basisPoints: 6000 },
          {
            key: "k",
            name: "Kemi",
            email: "kemi@example.test",
            invitationId: "i2",
            basisPoints: 4000,
            isSelf: false,
          },
          {
            key: "t",
            name: "Tomi",
            email: "t@example.test",
            invitationId: "gone",
            basisPoints: 0,
            isSelf: false,
          },
        ],
        source: AnswerSource.PERSON,
      },
    };
    saveDraftAnswers("w", "a", set);
    const resumed = resumedAnswers(resume, self).answers;
    assert.equal(resumed.name.value, "Night");
    assert.deepEqual(
      resumed.people.value.map((p) => [p.name, p.basisPoints, p.invitationId]),
      [
        ["Maya Okafor", 6000, undefined],
        ["Kemi", 4000, "i2"],
        // Its link no longer exists on the server: it is issued again at People.
        ["Tomi", 0, undefined],
      ],
    );
  } finally {
    delete (globalThis as any).localStorage;
  }
});

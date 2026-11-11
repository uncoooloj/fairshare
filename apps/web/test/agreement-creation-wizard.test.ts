import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import {
  AgreementCreationWizard,
  checkProblem,
  clearPersonInvitation,
  detailsPatch,
  mergeQuestions,
  resumedAnswers,
  readingResultIsCurrent,
  submissionWasCommitted,
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
import { StandardQuestionId, feeQuestion } from "../lib/standard-questions";
import type { Agreement } from "../lib/model";
import { saveDraftAnswers } from "../lib/wizard-persistence";
import { appSource } from "./app-source";
import {
  MIDNIGHT,
  Status,
  fullReading,
  namesOnlyReading,
} from "./extraction-v2-fixtures";

const wizard = readFileSync(
  new URL("../components/agreement-creation-wizard.tsx", import.meta.url),
  "utf8",
);
const owner = { id: "owner", name: "Maya Okafor", email: "maya@example.test" };
const self = { name: owner.name, userId: owner.id };
const noop = () => {};

const doc = MIDNIGHT;
/** The v2 reading with the fees sentence left unread: fees default to before the split. */
const extraction = (() => {
  const reading = fullReading();
  reading.facts = reading.facts.filter((f: any) => f.kind !== "FEES");
  reading.sections.FEES.status = Status.ASK;
  return reading;
})();

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
    (html.match(/Read my agreement sends it to AI/g) || []).length,
    1,
  );
  assert.match(html, /Cloudflare Workers AI, with an Anthropic fallback/);
  assert.doesNotMatch(html, /sandbox|Agreement name|Details/i);
});

test("the v2 reading maps to answers, honestly: full split → FOUND_ALL", () => {
  const read = answersFromExtraction(fullReading(), doc, self);
  assert.equal(read.mode, CheckMode.FOUND_ALL);
  assert.equal(read.answers.name.value, "Midnight Sessions");
  const people = read.answers.people.value;
  assert.deepEqual(
    people.map((p) => [p.name, p.basisPoints, p.isSelf]),
    [
      ["Maya Okafor", 5000, true],
      ["Jordan Reyes", 3000, false],
      ["Riley Chen", 2000, false],
    ],
  );
  assert.equal(people[0].userId, "owner");
  assert.equal(read.answers.advance?.value.amountCents, 200000);
  assert.equal(read.answers.advance?.value.recipientKey, "owner");
  assert.equal(read.answers.advance?.source, AnswerSource.DOCUMENT);
  assert.equal(read.answers.fees?.value, FeeChoice.BEFORE_SPLIT);
  // Refunds are never asked; silent fees aren't either (they come off the top).
  assert.deepEqual(read.answers.questions, []);
  const silent = answersFromExtraction(extraction, doc, self);
  assert.deepEqual(silent.answers.questions, []);
  assert.equal(silent.answers.fees, undefined);
  assert.equal(silent.mode, CheckMode.FOUND_ALL);
});

test("names only from prose are not an agreement; nothing read is MANUAL", () => {
  const only = namesOnlyReading();
  const names = answersFromExtraction(only.extraction, only.doc, self);
  assert.equal(names.mode, CheckMode.NOT_AGREEMENT);
  assert.equal(names.equalSplitGuessed, false);
  assert.deepEqual(
    names.answers.people.value.map((p) => [p.name, p.basisPoints]),
    [["Maya Okafor", 10000]],
  );
  for (const nothing of [
    null,
    { status: "MANUAL_REQUIRED", reason: "NOT_CONFIGURED", facts: [] },
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
          displayName: "Jordan Reyes",
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
  const jordan = read.answers.people.value.find(
    (p) => p.name === "Jordan Reyes",
  );
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
  const fees = feeQuestion(read);
  const answered = mergeQuestions({
    ...read,
    fees: { value: FeeChoice.BEFORE_SPLIT, source: AnswerSource.PERSON },
    questions: [{ ...fees, answeredChoiceId: "BEFORE_SPLIT" }],
  });
  assert.deepEqual(
    answered.questions.map((q) => [q.id, q.answeredChoiceId]),
    [[StandardQuestionId.FEES, "BEFORE_SPLIT"]],
  );
  // Nothing settled is asked again, and no refunds question appears.
  assert.deepEqual(mergeQuestions(read).questions, []);
});

test("Send shows the summary, what blocks it, and the one safety line", () => {
  const read = answersFromExtraction(extraction, doc, self).answers;
  const html = renderToStaticMarkup(
    createElement(WizardSendStep, { answers: read }),
  );
  assert.match(html, /Almost ready to send/);
  assert.match(html, /Midnight Sessions/);
  assert.match(html, /Has Maya Okafor already paid the \$2,000\?/);
  assert.doesNotMatch(html, /[Rr]efund/);
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

test("a lost submit reply is recovered only for this attempt's newly sent rules", () => {
  const before = {
    workspaceId: "w",
    id: "a",
    revision: 4,
    value: { versions: [] },
  } as unknown as Agreement;
  const rules = {
    currency: "USD",
    shares: [{ userId: "owner", basisPoints: 10000 }],
    feePolicy: "BEFORE_SPLIT",
    source: {
      origin: "HUMAN_PROPOSAL",
      documentId: "d",
      clause: "",
      excerpt: "",
    },
    unresolvedQuestions: [],
  } as any;
  const committed = {
    ...before,
    revision: 5,
    value: {
      ...before.value,
      versions: [{ id: 1, status: "AWAITING_APPROVAL", rules }],
    },
  } as Agreement;
  assert.equal(submissionWasCommitted(before, committed, rules), true);
  assert.equal(
    submissionWasCommitted(
      before,
      {
        ...committed,
        value: {
          ...committed.value,
          versions: [
            {
              ...committed.value.versions[0],
              rules: { ...rules, feePolicy: "ORGANIZER" },
            },
          ],
        },
      },
      rules,
    ),
    false,
  );
  assert.equal(
    submissionWasCommitted(
      before,
      { ...committed, value: { ...committed.value, versions: [] } },
      rules,
    ),
    false,
  );
});

test("manual reading exit keeps manual answers when the old read settles", () => {
  const manual = answersFromDraft(
    {
      workspaceId: "w",
      id: "a",
      revision: 1,
      value: { name: "Draft", members: [], versions: [] },
    } as unknown as Agreement,
    null,
    doc,
    self,
  ).answers;
  const seeded = {
    ...manual,
    name: { value: "Manual title", source: AnswerSource.PERSON },
  };
  assert.equal(readingResultIsCurrent(2, 1), false);
  assert.equal(seeded.name.value, "Manual title");
  assert.equal(readingResultIsCurrent(2, 2), true);
});

test("removing an edited pending seat clears its stale invitation before retry", () => {
  const before = {
    ...emptyAnswers(self),
    people: {
      value: [
        ...emptyAnswers(self).people.value,
        {
          key: "jordan",
          name: "Jordan",
          email: "new@example.test",
          invitationId: "old-invite",
          basisPoints: 0,
          isSelf: false,
        },
      ],
      source: AnswerSource.PERSON,
    },
  };
  const checkpointed = clearPersonInvitation(before, "jordan");
  assert.equal(checkpointed.people.value[1].invitationId, undefined);
  assert.equal(before.people.value[1].invitationId, "old-invite");
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

test("resuming rebuilds an unanswered advance question and replays an answered no", () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  };
  try {
    const review = fullReading();
    review.facts = review.facts.map((fact: any) =>
      fact.kind === "ADVANCE" ? { ...fact, recoupedBeforeSplit: null } : fact,
    );
    review.sections.ADVANCE.status = Status.ASK;
    const agreement = {
      workspaceId: "w-advance",
      id: "a-advance",
      revision: 1,
      value: {
        name: "Advance review",
        members: [
          { userId: "owner", displayName: "Maya Okafor", role: "ORGANIZER" },
        ],
        versions: [],
      },
    } as unknown as Agreement;
    const resume = {
      created: {
        workspaceId: "w-advance",
        agreementId: "a-advance",
        documentId: "d",
        documentText: MIDNIGHT,
        agreement,
      },
      extraction: review,
    };
    const initial = answersFromExtraction(review, MIDNIGHT, self).answers;
    const question = initial.questions.find((item) => item.id === "advance")!;
    saveDraftAnswers("w-advance", "a-advance", initial);
    const reopened = resumedAnswers(resume, self).answers;
    assert.equal(
      reopened.questions.find((item) => item.id === "advance")?.quote,
      question.quote,
    );
    const no = question.choices.find((item) => item.id === "not-paid-back")!;
    const answered = no.apply(initial);
    answered.questions = answered.questions.map((item) =>
      item.id === question.id ? { ...item, answeredChoiceId: no.id } : item,
    );
    saveDraftAnswers("w-advance", "a-advance", answered);
    const reopenedNo = resumedAnswers(resume, self).answers;
    assert.equal(reopenedNo.advance, undefined);
    assert.equal(
      reopenedNo.questions.find((item) => item.id === "advance")
        ?.answeredChoiceId,
      no.id,
    );
  } finally {
    delete (globalThis as any).localStorage;
  }
});

test("resuming never overwrites a later manual edit with a saved reading choice", () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  };
  try {
    const review = fullReading();
    review.facts = review.facts.map((fact: any) =>
      fact.kind === "ADVANCE" ? { ...fact, recoupedBeforeSplit: null } : fact,
    );
    review.sections.ADVANCE.status = Status.ASK;
    const agreement = {
      workspaceId: "w-manual",
      id: "a-manual",
      revision: 1,
      value: {
        name: "Advance review",
        members: [
          { userId: "owner", displayName: "Maya Okafor", role: "ORGANIZER" },
        ],
        versions: [],
      },
    } as unknown as Agreement;
    const resume = {
      created: {
        workspaceId: "w-manual",
        agreementId: "a-manual",
        documentId: "d",
        documentText: MIDNIGHT,
        agreement,
      },
      extraction: review,
    };
    const initial = answersFromExtraction(review, MIDNIGHT, self).answers;
    const question = initial.questions.find((item) => item.id === "advance")!;
    const yes = question.choices.find((item) => item.id === "paid-back-first")!;
    const manuallyEdited = yes.apply(initial);
    manuallyEdited.advance = {
      value: { recipientKey: "owner", amountCents: 123_400 },
      source: AnswerSource.PERSON,
    };
    manuallyEdited.questions = manuallyEdited.questions.map((item) =>
      item.id === question.id ? { ...item, answeredChoiceId: yes.id } : item,
    );
    saveDraftAnswers("w-manual", "a-manual", manuallyEdited);
    const reopened = resumedAnswers(resume, self).answers;
    assert.equal(reopened.advance?.value.amountCents, 123_400);
    assert.equal(
      reopened.questions.find((item) => item.id === "advance")
        ?.answeredChoiceId,
      undefined,
    );
    const noRecipient = {
      ...manuallyEdited,
      advance: undefined,
      people: {
        ...manuallyEdited.people,
        value: manuallyEdited.people.value.map((person) =>
          person.key === "owner" ? { ...person, name: "Renamed" } : person,
        ),
      },
    };
    saveDraftAnswers("w-manual", "a-manual", noRecipient);
    const reopenedNoRecipient = resumedAnswers(resume, self).answers;
    assert.equal(reopenedNoRecipient.advance, undefined);
    assert.equal(
      reopenedNoRecipient.questions.find((item) => item.id === "advance")
        ?.answeredChoiceId,
      undefined,
    );
  } finally {
    delete (globalThis as any).localStorage;
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import {
  AgreementCreationWizard,
  checkProblem,
  clearPersonInvitation,
  deleteDraftForReplacement,
  detailsPatch,
  mergeQuestions,
  resumedAnswers,
  readingResultIsCurrent,
  submissionWasCommitted,
  resumePlace,
  stageDetail,
  STAGE_STEP,
  syncPendingPeople,
  WizardStage,
  type PeopleApi,
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
import { ApiError, type Agreement } from "../lib/model";
import {
  inviteLinksKey,
  loadDraftAnswers,
  loadInviteLinks,
  saveDraftAnswers,
  saveInviteLinks,
} from "../lib/wizard-persistence";
import {
  inviteIsLive,
  liveInviteLink,
  shareMethod,
  ShareMethod,
} from "../components/wizard-sent-step";
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
const wizardCss = readFileSync(
  new URL("../app/wizard.css", import.meta.url),
  "utf8",
);
const wizardCheckCss = readFileSync(
  new URL("../app/wizard-check.css", import.meta.url),
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

test("the wizard opens on Upload with the spec's copy and clear actions", () => {
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
  assert.doesNotMatch(html, /Read my agreement sends it to AI/);
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
  assert.match(html, /<h1[^>]*>Review<\/h1>/);
  assert.match(html, /Check the details, then send it for approval\./);
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

test("the draft is saved on Read my agreement; people and one submit on Send", () => {
  assert.match(wizard, /requestId\.current \|\|= crypto\.randomUUID\(\)/);
  assert.match(wizard, /isUnreadableDocument\(cause\)/);
  assert.match(wizard, /await calls\.addPerson\(/);
  assert.match(wizard, /await calls\.removePerson\(/);
  assert.match(wizard, /await deleteDraft\(/);
  const send = wizard.slice(wizard.indexOf("async function send()"));
  const sync = send.indexOf("await syncPeople(");
  const rules = send.indexOf("toRules(synced.answers");
  const submit = send.indexOf("await submitForApproval(");
  assert.ok(sync > 0 && rules > sync && submit > rules);
  // Leaving People (and every other screen change) is local: no server call, no link.
  const leave = wizard.slice(
    wizard.indexOf("function leavePeople()"),
    wizard.indexOf("async function send()"),
  );
  assert.doesNotMatch(leave, /await|syncPeople|addPerson|replacePersonLink/);
  // Background work never disables the email fields.
  assert.doesNotMatch(
    wizard.slice(wizard.indexOf("<PeopleStep")),
    /^\s*disabled=\{busy\}\s*selfEmail/m,
  );
  assert.doesNotMatch(wizard, /consentToCloudflare|fetch\(/);
});

test("replacement confirms a lost delete response before local cleanup", async () => {
  const original = globalThis.fetch;
  const calls: Array<{ method: string; url: string }> = [];
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url: input });
    if (init?.method === "DELETE")
      return new Response(JSON.stringify({ error: { code: "TEMPORARY" } }), {
        status: 503,
      });
    return new Response(JSON.stringify({ error: { code: "NOT_FOUND" } }), {
      status: 404,
    });
  }) as typeof fetch;
  try {
    await deleteDraftForReplacement("w", "a", 7);
  } finally {
    globalThis.fetch = original;
  }
  assert.deepEqual(calls, [
    {
      method: "DELETE",
      url: "/api/service/workspaces/w/collaborations/a?expectedRevision=7",
    },
    { method: "GET", url: "/api/service/workspaces/w/collaborations/a" },
  ]);
});

test("replacement retains the original error unless a read proves deletion", async () => {
  const original = new ApiError("Try again", 503, "TEMPORARY");
  await assert.rejects(
    deleteDraftForReplacement("w", "a", 7, {
      deleteDraft: async () => {
        throw original;
      },
      readDraft: async () => ({ id: "a" }) as Agreement,
    }),
    (cause: unknown) => cause === original,
  );
  await assert.rejects(
    deleteDraftForReplacement("w", "a", 7, {
      deleteDraft: async () => {
        throw original;
      },
      readDraft: async () => {
        throw new ApiError("No access", 403, "FORBIDDEN");
      },
    }),
    (cause: unknown) => cause === original,
  );
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

test("history navigation asks the wizard to close before unmounting local work", () => {
  assert.match(
    wizard,
    /onLeaveAttempt\?: \(attempt: \(\) => boolean\) => void/,
  );
  assert.match(wizard, /onLeaveAttempt\(attemptLeave\)/);
  assert.match(wizard, /setClosing\(true\);\s*return false;/);
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

/** A tiny server for People: pending seats, revisions, and every call counted. */
function fakePeopleServer(initial: Agreement) {
  let agreement = structuredClone(initial) as any;
  let next = 0;
  const count = { add: 0, remove: 0, replace: 0 };
  const bump = () => {
    agreement = { ...agreement, revision: agreement.revision + 1 };
    return agreement as Agreement;
  };
  const checkRevision = (expected: number) =>
    assert.equal(expected, agreement.revision, "stale revision");
  const calls: PeopleApi = {
    addPerson: async (_w, _a, revision, person) => {
      checkRevision(revision);
      count.add++;
      const id = `inv${++next}`;
      agreement.value.members = [
        ...agreement.value.members,
        {
          userId: `pending:${id}`,
          displayName: person.name,
          role: "COLLABORATOR",
          pending: { invitationId: id, email: person.email },
        },
      ];
      return {
        agreement: bump(),
        invitation: {
          id,
          token: `token-${id}`,
          expiresAt: Date.now() + 48 * 3600000,
        },
      } as any;
    },
    removePerson: async (_w, _a, revision, userId) => {
      checkRevision(revision);
      count.remove++;
      agreement.value.members = agreement.value.members.filter(
        (m: any) => m.userId !== userId,
      );
      return bump();
    },
    replacePersonLink: async (_w, _a, revision, userId) => {
      checkRevision(revision);
      count.replace++;
      const id = `inv${++next}`;
      agreement.value.members = agreement.value.members.map((m: any) =>
        m.userId === userId
          ? {
              ...m,
              userId: `pending:${id}`,
              pending: { ...m.pending, invitationId: id },
            }
          : m,
      );
      return {
        agreement: bump(),
        invitation: {
          id,
          token: `token-${id}`,
          expiresAt: Date.now() + 48 * 3600000,
        },
      } as any;
    },
  };
  return { calls, count, current: () => agreement as Agreement };
}

const draftAgreement = (members: unknown[] = []) =>
  ({
    workspaceId: "w",
    id: "a",
    revision: 1,
    value: {
      name: "Night",
      members: [
        { userId: "owner", displayName: "Maya Okafor", role: "ORGANIZER" },
        ...members,
      ],
      versions: [],
    },
  }) as unknown as Agreement;

const withPeople = (people: any[]) => ({
  ...emptyAnswers(self),
  name: { value: "Night", source: AnswerSource.PERSON },
  people: {
    value: [
      { ...emptyAnswers(self).people.value[0], basisPoints: 5000 },
      ...people,
    ],
    source: AnswerSource.PERSON,
  },
});

test("links are made once per person at Send; a second Send or retry makes none", async () => {
  const server = fakePeopleServer(draftAgreement());
  const answers = withPeople([
    {
      key: "j",
      name: "Jordan ",
      email: "j@example.test",
      basisPoints: 3000,
      isSelf: false,
    },
    {
      key: "r",
      name: "Riley",
      email: "r@example.test",
      basisPoints: 2000,
      isSelf: false,
    },
  ]);
  const saved: Record<string, { token: string; expiresAt: number }> = {};
  const first = await syncPendingPeople({
    workspaceId: "w",
    agreementId: "a",
    agreement: server.current(),
    answers,
    links: {},
    onLink: (id, token, expiresAt) => (saved[id] = { token, expiresAt }),
    calls: server.calls,
  });
  assert.deepEqual(server.count, { add: 2, remove: 0, replace: 0 });
  assert.deepEqual(Object.keys(saved), ["inv1", "inv2"]);
  assert.equal(saved.inv1.token, "token-inv1");
  assert.equal(saved.inv2.token, "token-inv2");
  assert.deepEqual(
    first.answers.people.value.map((p) => [p.name, p.invitationId]),
    [
      ["Maya Okafor", undefined],
      ["Jordan", "inv1"],
      ["Riley", "inv2"],
    ],
  );
  // Back to People and Send again, five times over: nothing new is made or revoked.
  for (let i = 0; i < 5; i++)
    await syncPendingPeople({
      workspaceId: "w",
      agreementId: "a",
      agreement: server.current(),
      answers: first.answers,
      links: saved,
      calls: server.calls,
    });
  assert.deepEqual(server.count, { add: 2, remove: 0, replace: 0 });
});

test("a person saved by an older build gets one link, once; edits and removals replace seats", async () => {
  const server = fakePeopleServer(
    draftAgreement([
      {
        userId: "pending:old",
        displayName: "Jordan",
        role: "COLLABORATOR",
        pending: { invitationId: "old", email: "j@example.test" },
      },
      {
        userId: "pending:gone",
        displayName: "Sam",
        role: "COLLABORATOR",
        pending: { invitationId: "gone", email: "s@example.test" },
      },
    ]),
  );
  const answers = withPeople([
    {
      key: "j",
      name: "Jordan",
      email: "j@example.test",
      invitationId: "old",
      basisPoints: 5000,
      isSelf: false,
    },
  ]);
  const saved: Record<string, { token: string; expiresAt: number }> = {};
  const once = await syncPendingPeople({
    workspaceId: "w",
    agreementId: "a",
    agreement: server.current(),
    answers,
    links: {},
    onLink: (id, token, expiresAt) => (saved[id] = { token, expiresAt }),
    calls: server.calls,
  });
  assert.deepEqual(server.count, { add: 0, remove: 1, replace: 1 });
  await syncPendingPeople({
    workspaceId: "w",
    agreementId: "a",
    agreement: server.current(),
    answers: once.answers,
    links: saved,
    calls: server.calls,
  });
  assert.deepEqual(server.count, { add: 0, remove: 1, replace: 1 });
  // A changed email: the old seat goes and one new seat (and link) is made.
  const edited = {
    ...once.answers,
    people: {
      ...once.answers.people,
      value: once.answers.people.value.map((p) =>
        p.key === "j" ? { ...p, email: "jordan@example.test" } : p,
      ),
    },
  };
  await syncPendingPeople({
    workspaceId: "w",
    agreementId: "a",
    agreement: server.current(),
    answers: edited,
    links: saved,
    calls: server.calls,
  });
  assert.deepEqual(server.count, { add: 1, remove: 2, replace: 1 });
});

test("resume lands where the organizer stopped, or the earliest screen that needs them", () => {
  const ready = withPeople([
    {
      key: "j",
      name: "Jordan",
      email: "j@example.test",
      basisPoints: 5000,
      isSelf: false,
    },
  ]);
  const twoQuestions = mergeQuestions({ ...ready, fees: undefined });
  const at = (answers: any, stage: string, questionIndex = 0) =>
    resumePlace(answers, { stage, questionIndex }, owner.email);
  assert.deepEqual(at(ready, WizardStage.SEND), {
    stage: WizardStage.SEND,
    questionIndex: 0,
  });
  assert.equal(at(ready, WizardStage.PEOPLE).stage, WizardStage.PEOPLE);
  assert.equal(at(ready, WizardStage.CHECK).stage, WizardStage.CHECK);
  // No place saved (older draft), or a screen a draft can't reopen on: Check.
  assert.equal(resumePlace(ready, undefined).stage, WizardStage.CHECK);
  assert.equal(at(ready, WizardStage.SENT).stage, WizardStage.CHECK);
  assert.equal(at(ready, "nonsense").stage, WizardStage.CHECK);
  // Send with a missing email goes back to People.
  const noEmail = withPeople([
    { key: "j", name: "Jordan", basisPoints: 5000, isSelf: false },
  ]);
  assert.equal(at(noEmail, WizardStage.SEND).stage, WizardStage.PEOPLE);
  // The split no longer adds up: Check, wherever it was closed.
  const broken = withPeople([
    {
      key: "j",
      name: "Jordan",
      email: "j@example.test",
      basisPoints: 100,
      isSelf: false,
    },
  ]);
  assert.equal(at(broken, WizardStage.SEND).stage, WizardStage.CHECK);
  // Questions: the saved index, clamped; none left means People.
  if (twoQuestions.questions.length) {
    const last = twoQuestions.questions.length - 1;
    assert.deepEqual(at(twoQuestions, WizardStage.QUESTIONS, 9), {
      stage: WizardStage.QUESTIONS,
      questionIndex: last,
    });
  }
  assert.equal(
    at({ ...ready, questions: [] }, WizardStage.QUESTIONS, 1).stage,
    WizardStage.PEOPLE,
  );
});

test("the place and invite links are stored per draft, merged, and read back", () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  };
  try {
    const answers = withPeople([]);
    saveDraftAnswers("w", "a", answers, {
      stage: WizardStage.QUESTIONS,
      questionIndex: 1,
    });
    assert.deepEqual(loadDraftAnswers("w", "a")?.place, {
      stage: WizardStage.QUESTIONS,
      questionIndex: 1,
    });
    const expiresAt = Date.now() + 48 * 3600000;
    saveInviteLinks("w", "a", { i1: { token: "t1", expiresAt } });
    saveInviteLinks("w", "a", { i2: { token: "t2", expiresAt } });
    assert.equal(inviteLinksKey("w", "a"), "fairshare:invite-links:v1:w:a");
    assert.deepEqual(loadInviteLinks("w", "a"), { i1: "t1", i2: "t2" });
    store.set(inviteLinksKey("w", "a"), "not json");
    assert.deepEqual(loadInviteLinks("w", "a"), {});
  } finally {
    delete (globalThis as any).localStorage;
  }
});

test("the stepper says which question you're on; Share falls back to copy", () => {
  assert.equal(stageDetail(WizardStage.QUESTIONS, 0, 2), "Question 1 of 2");
  assert.equal(stageDetail(WizardStage.QUESTIONS, 5, 2), "Question 2 of 2");
  assert.equal(stageDetail(WizardStage.CHECK, 0, 2), undefined);
  const html = renderToStaticMarkup(
    createElement(WizardStepper, {
      step: WizardStep.CHECK,
      detail: "Question 1 of 2",
    }),
  );
  assert.match(html, /wiz-stepper-detail[^>]*>.*Question 1 of 2/);
  assert.equal((html.match(/aria-current="step"/g) || []).length, 1);
  const data = { url: "https://example.test" };
  assert.equal(shareMethod(undefined, data), ShareMethod.COPY);
  assert.equal(shareMethod({} as any, data), ShareMethod.COPY);
  assert.equal(
    shareMethod({ share: async () => {}, canShare: () => false } as any, data),
    ShareMethod.COPY,
  );
  assert.equal(
    shareMethod({ share: async () => {} } as any, data),
    ShareMethod.SHEET,
  );
  assert.equal(inviteIsLive("token", 1001, 1000), true);
  assert.equal(inviteIsLive("token", 1000, 1000), false);
  assert.equal(inviteIsLive("token", undefined, 1000), false);
  const invite = {
    key: "invite-1",
    name: "Riley Chen",
    email: "riley@example.test",
    token: "token",
    expiresAt: 1000,
  };
  assert.equal(
    liveInviteLink(invite, "https://fairshare.test", 999),
    "https://fairshare.test/invitation#token=agreement%3Atoken",
    "a mounted row may render while its link is live",
  );
  assert.equal(
    liveInviteLink(invite, "https://fairshare.test", 1000),
    undefined,
    "the Copy and Share handlers must recheck at the click boundary",
  );
  const sentStep = readFileSync(
    new URL("../components/wizard-sent-step.tsx", import.meta.url),
    "utf8",
  );
  const copy = sentStep
    .split("async function copy()")[1]
    .split("async function share()")[0];
  const share = sentStep
    .split("async function share()")[1]
    .split("return (")[0];
  assert.match(
    copy,
    /const currentLink = liveInviteLink\(invite, location\.origin\)/,
  );
  assert.match(
    share,
    /const currentLink = liveInviteLink\(invite, location\.origin\)/,
  );
});

test("not an agreement: no footer Continue, and uploading again discards the first draft", () => {
  const only = namesOnlyReading();
  const agreement = {
    workspaceId: "w",
    id: "a",
    revision: 1,
    value: {
      name: "Untitled agreement",
      members: [
        { userId: "owner", displayName: "Maya Okafor", role: "ORGANIZER" },
      ],
      versions: [],
    },
  } as unknown as Agreement;
  const render = (extraction: unknown) =>
    renderToStaticMarkup(
      createElement(AgreementCreationWizard, {
        owner,
        resume: {
          created: {
            workspaceId: "w",
            agreementId: "a",
            documentId: "d",
            documentText: only.doc,
            agreement,
          },
          extraction,
        },
        onCreate: async () => {
          throw new Error("not called");
        },
        onFinish: noop,
        onKeepDraft: noop,
        onClose: noop,
        onBusyChange: noop,
      }),
    );
  const html = render(only.extraction);
  assert.match(
    html,
    /This doesn(’|'|&#x27;)t look like a revenue-share agreement/,
  );
  assert.match(html, /Upload a different file/);
  assert.doesNotMatch(html, /wiz-footer|>Continue</);
  // An ordinary manual Check keeps its Continue.
  assert.match(render(null), />Continue</);
  // Upload again deletes the first draft and starts clean; Set it up myself leaves the screen.
  const again = wizard.slice(
    wizard.indexOf("async function uploadAgain()"),
    wizard.indexOf("async function discard()"),
  );
  assert.match(again, /await deleteDraftForReplacement\(/);
  assert.match(again, /clearDraftAnswers\(/);
  assert.match(again, /setCreated\(null\)/);
  assert.match(again, /setStage\(WizardStage\.UPLOAD\)/);
  assert.match(wizard, /onUploadAgain=\{\(\) => void uploadAgain\(\)\}/);
  assert.match(
    wizard,
    /onSetUpMyself=\{\(\) => setCheckMode\(CheckMode\.MANUAL\)\}/,
  );
});

test("a long source document widens the composed Check frame and stacks before narrow columns", () => {
  const longDocument = Array.from(
    { length: 160 },
    (_, index) => `Clause ${index + 1}: the revenue split remains as agreed.`,
  ).join("\n");
  const agreement = {
    workspaceId: "w",
    id: "a",
    revision: 1,
    value: {
      name: "Midnight Sessions",
      members: [
        { userId: "owner", displayName: owner.name, role: "ORGANIZER" },
      ],
      versions: [],
    },
  } as unknown as Agreement;
  const html = renderToStaticMarkup(
    createElement(AgreementCreationWizard, {
      owner,
      resume: {
        created: {
          workspaceId: "w",
          agreementId: "a",
          documentId: "source",
          documentText: longDocument,
          agreement,
        },
        extraction: fullReading(),
      },
      onCreate: async () => {
        throw new Error("not called");
      },
      onFinish: noop,
      onKeepDraft: noop,
      onClose: noop,
      onBusyChange: noop,
    }),
  );
  assert.ok(longDocument.length >= 3200);
  assert.match(html, /class="wiz"/);
  assert.match(html, /class="wiz-stepper"/);
  assert.match(html, /class="wiz-main"/);
  assert.match(html, /class="wc-reader"/);
  assert.match(
    wizardCss,
    /\.wiz-scroll:has\(\.wc-reader\)[\s\S]*?padding-left:/,
  );
  assert.match(
    wizardCss,
    /\.wiz-scroll:has\(\.wc-reader\) > \.wiz-main\s*\{\s*max-width: 1280px;/,
  );
  assert.match(wizardCss, /\.wiz-stepper\s*\{\s*max-width: 560px;/);
  assert.doesNotMatch(
    wizardCss,
    /\.wiz-scroll:has\(\.wc-reader\) > \.wiz-stepper/,
  );
  assert.match(
    wizardCss,
    /\.wiz-main:has\(\.wiz-send\)\s*\{\s*max-width: 886px;/,
  );
  assert.doesNotMatch(
    wizardCss,
    /\.wiz-scroll:has\(\.wiz-send\) \.wiz-stepper/,
  );
  assert.match(
    wizardCheckCss,
    /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    wizardCheckCss,
    /@media \(max-width: 899px\)[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/,
  );
});

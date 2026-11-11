import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeQuestions,
  resumedAnswers,
} from "../components/agreement-creation-wizard";
import {
  AnswerSource,
  emptyAnswers,
  FeeChoice,
  RefundChoice,
  type AgreementAnswers,
} from "../lib/rules-answers";
import { StandardQuestionId, feeQuestion } from "../lib/standard-questions";
import type { Agreement } from "../lib/model";
import {
  clearDraftAnswers,
  draftAnswersKey,
  forgetStaleInviteTokens,
  inviteLinksKey,
  loadDraftAnswers,
  loadInviteLinks,
  restoreQuestions,
  saveDraftAnswers,
  saveInviteLinks,
} from "../lib/wizard-persistence";

const self = { name: "Maya Okafor", userId: "owner" };
const doc =
  "Midnight Sessions. Revenue is shared between Maya, Jordan and Riley.";

function withStorage(run: (store: Map<string, string>) => void) {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  };
  try {
    run(store);
  } finally {
    delete (globalThis as any).localStorage;
  }
}

/** 50/30/20 with a $2,000 advance Maya already paid, fees answered on the Questions step
 * (asked because the document wanted someone Fairshare can't charge). */
function midnight(): AgreementAnswers {
  const base = emptyAnswers(self);
  const answers: AgreementAnswers = {
    ...base,
    name: { value: "Midnight Sessions", source: AnswerSource.PERSON },
    effectiveFrom: { value: "2026-10-01", source: AnswerSource.PERSON },
    people: {
      value: [
        { ...base.people.value[0], basisPoints: 5000 },
        { key: "j", name: "Jordan", basisPoints: 3000, isSelf: false },
        { key: "r", name: "Riley", basisPoints: 2000, isSelf: false },
      ],
      source: AnswerSource.PERSON,
    },
    advance: {
      value: {
        recipientKey: base.people.value[0].key,
        amountCents: 200000,
        alreadyPaid: true,
      },
      source: AnswerSource.PERSON,
    },
  };
  // Ask the fee question, then answer it the way the Questions step does.
  const asked = { ...answers, questions: [feeQuestion(answers)] };
  const fees = asked.questions.find((q) => q.id === StandardQuestionId.FEES)!;
  const choice = fees.choices.find((c) => c.id === FeeChoice.BEFORE_SPLIT)!;
  return {
    ...choice.apply(asked),
    questions: asked.questions.map((q) =>
      q.id === fees.id ? { ...q, answeredChoiceId: choice.id } : q,
    ),
  };
}

const draft = {
  workspaceId: "w",
  id: "a",
  revision: 2,
  value: {
    name: "Untitled agreement",
    members: [
      { userId: "owner", displayName: "Maya Okafor", role: "ORGANIZER" },
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
    agreement: draft,
  },
  extraction: null,
};

test("the whole answers round-trip under a versioned key, without tokens", () => {
  withStorage((store) => {
    const answers = midnight();
    // Anything extra on a person (an invite link, say) is never written.
    (answers.people.value[1] as any).token = "secret-invite-token";
    (answers.advance!.value as any).token = "secret-advance-token";
    saveDraftAnswers("w", "a", answers);
    assert.deepEqual([...store.keys()], [draftAnswersKey("w", "a")]);
    assert.match(draftAnswersKey("w", "a"), /:v1:/);
    const raw = store.get(draftAnswersKey("w", "a"))!;
    assert.doesNotMatch(raw, /token|secret/);
    const loaded = loadDraftAnswers("w", "a")!;
    assert.deepEqual(
      loaded.answers.people.value.map((p) => p.basisPoints),
      [5000, 3000, 2000],
    );
    assert.deepEqual(loaded.answers.advance?.value, {
      recipientKey: answers.advance!.value.recipientKey,
      amountCents: 200000,
      alreadyPaid: true,
    });
    assert.equal(loaded.answers.fees?.value, FeeChoice.BEFORE_SPLIT);
    assert.deepEqual(
      loaded.questions.find((q) => q.id === StandardQuestionId.FEES),
      { id: StandardQuestionId.FEES, answeredChoiceId: FeeChoice.BEFORE_SPLIT },
    );
    clearDraftAnswers("w", "a");
    assert.equal(store.size, 0);
    assert.equal(loadDraftAnswers("w", "a"), undefined);
  });
});

test("a reopened draft gets back the split, advance and answered questions", () => {
  withStorage(() => {
    saveDraftAnswers("w", "a", midnight());
    const back = resumedAnswers(resume, self).answers;
    assert.equal(back.name.value, "Midnight Sessions");
    assert.equal(back.effectiveFrom?.value, "2026-10-01");
    assert.deepEqual(
      back.people.value.map((p) => [p.name, p.basisPoints]),
      [
        ["Maya Okafor", 5000],
        ["Jordan", 3000],
        ["Riley", 2000],
      ],
    );
    assert.equal(back.advance?.value.alreadyPaid, true);
    assert.equal(back.fees?.value, FeeChoice.BEFORE_SPLIT);
    // Without a reading nothing raises the fee question again, and refunds are never asked.
    assert.deepEqual(back.questions, []);
  });
});

test("legacy saves migrate through the versioned whitelist without leaking extra fields", () => {
  withStorage((store) => {
    const { questions: _q, ...legacy } = midnight();
    store.set(
      "fairshare:wizard-draft:w:a",
      JSON.stringify({
        ...legacy,
        ignored: "not stored",
        people: {
          ...legacy.people,
          token: "not-stored",
          value: legacy.people.value.map((person, index) => ({
            ...person,
            token: `invite-${index}`,
            extra: true,
          })),
        },
        advance: {
          ...legacy.advance,
          value: { ...legacy.advance!.value, token: "not-stored" },
        },
        questionAnswers: [
          {
            id: StandardQuestionId.FEES,
            answeredChoiceId: FeeChoice.BEFORE_SPLIT,
            ignored: true,
          },
        ],
      }),
    );
    const loaded = loadDraftAnswers("w", "a")!;
    assert.equal(loaded.answers.people.value[0].basisPoints, 5000);
    assert.equal(store.has("fairshare:wizard-draft:w:a"), false);
    const raw = store.get(draftAnswersKey("w", "a"))!;
    assert.doesNotMatch(raw, /token|extra|ignored|invite/);
    assert.equal(
      resumedAnswers(resume, self).answers.fees?.value,
      FeeChoice.BEFORE_SPLIT,
    );
    store.set(
      draftAnswersKey("w", "a"),
      JSON.stringify({ version: 2, answers: legacy, questions: [] }),
    );
    assert.equal(loadDraftAnswers("w", "a"), undefined);
    store.set(draftAnswersKey("w", "a"), "{not json");
    assert.equal(loadDraftAnswers("w", "a"), undefined);
    clearDraftAnswers("w", "a");
    assert.equal(store.size, 0);
  });
});

test("a failed legacy migration keeps the old key", () => {
  withStorage((store) => {
    const { questions: _q, ...legacy } = midnight();
    const oldKey = "fairshare:wizard-draft:w:a";
    store.set(oldKey, JSON.stringify(legacy));
    (globalThis as any).localStorage.setItem = () => {
      throw new Error("full");
    };
    assert.equal(
      loadDraftAnswers("w", "a")?.answers.people.value[0].name,
      "Maya Okafor",
    );
    assert.ok(store.has(oldKey));
    assert.equal(store.has(draftAnswersKey("w", "a")), false);
  });
});

test("blocked storage never throws", () => {
  const boom = () => {
    throw new Error("blocked");
  };
  (globalThis as any).localStorage = {
    getItem: boom,
    setItem: boom,
    removeItem: boom,
  };
  try {
    saveDraftAnswers("w", "a", midnight());
    assert.equal(loadDraftAnswers("w", "a"), undefined);
    clearDraftAnswers("w", "a");
  } finally {
    delete (globalThis as any).localStorage;
  }
  // No localStorage at all (server render).
  assert.equal(loadDraftAnswers("w", "a"), undefined);
});

test("invite cache keeps only unexpired structured tokens and fails closed for legacy values", () => {
  withStorage((store) => {
    const now = 1000;
    assert.deepEqual(
      forgetStaleInviteTokens(
        {
          current: { token: "current", expiresAt: now + 1 },
          expired: { token: "expired", expiresAt: now },
        },
        now,
      ),
      { current: { token: "current", expiresAt: now + 1 } },
    );
    store.set(
      inviteLinksKey("w", "a"),
      JSON.stringify({ legacy: "bearer", invalid: { token: "x" } }),
    );
    assert.deepEqual(loadInviteLinks("w", "a"), {});
    saveInviteLinks("w", "a", {
      current: { token: "current", expiresAt: Date.now() + 48 * 3600000 },
    });
    assert.deepEqual(loadInviteLinks("w", "a"), { current: "current" });
  });
});

test("restoreQuestions drops unknown questions and stale answers", () => {
  const asked = [
    feeQuestion(
      (({ fees: _f, ...rest }) => rest)(midnight()) as AgreementAnswers,
    ),
  ];
  const restored = restoreQuestions(
    [
      { id: "gone" },
      { id: StandardQuestionId.FEES, answeredChoiceId: "no-such-choice" },
    ],
    asked,
  );
  assert.deepEqual(
    restored.map((q) => [q.id, q.answeredChoiceId]),
    [[StandardQuestionId.FEES, undefined]],
  );
});

test("restoreQuestions retains stored order and appends a newly live question", () => {
  const asked = [
    feeQuestion(
      (({ fees: _f, ...rest }) => rest)(midnight()) as AgreementAnswers,
    ),
  ];
  const restored = restoreQuestions(
    [{ id: StandardQuestionId.FEES, answeredChoiceId: FeeChoice.BEFORE_SPLIT }],
    asked,
  );
  assert.deepEqual(
    restored.map((q) => [q.id, q.answeredChoiceId]),
    [[StandardQuestionId.FEES, FeeChoice.BEFORE_SPLIT]],
  );
});

test("restoreQuestions keeps only the first persisted copy of an id", () => {
  const asked = [
    feeQuestion(
      (({ fees: _f, ...rest }) => rest)(midnight()) as AgreementAnswers,
    ),
  ];
  assert.deepEqual(
    restoreQuestions(
      [
        {
          id: StandardQuestionId.FEES,
          answeredChoiceId: FeeChoice.BEFORE_SPLIT,
        },
        {
          id: StandardQuestionId.FEES,
          answeredChoiceId: FeeChoice.ORGANIZER_SHARE,
        },
      ],
      asked,
    ).map((question) => [question.id, question.answeredChoiceId]),
    [[StandardQuestionId.FEES, FeeChoice.BEFORE_SPLIT]],
  );
});

test("a fresh unresolved question wins a capped list over older answered questions", () => {
  const answered = ["old-a", "old-b", "old-c"].map((id) => ({
    id,
    text: id,
    choices: [
      {
        id: "keep",
        label: "Keep",
        explanation: "",
        apply: (a: AgreementAnswers) => a,
      },
    ],
    answeredChoiceId: "keep",
  }));
  const live = {
    id: "newly-live",
    text: "Current question",
    choices: [
      {
        id: "answer",
        label: "Answer",
        explanation: "",
        apply: (a: AgreementAnswers) => a,
      },
    ],
  };
  const answers: AgreementAnswers = {
    ...midnight(),
    refunds: { value: RefundChoice.SPLIT, source: AnswerSource.PERSON },
    questions: [...answered, live],
  };
  assert.deepEqual(
    mergeQuestions(answers).questions.map((question) => question.id),
    ["newly-live", "old-a", "old-b"],
  );
});

test("an old saved refunds question is dropped on resume", () => {
  withStorage(() => {
    const answers = midnight();
    saveDraftAnswers("w", "a", {
      ...answers,
      refunds: { value: RefundChoice.ADVANCE, source: AnswerSource.PERSON },
      questions: [
        ...answers.questions,
        {
          id: StandardQuestionId.REFUNDS,
          text: "Refunds?",
          choices: [],
          answeredChoiceId: RefundChoice.SPLIT,
        },
      ],
    });
    assert.equal(
      resumedAnswers(resume, self).answers.questions.some(
        (question) => question.id === StandardQuestionId.REFUNDS,
      ),
      false,
    );
  });
});

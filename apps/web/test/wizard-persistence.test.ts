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
  type AgreementAnswers,
} from "../lib/rules-answers";
import { StandardQuestionId } from "../lib/standard-questions";
import type { Agreement } from "../lib/model";
import {
  clearDraftAnswers,
  draftAnswersKey,
  loadDraftAnswers,
  restoreQuestions,
  saveDraftAnswers,
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

/** 50/30/20 with a $2,000 advance Maya already paid, fees answered on the Questions step. */
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
  // Ask the questions, then answer fees the way the Questions step does.
  const asked = mergeQuestions(answers);
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
    const fees = back.questions.find((q) => q.id === StandardQuestionId.FEES);
    assert.equal(fees?.answeredChoiceId, FeeChoice.BEFORE_SPLIT);
    assert.ok(fees?.choices.length, "choices are rebuilt, not stored");
    // Still-open questions are asked again.
    assert.ok(
      back.questions.some(
        (q) => q.id === StandardQuestionId.REFUNDS && !q.answeredChoiceId,
      ),
    );
  });
});

test("older unversioned saves still load; bad or other-version data is ignored", () => {
  withStorage((store) => {
    const { questions: _q, ...legacy } = midnight();
    store.set("fairshare:wizard-draft:w:a", JSON.stringify(legacy));
    assert.equal(
      loadDraftAnswers("w", "a")?.answers.people.value[0].basisPoints,
      5000,
    );
    // Saves that carried answered choices as `questionAnswers` keep them.
    store.set(
      "fairshare:wizard-draft:w:a",
      JSON.stringify({
        ...legacy,
        questionAnswers: [
          {
            id: StandardQuestionId.FEES,
            answeredChoiceId: FeeChoice.BEFORE_SPLIT,
          },
        ],
      }),
    );
    assert.equal(
      resumedAnswers(resume, self).answers.questions.find(
        (q) => q.id === StandardQuestionId.FEES,
      )?.answeredChoiceId,
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

test("restoreQuestions drops unknown questions and stale answers", () => {
  const asked = mergeQuestions(
    (({ fees: _f, ...rest }) => rest)(midnight()) as AgreementAnswers,
  ).questions;
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

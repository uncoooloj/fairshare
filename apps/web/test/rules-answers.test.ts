import test from "node:test";
import assert from "node:assert/strict";
import {
  createCollaboration,
  proposeVersion,
  previewVersion,
  MemberRole,
  type Rules as DomainRules,
} from "../../../packages/domain/src/index";
import {
  AnswerSource,
  BlockerKind,
  FeeChoice,
  RefundChoice,
  blockingReasons,
  sendBlockers,
  emptyAnswers,
  exampleSplit,
  rebalance,
  summarySentences,
  toRules,
  totalBasisPoints,
  type AgreementAnswers,
  type PersonAnswer,
} from "../lib/rules-answers";

const person = (
  key: string,
  basisPoints: number,
  extra: Partial<PersonAnswer> = {},
): PersonAnswer => ({ key, name: key, basisPoints, isSelf: false, ...extra });

const doc = <T>(value: T, clause = "§ 4") => ({
  value,
  source: AnswerSource.DOCUMENT,
  clause,
});

function answers(over: Partial<AgreementAnswers> = {}): AgreementAnswers {
  return {
    name: doc("Midnight Sessions"),
    effectiveFrom: doc("2026-10-01"),
    effectiveTo: doc<string | null>("2027-09-30"),
    people: doc([
      person("maya", 5000, { name: "Maya", userId: "u-maya", isSelf: true }),
      person("jordan", 3000, {
        name: "Jordan",
        email: "jordan@x",
        invitationId: "inv-j",
      }),
      person("riley", 2000, {
        name: "Riley",
        email: "riley@y",
        invitationId: "inv-r",
      }),
    ]),
    advance: doc({
      recipientKey: "maya",
      amountCents: 200000,
      alreadyPaid: true,
    }),
    fees: doc(FeeChoice.BEFORE_SPLIT),
    refunds: doc(RefundChoice.SPLIT),
    questions: [],
    ...over,
  };
}

/** Independent run of the engine on the same rules, after everyone has joined
 * (pending placeholders rewritten to real ids, as accepting an invite does). */
function engine(a: AgreementAnswers, gross: number, fee: number) {
  const pending = toRules(a, {
    documentId: "doc",
    organizerId: "u-maya",
  }) as DomainRules;
  const joined = (id: string) => id.replace(/^pending:/, "joined-");
  const rules: DomainRules = {
    ...pending,
    shares: pending.shares.map((s) => ({ ...s, userId: joined(s.userId) })),
    ...(pending.advance
      ? {
          advance: {
            ...pending.advance,
            recipientId: joined(pending.advance.recipientId),
          },
        }
      : {}),
  };
  const ids = pending.shares.map((s) => joined(s.userId));
  const c = createCollaboration(
    {
      id: "c",
      name: "c",
      members: a.people.value.map((p, i) => ({
        userId: ids[i],
        displayName: p.name,
        role: p.isSelf ? MemberRole.ORGANIZER : MemberRole.COLLABORATOR,
      })),
    },
    "u-maya",
    "2000-01-01T00:00:00Z",
  );
  const v = proposeVersion(c, rules, "u-maya", "2000-01-01T00:00:00Z");
  const preview = previewVersion(
    v,
    1,
    { grossCents: gross, feeCents: fee },
    "u-maya",
  );
  return ids.map(
    (id) => preview.allocations.find((x) => x.userId === id)!.totalCents,
  );
}

test("rebalance keeps 10000, bounds and proportionality", () => {
  const people = [person("a", 5000), person("b", 3000), person("c", 2000)];
  for (const x of [0, 1, 777, 5000, 9999, 10000, -50, 20000]) {
    const out = rebalance(people, "a", x);
    assert.equal(totalBasisPoints(out), 10000);
    assert.ok(out.every((p) => Number.isInteger(p.basisPoints)));
    assert.ok(out.every((p) => p.basisPoints >= 0 && p.basisPoints <= 10000));
  }
  assert.deepEqual(
    rebalance(people, "a", 0).map((p) => p.basisPoints),
    [0, 6000, 4000],
  );
  assert.deepEqual(
    rebalance(people, "a", 7500).map((p) => p.basisPoints),
    [7500, 1500, 1000],
  );
  assert.deepEqual(
    rebalance(people, "a", 20000).map((p) => p.basisPoints),
    [10000, 0, 0],
  );
});

test("rebalance splits equally from all-zero others, ties go to earlier rows", () => {
  const people = [
    person("a", 10000),
    person("b", 0),
    person("c", 0),
    person("d", 0),
  ];
  assert.deepEqual(
    rebalance(people, "a", 0).map((p) => p.basisPoints),
    [0, 3334, 3333, 3333],
  );
  const tie = [person("a", 0), person("b", 5000), person("c", 5000)];
  assert.deepEqual(
    rebalance(tie, "a", 1).map((p) => p.basisPoints),
    [1, 5000, 4999],
  );
});

test("rebalance keeps a single person at 10000 and ignores unknown keys", () => {
  assert.deepEqual(
    rebalance([person("a", 10000)], "a", 4000).map((p) => p.basisPoints),
    [10000],
  );
  const people = [person("a", 6000), person("b", 4000)];
  assert.deepEqual(rebalance(people, "zzz", 1), people);
});

test("exampleSplit equals the engine: advance partly recouped", () => {
  const a = answers({
    advance: doc({
      recipientKey: "maya",
      amountCents: 500000,
      alreadyPaid: true,
    }),
  });
  const shown = exampleSplit(a, 300000);
  assert.deepEqual(
    shown.map((x) => x.cents),
    engine(a, 300000, 0),
  );
  assert.deepEqual(
    shown.map((x) => [x.name, x.cents]),
    [
      ["Maya", 300000],
      ["Jordan", 0],
      ["Riley", 0],
    ],
  );
});

test("exampleSplit equals the engine: fees before the split", () => {
  const a = answers();
  const shown = exampleSplit(a, 300000, 10500);
  assert.deepEqual(
    shown.map((x) => x.cents),
    engine(a, 300000, 10500),
  );
  // 289,500 net − 200,000 advance = 89,500 split 50/30/20.
  assert.deepEqual(
    shown.map((x) => x.cents),
    [200000 + 44750, 26850, 17900],
  );
});

test("exampleSplit equals the engine: organizer covers fees", () => {
  const a = answers({
    fees: doc(FeeChoice.ORGANIZER_SHARE),
    advance: undefined,
  });
  const shown = exampleSplit(a, 300000, 10500);
  assert.deepEqual(
    shown.map((x) => x.cents),
    engine(a, 300000, 10500),
  );
  assert.deepEqual(
    shown.map((x) => x.cents),
    [150000 - 10500, 90000, 60000],
  );
});

test("exampleSplit returns nothing while the split isn't 100%", () => {
  const a = answers();
  a.people.value[0].basisPoints = 1000;
  assert.deepEqual(exampleSplit(a, 300000), []);
});

test("toRules fills hidden fields and keys pending people by invitation", () => {
  const a = answers({
    fees: doc(FeeChoice.ORGANIZER_SHARE),
    questions: [
      {
        id: "q-refunds",
        text: "Do refunds come off the advance or the split?",
        choices: [],
      },
      { id: "q-done", text: "Answered", choices: [], answeredChoiceId: "x" },
    ],
  });
  const rules = toRules(a, { documentId: "doc-1", organizerId: "u-maya" });
  assert.equal(rules.currency, "USD");
  assert.equal(rules.feePolicy, "ORGANIZER_SHARE");
  assert.equal(rules.feeBearerId, "u-maya");
  assert.deepEqual(rules.shares, [
    { userId: "u-maya", basisPoints: 5000 },
    { userId: "pending:inv-j", basisPoints: 3000 },
    { userId: "pending:inv-r", basisPoints: 2000 },
  ]);
  assert.deepEqual(rules.unresolvedQuestions, [
    "Do refunds come off the advance or the split?",
  ]);
  assert.equal(rules.source.origin, "HUMAN_PROPOSAL");
  assert.equal(rules.source.documentId, "doc-1");
  assert.equal(rules.source.clause, "Midnight Sessions");
  assert.doesNotMatch(rules.source.excerpt, /[Rr]efund/);
  assert.ok(rules.source.excerpt.length <= 10000);
  assert.equal(rules.advance?.recipientId, "u-maya");
  assert.equal(rules.advance?.verified, true);
  // "Not yet": sent as an advance still to be confirmed.
  const notYet = answers();
  notYet.advance!.value.alreadyPaid = false;
  assert.equal(
    toRules(notYet, { documentId: "d", organizerId: "u-maya" }).advance
      ?.verified,
    false,
  );

  const before = toRules(answers(), { documentId: "d", organizerId: "u-maya" });
  assert.equal(before.feePolicy, "BEFORE_SPLIT");
  assert.equal(before.feeBearerId, undefined);
});

test("toRules marks the source as a clause only when the excerpt is verbatim", () => {
  const a = answers();
  const first = toRules(a, { documentId: "d", organizerId: "u-maya" });
  const quoted = toRules(a, {
    documentId: "d",
    organizerId: "u-maya",
    documentText: `Preamble. ${first.source.excerpt} More.`,
  });
  assert.equal(quoted.source.origin, "SOURCE_CLAUSE");
  const withQuote = answers({
    advance: {
      ...doc(
        { recipientKey: "maya", amountCents: 200000, alreadyPaid: true },
        "§ 4.1",
      ),
      quote: "Maya advanced $2,000.",
    },
  });
  const adv = toRules(withQuote, {
    documentId: "d",
    organizerId: "u-maya",
    documentText: "4.1 Maya advanced $2,000. 4.2 ...",
  }).advance!;
  assert.equal(adv.source.origin, "SOURCE_CLAUSE");
  assert.equal(adv.source.excerpt, "Maya advanced $2,000.");
  assert.equal(adv.source.clause, "§ 4.1");
});

test("toRules reuses the advance id only when amount and recipient match", () => {
  const ctx = { documentId: "d", organizerId: "u-maya" };
  const same = toRules(answers(), {
    ...ctx,
    priorAdvance: { id: "adv-1", amountCents: 200000, recipientId: "u-maya" },
  });
  assert.equal(same.advance?.id, "adv-1");
  const amount = toRules(answers(), {
    ...ctx,
    priorAdvance: { id: "adv-1", amountCents: 150000, recipientId: "u-maya" },
  });
  assert.notEqual(amount.advance?.id, "adv-1");
  assert.ok(amount.advance?.id);
  const recipient = toRules(answers(), {
    ...ctx,
    priorAdvance: {
      id: "adv-1",
      amountCents: 200000,
      recipientId: "pending:inv-j",
    },
  });
  assert.notEqual(recipient.advance?.id, "adv-1");
  const fresh = toRules(answers(), ctx);
  assert.notEqual(fresh.advance?.id, toRules(answers(), ctx).advance?.id);
});

test("toRules refuses people who can't be referenced yet", () => {
  const a = answers();
  a.people.value[2] = person("riley", 2000, { name: "Riley" });
  assert.throws(
    () => toRules(a, { documentId: "d", organizerId: "u-maya" }),
    /Add Riley's email/,
  );
});

test("summary sentences follow the spec copy", () => {
  assert.deepEqual(summarySentences(answers()), [
    "Midnight Sessions · Oct 1, 2026 to Sep 30, 2027",
    "Maya is paid back $2,000 first. Then the rest is split Maya 50%, Jordan 30% and Riley 20%.",
    "PayPal fees come off the top, before the split.",
    "Sending to Jordan (jordan@x) and Riley (riley@y)",
  ]);
  const other = answers({
    effectiveTo: doc<string | null>(null),
    advance: undefined,
    fees: doc(FeeChoice.ORGANIZER_SHARE),
    refunds: doc(RefundChoice.ADVANCE),
  });
  assert.deepEqual(summarySentences(other), [
    "Midnight Sessions · From Oct 1, 2026, no end date",
    "The money is split Maya 50%, Jordan 30% and Riley 20%.",
    "PayPal fees come out of Maya's share.",
    "Sending to Jordan (jordan@x) and Riley (riley@y)",
  ]);
});

test("the organizer outside the split is left out; odd shares keep their decimals", () => {
  const a = answers({ fees: undefined });
  a.people.value = [
    { ...a.people.value[0], basisPoints: 0 },
    { ...a.people.value[1], basisPoints: 3334 },
    { ...a.people.value[2], basisPoints: 3333 },
    person("sam", 3333, { name: "Sam", email: "sam@z" }),
  ];
  const lines = summarySentences(a);
  assert.equal(
    lines[1],
    "Maya is paid back $2,000 first. Then the rest is split Jordan 33.34%, Riley 33.33% and Sam 33.33%.",
  );
  assert.doesNotMatch(lines.join(" "), /\b0 \/|Maya 0/);
  // Unstated fees read as the default the rules store.
  assert.equal(lines[2], "PayPal fees come off the top, before the split.");
  const solo = answers({ advance: undefined });
  solo.people.value = [
    { ...solo.people.value[0], basisPoints: 0 },
    { ...solo.people.value[1], basisPoints: 10000 },
    { ...solo.people.value[2], basisPoints: 0 },
  ];
  assert.equal(summarySentences(solo)[1], "All of it goes to Jordan.");
});

test("an advance not paid yet is sendable and stored as unconfirmed", () => {
  const a = answers();
  a.advance!.value.alreadyPaid = false;
  assert.deepEqual(blockingReasons(a), []);
  // The Send screen says what's next; the stored summary stays about the terms.
  const rules = toRules(a, { documentId: "d", organizerId: "u-maya" });
  assert.equal(rules.advance?.verified, false);
  assert.doesNotMatch(rules.source.excerpt, /confirm|Nothing is split/);
});

test("blocking reasons are plain and specific, each with what fixes it", () => {
  assert.deepEqual(blockingReasons(answers()), []);
  const a = answers({
    fees: undefined,
    advance: doc({ recipientKey: "maya", amountCents: 200000 }),
    questions: [
      {
        id: "fees",
        text: "We can't have Jordan pay the PayPal fee yet. Who covers it?",
        choices: [],
      },
    ],
  });
  a.people.value[2] = person("riley", 2000, { name: "Riley" });
  assert.deepEqual(
    sendBlockers(a).map((b) => [b.kind, b.text]),
    [
      [
        BlockerKind.QUESTION,
        "We can't have Jordan pay the PayPal fee yet. Who covers it?",
      ],
      [BlockerKind.ADVANCE_PAID, "Has Maya already paid the $2,000?"],
      [BlockerKind.PEOPLE, "Add Riley's email"],
    ],
  );
  const b = answers({ name: doc("  ") });
  b.people.value[1] = person("jordan", 1000, { name: "Jordan", email: "nope" });
  assert.deepEqual(blockingReasons(b), [
    "Name the agreement",
    "Make the split add up to 100%",
    "Check Jordan's email",
  ]);
  const gone = answers({
    advance: doc({ recipientKey: "nobody", amountCents: 200000 }),
  });
  assert.deepEqual(blockingReasons(gone), ["Who put in the $2,000?"]);
});

test("emptyAnswers starts with just the organizer at 100%", () => {
  const a = emptyAnswers({ name: "Maya", userId: "u-maya" });
  assert.deepEqual(a.people.value, [
    {
      key: "u-maya",
      name: "Maya",
      userId: "u-maya",
      basisPoints: 10000,
      isSelf: true,
    },
  ]);
  assert.equal(a.name.source, AnswerSource.PERSON);
  assert.deepEqual(a.questions, []);
});

test("rebalance never moves held people and can snap the rest to whole percents", () => {
  const people = [person("a", 3334), person("b", 3333), person("c", 3333)];
  // Only c is free: it takes exactly what is left.
  assert.deepEqual(
    rebalance(people, "b", 3000, ["a"]).map((p) => p.basisPoints),
    [3334, 3000, 3666],
  );
  // Everyone else held: nobody else moves, so the total is off for the caller to show.
  assert.deepEqual(
    rebalance(people, "c", 2000, ["a", "b"]).map((p) => p.basisPoints),
    [3334, 3333, 2000],
  );
  // Never negative when the held shares already pass 100%.
  assert.deepEqual(
    rebalance(people, "a", 9000, ["b"]).map((p) => p.basisPoints),
    [9000, 3333, 0],
  );
  // step 100 keeps the movers on whole percents when what is left divides evenly.
  assert.deepEqual(
    rebalance(people, "a", 4700, [], 100).map((p) => p.basisPoints),
    [4700, 2700, 2600],
  );
  assert.deepEqual(
    rebalance(people, "a", 4750, [], 100).map((p) => p.basisPoints),
    [4750, 2625, 2625],
  );
});

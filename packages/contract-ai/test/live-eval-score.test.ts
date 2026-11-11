import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateDraft,
  ExtractionStatus,
  FactKind,
  FeePolicy,
  RefundStep,
  TermBoundary,
  PROMPT_VERSION,
  type ExtractionResult,
} from "../src/index.js";
import {
  loadFixtures,
  nameResolver,
  scoreResult,
  ScoredField,
  type LiveFixture,
} from "../scripts/live-eval-score.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = loadFixtures(join(here, "fixtures/live"));
const byId = (id: string) => fixtures.find((f) => f.id.startsWith(id))!;

const NULLS = {
  recoupedBeforeSplit: null,
  feePolicy: null,
  refundStep: null,
  termBoundary: null,
};
const fact = (
  kind: FactKind,
  subject: string,
  rawValue: string,
  quote: string,
  extra: Partial<Record<keyof typeof NULLS, unknown>> = {},
) => ({ kind, subject, rawValue, quote, ...NULLS, ...extra });

function resultFor(fixture: LiveFixture, draft: unknown): ExtractionResult {
  const document = { documentId: fixture.id, revision: 1, text: fixture.text };
  return {
    ...validateDraft(draft, document),
    status: ExtractionStatus.REVIEW_REQUIRED,
    documentId: fixture.id,
    revision: 1,
    sourceHash: "",
    requiresHumanReview: true,
    executable: false,
    provider: null,
    model: null,
    fallbackFrom: null,
    promptVersion: PROMPT_VERSION,
    reason: null,
  };
}
const failing = (score: ReturnType<typeof scoreResult>) =>
  score.fields.filter((f) => !f.pass).map((f) => f.field);

// A correct reading of fixture 01, written the way a provider would return it.
const clean = byId("01");
const termQuote =
  "1.1 This Agreement starts on March 1, 2026 and ends on February 28, 2027, unless the Parties agree in writing to extend it.";
const cleanFacts = [
  fact(
    FactKind.SHARE,
    "Ada Obi",
    "50%",
    "4.1 Ada Obi receives 50% of Net Revenue.",
  ),
  fact(
    FactKind.SHARE,
    "Tunde Bakare",
    "30%",
    "4.2 Tunde Bakare receives 30% of Net Revenue.",
  ),
  fact(
    FactKind.SHARE,
    "Chioma Eze",
    "20%",
    "4.3 Chioma Eze receives 20% of Net Revenue.",
  ),
  fact(
    FactKind.ADVANCE,
    "Ada Obi",
    "$2,000",
    "3.1 Ada Obi received a $2,000 advance to cover rehearsal space, which is recouped from Net Revenue before the split.",
    { recoupedBeforeSplit: true },
  ),
  fact(
    FactKind.FEES,
    "deducted from Gross Receipts before the split",
    "deducted from Gross Receipts before the split",
    "2.3 Payment processing fees are deducted from Gross Receipts before the split.",
    { feePolicy: FeePolicy.BEFORE_SPLIT },
  ),
  fact(
    FactKind.REFUNDS,
    "deducted from Gross Receipts before the split",
    "deducted from Gross Receipts before the split",
    "5.1 Refunds issued to ticket buyers are deducted from Gross Receipts before the split.",
    { refundStep: RefundStep.BEFORE_SPLIT },
  ),
  fact(FactKind.TERM, "March 1, 2026", "March 1, 2026", termQuote, {
    termBoundary: TermBoundary.START,
  }),
  fact(FactKind.TERM, "February 28, 2027", "February 28, 2027", termQuote, {
    termBoundary: TermBoundary.END,
  }),
  ...["Ada Obi", "Tunde Bakare", "Chioma Eze"].map((name) =>
    fact(
      FactKind.PERSON,
      name,
      name,
      "Signed by Ada Obi, Tunde Bakare and Chioma Eze.",
    ),
  ),
];

test("fixtures: six agreements, each with an expected reading naming people that appear in the text", () => {
  assert.equal(fixtures.length, 6);
  for (const f of fixtures) {
    assert.ok(f.expected.people.length >= 2, f.id);
    for (const p of f.expected.people)
      assert.ok(
        f.text.toLowerCase().includes(p.name.toLowerCase()),
        `${f.id} ${p.name}`,
      );
  }
});

test("scorer: a correct reading passes every field", () => {
  const score = scoreResult(
    clean,
    resultFor(clean, { facts: cleanFacts, issues: [] }),
  );
  assert.deepEqual(failing(score), []);
  assert.equal(score.passed, score.total);
});

test("scorer: a wrong share, a missing advance and an extra question each fail their own field", () => {
  const facts = cleanFacts
    .filter((f) => f.kind !== FactKind.ADVANCE)
    .map((f) =>
      f.subject === "Chioma Eze"
        ? fact(FactKind.SHARE, "Chioma Eze", "20%", f.quote, {})
        : f,
    );
  facts[0] = fact(
    FactKind.SHARE,
    "Ada Obi",
    "50%",
    "4.1 Ada Obi receives 50% of Net Revenue.",
  );
  const result = resultFor(clean, { facts, issues: [] });
  // Simulate a provider that reads Tunde's share wrong: validated facts are data, edit after.
  const tunde = result.facts.find((f) => f.subject === "Tunde Bakare");
  assert.ok(tunde && tunde.kind === FactKind.SHARE);
  tunde.basisPoints = 2500;
  const score = scoreResult(clean, result);
  assert.deepEqual(
    failing(score).sort(),
    [ScoredField.ADVANCE, ScoredField.SECTIONS]
      .concat(ScoredField.SHARES)
      .sort(),
  );
});

test("scorer: questions are counted against min/max and required topics", () => {
  const fees = byId("04");
  const result = resultFor(fees, {
    facts: [
      fact(
        FactKind.SHARE,
        "Dana Cole",
        "60%",
        "3.2 Dana Cole receives 60% of Course Revenue.",
      ),
      fact(
        FactKind.SHARE,
        "Felix Grant",
        "40%",
        "3.3 Felix Grant receives 40% of Course Revenue.",
      ),
    ],
    issues: [],
  });
  const score = scoreResult(fees, result);
  const questions = score.fields.find(
    (f) => f.field === ScoredField.QUESTIONS,
  )!;
  assert.equal(questions.pass, false);
  assert.match(questions.detail, /missing \["FEES"\]/);
  // Fees silent and not invented: the fees field itself passes.
  assert.ok(score.fields.find((f) => f.field === ScoredField.FEES)!.pass);
});

test("scorer: oneOf accepts either reading of ambiguous refunds", () => {
  const refunds = byId("05");
  const base = [
    fact(
      FactKind.SHARE,
      "Omar Haddad",
      "40%",
      "4.1 Omar Haddad receives 40% of Net Revenue.",
    ),
  ];
  const quote =
    "5.2 Any refunds, chargebacks or credits issued to customers shall be deducted from future Net Revenue.";
  const silent = scoreResult(
    refunds,
    resultFor(refunds, { facts: base, issues: [] }),
  );
  const before = scoreResult(
    refunds,
    resultFor(refunds, {
      facts: [
        ...base,
        fact(
          FactKind.REFUNDS,
          "deducted from future Net Revenue",
          "deducted from future Net Revenue",
          quote,
          {
            refundStep: RefundStep.BEFORE_SPLIT,
          },
        ),
      ],
      issues: [],
    }),
  );
  for (const score of [silent, before])
    assert.ok(score.fields.find((f) => f.field === ScoredField.REFUNDS)!.pass);
});

test("scorer: defined terms and decorated names resolve to the expected person", () => {
  const resolve = nameResolver(byId("06").expected.people);
  assert.equal(resolve("the Producer"), "Daniel Osei");
  assert.equal(resolve("Producer"), "Daniel Osei");
  assert.equal(resolve("KEMI ADEYEMI"), "Kemi Adeyemi");
  assert.equal(resolve("The Manager (Ruth Mensah)"), "Ruth Mensah");
  assert.equal(resolve("Someone Else"), "Someone Else");
  assert.equal(resolve(null), null);
});

test("scorer: a fallback result fails status, and a tampered quote fails quotes", () => {
  const manual = resultFor(clean, { facts: cleanFacts, issues: [] });
  manual.status = ExtractionStatus.MANUAL_REQUIRED;
  manual.facts[0].citation = {
    ...manual.facts[0].citation,
    quote: "Ada Obi receives 60%",
  };
  const score = scoreResult(clean, manual);
  assert.ok(failing(score).includes(ScoredField.STATUS));
  assert.ok(failing(score).includes(ScoredField.QUOTES));
});

const script = resolve(here, "../scripts/live-eval.ts");
const run = (args: string[]) =>
  spawnSync(process.execPath, ["--import", "tsx", script, ...args], {
    encoding: "utf8",
    cwd: resolve(here, ".."),
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !/^(CLOUDFLARE_|ANTHROPIC_)/.test(name),
      ),
    ),
  });

test("harness: refuses a live run without keys and names only the missing variables", () => {
  const out = mkdtempSync(join(tmpdir(), "live-eval-"));
  for (const [provider, names] of [
    ["cloudflare", /CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN/],
    ["anthropic", /ANTHROPIC_API_KEY/],
  ] as const) {
    const child = run([
      "--provider",
      provider,
      "--out",
      out,
      "--vars-file",
      join(out, "none.vars"),
    ]);
    assert.equal(child.status, 2, child.stderr);
    assert.match(child.stderr, names);
  }
});

test("harness: refuses to save raw results inside the repository", () => {
  const child = run([
    "--provider",
    "cloudflare",
    "--out",
    here,
    "--vars-file",
    "/nonexistent",
  ]);
  assert.equal(child.status, 2);
  assert.match(child.stderr, /inside the repository/);
});

test("harness: offline mode scores a saved result file without keys or network", () => {
  const dir = mkdtempSync(join(tmpdir(), "live-eval-"));
  const file = join(dir, `${clean.id}.cloudflare.result.json`);
  writeFileSync(
    file,
    JSON.stringify(resultFor(clean, { facts: cleanFacts, issues: [] })),
  );
  const child = run(["--score", dir]);
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /TOTAL 10\/10 fields passed across 1 fixtures/);
});

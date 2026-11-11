import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractContract,
  parseCloudflareResult,
  validateDraft,
  DEFAULT_CLOUDFLARE_MODEL,
  ExtractionProvider,
  ExtractionStatus,
} from "../src/index.js";
import {
  loadFixtures,
  scoreResult,
  ScoredField,
} from "../scripts/live-eval-score.js";

// Real Workers AI responses recorded on 2026-11-11 by scripts/live-eval.ts (DeepSeek V4.1 Flash,
// prompt v5), replayed without network. Re-record with `npm run eval:live` after prompt changes.
const here = fileURLToPath(new URL(".", import.meta.url));
const live = join(here, "fixtures/live");
const recorded = (name: string) =>
  readFileSync(join(live, "recorded", name), "utf8");
const fixtures = loadFixtures(live);

/** Fields the recorded reading is known to miss. 06: the model puts recoupment
 * in a different quote from the advance amount, so validation preserves it as
 * unknown; its start date also sits behind "the Effective Date". */
const KNOWN_MISSES: Record<string, ScoredField[]> = {
  "06-messy-amended": [
    ScoredField.ADVANCE,
    ScoredField.TERM,
    ScoredField.SECTIONS,
  ],
};

for (const fixture of fixtures) {
  test(`recorded DeepSeek reading of ${fixture.id} scores as confirmed live`, async () => {
    const body = recorded(`${fixture.id}.deepseek-v4.1-flash-1017.json`);
    let requested = "";
    const result = await extractContract(
      { documentId: fixture.id, revision: 1, text: fixture.text },
      {
        accountId: "0".repeat(32),
        apiToken: "test-token",
        fetch: async (url) => {
          requested = String(url);
          return new Response(body, { status: 200 });
        },
      },
    );
    assert.ok(requested.endsWith(`/ai/run/${DEFAULT_CLOUDFLARE_MODEL}`));
    assert.equal(result.provider, ExtractionProvider.CLOUDFLARE);
    assert.equal(result.status, ExtractionStatus.REVIEW_REQUIRED);
    const failing = scoreResult(fixture, result)
      .fields.filter((f) => !f.pass)
      .map((f) => `${f.field}: ${f.detail}`);
    assert.deepEqual(
      failing.map((f) => f.split(":")[0]),
      KNOWN_MISSES[fixture.id] ?? [],
      failing.join("\n"),
    );
  });
}

test("DeepSeek V4.1 Flash is the default Workers AI model", () => {
  assert.equal(
    DEFAULT_CLOUDFLARE_MODEL,
    "@cf/deepseek-ai/deepseek-v4.1-flash-1017",
  );
});

test("chat-completions replies with reasoning fields parse to the answer only", () => {
  const clean = fixtures.find((f) => f.id === "01-clean-three-way")!;
  for (const name of [
    "shape-qwen3.8-27b-reasoning.json",
    "shape-gpt-oss-120b-reasoning.json",
  ]) {
    const envelope = JSON.parse(recorded(name)) as { result: unknown };
    const draft = validateDraft(parseCloudflareResult(envelope.result), {
      documentId: clean.id,
      revision: 1,
      text: clean.text,
    });
    assert.ok(draft.facts.length > 0, name);
  }
});

test("terminal colour codes inside a reply are dropped instead of failing the whole reading", () => {
  const fixture = fixtures.find((f) => f.id === "02-names-no-percentages")!;
  const envelope = JSON.parse(
    recorded("shape-deepseek-terminal-codes.json"),
  ) as { result: unknown };
  const draft = validateDraft(parseCloudflareResult(envelope.result), {
    documentId: fixture.id,
    revision: 1,
    text: fixture.text,
  });
  assert.equal(draft.suggestedTitle, undefined);
  assert.ok(draft.facts.length > 0);
});

test("classic { response } and Responses-style output shapes still parse", () => {
  const answer = { facts: [], issues: [] };
  assert.deepEqual(
    parseCloudflareResult({ response: JSON.stringify(answer) }),
    answer,
  );
  assert.deepEqual(parseCloudflareResult({ response: answer }), answer);
  assert.deepEqual(
    parseCloudflareResult({
      output: [
        { type: "reasoning", content: [{ text: "thinking" }] },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "```json\n" + JSON.stringify(answer) + "\n```",
            },
          ],
        },
      ],
    }),
    answer,
  );
  assert.deepEqual(
    parseCloudflareResult({
      choices: [
        {
          message: {
            content: `<think>plan</think>${JSON.stringify(answer)}`,
          },
        },
      ],
    }),
    answer,
  );
  assert.throws(() =>
    parseCloudflareResult({ choices: [{ message: { content: "no json" } }] }),
  );
});

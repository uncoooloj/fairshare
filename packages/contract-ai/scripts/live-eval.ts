/**
 * Live eval for contract extraction against real providers, plus offline scoring of saved results.
 *
 *   npm run eval:live -w @fairshare/contract-ai -- --provider cloudflare --out <scratch dir> [--model @cf/...] [--fixture 01-clean-three-way,02-...] [--budget 90]
 *   npm run eval:live -w @fairshare/contract-ai -- --score <result.json | dir of *.result.json>
 *   npm run eval:live -w @fairshare/contract-ai -- --rescore <out dir> --label <model label>   (re-parse saved Cloudflare bodies with the current code)
 *   npm run eval:live -w @fairshare/contract-ai -- --report <out dir>
 *
 * Live mode configures exactly one provider (no fallback), so each fixture costs one call. Calls are
 * counted in <out>/calls.json across runs and the run refuses to start if it would pass --budget.
 * Keys come from the environment, or from apps/api/.dev.vars (or --vars-file) when present. Key
 * values are never printed, logged or written; only successful response bodies (error bodies are
 * reduced to status and codes) and validated results are saved, and only outside the repository.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  extractContract,
  locateQuote,
  parseCloudflareResult,
  validateDraft,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_CLOUDFLARE_MODEL,
  ExtractionProvider,
  ExtractionStatus,
  PROMPT_VERSION,
  type CloudflareConfig,
  type ExtractionDiagnostic,
  type ExtractionResult,
} from "../src/index.js";
import {
  formatScores,
  loadFixtures,
  scoreResult,
  ScoredField,
  type FixtureScore,
  type LiveFixture,
} from "./live-eval-score.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const fixturesDir = resolve(here, "../test/fixtures/live");

enum EnvName {
  CLOUDFLARE_ACCOUNT_ID = "CLOUDFLARE_ACCOUNT_ID",
  CLOUDFLARE_API_TOKEN = "CLOUDFLARE_API_TOKEN",
  CLOUDFLARE_AI_MODEL = "CLOUDFLARE_AI_MODEL",
  ANTHROPIC_API_KEY = "ANTHROPIC_API_KEY",
  ANTHROPIC_MODEL = "ANTHROPIC_MODEL",
}
const REQUIRED: Record<ExtractionProvider, EnvName[]> = {
  [ExtractionProvider.CLOUDFLARE]: [
    EnvName.CLOUDFLARE_ACCOUNT_ID,
    EnvName.CLOUDFLARE_API_TOKEN,
  ],
  [ExtractionProvider.ANTHROPIC]: [EnvName.ANTHROPIC_API_KEY],
};
/** USD per million tokens [input, output], from the Workers AI catalog (2026-11). */
const PRICES: Record<string, [number, number]> = {
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": [0.293, 2.253],
  "@cf/zai-org/glm-5.3": [1.4, 4.4],
  "@cf/deepseek-ai/deepseek-v4.1-flash-1017": [0.3, 1.2],
  "@cf/qwen/qwen3.8-27b": [0.45, 3.2],
  "@cf/openai/gpt-oss-120b": [0.35, 0.75],
  "@cf/google/gemma-4-26b-a4b-it": [0.1, 0.3],
};

interface Usage {
  promptTokens: number;
  completionTokens: number;
}
/** One fixture of one run, enough to compare models without re-calling them. */
interface RunRecord {
  fixture: string;
  model: string;
  passed: number;
  total: number;
  fields: FixtureScore["fields"];
  latencyMs: number;
  /** The answer parsed as JSON (whether or not it then validated). */
  jsonValid: boolean;
  /** Quotes the model wrote that are verbatim in the source, before validation drops any. */
  rawQuotes: { found: number; total: number };
  usage: Usage | null;
  costUsd: number | null;
  diagnostics: ExtractionDiagnostic[];
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

/** Copies the provider variables from a KEY=VALUE file into process.env without overriding what is
 * already set. Returns the names it set, never the values. */
function loadEnvFile(path: string): EnvName[] {
  if (!existsSync(path)) return [];
  const loaded: EnvName[] = [];
  const allowed = Object.values(EnvName) as string[];
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || !allowed.includes(match[1]) || process.env[match[1]])
      continue;
    const value = match[2].replace(/^(["'])(.*)\1$/, "$2");
    if (!value) continue;
    process.env[match[1]] = value;
    loaded.push(match[1] as EnvName);
  }
  return loaded;
}

/** Status plus numeric/enum error codes only; messages can echo request details. */
function redactedError(status: number, body: string): string {
  const codes = [
    ...body.matchAll(/"(?:code|type)"\s*:\s*("?[A-Za-z0-9_.-]{1,40}"?)/g),
  ].map((m) => m[1]);
  return JSON.stringify({ httpStatus: status, codes });
}

function readCalls(outDir: string): number {
  const path = join(outDir, "calls.json");
  if (!existsSync(path)) return 0;
  const calls = (JSON.parse(readFileSync(path, "utf8")) as { calls: unknown })
    .calls;
  if (typeof calls !== "number" || !Number.isSafeInteger(calls) || calls < 0)
    fail(`Refusing to run: invalid call counter in ${path}.`);
  return calls;
}

/** A readable model label plus a short identity suffix prevents two providers or
 * similarly named models from writing the same fixture files. */
const labelFor = (provider: ExtractionProvider, model: string) => {
  const readable = model
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const identity = Buffer.from(model).toString("hex");
  return `${provider}.${readable || "model"}.${identity}`;
};

function safeNonNegativeInteger(value: string, name: string): number {
  if (!/^\d+$/.test(value))
    fail(`${name} must be a finite non-negative safe integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    fail(`${name} must be a finite non-negative safe integer.`);
  return parsed;
}

/** Parses a saved Cloudflare body with the current adapter. */
function parseRaw(
  provider: ExtractionProvider,
  rawBody: string,
): {
  draft: unknown;
  usage: Usage | null;
} | null {
  try {
    const envelope = JSON.parse(rawBody) as {
      result?: { usage?: Record<string, number> };
      content?: { type?: unknown; text?: unknown }[];
      usage?: { input_tokens?: unknown; output_tokens?: unknown };
    };
    if (provider === ExtractionProvider.ANTHROPIC) {
      const text = Array.isArray(envelope.content)
        ? envelope.content
            .filter((block) => block?.type === "text")
            .map((block) => block.text)
            .filter((text): text is string => typeof text === "string")
            .join("")
        : "";
      return {
        draft: JSON.parse(text),
        usage:
          typeof envelope.usage?.input_tokens === "number" &&
          typeof envelope.usage?.output_tokens === "number"
            ? {
                promptTokens: envelope.usage.input_tokens,
                completionTokens: envelope.usage.output_tokens,
              }
            : null,
      };
    }
    const usage = envelope.result?.usage;
    return {
      draft: parseCloudflareResult(envelope.result),
      usage: usage
        ? {
            promptTokens: usage.prompt_tokens ?? 0,
            completionTokens: usage.completion_tokens ?? 0,
          }
        : null,
    };
  } catch {
    return null;
  }
}

function rawQuoteCount(draft: unknown, text: string) {
  const quotes: string[] = [];
  const d = draft as { facts?: unknown; issues?: unknown } | null;
  for (const list of [d?.facts, d?.issues])
    if (Array.isArray(list))
      for (const item of list) {
        const quote = (item as { quote?: unknown } | null)?.quote;
        if (typeof quote === "string") quotes.push(quote);
      }
  return {
    found: quotes.filter((q) => locateQuote(text, q) !== null).length,
    total: quotes.length,
  };
}

function record(
  fixture: LiveFixture,
  provider: ExtractionProvider,
  model: string,
  result: ExtractionResult,
  rawBody: string,
  latencyMs: number,
  diagnostics: ExtractionDiagnostic[],
): RunRecord {
  const score = scoreResult(fixture, result);
  const parsed = parseRaw(provider, rawBody);
  const price = PRICES[model];
  return {
    fixture: fixture.id,
    model,
    passed: score.passed,
    total: score.total,
    fields: score.fields,
    latencyMs,
    jsonValid: parsed !== null,
    rawQuotes: parsed
      ? rawQuoteCount(parsed.draft, fixture.text)
      : { found: 0, total: 0 },
    usage: parsed?.usage ?? null,
    costUsd:
      parsed?.usage && price
        ? (parsed.usage.promptTokens * price[0] +
            parsed.usage.completionTokens * price[1]) /
          1_000_000
        : null,
    diagnostics,
  };
}

async function runLive(
  provider: ExtractionProvider,
  outDir: string,
  fixtures: LiveFixture[],
  budget: number,
  envFile: string,
  timeoutMs: number,
  modelFlag: string | undefined,
) {
  const rel = relative(repoRoot, outDir);
  if (!rel.startsWith("..") && !rel.startsWith("/"))
    fail(
      `Refusing to write raw results inside the repository (${outDir}). Use a scratch directory.`,
    );

  const loaded = loadEnvFile(envFile);
  if (loaded.length)
    console.log(
      `Loaded from ${relative(repoRoot, envFile)}: ${loaded.join(", ")}`,
    );
  const missing = REQUIRED[provider].filter((name) => !process.env[name]);
  if (missing.length)
    fail(
      `Refusing to run ${provider}: missing ${missing.join(", ")} (checked the environment and ${relative(repoRoot, envFile)}).`,
    );
  const malformed = REQUIRED[provider].filter((name) =>
    /\s/.test(process.env[name] ?? ""),
  );
  if (malformed.length)
    fail(
      `Refusing to run ${provider}: ${malformed.join(", ")} contains whitespace (e.g. CLI banner output); pass only the value.`,
    );
  // The SDK would otherwise send the real key to whatever ANTHROPIC_BASE_URL points at.
  if (
    provider === ExtractionProvider.ANTHROPIC &&
    process.env.ANTHROPIC_BASE_URL
  ) {
    delete process.env.ANTHROPIC_BASE_URL;
    console.log(
      "Ignoring ANTHROPIC_BASE_URL: calling the Anthropic API directly.",
    );
  }

  const model =
    provider === ExtractionProvider.CLOUDFLARE
      ? modelFlag || process.env.CLOUDFLARE_AI_MODEL || DEFAULT_CLOUDFLARE_MODEL
      : modelFlag || process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
  if (
    provider === ExtractionProvider.ANTHROPIC &&
    !/^claude-[a-z0-9.-]+$/.test(model)
  )
    fail(
      `Refusing to run Anthropic: --model must name an Anthropic Claude model (got ${model}).`,
    );
  const label = labelFor(provider, model);
  const lockPath = join(outDir, ".live-eval.lock");
  mkdirSync(outDir, { recursive: true });
  try {
    mkdirSync(lockPath);
  } catch {
    fail(
      `Refusing to run: ${outDir} is already reserved by another live eval.`,
    );
  }
  try {
    const used = readCalls(outDir);
    if (used + fixtures.length > budget) {
      console.error(
        `Refusing to run: ${used} calls already used, ${fixtures.length} planned, budget ${budget}.`,
      );
      process.exitCode = 2;
      return;
    }
    console.log(
      `Running ${fixtures.length} fixture(s) on ${provider} ${model}; calls used so far ${used}/${budget}.`,
    );

    let calls = used;
    const records: RunRecord[] = [];
    for (const fixture of fixtures) {
      let rawBody = "";
      // Keeps only a successful response body. Request headers (which carry the key) are never stored,
      // and error bodies are reduced to the status and provider error codes.
      const capture: typeof fetch = async (input, init) => {
        calls += 1;
        writeFileSync(join(outDir, "calls.json"), JSON.stringify({ calls }));
        const response = await fetch(input, init);
        const body = await response.clone().text();
        rawBody = response.ok ? body : redactedError(response.status, body);
        return response;
      };
      const diagnostics: ExtractionDiagnostic[] = [];
      const config: CloudflareConfig =
        provider === ExtractionProvider.CLOUDFLARE
          ? {
              accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
              apiToken: process.env.CLOUDFLARE_API_TOKEN,
              model,
              timeoutMs,
              fetch: capture,
              onFailure: (d) => diagnostics.push(d),
            }
          : {
              anthropic: {
                apiKey: process.env.ANTHROPIC_API_KEY,
                model,
                timeoutMs,
                fetch: capture,
              },
              onFailure: (d) => diagnostics.push(d),
            };
      const started = Date.now();
      const result = await extractContract(
        { documentId: fixture.id, revision: 1, text: fixture.text },
        config,
      );
      const latencyMs = Date.now() - started;
      const stem = join(outDir, `${fixture.id}.${label}`);
      writeFileSync(`${stem}.raw.txt`, rawBody);
      writeFileSync(`${stem}.result.json`, JSON.stringify(result, null, 2));
      const run = record(
        fixture,
        provider,
        model,
        result,
        rawBody,
        latencyMs,
        diagnostics,
      );
      records.push(run);
      writeFileSync(`${stem}.run.json`, JSON.stringify(run, null, 2));
      console.log(
        `${fixture.id}: ${run.passed}/${run.total} in ${latencyMs} ms` +
          (diagnostics.length
            ? ` diagnostics ${JSON.stringify(diagnostics)}`
            : ""),
      );
    }
    console.log(formatScores(records.map(asScore)));
    console.log(`Calls used: ${calls}/${budget}. Results in ${outDir}`);
  } finally {
    rmdirSync(lockPath);
  }
}

const asScore = (r: RunRecord): FixtureScore => ({
  fixture: r.fixture,
  passed: r.passed,
  total: r.total,
  fields: r.fields,
});

/** Re-runs parsing and validation on saved Cloudflare bodies with the current code. No network. */
function runRescore(outDir: string, label: string, fixtures: LiveFixture[]) {
  const records: RunRecord[] = [];
  for (const fixture of fixtures) {
    const stem = join(outDir, `${fixture.id}.${label}`);
    if (!existsSync(`${stem}.raw.txt`)) continue;
    const rawBody = readFileSync(`${stem}.raw.txt`, "utf8");
    const previous = existsSync(`${stem}.run.json`)
      ? (JSON.parse(readFileSync(`${stem}.run.json`, "utf8")) as RunRecord)
      : null;
    const saved = JSON.parse(
      readFileSync(`${stem}.result.json`, "utf8"),
    ) as ExtractionResult;
    const provider = saved.provider ?? ExtractionProvider.CLOUDFLARE;
    const parsed = parseRaw(provider, rawBody);
    const document = {
      documentId: fixture.id,
      revision: 1,
      text: fixture.text,
    };
    let result: ExtractionResult = { ...saved };
    if (parsed)
      try {
        result = {
          ...saved,
          ...validateDraft(parsed.draft, document),
          status: ExtractionStatus.REVIEW_REQUIRED,
          promptVersion: PROMPT_VERSION,
          reason: null,
        };
      } catch {
        // Still invalid with the current code: keep the saved fallback result.
      }
    const run = record(
      fixture,
      provider,
      previous?.model ?? saved.model ?? label,
      result,
      rawBody,
      previous?.latencyMs ?? 0,
      previous?.diagnostics ?? [],
    );
    records.push(run);
    writeFileSync(`${stem}.rescored.json`, JSON.stringify(run, null, 2));
  }
  console.log(formatScores(records.map(asScore)));
}

function runOffline(target: string, fixtures: LiveFixture[], only?: string) {
  const files = statSync(target).isDirectory()
    ? readdirSync(target)
        .filter((f) => f.endsWith(".result.json"))
        .sort()
        .map((f) => join(target, f))
    : [target];
  const scores = files.map((file) => {
    const id = only ?? basename(file).split(".")[0];
    const fixture = fixtures.find((f) => f.id === id);
    if (!fixture) fail(`No fixture named ${id} for ${file}`);
    const score = scoreResult(
      fixture,
      JSON.parse(readFileSync(file, "utf8")) as ExtractionResult,
    );
    return { ...score, fixture: basename(file) };
  });
  console.log(formatScores(scores));
}

/** One row per model from saved run records (rescored ones win over the originals). */
function runReport(outDir: string) {
  const byStem = new Map<string, RunRecord>();
  for (const file of readdirSync(outDir).sort()) {
    const match = /^(.*)\.(run|rescored)\.json$/.exec(file);
    if (!match) continue;
    const run = JSON.parse(
      readFileSync(join(outDir, file), "utf8"),
    ) as RunRecord;
    if (match[2] === "rescored" || !byStem.has(match[1]))
      byStem.set(match[1], run);
  }
  const models = new Map<string, RunRecord[]>();
  for (const run of byStem.values())
    models.set(run.model, [...(models.get(run.model) ?? []), run]);
  const pct = (n: number, d: number) =>
    d ? `${Math.round((100 * n) / d)}%` : "n/a";
  console.log(
    "| Model | Fields | Field accuracy | Raw quotes verbatim | Questions as expected | Valid JSON | Median latency | Max latency | Cost / agreement |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const [model, runs] of models) {
    const passed = runs.reduce((n, r) => n + r.passed, 0);
    const total = runs.reduce((n, r) => n + r.total, 0);
    const quotes = runs.reduce(
      (q, r) => ({
        found: q.found + r.rawQuotes.found,
        total: q.total + r.rawQuotes.total,
      }),
      { found: 0, total: 0 },
    );
    const questions = runs.filter(
      (r) => r.fields.find((f) => f.field === ScoredField.QUESTIONS)?.pass,
    ).length;
    const latencies = runs.map((r) => r.latencyMs).sort((a, b) => a - b);
    const costs = runs.flatMap((r) => (r.costUsd === null ? [] : [r.costUsd]));
    console.log(
      `| ${model} | ${passed}/${total} | ${pct(passed, total)} | ${quotes.found}/${quotes.total} (${pct(quotes.found, quotes.total)}) | ${questions}/${runs.length} | ${runs.filter((r) => r.jsonValid).length}/${runs.length} | ${(latencies[Math.floor(latencies.length / 2)] / 1000).toFixed(1)} s | ${(latencies[latencies.length - 1] / 1000).toFixed(1)} s | ${costs.length ? `$${(costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(4)}` : "n/a"} |`,
    );
  }
}

const { values } = parseArgs({
  options: {
    provider: { type: "string" },
    model: { type: "string" },
    out: { type: "string" },
    fixture: { type: "string" },
    budget: { type: "string", default: "90" },
    timeout: { type: "string", default: "120000" },
    score: { type: "string" },
    rescore: { type: "string" },
    label: { type: "string" },
    report: { type: "string" },
    "vars-file": {
      type: "string",
      default: join(repoRoot, "apps/api/.dev.vars"),
    },
  },
});
const all = loadFixtures(fixturesDir);
const wanted = values.fixture?.split(",");
const selected = wanted ? all.filter((f) => wanted.includes(f.id)) : all;
if (!selected.length) fail(`No fixture named ${values.fixture}`);

if (values.score) {
  runOffline(resolve(values.score), all, values.fixture);
} else if (values.rescore) {
  if (!values.label) fail("--rescore needs --label <model label>");
  runRescore(resolve(values.rescore), values.label, selected);
} else if (values.report) {
  runReport(resolve(values.report));
} else {
  const provider = Object.values(ExtractionProvider).find(
    (p) => p === values.provider,
  );
  if (!provider)
    fail(
      `--provider must be one of ${Object.values(ExtractionProvider).join(", ")} (or use --score, --rescore, --report)`,
    );
  if (!values.out) fail("--out <scratch dir> is required for live runs");
  await runLive(
    provider,
    resolve(values.out),
    selected,
    safeNonNegativeInteger(values.budget, "--budget"),
    resolve(values["vars-file"]),
    safeNonNegativeInteger(values.timeout, "--timeout"),
    values.model,
  );
}

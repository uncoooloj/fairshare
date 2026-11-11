/**
 * Live eval for contract extraction against real providers, plus offline scoring of saved results.
 *
 *   npm run eval:live -w @fairshare/contract-ai -- --provider cloudflare --out <scratch dir> [--fixture 01-clean-three-way] [--budget 40]
 *   npm run eval:live -w @fairshare/contract-ai -- --score <result.json | dir of *.result.json>
 *
 * Live mode configures exactly one provider (no fallback), so each fixture costs one call. Calls are
 * counted in <out>/calls.json across runs and the run refuses to start if it would pass --budget.
 * Keys come from the environment, or from apps/api/.dev.vars (or --vars-file) when present. Key values are never
 * printed, logged or written; only the provider's response body and the validated result are saved,
 * and only outside the repository.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  extractContract,
  ExtractionProvider,
  type CloudflareConfig,
  type ExtractionResult,
} from "../src/index.js";
import {
  formatScores,
  loadFixtures,
  scoreResult,
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
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as { calls: number }).calls
    : 0;
}

async function runLive(
  provider: ExtractionProvider,
  outDir: string,
  fixtures: LiveFixture[],
  budget: number,
  envFile: string,
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

  mkdirSync(outDir, { recursive: true });
  const used = readCalls(outDir);
  if (used + fixtures.length > budget)
    fail(
      `Refusing to run: ${used} calls already used, ${fixtures.length} planned, budget ${budget}.`,
    );
  console.log(
    `Running ${fixtures.length} fixture(s) on ${provider}; calls used so far ${used}/${budget}.`,
  );

  let calls = used;
  const scores: FixtureScore[] = [];
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
    const diagnostics: unknown[] = [];
    const config: CloudflareConfig =
      provider === ExtractionProvider.CLOUDFLARE
        ? {
            accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
            apiToken: process.env.CLOUDFLARE_API_TOKEN,
            model: process.env.CLOUDFLARE_AI_MODEL,
            timeoutMs: 60_000,
            fetch: capture,
            onFailure: (d) => diagnostics.push(d),
          }
        : {
            anthropic: {
              apiKey: process.env.ANTHROPIC_API_KEY,
              model: process.env.ANTHROPIC_MODEL,
              timeoutMs: 60_000,
              fetch: capture,
            },
            onFailure: (d) => diagnostics.push(d),
          };
    const started = Date.now();
    const result = await extractContract(
      { documentId: fixture.id, revision: 1, text: fixture.text },
      config,
    );
    const stem = join(outDir, `${fixture.id}.${provider}`);
    writeFileSync(`${stem}.raw.txt`, rawBody);
    writeFileSync(`${stem}.result.json`, JSON.stringify(result, null, 2));
    const score = scoreResult(fixture, result);
    scores.push(score);
    console.log(
      `${fixture.id}: ${score.passed}/${score.total} in ${Date.now() - started} ms` +
        (diagnostics.length
          ? ` diagnostics ${JSON.stringify(diagnostics)}`
          : ""),
    );
  }
  writeFileSync(
    join(outDir, `${provider}.scores.json`),
    JSON.stringify(scores, null, 2),
  );
  console.log(formatScores(scores));
  console.log(`Calls used: ${calls}/${budget}. Results in ${outDir}`);
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

const { values } = parseArgs({
  options: {
    provider: { type: "string" },
    out: { type: "string" },
    fixture: { type: "string" },
    budget: { type: "string", default: "40" },
    score: { type: "string" },
    "vars-file": {
      type: "string",
      default: join(repoRoot, "apps/api/.dev.vars"),
    },
  },
});
const all = loadFixtures(fixturesDir);
const selected = values.fixture
  ? all.filter((f) => f.id === values.fixture)
  : all;
if (!selected.length) fail(`No fixture named ${values.fixture}`);

if (values.score) {
  runOffline(resolve(values.score), all, values.fixture);
} else {
  const provider = Object.values(ExtractionProvider).find(
    (p) => p === values.provider,
  );
  if (!provider)
    fail(
      `--provider must be one of ${Object.values(ExtractionProvider).join(", ")} (or use --score <file|dir>)`,
    );
  if (!values.out) fail("--out <scratch dir> is required for live runs");
  await runLive(
    provider,
    resolve(values.out),
    selected,
    Number(values.budget),
    resolve(values["vars-file"]),
  );
}

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fingerprint,
  isPersistencePath,
  repositoryFingerprint,
  target,
  validateAcceptance,
} from "./persistence-gate.mjs";

const digest = "a".repeat(64);
const now = Date.parse("2026-11-11T00:00:00.000Z");
const valid = {
  version: 1,
  scopeSha256: digest,
  target,
  checks: { restart: true, redeploy: true, restore: true, rollback: true },
  acceptedBy: "Test operator (synthetic fixture)",
  acceptedAt: "2026-11-10T00:00:00.000Z",
  evidenceUrl: "https://example.invalid/synthetic-test-evidence",
};
const validate = (receipt) =>
  validateAcceptance(JSON.stringify(receipt), digest, now);

test("requires a complete operator receipt matching the target and scope", () => {
  assert.deepEqual(validate(valid), []);
  for (const raw of [undefined, "", "true", "null", "[]", "{}", "not json"])
    assert.ok(validateAcceptance(raw, digest, now).length);
  for (const [key, value] of Object.entries(valid)) {
    const incomplete = { ...valid };
    delete incomplete[key];
    assert.ok(validate(incomplete).length, `missing ${key}`);
    assert.notEqual(value, undefined);
  }
  assert.ok(validate({ ...valid, version: 2 }).length);
  assert.ok(validate({ ...valid, scopeSha256: "b".repeat(64) }).length);
  for (const key of Object.keys(target))
    assert.ok(
      validate({ ...valid, target: { ...target, [key]: "different" } }).length,
    );
  for (const check of Object.keys(valid.checks)) {
    for (const value of [false, "true", undefined])
      assert.ok(
        validate({ ...valid, checks: { ...valid.checks, [check]: value } })
          .length,
      );
  }
});

test("rejects missing operator, invalid/future dates and unsafe evidence links", () => {
  for (const acceptedBy of [undefined, "", " ", 1])
    assert.ok(validate({ ...valid, acceptedBy }).length);
  for (const acceptedAt of [
    undefined,
    "",
    "no date",
    "2026-11-12T00:00:00.000Z",
    0,
  ])
    assert.ok(validate({ ...valid, acceptedAt }).length);
  for (const evidenceUrl of [
    undefined,
    "",
    "http://example.invalid",
    "https://user:secret@example.invalid",
    "https://example.invalid/?token=secret",
  ])
    assert.ok(validate({ ...valid, evidenceUrl }).length);
  assert.ok(
    !validate({ ...valid, evidenceUrl: "https://user:secret@example.invalid" })
      .join(" ")
      .includes("secret"),
  );
});

test("storage, backend, shared-package, dependencies and deploy changes revoke acceptance", () => {
  const files = [
    { path: "apps/api/cloudflare/worker.ts", content: "authority" },
    { path: "apps/web/app/page.tsx", content: "frontend" },
  ];
  const original = fingerprint(files);
  assert.equal(fingerprint([...files].reverse()), original);
  assert.equal(
    fingerprint([...files, { path: "docs/release.md", content: "docs" }]),
    original,
  );
  assert.equal(
    fingerprint([files[0], { ...files[1], content: "new frontend" }]),
    original,
  );
  for (const path of [
    "apps/api/src/database.ts",
    "apps/api/cloudflare/worker.ts",
    "apps/api/wrangler.hosted.json",
    "packages/cloudflare-storage/src/index.ts",
    "packages/new-backend/src/index.ts",
    "deploy/cloudflare/persistence-gate.mjs",
    "deploy/new-migration.sql",
    ".github/workflows/deploy.yml",
    "apps/web/wrangler.jsonc",
    "apps/web/package.json",
    "apps/web/next.config.ts",
    "apps/web/open-next.config.ts",
    "apps/web/tsconfig.json",
    "apps/web/scripts/build.mjs",
    "package.json",
    "package-lock.json",
  ]) {
    assert.equal(isPersistencePath(path), true);
    const withFile = [
      ...files.filter((file) => file.path !== path),
      { path, content: "original" },
    ];
    const changed = withFile.map((file) =>
      file.path === path ? { ...file, content: "updated" } : file,
    );
    const removed = withFile.filter((file) => file.path !== path);
    assert.notEqual(
      fingerprint(withFile),
      fingerprint(changed),
      `edit ${path}`,
    );
    assert.notEqual(
      fingerprint(withFile),
      fingerprint(removed),
      `remove ${path}`,
    );
    assert.notEqual(
      fingerprint([...files, { path, content: "changed" }]),
      original,
      path,
    );
  }
  assert.notEqual(
    fingerprint([{ ...files[0], content: "changed authority" }]),
    original,
  );
  assert.notEqual(fingerprint([]), original);
});

test("repository fingerprint excludes ignored output and includes new backend files", () => {
  const directory = mkdtempSync(join(tmpdir(), "fairshare-persistence-"));
  try {
    execFileSync("git", ["init", "-q", directory]);
    mkdirSync(join(directory, "apps/api/cloudflare"), { recursive: true });
    writeFileSync(join(directory, ".gitignore"), "apps/api/dist-cloudflare/\n");
    writeFileSync(
      join(directory, "apps/api/cloudflare/worker.ts"),
      "authority",
    );
    const original = repositoryFingerprint(directory);
    mkdirSync(join(directory, "apps/api/dist-cloudflare"));
    writeFileSync(
      join(directory, "apps/api/dist-cloudflare/worker.mjs"),
      "generated",
    );
    assert.equal(repositoryFingerprint(directory), original);
    writeFileSync(join(directory, "apps/api/migration.sql"), "new schema");
    assert.notEqual(repositoryFingerprint(directory), original);
    rmSync(join(directory, "apps/api/migration.sql"));
    assert.equal(repositoryFingerprint(directory), original);
    rmSync(join(directory, "apps/api/cloudflare/worker.ts"));
    assert.throws(() => repositoryFingerprint(directory), /incomplete/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("release gate fails closed without an acceptance variable", () => {
  const script = fileURLToPath(
    new URL("./persistence-gate.mjs", import.meta.url),
  );
  const result = spawnSync(process.execPath, [script], {
    env: { ...process.env, FAIRSHARE_PERSISTENCE_ACCEPTANCE: "" },
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /genuine hosted acceptance receipt/);
});

test("push-to-main releases retain gates while pull requests cannot publish", () => {
  const workflow = readFileSync(
    new URL("../../.github/workflows/deploy.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /push:\s+branches: \[main\]/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /vars\.FAIRSHARE_PERSISTENCE_ACCEPTANCE/);
  assert.match(
    workflow,
    /github\.event_name != 'pull_request' && github\.ref == 'refs\/heads\/main'/,
  );
  assert.match(workflow, /cancel-in-progress: false/);
  // Hosted origins belong in Wrangler bindings, not in the local test runner.
  assert.doesNotMatch(workflow, /^\s+FAIRSHARE_(?:API_URL|WEB_ORIGIN):/m);
  assert.match(workflow, /--no-bundle --keep-vars/);
  assert.equal(
    workflow.match(/run: node deploy\/cloudflare\/persistence-gate.mjs/g)
      ?.length,
    1,
  );
  assert.equal(
    workflow.match(/node deploy\/cloudflare\/persistence-gate.mjs\n/g)?.length,
    2,
  );
  assert.match(
    workflow,
    /test "\$actual" = "\$\{\{ steps\.api_bundle\.outputs\.sha256 \}\}"/,
  );
  assert.match(workflow, /git ls-remote origin refs\/heads\/main/);
  assert.match(workflow, /if: steps\.current\.outputs\.deploy == 'true'/);
});

test("persistence waiver is manual-main-only and guards both gate invocations", () => {
  const workflow = readFileSync(
    new URL("../../.github/workflows/deploy.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /workflow_dispatch:\s+inputs:/);
  assert.match(
    workflow,
    /waive_persistence:[\s\S]*default: false[\s\S]*type: boolean/,
  );
  const manualMain =
    "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.waive_persistence == true";
  assert.equal(workflow.split(manualMain).length - 1, 3);
  assert.ok(
    workflow.includes(
      "github.event_name != 'pull_request' && github.ref == 'refs/heads/main' && !(" +
        manualMain +
        ")",
    ),
  );
  for (const text of [
    "$GITHUB_ACTOR",
    "$GITHUB_SHA",
    "fairshare-api-sandbox",
    "https://fairshare-api-sandbox.udaleamehoj.workers.dev",
    "https://usefairshare.app",
    "Checks not performed: restart, redeploy, restore, rollback",
  ]) {
    assert.ok(workflow.includes(text));
  }
  assert.match(workflow, /FAIRSHARE_PERSISTENCE_WAIVED/);
  assert.match(workflow, /if \[ \"\$FAIRSHARE_PERSISTENCE_WAIVED\" = true \]/);
});

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { validateCloudflareEnvironment } from "./preflight.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const target = Object.freeze({
  worker: "fairshare-api-sandbox",
  apiOrigin: "https://fairshare-api-sandbox.udaleamehoj.workers.dev",
  webOrigin: "https://usefairshare.app",
});
const checks = ["restart", "redeploy", "restore", "rollback"];

// Deliberately conservative: any backend, shared-package, deployment or dependency
// change needs renewed hosted acceptance. Frontend-only and docs changes do not.
// This file and the release workflow are themselves included in the fingerprint.
export function isPersistencePath(path) {
  return (
    path === "package.json" ||
    path === "package-lock.json" ||
    path === ".github/workflows/deploy.yml" ||
    [
      "apps/web/wrangler.jsonc",
      "apps/web/package.json",
      "apps/web/next.config.ts",
      "apps/web/open-next.config.ts",
      "apps/web/tsconfig.json",
    ].includes(path) ||
    path.startsWith("apps/web/scripts/") ||
    ["apps/api/", "packages/", "deploy/"].some((prefix) =>
      path.startsWith(prefix),
    )
  );
}

export function fingerprint(files) {
  const hash = createHash("sha256");
  hash.update("fairshare-hosted-persistence-v1\0");
  for (const { path, content } of [...files].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  )) {
    if (!isPersistencePath(path)) continue;
    const bytes = Buffer.from(content);
    hash.update(`${path}\0${bytes.length}\0`);
    hash.update(bytes);
  }
  return hash.digest("hex");
}

export function repositoryFingerprint(directory = root) {
  const paths = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: directory, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  const selected = [...new Set(paths)].filter(isPersistencePath);
  if (!selected.includes("apps/api/cloudflare/worker.ts"))
    throw new Error(
      "Persistence scope is incomplete; use a complete checkout.",
    );
  return fingerprint(
    selected.map((path) => {
      const local = resolve(directory, path);
      if (!lstatSync(local).isFile())
        throw new Error("Persistence scope must contain regular files only.");
      return { path, content: readFileSync(local) };
    }),
  );
}

export function validateAcceptance(raw, scopeSha256, now = Date.now()) {
  let receipt;
  try {
    receipt = JSON.parse(raw || "");
  } catch {
    return [
      "Set FAIRSHARE_PERSISTENCE_ACCEPTANCE to a genuine hosted acceptance receipt. See deploy/cloudflare/README.md.",
    ];
  }
  const errors = [];
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt))
    return ["Persistence acceptance must be a JSON object."];
  if (receipt.version !== 1)
    errors.push("Unsupported persistence receipt version.");
  if (receipt.scopeSha256 !== scopeSha256)
    errors.push(
      "Persistence acceptance is missing or stale for this backend/deployment scope. Repeat hosted acceptance before updating the receipt.",
    );
  for (const [key, value] of Object.entries(target)) {
    if (receipt.target?.[key] !== value)
      errors.push(
        `Persistence acceptance target ${key} does not match this hosted sandbox.`,
      );
  }
  if (!checks.every((check) => receipt.checks?.[check] === true))
    errors.push(
      "Restart, redeploy, restore and rollback must each have recorded passing acceptance.",
    );
  if (typeof receipt.acceptedBy !== "string" || !receipt.acceptedBy.trim())
    errors.push("Persistence acceptance must identify its operator.");
  const acceptedAt =
    typeof receipt.acceptedAt === "string"
      ? Date.parse(receipt.acceptedAt)
      : NaN;
  if (!Number.isFinite(acceptedAt) || acceptedAt > now)
    errors.push(
      "Persistence acceptance needs a valid, non-future acceptedAt timestamp.",
    );
  try {
    const url = new URL(receipt.evidenceUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search)
      throw new Error();
  } catch {
    errors.push(
      "Persistence acceptance needs an HTTPS evidence URL without credentials or a query string.",
    );
  }
  return errors;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const scopeSha256 = repositoryFingerprint();
    if (process.argv[2] === "--fingerprint") {
      console.log(scopeSha256);
    } else {
      console.log(`Persistence scope SHA-256: ${scopeSha256}`);
      const errors = validateAcceptance(
        process.env.FAIRSHARE_PERSISTENCE_ACCEPTANCE,
        scopeSha256,
      );
      // This is a validated operator attestation, never automatic evidence that
      // hosted restart/restore tests passed or provider operations are accepted.
      if (!errors.length) {
        errors.push(
          ...validateCloudflareEnvironment({
            FAIRSHARE_API_URL: target.apiOrigin,
            FAIRSHARE_WEB_ORIGIN: target.webOrigin,
            FAIRSHARE_API_PERSISTENCE_VERIFIED: "true",
          }),
        );
      }
      if (errors.length) throw new Error(errors.join("\n"));
      console.log(
        "Matching hosted persistence attestation found. Evidence truth and provider acceptance remain separate.",
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

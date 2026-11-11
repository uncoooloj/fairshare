import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const route = readFileSync(
  join(root, "app/api/service/[...path]/route.ts"),
  "utf8",
);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return name === "node_modules" || name.startsWith(".")
        ? []
        : sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

test("the service proxy allows every API prefix the web app calls", () => {
  const allowlist = route.slice(
    route.indexOf("!["),
    route.indexOf("].includes(parts[0])"),
  );
  const allowed = new Set(
    [...allowlist.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]),
  );
  const called = new Set<string>();
  for (const file of ["components", "lib", "src", "app"].flatMap((dir) =>
    sources(join(root, dir)),
  )) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(
      /\bapi(?:<[^>]*>)?\(\s*[`"']([a-z-]+)[/`"'$]/g,
    ))
      called.add(match[1]);
  }
  assert.ok(
    called.has("agreement-invitations"),
    "scan should find invitation calls",
  );
  for (const prefix of called)
    assert.ok(allowed.has(prefix), `proxy blocks /api/${prefix}`);
});

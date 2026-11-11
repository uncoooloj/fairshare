import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appSource } from "./app-source";
const read = (name: string) =>
  readFileSync(new URL(`../components/${name}.tsx`, import.meta.url), "utf8");
test("upload paths let the server choose how to read a document without an OCR checkbox", () => {
  for (const source of [
    read("agreement-intake"),
    read("wizard-intake"),
    read("agreement-creation-wizard"),
    appSource(),
  ]) {
    assert.doesNotMatch(
      source,
      /LocalOcrChoice|setOcr|setUseLocalOcr|Use OCR|useLocalOcr:/,
    );
  }
  assert.match(read("agreement-creation-wizard"), /Nothing is saved until/);
});
test("scanned source is clearly distinguished and page counts remain readable", () => {
  const source = read("agreement-document");
  assert.match(source, /Scanned document · check against the original/);
  assert.match(
    source,
    /Array\.isArray\(document\.provenance\.pages\)\s*\?\s*document\.provenance\.pages\.length/,
  );
});

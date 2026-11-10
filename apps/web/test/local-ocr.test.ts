import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("OCR choice is opt-in, capability-gated and explicit about processing location", () => {
  const choice = readFileSync(
    new URL("../components/local-ocr-choice.tsx", import.meta.url),
    "utf8",
  );
  assert.match(choice, /setAvailable\(false\)/);
  assert.match(choice, /onChange\(false\)/);
  assert.match(choice, /localOcrEnabled\s*===\s*true/);
  assert.match(choice, /Cloudflare when hosted/);
  const app = readFileSync(
    new URL("../components/fairshare-app.tsx", import.meta.url),
    "utf8",
  );
  assert.match(app, /useLocalOcr,\s*setUseLocalOcr\]\s*=\s*useState\(false\)/);
  assert.match(
    app,
    /!isDocx\s*&&\s*useLocalOcr\s*\?\s*\{\s*useLocalOcr:\s*true\s*\}/,
  );
});
test("document view labels OCR and renders page count rather than page objects", () => {
  const source = readFileSync(
    new URL("../components/agreement-document.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /OCR TEXT · REVIEW REQUIRED/);
  assert.match(
    source,
    /Array\.isArray\(document\.provenance\.pages\)\s*\?\s*document\.provenance\.pages\.length/,
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const app = readFileSync(
  new URL("../components/fairshare-app.tsx", import.meta.url),
  "utf8",
);
const widgets = readFileSync(
  new URL("../components/agreement-widgets.tsx", import.meta.url),
  "utf8",
);
const css = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

test("successful source save clears source dirty state but preserves unsaved rules", () => {
  assert.match(
    app,
    /setDocumentId\(doc.documentId\);\s*setDraftDirty\(rulesDirty.current\);\s*setNotice/,
  );
  // PDF/DOCX uploads are persisted by the API; plain text still needs Save source.
  assert.match(
    app,
    /setDraftDirty\(\s*!\/\\\.\(pdf\|docx\)\$\/i\.test\(f\.name\),?\s*\)/,
  );
  assert.match(
    app,
    /onDirty=\{\(\)\s*=>\s*\{\s*rulesDirty\.current\s*=\s*true;\s*setDraftDirty\(true\);\s*\}\}/,
  );
});
test("sample rules show party names and explicit human-review guidance", () => {
  assert.match(widgets, /source.trim\(\) === sampleAgreement/);
  assert.match(widgets, /Sample text is not your participants’ agreement/);
  assert.match(widgets, /\(?member\)?\s*=>\s*member\.displayName/);
  assert.match(widgets, /Add the correct people in People/);
  assert.match(widgets, /not\s+extracted or approved terms/);
  assert.match(widgets, /everyone must review and approve/);
});
test("sidebar email truncates visibly without losing full address", () => {
  assert.ok(app.includes("<small title={user.email}>{user.email}</small>"));
  assert.match(
    css,
    /\.identity\s*>\s*div\s*\{\s*min-width:\s*0;\s*flex:\s*1;\s*\}/,
  );
  assert.match(
    css,
    /\.identity\s+small\s*\{\s*overflow:\s*hidden;\s*text-overflow:\s*ellipsis;\s*white-space:\s*nowrap;\s*\}/,
  );
});

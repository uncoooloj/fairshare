import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const app = readFileSync(new URL('../components/fairshare-app.tsx', import.meta.url), 'utf8');
const widgets = readFileSync(new URL('../components/agreement-widgets.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

test('successful source save clears source dirty state but preserves unsaved rules', () => {
  assert.match(app, /setDocumentId\(doc.documentId\);\s*setDraftDirty\(rulesDirty.current\);\s*setNotice/);
  // PDF/DOCX uploads are persisted by the API; plain text still needs Save source.
  assert.ok(app.includes('setDraftDirty(!/\\.(pdf|docx)$/i.test(f.name))'));
  assert.match(app, /onDirty=\{\(\) => \{ rulesDirty.current = true; setDraftDirty\(true\); \}\}/);
});
test('sample rules show party names and explicit human-review guidance', () => {
  assert.match(widgets, /source.trim\(\) === sampleAgreement/);
  assert.match(widgets, /Sample text is not your participants’ agreement/);
  assert.match(widgets, /member => member.displayName/);
  assert.match(widgets, /Add the correct people in People/);
  assert.match(widgets, /not extracted or approved terms/);
  assert.match(widgets, /everyone must review and approve/);
});
test('sidebar email truncates visibly without losing full address', () => {
  assert.ok(app.includes('<small title={user.email}>{user.email}</small>'));
  assert.match(css, /\.identity > div \{ min-width: 0; flex: 1; \}/);
  assert.match(css, /\.identity small \{ overflow: hidden; text-overflow: ellipsis; white-space: nowrap; \}/);
});

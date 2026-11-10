import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {agreementEmptyState} from '../lib/agreement-empty-state';

test('joined members wait for an agreement rather than re-uploading the source', () => {
  const state = agreementEmptyState('MEMBER');
  assert.equal(state.title, 'No agreements shared with you yet');
  assert.match(state.description, /organizer to add you/);
  assert.match(state.description, /Refresh/);
  assert.match(state.description, /do not need to upload/);
});
test('owners retain creation guidance and viewers get role-appropriate access guidance', () => {
  assert.match(agreementEmptyState('OWNER').description, /Create an agreement/);
  assert.match(agreementEmptyState('VIEWER').description, /read-only/);
  assert.match(agreementEmptyState('VIEWER').description, /workspace owner/);
});
test('invitation confirmation suppresses competing application forms; creation respects membership', () => {
  const source = readFileSync(new URL('../components/fairshare-app.tsx', import.meta.url),'utf8');
  assert.match(source, /flowToken && flowKind === "\/invitation" \? null : !workspace/);
  assert.match(source, /workspaceRole === "OWNER" \|\| workspaceRole === "MEMBER"/);
  assert.match(source, /!creating && canCreateAgreement/);
  assert.match(source, /creating && canCreateAgreement \? \(/);
  assert.match(source, /setCreating\(false\);\s*setWorkspace\(e.target.value\)/);
  assert.equal(source.match(/workspaceRole=\{workspaceRole\}/g)?.length, 2);
});

test('expired or unwanted invitations can be dismissed without consuming them', () => {
  const prompt = readFileSync(new URL('../components/designer-auth.tsx', import.meta.url),'utf8');
  assert.match(prompt, /kind === "invitation" && onCancel/);
  assert.match(prompt, /onClick=\{onCancel\}>Not now/);
  const source = readFileSync(new URL('../components/fairshare-app.tsx', import.meta.url),'utf8');
  assert.match(source, /onCancel=\{\(\) => \{setFlowToken\(""\);setError\(""\);history.replaceState/);
});

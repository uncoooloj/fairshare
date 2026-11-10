import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../components/fairshare-app.tsx', import.meta.url), 'utf8');
test('designer shell retains authoritative payment recovery and onboarding callbacks', () => {
  assert.match(source, /<PaymentRecovery/);
  assert.match(source, /<AgreementIntake/);
  assert.match(source, /<AccessPrompt/);
  assert.match(source, /auth\/verification\/confirm/);
  assert.match(source, /invitations\/accept/);
  assert.match(source, /agreements\/intake", "POST"/);
  assert.match(source, /no live money/);
});
test('export styling uses local licensed Onest fonts without importing export scripts', () => {
  const fonts=readFileSync(new URL('../app/fonts.css', import.meta.url),'utf8');
  const license=readFileSync(new URL('../public/fonts/OFL.txt', import.meta.url),'utf8');
  assert.match(fonts,/\/fonts\//); assert.match(license,/SIL OPEN FONT LICENSE/);
  assert.doesNotMatch(source,/__bundler|dangerouslySetInnerHTML|iframe/);
});

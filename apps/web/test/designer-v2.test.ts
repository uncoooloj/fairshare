import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../components/agreement-widgets.tsx', import.meta.url), 'utf8');
test('revised agreement filter is labelled, native and wired to existing filter state', () => {
  assert.match(source, /<select aria-label="Filter agreements by status" value={filter} onChange={event => setFilter\(event.target.value\)}/);
  assert.match(source, /\["All", "Draft", "In review", "Approved", "Needs attention"\]/);
  assert.match(source, /filter === "All" \|\| agreementStatus\(a\) === filter/);
  assert.doesNotMatch(source, /className="filter-tabs"/);
  assert.match(source, /No matching agreements/);
});
test('only active rules collapse, leaving setup and recoupment actions outside', () => {
  const app = readFileSync(new URL('../components/fairshare-app.tsx', import.meta.url), 'utf8');
  const disclosure = readFileSync(new URL('../components/revenue-rules.tsx', import.meta.url), 'utf8');
  assert.match(disclosure, /useState\(true\)/);
  assert.match(disclosure, /<summary>Revenue rules<\/summary>/);
  assert.match(app, /<RevenueRules key=\{`\$\{selected.id\}:\$\{active.id\}`\}>/);
  assert.match(app, /<\/RevenueRules>\s*\) : \(\s*<Empty/);
  assert.match(app, /Set up terms/);
  assert.match(app, /allocated toward recoupment\. This is not proof of/);
});

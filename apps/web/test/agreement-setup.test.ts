import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../components/agreement-setup.tsx',import.meta.url),'utf8');
test('setup does not guess completion or mutate financial state',()=>{
 assert.match(source,/if\s*\(\s*agreement\.value\.activeVersionId\s*\)\s*return null/);
 assert.match(source,/latest.approvals\[m.userId\]/);
 assert.match(source,/if\s*\(\s*!busy\s*&&\s*name\.trim\(\)\s*\)\s*onCreate\(\s*name\.trim\(\)\s*\)/);
 assert.doesNotMatch(source,/fetch\(|api\(|\/activate|\/payments|\/payouts/);
});
test('setup explains explicit activation and sandbox rather than promising live movement',()=>{
 assert.match(source,/organizer activates it/);
 assert.match(source,/does not move money/);
 assert.match(source,/accepted members before proposing/);
});

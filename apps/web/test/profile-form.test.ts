import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('profile editor guards duplicate writes and explains immutable agreement names',()=>{
 const source=readFileSync(new URL('../components/profile-form.tsx',import.meta.url),'utf8');
 assert.match(source,/pending.current\|\|busy/);
 assert.match(source,/pending.current=true/);
 assert.match(source,/finally\{pending.current=false/);
 assert.match(source,/maxLength=\{80\}/);
 assert.match(source,/not names recorded in existing agreements/);
 assert.match(source,/role="alert"/);
});

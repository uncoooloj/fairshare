import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
test('Cloudflare manifest provisions durable SQL authority and private bounded parser, never enables money features by default',()=>{
  const config=JSON.parse(read('../wrangler.jsonc'));
  assert.equal(config.workers_dev,false);assert.equal(config.preview_urls,false);
  assert.deepEqual(config.migrations[0].new_sqlite_classes,['FairshareAuthority','FairshareDocumentParser']);
  assert.equal(config.containers.length,1);assert.equal(config.containers[0].max_instances,1);
  assert.equal(config.containers[0].image_build_context,'../..');
  for(const value of Object.values(config.vars))assert.equal(value,'false');
  assert.equal(Object.keys(config.vars).some(key=>/SECRET|TOKEN|ENCRYPTION_KEY/.test(key)),false);
  assert.match(read('../cloudflare/parser.ts'),/enableInternet = false/);
  assert.match(read('../../../.dockerignore'),/\*\*\/\.env\*/);
});

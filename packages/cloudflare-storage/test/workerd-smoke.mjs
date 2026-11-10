// Run after the Cloudflare web toolchain installs Miniflare (via Wrangler).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
const adapter = stripTypeScriptTypes(await readFile(new URL('../src/index.ts', import.meta.url), 'utf8'));
const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
  name: 'storage-probe',
  modules: true,
  compatibilityDate: '2026-11-01',
  durableObjects: { STATE: { className: 'StorageProbe', useSQLite: true } },
  script: `import { DurableObject } from 'cloudflare:workers';
${adapter}
export class StorageProbe extends DurableObject {
  async fetch() {
    const db = new DurableSqlDatabase(this.ctx.storage);
    db.exec('CREATE TABLE IF NOT EXISTS captures(id TEXT PRIMARY KEY, cents INTEGER, revision INTEGER)');
    db.prepare('INSERT OR IGNORE INTO captures VALUES(?,?,?)').run('cap',100,1);
    let rolledBack = false;
    try { db.tx(() => {
      db.prepare('UPDATE captures SET cents=900 WHERE id=?').run('cap');
      db.prepare('INSERT INTO captures VALUES(?,?,?)').run('cap',900,1);
    }); } catch { rolledBack = true; }
    const zero = db.prepare('UPDATE captures SET cents=200 WHERE id=? AND revision=?').run('cap',99).changes;
    const row = db.prepare('SELECT * FROM captures').get();
    return Response.json({rolledBack,zero,row});
  }
}
export default { fetch(request, env) { return env.STATE.get(env.STATE.idFromName('global-probe')).fetch(request); } };`,
}] }));
try {
  const response = await mf.dispatchFetch('https://storage.test/');
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(result, { rolledBack: true, zero: 0, row: { id: 'cap', cents: 100, revision: 1 } });
  console.log('workerd DO SQLite: atomic rollback, unique capture, stale revision row count PASS');
} finally { await mf.dispose(); }

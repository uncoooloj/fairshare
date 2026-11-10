import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { createParserServer } from '../parser-container/server.js';
import { cloudflareDocumentReaders } from '../cloudflare/documentReaders.js';
import { buildApp } from '../src/app.js';

async function withParser(fn: (origin: string) => Promise<void>) {
  const server = createParserServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as {port: number};
  try { await fn(`http://127.0.0.1:${address.port}`); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
const bound = (origin: string) => cloudflareDocumentReaders({fetch: request => fetch(new Request(origin + new URL(request.url).pathname, request))});

test('private parser rejects unsupported routes and oversized input, reads actual DOCX without AI', async () => {
  await withParser(async origin => {
    assert.equal((await fetch(origin+'/')).status,404);
    assert.equal((await fetch(origin+'/pdf',{method:'POST',body:'bad'})).status,415);
    const oversized = await fetch(origin+'/pdf',{method:'POST',headers:{'content-type':'application/octet-stream'},body:Buffer.alloc(5*1024*1024+1)});
    assert.equal(oversized.status,413);
    const zip = new JSZip();
    zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Synthetic agreement</w:t></w:r></w:p></w:body></w:document>');
    const bytes = await zip.generateAsync({type:'nodebuffer'});
    const result = await bound(origin).docx(bytes);
    assert.equal(result.text,'Synthetic agreement');
    assert.equal(result.sourceFileSha256,createHash('sha256').update(bytes).digest('hex'));
    assert.equal(result.extraction.ocr,false);
    await assert.rejects(bound(origin).pdf(Buffer.from('broken')), (e:any) => e.code==='INVALID_PDF');
  });
});
const ocrAvailable=['pdfinfo','pdftoppm','tesseract'].every(binary=>spawnSync(binary,[binary==='tesseract'?'--version':'-v']).status===0);
test('private parser runs actual OCR and preserves immutable hash and review provenance', {skip:!ocrAvailable}, async () => {
  await withParser(async origin => {
    const bytes=readFileSync(new URL('./fixtures/scanned-agreement.pdf',import.meta.url));
    await assert.rejects(bound(origin).pdf(bytes),(e:any)=>e.code==='PDF_NO_EXTRACTABLE_TEXT');
    const result=await bound(origin).ocr(bytes);
    assert.match(result.text,/Maya receives 50 percent/);
    assert.equal(result.extraction.reviewRequired,true);
    assert.equal(result.extraction.ocr,true);
    assert.equal(result.pages.length,1);
    assert.equal(result.sourceFileSha256,createHash('sha256').update(bytes).digest('hex'));
  });
});
test('binding absent, malformed output and mismatched hash fail closed without echoing private errors', async () => {
  const bytes=Buffer.from('%PDF-test');
  await assert.rejects(cloudflareDocumentReaders().pdf(bytes),(e:any)=>e.code==='PARSER_NOT_CONFIGURED');
  for(const response of [Response.json({text:'secret'}),new Response('private debug text',{status:500}),Response.json({text:'ok',sourceFileSha256:'wrong'})]) {
    await assert.rejects(cloudflareDocumentReaders({fetch:async()=>response}).pdf(bytes),(e:any)=>e.code==='PARSER_UNAVAILABLE'&&!e.message.includes('secret')&&!e.message.includes('debug'));
  }
  await assert.rejects(cloudflareDocumentReaders({fetch:async()=>new Response('x'.repeat(300001))}).pdf(bytes),(e:any)=>e.code==='PARSER_UNAVAILABLE');
});
test('API missing parser returns 503, never writes partial intake and does not advertise OCR', async () => {
  const app=await buildApp({dbPath:':memory:',documentReaders:cloudflareDocumentReaders()});
  try {
    const owner=app.store.register({name:'Owner',email:'parser@example.com',password:'Password123!'});
    const response=await app.inject({method:'POST',url:'/api/agreements/intake',headers:{authorization:`Bearer ${owner.token}`},payload:{requestId:'00000000-0000-4000-8000-000000000001',mimeType:'application/pdf',base64:Buffer.from('%PDF-test').toString('base64')}});
    assert.equal(response.statusCode,503,response.body);
    assert.equal(response.json().error.code,'PARSER_NOT_CONFIGURED');
    assert.equal(app.store.workspaces(owner.user.id).length,0);
  }finally{await app.close();}
});
test('parser concurrency is bounded and slot releases after completion', async () => {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const parse = async () => { entered(); await blocked; return {text:'fixture'} as any; };
  const server = createParserServer({pdf:parse,docx:parse,ocr:parse});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const post=()=>fetch(origin+'/pdf',{method:'POST',headers:{'content-type':'application/octet-stream'},body:'%PDF-fixture'});
  try {
    const first=post();
    await started;
    assert.equal((await post()).status,429);
    release();
    assert.equal((await first).status,200);
    assert.equal((await post()).status,200);
  }finally{release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

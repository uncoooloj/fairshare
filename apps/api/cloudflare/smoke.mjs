import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import assert from 'node:assert/strict';
const directory = await mkdtemp(join(tmpdir(),'fairshare-worker-test-'));
let reference='',orderWrites=0,captureWrites=0;
const providerFixture=async request=>{
  const url=new URL(request.url);
  assert.equal(url.origin,'https://api-m.sandbox.paypal.com');
  const money=value=>({currency_code:'USD',value});
  if(url.pathname==='/v1/oauth2/token')return Response.json({access_token:'local-test-token',expires_in:3600});
  if(url.pathname==='/v2/checkout/orders'){
    orderWrites++;reference=(await request.json()).purchase_units[0].custom_id;
    return Response.json({id:'ORDER-TEST',links:[{rel:'approve',href:'https://sandbox.paypal.com/test'}]});
  }
  if(['/v2/checkout/orders/ORDER-TEST/capture','/v2/checkout/orders/ORDER-TEST'].includes(url.pathname)){
    if(request.method==='POST')captureWrites++;
    return Response.json({id:'ORDER-TEST',status:'COMPLETED',purchase_units:[{custom_id:reference,payee:{merchant_id:'ABCDEFGHIJKLM'},payments:{captures:[{id:'CAPTURE-TEST',status:'COMPLETED',amount:money('1.00'),seller_receivable_breakdown:{gross_amount:money('1.00'),paypal_fee:money('0.03'),net_amount:money('0.97')}}]}}]});
  }
  throw new Error('Unexpected outbound provider request');
};
const options = convertV4MiniflareOptions({modules:true,
  script:await readFile(new URL('../dist-cloudflare/worker.mjs',import.meta.url),'utf8'),
  compatibilityDate:'2026-11-01',compatibilityFlags:['nodejs_compat'],outboundService:providerFixture,
  durableObjectsPersist:directory,
  durableObjects:{AUTHORITY:{className:'FairshareAuthority',useSQLite:true}}});
options.resourcePersistencePath=directory;
let mf = new Miniflare(options);
let token;
async function request(path, body, expected=200, overrideToken=token) {
  const response = await mf.dispatchFetch('https://fairshare.test'+path,{
    method:body?'POST':'GET',headers:{'content-type':'application/json',...(overrideToken?{authorization:`Bearer ${overrideToken}`}:{})},
    body:body?JSON.stringify(body):undefined});
  const result = await response.json();
  assert.equal(response.status,expected,JSON.stringify(result));
  assert.equal(response.headers.get('cache-control'),'no-store');
  return result;
}
try {
  await request('/health');
  await request('/api/auth/register',{email:'a@example.com',name:'A',password:'valid-password-123',admin:true},400);
  const owner = await request('/api/auth/register',{email:'a@example.com',name:'A',password:'valid-password-123'},201);
  token=owner.token;
  await request('/api/auth/login',{email:'a@example.com',password:'wrong'},401);
  const intakeInput={requestId:randomUUID(),text:'Creator Agreement\nCreator receives all net revenue.'};
  const intake=await request('/api/agreements/intake',intakeInput,201);
  const replay=await request('/api/agreements/intake',intakeInput);
  assert.equal(intake.agreement.id,replay.agreement.id);
  assert.equal((await request('/api/workspaces')).workspaces.length,1);
  const base=`/api/workspaces/${intake.workspace.id}/collaborations/${intake.agreement.id}`;
  const outsider=await request('/api/auth/register',{email:'b@example.com',name:'B',password:'valid-password-123'},201);
  await request(base,undefined,404,outsider.token);
  let row=await request(base+'/versions',{expectedRevision:1,rules:{currency:'USD',feePolicy:'BEFORE_SPLIT',shares:[{userId:owner.user.id,basisPoints:10000}],source:{origin:'SOURCE_CLAUSE',documentId:intake.document.documentId,clause:'1',excerpt:'Creator receives all net revenue.'},unresolvedQuestions:[]}});
  await request(base+'/name',{name:'stale',expectedRevision:1},409);
  for(const action of ['send','approve','activate']) row=await request(base+'/versions/1/'+action,{expectedRevision:row.revision});
  assert.equal(row.value.versions[0].status,'ACTIVE');
  await request(base+'/payments',{amountCents:100,requestKey:'unconfigured'},503);
  await request('/api/paypal/webhook',{id:'not-signed',event_type:'PAYMENT.CAPTURE.COMPLETED'},503);
  await mf.dispose();
  mf=new Miniflare(options);
  const restored=await request(base);
  assert.equal(restored.revision,row.revision);
  assert.equal(restored.value.versions[0].status,'ACTIVE');
  assert.equal((await request('/api/auth/me')).user.id,owner.user.id);
  await mf.dispose();
  for(const [key,value] of Object.entries({PAYPAL_CLIENT_ID:'test-id',PAYPAL_CLIENT_SECRET:'test-secret',PAYPAL_MERCHANT_ID:'ABCDEFGHIJKLM',PAYPAL_WEBHOOK_ID:'test-webhook',PUBLIC_API_URL:'https://callbacks.example.test'})) options.workers[0].config.env[key]={type:'text',value};
  mf=new Miniflare(options);
  const payment=await request(base+'/payments',{amountCents:100,requestKey:'fixture-payment'});
  await request(base+'/payments',{amountCents:100,requestKey:'fixture-payment'});
  await request(base+'/payments/'+payment.id+'/capture',{});
  await request(base+'/payments/'+payment.id+'/capture',{});
  assert.equal(orderWrites,1);assert.equal(captureWrites,1);
  const settled=await request(base);
  assert.equal(settled.value.revenue.length,1);
  assert.equal(settled.value.revenue[0].allocations[0].totalCents,97);
  await request('/api/paypal/webhook',{id:'unsigned',event_type:'PAYMENT.CAPTURE.COMPLETED'},401);
  console.log('workerd full handlers PASS: auth, schema rejection, atomic intake/replay, tenant isolation, source-backed rules/approval/activation, stale revision, fail-closed payments, durable restart; MOCKED PayPal create/capture/net allocation/idempotency (not provider evidence)');
} finally { await mf.dispose(); await rm(directory,{recursive:true,force:true}); }

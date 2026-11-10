import test from 'node:test';
import assert from 'node:assert/strict';
import workerRouter from '../cloudflare/router.js';
function setup() {
  const app=workerRouter({bodyLimit:100});
  app.setErrorHandler((error:any,_req:any,reply:any)=>reply.status(error.statusCode??500).send({error:true}));
  app.addHook('onSend',async(_req:any,reply:any)=>{reply.header('cache-control','no-store');});
  return app;
}
const bytes=(body:unknown)=>new TextEncoder().encode(JSON.stringify(body));
test('worker router prefers static routes and decodes only captured params',async()=>{
  const app=setup();
  app.get('/items/:id',(req:any)=>({id:req.params.id}));app.get('/items/special',()=>({special:true}));
  const special=await app.inject({method:'GET',url:'/items/special'});
  assert.deepEqual(JSON.parse(new TextDecoder().decode(special.rawPayload)),{special:true});
  const encoded=await app.inject({method:'GET',url:'/items/a%20b'});
  assert.deepEqual(JSON.parse(new TextDecoder().decode(encoded.rawPayload)),{id:'a b'});
  assert.equal((await app.inject({method:'GET',url:'/items/%GG'})).statusCode,400);
});
test('worker router enforces schemas without stripping unknown inputs or coercing values',async()=>{
  const app=setup();let called=0;
  app.post('/save',{schema:{body:{type:'object',required:['name'],additionalProperties:false,properties:{name:{type:'string',minLength:2,maxLength:5,pattern:'^[a-z]+$'},enabled:{type:'boolean'}}}}},()=>{called++;return{ok:true};});
  for(const body of [{},{name:123},{name:'a'},{name:'abcdef'},{name:'AA'},{name:'ok',admin:true},{name:'ok',enabled:'true'}]) {
    assert.equal((await app.inject({method:'POST',url:'/save',headers:{'content-type':'application/json'},payload:bytes(body)})).statusCode,400);
  }
  assert.equal(called,0);
  assert.equal((await app.inject({method:'POST',url:'/save',headers:{'content-type':'application/json'},payload:bytes({name:'ok'})})).statusCode,200);
  assert.equal(called,1);
});
test('worker router bounds body, rejects invalid JSON/media type, and keeps error response headers',async()=>{
  const app=setup();app.post('/save',()=>({ok:true}));
  for(const [headers,payload,status] of [[{'content-type':'application/json'},new Uint8Array(101),413],[{},bytes({}),415],[{'content-type':'application/json'},new TextEncoder().encode('{'),400]] as const){
    const response=await app.inject({method:'POST',url:'/save',headers,payload});assert.equal(response.statusCode,status);assert.equal(response.headers['cache-control'],'no-store');
  }
});
test('worker router rejects unsupported schema/hook features rather than silently bypassing validation',()=>{
  const app=setup();
  assert.throws(()=>app.post('/bad',{schema:{body:{type:'object',oneOf:[]}}},()=>{}),/Unsupported/);
  assert.throws(()=>app.post('/number',{schema:{body:{type:'number'}}},()=>{}),/Unsupported/);
  assert.throws(()=>app.addHook('onReady',()=>{}),/Unsupported/);
});

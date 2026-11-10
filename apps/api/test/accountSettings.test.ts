import test from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../src/app.js';

test('payment destinations are own-user only, tenant scoped, masked and honestly unverified', async()=>{
 const app=await buildApp({dbPath:':memory:'});
 try {
  const a=app.store.register({name:'A',email:'a@example.test',password:'Correct-Horse-123'});
  const b=app.store.register({name:'B',email:'b@example.test',password:'Correct-Horse-123'});
  const w=app.store.createWorkspace(a.user.id,'Studio');
  const path=`/api/workspaces/${w.id}/payment-accounts`;
  const headers={authorization:`Bearer ${a.token}`};
  assert.equal((await app.inject({url:path})).statusCode,401);
  assert.equal((await app.inject({url:path,headers:{authorization:`Bearer ${b.token}`}})).statusCode,404);
  assert.equal((await app.inject({method:'PUT',url:`${path}/mine`,headers,payload:{paypalId:'invalid'}})).statusCode,400);
  const saved=await app.inject({method:'PUT',url:`${path}/mine`,headers,payload:{paypalId:'ABCDEFGHIJKLM',userId:b.user.id}});
  assert.equal(saved.statusCode,200,saved.body);
  assert.equal(saved.json().status,'SAVED_UNVERIFIED');
  const result=(await app.inject({url:path,headers})).json();
  assert.equal(result.ownPaypalId,'ABCDEFGHIJKLM');assert.equal(result.providerConfigured,false);
  assert.equal(result.members[0].accountHint,'•••• JKLM');
  assert.equal(app.store.db.prepare('SELECT 1 FROM fairshare_recipients WHERE user_id=?').get(b.user.id),undefined);
  assert.equal((await app.inject({method:'DELETE',url:`${path}/mine`,headers})).statusCode,200);
  assert.equal((await app.inject({url:path,headers})).json().ownPaypalId,null);
 }finally{await app.close();}
});

test('activity filters, pagination and authorization keep account events private',async()=>{
 const app=await buildApp({dbPath:':memory:'});
 try{
  const a=app.store.register({name:'A',email:'a@example.test',password:'Correct-Horse-123'});
  const b=app.store.register({name:'B',email:'b@example.test',password:'Correct-Horse-123'});
  const w=app.store.createWorkspace(a.user.id,'Studio');
  const headers={authorization:`Bearer ${a.token}`};
  for(let i=0;i<55;i++)app.store.audit(a.user.id,w.id,'TEST_EVENT');
  app.store.audit(b.user.id,null,'PRIVATE_EVENT');
  const path=`/api/settings/activity?workspaceId=${w.id}&action=TEST_EVENT`;
  const first=(await app.inject({url:path,headers})).json();
  assert.equal(first.events.length,50);assert.equal(first.total,55);assert.equal(first.nextOffset,50);
  assert.equal((await app.inject({url:`${path}&offset=50`,headers})).json().events.length,5);
  assert(!(await app.inject({url:'/api/settings/activity',headers})).body.includes('PRIVATE_EVENT'));
  assert.equal((await app.inject({url:path,headers:{authorization:`Bearer ${b.token}`}})).statusCode,404);
  assert.equal((await app.inject({url:'/api/settings/activity?days=-1',headers})).statusCode,400);
  assert.equal((await app.inject({url:'/api/settings/activity?offset=1.2',headers})).statusCode,400);
  assert.equal((await app.inject({url:path})).statusCode,401);
 }finally{await app.close();}
});

test('activity includes accessible contract events but hides unrelated contracts; viewers cannot change recipients',async()=>{
 const app=await buildApp({dbPath:':memory:'});
 try{
  const a=app.store.register({name:'A',email:'a@example.test',password:'Correct-Horse-123'});
  const b=app.store.register({name:'B',email:'b@example.test',password:'Correct-Horse-123'});
  const w=app.store.createWorkspace(a.user.id,'Studio');
  app.store.db.prepare('INSERT INTO memberships VALUES(?,?,?)').run(w.id,b.user.id,'VIEWER');
  const headers={authorization:`Bearer ${a.token}`},viewer={authorization:`Bearer ${b.token}`};
  const made=await app.inject({method:'POST',url:`/api/workspaces/${w.id}/collaborations`,headers,payload:{name:'Private agreement'}});
  assert.equal(made.statusCode,201,made.body);
  const path=`/api/settings/activity?workspaceId=${w.id}&agreementId=${made.json().id}`;
  assert.equal((await app.inject({url:path,headers})).json().events[0].action,'CREATED');
  assert.equal((await app.inject({url:path,headers:viewer})).json().events.length,0);
  assert.equal((await app.inject({url:`/api/workspaces/${w.id}/payment-accounts/mine`,method:'PUT',headers:viewer,payload:{paypalId:'ABCDEFGHIJKLM'}})).statusCode,403);
  assert.equal((await app.inject({url:`/api/workspaces/${w.id}/payment-accounts/mine`,method:'DELETE',headers:viewer})).statusCode,403);
 }finally{await app.close();}
});

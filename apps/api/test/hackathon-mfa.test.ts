import test from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../src/app.js';
const password='Synthetic-Test-123';
test('opt-in sandbox simulation accepts arbitrary nonempty values but retains passwords and sessions', async()=>{
 const app=await buildApp({dbPath:':memory:',hackathonMfaSimulation:true});
 try {
  const u=app.store.register({email:'simulation@example.test',name:'Test',password});
  assert.equal(app.store.mfa.status(u.user.id).simulated,true);
  assert.throws(()=>app.store.mfa.start(u.user.id,'wrong'));
  app.store.mfa.start(u.user.id,password);
  assert.throws(()=>app.store.mfa.activate(u.user.id,'   '));
  const result=app.store.mfa.activate(u.user.id,'anything!');
  assert.equal(result.simulated,true);
  assert.deepEqual(result.recoveryCodes,[]);
  assert.throws(()=>app.store.userForToken(u.token));
  assert.throws(()=>app.store.login(u.user.email,password));
  assert.throws(()=>app.store.login(u.user.email,'wrong','anything'));
  assert(app.store.login(u.user.email,password,'other text').token);
  app.store.mfa.disable(u.user.id,password,'yes');
  assert.equal(app.store.mfa.status(u.user.id).enabled,false);
 } finally { await app.close(); }
});
test('simulation refuses DEMO, production and live configuration',async()=>{
 await assert.rejects(buildApp({dbPath:':memory:',demo:true,hackathonMfaSimulation:true}));
 for (const [key,value] of [['NODE_ENV','production'],['PAYPAL_ENV','live']]) {
  const previous=process.env[key!];process.env[key!]=value;
  try {await assert.rejects(buildApp({dbPath:':memory:',hackathonMfaSimulation:true}));}
  finally {if(previous===undefined)delete process.env[key!];else process.env[key!]=previous;}
 }
});
test('normal sandbox remains fail-closed and existing real MFA is never bypassed',async()=>{
 const app=await buildApp({dbPath:':memory:',mfaEncryptionKey:Buffer.alloc(32,42).toString('base64'),hackathonMfaSimulation:true});
 try {
  const u=app.store.register({email:'real@example.test',name:'Real',password});
  // Existing encrypted authenticator record must use the real verification path.
  app.store.db.prepare("INSERT INTO mfa(user_id,secret,enabled,expires_at) VALUES(?,?,1,0)").run(u.user.id,'invalid-encrypted-secret');
  assert.notEqual(app.store.mfa.status(u.user.id).simulated,true);
  assert.throws(()=>app.store.login(u.user.email,password,'anything'));
 } finally {await app.close();}
 const normal=await buildApp({dbPath:':memory:'});
 try {const u=normal.store.register({email:'normal@example.test',name:'Normal',password});assert.equal(normal.store.mfa.status(u.user.id).available,false);assert.throws(()=>normal.store.mfa.start(u.user.id,password));}
 finally {await normal.close();}
});
test('turning simulation off fails closed for enrolled simulation accounts',async()=>{
 const app=await buildApp({dbPath:':memory:',hackathonMfaSimulation:true});
 try {
  const u=app.store.register({email:'off@example.test',name:'Test',password});
  app.store.mfa.start(u.user.id,password);app.store.mfa.activate(u.user.id,'x');
  // Runtime guard is checked again, not just at startup.
  const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';
  try {assert.throws(()=>app.store.login(u.user.email,password,'x'));}
  finally {if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
 }finally {await app.close();}
});

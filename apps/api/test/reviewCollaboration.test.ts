import test from 'node:test';
import assert from 'node:assert/strict';
import {buildApp,type AppOptions} from '../src/app.js';
import {AggregateStore} from '../src/fairshare.js';
import {createCollaboration,proposeVersion,sendForReview,MemberRole,FeePolicy,RuleOrigin} from '@fairshare/domain';
import {MailKind} from '../src/mail.js';
async function fixture(options:AppOptions={}){
 const app=await buildApp({dbPath:':memory:',...options});
 const user=(email:string)=>app.store.register({email,name:email,password:'correct-long-password'});
 const a=user('a@example.test'),b=user('b@example.test'),outside=user('outside@example.test');
 for(const x of [a,b]){const proof=app.store.createEmailVerification(x.user.id);app.store.confirmEmail(x.user.id,proof.token);}
 const w=app.store.createWorkspace(a.user.id,'test');
 app.store.db.prepare('INSERT INTO memberships VALUES(?,?,?)').run(w.id,b.user.id,'MEMBER');
 const store=new AggregateStore(app.store.db,fn=>app.store.tx(fn));
 let c=createCollaboration({id:'agreement',name:'Private contract',members:[{userId:a.user.id,displayName:'A',role:MemberRole.ORGANIZER},{userId:b.user.id,displayName:'B',role:MemberRole.COLLABORATOR}]},a.user.id,new Date().toISOString());
 c=proposeVersion(c,{currency:'USD',shares:[{userId:a.user.id,basisPoints:5000},{userId:b.user.id,basisPoints:5000}],feePolicy:FeePolicy.BEFORE_SPLIT,source:{origin:RuleOrigin.HUMAN_PROPOSAL,documentId:'doc',clause:'1',excerpt:'private terms'},unresolvedQuestions:[]},a.user.id,new Date().toISOString());
 c=sendForReview(c,1,a.user.id,new Date().toISOString());store.insert(w.id,c);
 const base=`/api/workspaces/${w.id}/collaborations/agreement/versions/1`;
 const call=(suffix:string,payload?:unknown,token=a.token)=>app.inject({method:payload===undefined?'GET':'POST',url:base+suffix,headers:{authorization:`Bearer ${token}`},...(payload===undefined?{}:{payload:payload as any})});
 return {app,a,b,outside,w,call,store};
}
test('thread comments scoped to participant/version/rule; no domain mutation; replies validated',async()=>{
 const f=await fixture();try{
  const first=await f.call('/comments',{body:'<script>plain text</script>',ruleKey:'SPLIT'});assert.equal(first.statusCode,201,first.body);const id=first.json().comment.id;
  const reply=await f.call('/comments',{body:'Reply',ruleKey:'SPLIT',parentId:id},f.b.token);assert.equal(reply.statusCode,201);
  assert.equal((await f.call('/comments',{body:'Wrong rule',ruleKey:'FEES',parentId:id})).statusCode,400);
  assert.equal((await f.call('/comments',{body:'Deep reply',ruleKey:'SPLIT',parentId:reply.json().comment.id})).statusCode,400);
  assert.equal((await f.call('/comments',undefined,f.outside.token)).statusCode,404);
  assert.equal((await f.call('/comments',{body:' ',ruleKey:'SPLIT'})).statusCode,400);
  assert.equal((await f.call('/comments',{body:'x',ruleKey:'SPLIT',authorId:f.b.user.id})).statusCode,400);
  assert.equal((await f.call('/comments')).json().comments.length,2);
  assert.equal(f.store.read(f.w.id,'agreement').revision,1);
  f.app.store.db.prepare('UPDATE memberships SET role=? WHERE user_id=?').run('VIEWER',f.b.user.id);
  assert.equal((await f.call('/comments',{body:'No write',ruleKey:'SPLIT'},f.b.token)).statusCode,403);
 }finally{await f.app.close();}
});
test('real transport receives verified recipient only, generic reminder, duplicate suppression',async()=>{
 const messages:any[]=[];const f=await fixture({publicAppOrigin:'https://fairshare.example',mailTransport:{async send(m){messages.push(m);return {providerId:'receipt'};}}});try{
  assert.equal((await f.call('/reminders',{recipientId:f.a.user.id},f.b.token)).statusCode,403);
  assert.equal((await f.call('/reminders',{recipientId:f.outside.user.id})).statusCode,400);
  const r=await f.call('/reminders',{recipientId:f.b.user.id});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().status,'PROVIDER_ACCEPTED');
  assert.equal(messages.length,1);assert.equal(messages[0].kind,MailKind.AGREEMENT_REVIEW);assert.equal(messages[0].to,f.b.user.email);assert.equal(messages[0].link,'https://fairshare.example/');
  const again=await f.call('/reminders',{recipientId:f.b.user.id});assert.equal(again.json().repeated,true);assert.equal(messages.length,1);
 }finally{await f.app.close();}
});
test('unconfigured/demo sends nothing and uncertain provider failure cannot be retried',async()=>{
 const f=await fixture();try{assert.equal((await f.call('/reminders',{recipientId:f.b.user.id})).json().error.code,'EMAIL_UNAVAILABLE');}finally{await f.app.close();}
 let sends=0;const bad=await fixture({publicAppOrigin:'https://fairshare.example',mailTransport:{async send(){sends++;throw new Error('secret');}}});try{
  const r=await bad.call('/reminders',{recipientId:bad.b.user.id});assert.equal(r.statusCode,503);assert(!r.body.includes('secret'));
  const again=await bad.call('/reminders',{recipientId:bad.b.user.id});assert.equal(again.json().status,'UNCONFIRMED');assert.equal(sends,1);
 }finally{await bad.app.close();}
});
test('same-workspace nonparticipants cannot read; comments bounded and rate limited',async()=>{
 const f=await fixture();try{
  f.app.store.db.prepare('INSERT INTO memberships VALUES(?,?,?)').run(f.w.id,f.outside.user.id,'MEMBER');
  assert.equal((await f.call('/comments',undefined,f.outside.token)).statusCode,403);
  assert.equal((await f.call('/comments',{body:'x'.repeat(2001),ruleKey:'SOURCE'})).statusCode,400);
  for(let i=0;i<30;i++)assert.equal((await f.call('/comments',{body:'comment '+i,ruleKey:'SOURCE'})).statusCode,201);
  assert.equal((await f.call('/comments',{body:'Too many',ruleKey:'SOURCE'})).statusCode,429);
  assert.equal((await f.call('/comments?after=bad')).statusCode,400);
 }finally{await f.app.close();}
});
test('concurrent reminder requests reserve exactly one send; demo cannot deliver',async()=>{
 let sends=0;let release:()=>void=()=>{};const gate=new Promise<void>(r=>release=r);
 const f=await fixture({publicAppOrigin:'https://fairshare.example',mailTransport:{async send(){sends++;await gate;return {providerId:'one'};}}});try{
  const one=f.call('/reminders',{recipientId:f.b.user.id});
  await new Promise(r=>setTimeout(r,20));
  const two=await f.call('/reminders',{recipientId:f.b.user.id});assert.equal(two.json().status,'SENDING');assert.equal(sends,1);release();assert.equal((await one).json().status,'PROVIDER_ACCEPTED');
 }finally{release();await f.app.close();}
 const demo=await fixture({demo:true,publicAppOrigin:'https://fairshare.example',mailTransport:{async send(){throw new Error('Must not send');}}});try{assert.equal((await demo.call('/reminders',{recipientId:demo.b.user.id})).json().error.code,'EMAIL_UNAVAILABLE');}finally{await demo.app.close();}
});

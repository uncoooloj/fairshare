import {randomUUID} from 'node:crypto';
import type {FastifyRequest} from 'fastify';
import type {FairshareApp} from './app.js';
import type {AggregateStore} from './fairshare.js';
import {ApiError,DataMode,Role} from './identity.js';
import {MemberRole} from '@fairshare/domain';
import {MailKind,publicAppOrigin} from './mail.js';
import type {EmailOptions} from './emailRoutes.js';
export function registerReviewCollaboration(app:FairshareApp,store:AggregateStore,options:EmailOptions){
 const db=app.store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS agreement_comments(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,agreement_id TEXT NOT NULL,version_id INTEGER NOT NULL,rule_key TEXT NOT NULL,parent_id TEXT,author_id TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS agreement_comments_scope ON agreement_comments(workspace_id,agreement_id,version_id);
 CREATE TABLE IF NOT EXISTS agreement_reminders(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,agreement_id TEXT NOT NULL,version_id INTEGER NOT NULL,recipient_id TEXT NOT NULL,actor_id TEXT NOT NULL,status TEXT NOT NULL,provider_id TEXT,created_at INTEGER NOT NULL);`);
 const base='/api/workspaces/:workspaceId/collaborations/:collaborationId/versions/:versionId';
 function access(req:FastifyRequest,write=false){
  const p=req.params as {workspaceId:string;collaborationId:string;versionId:string};
  const {user}=app.requireWorkspace(req,p.workspaceId,write?[Role.OWNER,Role.MEMBER]:undefined);
  const row=store.read(p.workspaceId,p.collaborationId);
  const member=row.value.members.find(m=>m.userId===user.id);
  if(!member)throw new ApiError(403,'FORBIDDEN','Agreement participants only.');
  if(!/^[1-9]\d{0,8}$/.test(p.versionId))throw new ApiError(400,'INVALID_VERSION','Invalid version.');
  const version=row.value.versions.find(v=>v.id===Number(p.versionId));
  if(!version)throw new ApiError(404,'NOT_FOUND','Version not found.');
  return {p,user,row,member,version};
 }
 const rules=['AGREEMENT','SPLIT','FEES','ADVANCE','SOURCE'];
 app.get(`${base}/comments`,async req=>{
  const {p}=access(req);const query=req.query as {after?:string};
  if(query.after!==undefined&&!/^\d{1,15}$/.test(query.after))throw new ApiError(400,'INVALID_CURSOR','Invalid comment cursor.');
  const rows=db.prepare(`SELECT rowid AS sequence,id,version_id AS versionId,rule_key AS ruleKey,parent_id AS parentId,author_id AS authorId,body,created_at AS createdAt FROM agreement_comments WHERE workspace_id=? AND agreement_id=? AND version_id=? AND rowid>? ORDER BY rowid LIMIT 101`).all(p.workspaceId,p.collaborationId,Number(p.versionId),Number(query.after??0)) as any[];
  const page=rows.slice(0,100);return {comments:page,nextCursor:rows.length>100?String(page.at(-1).sequence):null};
 });
 app.post(`${base}/comments`,{schema:{body:{type:'object',additionalProperties:false,required:['body','ruleKey'],properties:{body:{type:'string',minLength:1,maxLength:2000},ruleKey:{type:'string',enum:rules},parentId:{type:'string',maxLength:100}}}}},async(req,reply)=>{
  const {p,user,version}=access(req,true);const input=req.body as {body:string;ruleKey:string;parentId?:string};
  if(!input.body.trim())throw new ApiError(400,'INVALID_COMMENT','Write a comment first.');
  if(version.status==='SUPERSEDED')throw new ApiError(409,'HISTORICAL_VERSION','Comment on the current version instead.');
  app.store.limit(`comments:${user.id}`,30);app.store.limit(`comments:agreement:${p.collaborationId}`,200);
  if(input.parentId){const parent=db.prepare('SELECT parent_id,rule_key FROM agreement_comments WHERE id=? AND workspace_id=? AND agreement_id=? AND version_id=?').get(input.parentId,p.workspaceId,p.collaborationId,version.id) as any;if(!parent||parent.parent_id||parent.rule_key!==input.ruleKey)throw new ApiError(400,'INVALID_PARENT','Reply to a root comment on the same version and rule.');}
  const comment={id:randomUUID(),versionId:version.id,ruleKey:input.ruleKey,parentId:input.parentId??null,authorId:user.id,body:input.body.trim(),createdAt:app.store.now()};
  app.store.tx(()=>{db.prepare('INSERT INTO agreement_comments VALUES(?,?,?,?,?,?,?,?,?)').run(comment.id,p.workspaceId,p.collaborationId,version.id,comment.ruleKey,comment.parentId,user.id,comment.body,comment.createdAt);app.store.audit(user.id,p.workspaceId,'AGREEMENT_COMMENT_ADDED',{agreementId:p.collaborationId,versionId:version.id,commentId:comment.id});});
  return reply.code(201).send({comment,notice:'Discussion only. Comments do not change rules or approvals.'});
 });
 app.post(`${base}/reminders`,{schema:{body:{type:'object',additionalProperties:false,required:['recipientId'],properties:{recipientId:{type:'string',minLength:1,maxLength:100}}}}},async req=>{
  const {p,user,row,member,version}=access(req,true);const {recipientId}=req.body as {recipientId:string};
  if(member.role!==MemberRole.ORGANIZER)throw new ApiError(403,'FORBIDDEN','Only the agreement organizer can send review reminders.');
  if(version.status!=='AWAITING_APPROVAL'||row.value.versions.at(-1)?.id!==version.id)throw new ApiError(409,'NOT_IN_REVIEW','Only the latest version awaiting approval can be reminded.');
  if(recipientId===user.id||!row.value.members.some(m=>m.userId===recipientId)||Object.hasOwn(version.approvals,recipientId))throw new ApiError(400,'INVALID_RECIPIENT','Choose a participant who has not approved this version.');
  if(app.store.mode===DataMode.DEMO||!options.mailTransport||!options.publicAppOrigin)throw new ApiError(503,'EMAIL_UNAVAILABLE','Review reminder email is not configured for this environment. No email was sent.');
  app.store.requireVerifiedEmail(user.id);
  const recipient=db.prepare('SELECT u.email,u.email_verified_at FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=? AND m.workspace_id=? AND m.role IN (?,?)').get(recipientId,p.workspaceId,Role.OWNER,Role.MEMBER) as any;
  if(!recipient||typeof recipient.email_verified_at!=='number')throw new ApiError(409,'RECIPIENT_UNVERIFIED','The participant must verify their email first.');
  const link=publicAppOrigin(options.publicAppOrigin)+'/';
  const id=randomUUID(),createdAt=app.store.now();
  app.store.limit(`reminders:${user.id}`,10,3600000);
  const previous=app.store.tx(()=>{
   const existing=db.prepare('SELECT status,created_at AS createdAt FROM agreement_reminders WHERE workspace_id=? AND agreement_id=? AND version_id=? AND recipient_id=? AND created_at>? ORDER BY created_at DESC LIMIT 1').get(p.workspaceId,p.collaborationId,version.id,recipientId,createdAt-86400000) as any;
   if(existing)return existing;
   db.prepare('INSERT INTO agreement_reminders VALUES(?,?,?,?,?,?,?,NULL,?)').run(id,p.workspaceId,p.collaborationId,version.id,recipientId,user.id,'SENDING',createdAt);
   return null;
  });
  if(previous)return {...previous,repeated:true,notice:'A reminder was already attempted for this person and version in the last 24 hours. No additional email was sent.'};
  try{
   const receipt=await options.mailTransport.send({kind:MailKind.AGREEMENT_REVIEW,to:recipient.email,link,expiresAt:createdAt+86400000,operationId:id});
   if(!receipt.providerId)throw new Error('Missing provider receipt');
   db.prepare('UPDATE agreement_reminders SET status=?,provider_id=? WHERE id=?').run('PROVIDER_ACCEPTED',receipt.providerId,id);
   app.store.audit(user.id,p.workspaceId,'AGREEMENT_REMINDER_REQUESTED',{agreementId:p.collaborationId,versionId:version.id,recipientId,reminderId:id});
   return {id,status:'PROVIDER_ACCEPTED',createdAt,notice:'The email provider accepted the reminder. Inbox delivery is not confirmed.'};
  }catch{
   db.prepare('UPDATE agreement_reminders SET status=? WHERE id=?').run('UNCONFIRMED',id);
   throw new ApiError(503,'EMAIL_DELIVERY_UNCONFIRMED','Reminder delivery is unconfirmed. Do not resend; another attempt is blocked for 24 hours to avoid duplicates.');
  }
 });
}

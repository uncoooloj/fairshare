import {randomBytes, randomUUID} from 'node:crypto';
import type {FairshareApp} from './app.js';
import type {EmailOptions} from './emailRoutes.js';
import {ApiError, digest, DataMode} from './identity.js';
import {MailKind, publicAppOrigin} from './mail.js';

/** Account profile changes never rewrite agreement parties or payout recipients. */
export function registerProfileRoutes(app:FairshareApp, options:EmailOptions) {
 const {store}=app, db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS profile_photos(user_id TEXT PRIMARY KEY REFERENCES users(id),data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS email_changes(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),old_email TEXT NOT NULL,new_email TEXT NOT NULL,password_fingerprint TEXT NOT NULL,expires_at INTEGER NOT NULL);`);
 app.get('/api/auth/profile/photo',async req=>{
  const user=app.requireSession(req);
  return {photo:(db.prepare('SELECT data FROM profile_photos WHERE user_id=?').get(user.id) as any)?.data??null};
 });
 app.put('/api/auth/profile/photo',{bodyLimit:360000,schema:{body:{type:'object',additionalProperties:false,required:['photo'],properties:{photo:{anyOf:[{type:'null'},{type:'string',maxLength:350000}]}}}}},async req=>{
  const user=app.requireSession(req), {photo}=req.body as {photo:string|null};
  store.limit(`photo:${user.id}`,20);
  if(photo!==null){
   const match=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo);
   if(!match)throw new ApiError(400,'INVALID_PHOTO','Choose a PNG or JPEG image.');
   const bytes=Buffer.from(match[2]!,'base64');
   const valid=match[1]==='png'?bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
   if(!valid||bytes.length>256000||bytes.toString('base64')!==match[2])throw new ApiError(400,'INVALID_PHOTO','Choose a PNG or JPEG smaller than 250 KB.');
  }
  store.tx(()=>{if(photo===null)db.prepare('DELETE FROM profile_photos WHERE user_id=?').run(user.id);else db.prepare('INSERT INTO profile_photos VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data').run(user.id,photo);store.audit(user.id,null,'PROFILE_PHOTO_UPDATED');});
  return {photo};
 });
 app.post('/api/auth/email-change/request',{schema:{body:{type:'object',additionalProperties:false,required:['email','password'],properties:{email:{type:'string',maxLength:254,pattern:'^\\S+@\\S+\\.\\S+$'},password:{type:'string',maxLength:256},mfaCode:{type:'string',maxLength:80}}}}},async req=>{
  const user=app.requireSession(req), body=req.body as {email:string;password:string;mfaCode?:string};
  store.limit(`email-change:${user.id}`,3,30*60000);
  store.verifyPassword(user.id,body.password);
  store.tx(()=>store.mfa.verify(user.id,body.mfaCode));
  if(store.mode===DataMode.DEMO||!options.mailTransport)throw new ApiError(503,'EMAIL_UNAVAILABLE','Email changes require configured verification email delivery. Your email has not changed.');
  const email=body.email.trim().toLowerCase();
  if(email===user.email)throw new ApiError(400,'UNCHANGED_EMAIL','Enter a different email address.');
  // Do not reveal whether the destination already has an account.
  const notice='If this email is available, a verification link has been requested. Your current email stays active until you confirm it.';
  const token=randomBytes(32).toString('base64url'),expiresAt=store.now()+30*60000;
  const row=db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id) as any;
  store.tx(()=>{db.prepare('DELETE FROM email_changes WHERE user_id=? OR expires_at<=?').run(user.id,store.now());db.prepare('INSERT INTO email_changes VALUES(?,?,?,?,?,?)').run(digest(token),user.id,user.email,email,digest(row.password_hash),expiresAt);});
  try{await options.mailTransport.send({kind:MailKind.CHANGE_EMAIL,to:email,link:`${publicAppOrigin(options.publicAppOrigin??'http://localhost:3000')}/change-email#token=${token}`,expiresAt,operationId:randomUUID()});}
  catch{db.prepare('DELETE FROM email_changes WHERE hash=?').run(digest(token));throw new ApiError(503,'EMAIL_DELIVERY_FAILED','Verification email could not be requested. Your email has not changed.');}
  store.audit(user.id,null,'EMAIL_CHANGE_REQUESTED');
  return {notice};
 });
 app.post('/api/auth/email-change/confirm',{schema:{body:{type:'object',additionalProperties:false,required:['token'],properties:{token:{type:'string',pattern:'^[A-Za-z0-9_-]{43}$'}}}}},async req=>{
  const user=app.requireSession(req);store.limit(`email-confirm:${user.id}`,20);
  const token=(req.body as {token:string}).token;
  store.tx(()=>{
   const change=db.prepare('SELECT * FROM email_changes WHERE hash=? AND user_id=? AND expires_at>?').get(digest(token),user.id,store.now()) as any;
   const account=db.prepare('SELECT * FROM users WHERE id=?').get(user.id) as any;
   if(!change||change.old_email!==account.email||change.password_fingerprint!==digest(account.password_hash))throw new ApiError(400,'INVALID_VERIFICATION','Email change link is invalid or expired.');
   if(db.prepare('SELECT id FROM users WHERE email=?').get(change.new_email))throw new ApiError(409,'EMAIL_UNAVAILABLE','This email cannot be used. Request a different address.');
   db.prepare('UPDATE users SET email=?,email_verified_at=? WHERE id=?').run(change.new_email,store.now(),user.id);
   for(const table of ['email_changes','email_verifications','password_resets','sessions'])db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(user.id);
   store.audit(user.id,null,'EMAIL_CHANGED');
  });
  return {ok:true,signInRequired:true};
 });
}

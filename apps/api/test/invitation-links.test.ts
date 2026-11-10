import test from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../src/app.js';

test('private links work without mail or verified email; scoped, authenticated, single-use and secret-safe', async () => {
  let now = Date.now();
  const app = await buildApp({dbPath: ':memory:', clock: () => now});
  const register = async (email: string) => (await app.inject({
    method: 'POST', url: '/api/auth/register',
    payload: {email, name: 'Test person', password: 'Correct-Horse-123'},
  })).json();
  const owner = await register('owner@example.test');
  const member = await register('member@example.test');
  const stranger = await register('stranger@example.test');
  const headers = (token: string) => ({authorization: `Bearer ${token}`});
  const workspace = app.store.createWorkspace(owner.user.id, 'Private team');
  const create = (token=owner.token, role='MEMBER') => app.inject({
    method:'POST', url:`/api/workspaces/${workspace.id}/invitation-links`,
    headers:headers(token), payload:{role},
  });
  const accept = (token:string, session=member.token) => app.inject({
    method:'POST', url:'/api/invitations/accept', headers:headers(session), payload:{token},
  });
  try {
    assert.equal((await create(stranger.token)).statusCode,404);
    assert.equal((await create(owner.token,'OWNER')).statusCode,400);
    const response=await create();
    assert.equal(response.statusCode,201,response.body);
    assert.equal(response.headers['cache-control'],'no-store');
    const invitation=response.json().invitation;
    assert.equal(invitation.expiresAt,now+48*3600000);
    const stored=app.store.db.prepare('SELECT * FROM invitations WHERE id=?').get(invitation.id);
    assert(!JSON.stringify(stored).includes(invitation.token));
    assert(!JSON.stringify(app.store.db.prepare('SELECT * FROM audit').all()).includes(invitation.token));
    assert.equal((await accept(invitation.token,'')).statusCode,401);
    assert.equal((await accept(invitation.token)).statusCode,200);
    assert.equal(app.store.membership(member.user.id,workspace.id).role,'MEMBER');
    assert.equal((await accept(invitation.token,stranger.token)).statusCode,400);
    assert.equal((await create(member.token)).statusCode,403);
    const revoked=(await create()).json().invitation;
    const other=app.store.createWorkspace(owner.user.id,'Other workspace');
    assert.throws(()=>app.store.revoke(owner.user.id,other.id,revoked.id));
    app.store.revoke(owner.user.id,workspace.id,revoked.id);
    assert.equal((await accept(revoked.token,stranger.token)).statusCode,400);
    const expired=(await create()).json().invitation;
    now+=48*3600000;
    assert.equal((await accept(expired.token,stranger.token)).statusCode,400);
  } finally {await app.close();}
});

test('DEMO viewer link preserves least privilege and never invokes configured mail', async () => {
  const app=await buildApp({dbPath:':memory:',demo:true,mailTransport:{async send(){throw new Error('mail must not run');}}});
  try {
    const owner=app.store.register({email:'owner@example.test',name:'Owner',password:'Correct-Horse-123'});
    const viewer=app.store.register({email:'viewer@example.test',name:'Viewer',password:'Correct-Horse-123'});
    const workspace=app.store.createWorkspace(owner.user.id,'Demo workspace');
    const response=await app.inject({method:'POST',url:`/api/workspaces/${workspace.id}/invitation-links`,headers:{authorization:`Bearer ${owner.token}`},payload:{role:'VIEWER'}});
    assert.equal(response.statusCode,201);
    const accepted=await app.inject({method:'POST',url:'/api/invitations/accept',headers:{authorization:`Bearer ${viewer.token}`},payload:{token:response.json().invitation.token}});
    assert.equal(accepted.statusCode,200);
    assert.equal(accepted.json().workspace.role,'VIEWER');
    assert.equal(app.store.userForToken(viewer.token).emailVerified,false);
  } finally {await app.close();}
});

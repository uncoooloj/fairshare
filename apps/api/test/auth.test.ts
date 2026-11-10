import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.js";
import { DataMode, IdentityStore, Role } from "../src/identity.js";
const password = "Correct-Horse-123";
async function reg(app: any, email = "owner@example.test") {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name: "Test User", password },
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json();
}
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
async function ws(app: any, token: string) {
  const r = await app.inject({
    method: "POST",
    url: "/api/workspaces",
    headers: auth(token),
    payload: { name: "Creative team" },
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json().workspace;
}
test("registration stores password/session hashes only, login/logout and expiry", async () => {
  let time = 10000;
  const app = await buildApp({ dbPath: ":memory:", clock: () => time });
  try {
    const a = await reg(app);
    assert(!JSON.stringify(a).includes("password_hash"));
    const row = app.store.db.prepare("SELECT * FROM users").get() as any;
    assert.notEqual(row.password_hash, password);
    const session = app.store.db.prepare("SELECT * FROM sessions").get() as any;
    assert.notEqual(session.hash, a.token);
    let r = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: auth(a.token),
    });
    assert.equal(r.statusCode, 200);
    r = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: " OWNER@EXAMPLE.TEST ", password },
    });
    assert.equal(r.statusCode, 200);
    const secondToken = r.json().token;
    r = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: auth(a.token),
    });
    assert.equal(r.statusCode, 200);
    assert.equal(
      (await app.inject({ url: "/api/auth/me", headers: auth(a.token) }))
        .statusCode,
      401,
    );
    time += 8 * 86400000;
    assert.throws(() => app.store.userForToken(secondToken));
  } finally {
    await app.close();
  }
});
test("tenant isolation and viewers cannot invite; owner role cannot be injected", async () => {
  const app = await buildApp({ dbPath: ":memory:" });
  try {
    const owner = await reg(app),
      other = await reg(app, "other@example.test"),
      workspace = await ws(app, owner.token);
    for (const suffix of ["", "/members", "/audit"])
      assert.equal(
        (
          await app.inject({
            url: `/api/workspaces/${workspace.id}${suffix}`,
            headers: auth(other.token),
          })
        ).statusCode,
        404,
      );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/register",
          payload: {
            email: "evil@example.test",
            name: "Evil",
            password,
            role: "OWNER",
          },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/workspaces/${workspace.id}/invitations`,
          headers: auth(owner.token),
          payload: { email: other.user.email, role: "OWNER" },
        })
      ).statusCode,
      400,
    );
    const invite = app.store.invite(
      owner.user,
      workspace.id,
      other.user.email,
      Role.VIEWER,
    );
    app.store.accept(other.user, invite.token);
    assert.equal(
      (
        await app.inject({
          url: `/api/workspaces/${workspace.id}`,
          headers: auth(other.token),
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/workspaces/${workspace.id}/invitations`,
          headers: auth(other.token),
          payload: { email: "third@example.test", role: "MEMBER" },
        })
      ).statusCode,
      403,
    );
    assert.throws(() =>
      app.store.membership(other.user.id, workspace.id, [
        Role.OWNER,
        Role.MEMBER,
      ]),
    );
  } finally {
    await app.close();
  }
});
test("invites are email-bound single-use, expiring, revocable and replaced", async () => {
  let now = 10000;
  const app = await buildApp({ dbPath: ":memory:", clock: () => now });
  try {
    const a = await reg(app),
      b = await reg(app, "b@example.test"),
      c = await reg(app, "c@example.test"),
      w = await ws(app, a.token);
    const i = app.store.invite(a.user, w.id, b.user.email, Role.MEMBER);
    assert.throws(() => app.store.accept(c.user, i.token));
    assert.equal(app.store.accept(b.user, i.token).role, Role.MEMBER);
    assert.throws(() => app.store.accept(b.user, i.token));
    const old = app.store.invite(a.user, w.id, c.user.email, Role.VIEWER),
      fresh = app.store.invite(a.user, w.id, c.user.email, Role.MEMBER);
    assert.throws(() => app.store.accept(c.user, old.token));
    app.store.revoke(a.user.id, w.id, fresh.id);
    assert.throws(() => app.store.accept(c.user, fresh.token));
    const expire = app.store.invite(a.user, w.id, c.user.email, Role.MEMBER);
    now += 49 * 3600000;
    assert.throws(() => app.store.accept(c.user, expire.token));
    assert.equal(
      (
        app.store.db
          .prepare("SELECT COUNT(*) AS n FROM memberships")
          .get() as any
      ).n,
      2,
    );
  } finally {
    await app.close();
  }
});
test("password change requires old password and revokes every session", async () => {
  const app = await buildApp({ dbPath: ":memory:" });
  try {
    const a = await reg(app),
      second = app.store.login(a.user.email, password);
    assert.throws(() =>
      app.store.changePassword(a.user.id, "wrong", password + "!"),
    );
    app.store.changePassword(a.user.id, password, password + "!");
    assert.throws(() => app.store.userForToken(a.token));
    assert.throws(() => app.store.userForToken(second.token));
    assert.throws(() => app.store.login(a.user.email, password));
    assert(app.store.login(a.user.email, password + "!").token);
  } finally {
    await app.close();
  }
});
test("durable store reopens, rejects mode switching and enforces optimistic versions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fairshare-auth-"));
  const path = join(dir, "db.sqlite");
  try {
    let s = new IdentityStore(path, DataMode.SANDBOX);
    const a = s.register({
        email: "owner@example.test",
        name: "Owner",
        password,
      }),
      w = s.createWorkspace(a.user.id, "Team");
    assert.equal(s.putRecord(w.id, "agreement", { cents: 99 }, 0), 1);
    assert.throws(() => s.putRecord(w.id, "agreement", { cents: 100 }, 0));
    s.close();
    s = new IdentityStore(path, DataMode.SANDBOX);
    assert.equal(s.userForToken(a.token).id, a.user.id);
    assert.deepEqual(s.getRecord(w.id, "agreement"), {
      value: { cents: 99 },
      version: 1,
    });
    assert.equal(s.getRecord("unrelated", "agreement"), null);
    s.close();
    assert.throws(
      () => new IdentityStore(path, DataMode.DEMO),
      /mode mismatch/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("rate limits cap repeated failed auth, malformed bearer rejected, health no real money", async () => {
  const app = await buildApp({ dbPath: ":memory:" });
  try {
    for (let i = 0; i < 10; i++)
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { email: "none@example.test", password },
          })
        ).statusCode,
        401,
      );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { email: "none@example.test", password },
        })
      ).statusCode,
      429,
    );
    for (const value of ["Bearer x", "Basic a", "Bearer " + "' OR 1=1--"]) {
      assert.equal(
        (
          await app.inject({
            url: "/api/auth/me",
            headers: { authorization: value },
          })
        ).statusCode,
        401,
      );
    }
    const h = (await app.inject({ url: "/health" })).json();
    assert.equal(h.realMoneyEnabled, false);
    assert.equal(h.mode, "SANDBOX");
  } finally {
    await app.close();
  }
});

test("role changes and removal take effect on existing session without deleting audit", async () => {
  const app = await buildApp({ dbPath: ":memory:" });
  try {
    const a = await reg(app),
      b = await reg(app, "b@example.test"),
      w = await ws(app, a.token);
    const invite = app.store.invite(a.user, w.id, b.user.email, Role.MEMBER);
    app.store.accept(b.user, invite.token);
    assert.throws(() =>
      app.store.changeMemberRole(b.user.id, w.id, a.user.id, Role.VIEWER),
    );
    assert.throws(() => app.store.removeMember(a.user.id, w.id, a.user.id));
    app.store.changeMemberRole(a.user.id, w.id, b.user.id, Role.VIEWER);
    assert.throws(() => app.store.membership(b.user.id, w.id, [Role.MEMBER]));
    app.store.removeMember(a.user.id, w.id, b.user.id);
    assert.equal(
      (
        await app.inject({
          url: `/api/workspaces/${w.id}`,
          headers: auth(b.token),
        })
      ).statusCode,
      404,
    );
    assert(app.store.userForToken(b.token));
    const events = (
      await app.inject({
        url: `/api/workspaces/${w.id}/audit`,
        headers: auth(a.token),
      })
    ).json().events;
    assert(events.some((x: any) => x.action === "MEMBER_REMOVED"));
  } finally {
    await app.close();
  }
});

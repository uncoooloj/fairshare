import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PayPalError,
  PayPalIdentitySandbox,
  mapPayPalUserInfo,
  type PayPalIdentityProfile,
} from "@fairshare/payments";
import { buildApp } from "../src/app.js";
import {
  safeReturnPath,
  signState,
  verifyState,
} from "../src/paypalConnect.js";

const SECRET = "test-state-secret";
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** Mocked identity provider: no network, records the codes it was given. */
function fakeProvider(
  profile: PayPalIdentityProfile | (() => never) = {
    email: "Maya.Pay@Example.TEST",
    emailVerified: true,
    payerId: "PAYERID12345",
  },
) {
  const codes: string[] = [];
  return {
    codes,
    authorizeUrl: (state: string) =>
      `https://www.sandbox.paypal.com/connect?state=${encodeURIComponent(state)}`,
    exchange: async (code: string) => {
      codes.push(code);
      if (typeof profile === "function") profile();
      return {
        ...(profile as PayPalIdentityProfile),
        email: (profile as PayPalIdentityProfile).email?.toLowerCase() ?? null,
      };
    },
  };
}

function deferredProvider() {
  let release: ((profile: PayPalIdentityProfile) => void) | undefined;
  let started: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const provider: ReturnType<typeof fakeProvider> = {
    codes: [],
    authorizeUrl: (state) =>
      `https://www.sandbox.paypal.com/connect?state=${encodeURIComponent(state)}`,
    exchange: async (code) => {
      provider.codes.push(code);
      started();
      return new Promise<PayPalIdentityProfile>((resolve) => {
        release = resolve;
      });
    },
  };
  return {
    provider,
    waitForExchange: () => startedPromise,
    release: () =>
      release?.({
        email: "paypal@example.test",
        emailVerified: true,
        payerId: "PAYERID12345",
      }),
  };
}

async function setup(provider?: ReturnType<typeof fakeProvider>) {
  const app = await buildApp({
    dbPath: ":memory:",
    paypalIdentity: provider ? { provider, stateSecret: SECRET } : undefined,
  });
  const maya = app.store.register({
    name: "Maya",
    email: "maya@example.test",
    password: "Correct-Horse-123",
  });
  const org = app.store.register({
    name: "Org",
    email: "org@example.test",
    password: "Correct-Horse-123",
  });
  const w = app.store.createWorkspace(org.user.id, "Studio");
  app.store.db
    .prepare("INSERT INTO memberships VALUES(?,?,?)")
    .run(w.id, maya.user.id, "MEMBER");
  const start = async (token = maya.token, returnTo = "/app/settings") => {
    const r = await app.inject({
      url: `/api/auth/paypal/connect?returnTo=${encodeURIComponent(returnTo)}`,
      headers: auth(token),
    });
    assert.equal(r.statusCode, 200, r.body);
    return new URL(r.json().authorizeUrl).searchParams.get("state")!;
  };
  const callback = (state: string, token = maya.token, code = "AUTHCODE") =>
    app.inject({
      method: "POST",
      url: "/api/auth/paypal/callback",
      headers: auth(token),
      payload: { code, state },
    });
  return { app, maya, org, w, start, callback };
}

test("state is signed, short-lived and tamper-evident", () => {
  const state = signState(SECRET, "nonce", 2_000);
  assert.equal(verifyState(SECRET, state, 1_000), "nonce");
  assert.equal(verifyState(SECRET, state, 2_000), null, "expired");
  assert.equal(verifyState("other", state, 1_000), null, "wrong key");
  assert.equal(
    verifyState(SECRET, state.replace("nonce", "nonce2"), 1_000),
    null,
  );
  assert.equal(
    verifyState(SECRET, state.replace(".2000.", ".9999."), 1_000),
    null,
  );
  assert.equal(verifyState(SECRET, `${state}.x`, 1_000), null);
  assert.equal(verifyState(SECRET, undefined, 1_000), null);
  assert.equal(
    safeReturnPath("/app/settings?tab=payments"),
    "/app/settings?tab=payments",
  );
  for (const bad of ["https://evil.test", "//evil.test", "/\\evil", "app", 3])
    assert.equal(safeReturnPath(bad), "/app");
});

test("connect success: code exchanged server-side, verified email saved, audited, one-time state", async () => {
  const provider = fakeProvider();
  const s = await setup(provider);
  try {
    const state = await s.start();
    const r = await s.callback(state);
    assert.equal(r.statusCode, 200, r.body);
    const body = r.json();
    assert.equal(body.result, "connected");
    assert.equal(body.returnTo, "/app/settings");
    assert.equal(body.destination.type, "EMAIL");
    assert.equal(body.destination.value, "maya.pay@example.test");
    assert.equal(body.destination.verified, true);
    assert.equal(typeof body.destination.verifiedAt, "number");
    assert.doesNotMatch(r.body, /PAYERID|AUTHCODE|access_token/);
    assert.deepEqual(provider.codes, ["AUTHCODE"]);
    const row = s.app.store.db
      .prepare(
        "SELECT receiver, verified, payer_id AS payerId FROM fairshare_payout_accounts WHERE user_id=?",
      )
      .get(s.maya.user.id) as any;
    assert.deepEqual(
      { ...row },
      {
        receiver: "maya.pay@example.test",
        verified: 1,
        payerId: "PAYERID12345",
      },
    );
    assert.ok(
      s.app.store.db
        .prepare(
          "SELECT 1 FROM audit WHERE actor_id=? AND action='PAYPAL_CONNECTED'",
        )
        .get(s.maya.user.id),
    );
    // Replay of the same state is rejected and PayPal is not asked again.
    const replay = await s.callback(state);
    assert.equal(replay.statusCode, 400);
    assert.equal(replay.json().error.code, "PAYPAL_STATE_INVALID");
    assert.equal(provider.codes.length, 1);
    // Own view shows it; typing an email afterwards drops verification.
    const own = (
      await s.app.inject({
        url: "/api/auth/payout-account",
        headers: auth(s.maya.token),
      })
    ).json();
    assert.equal(own.paypalConnect, true);
    assert.equal(own.destination.verified, true);
    await s.app.inject({
      method: "PUT",
      url: "/api/auth/payout-account",
      headers: auth(s.maya.token),
      payload: { email: "maya.pay@example.test" },
    });
    const typed = s.app.store.db
      .prepare(
        "SELECT verified, payer_id AS payerId FROM fairshare_payout_accounts WHERE user_id=?",
      )
      .get(s.maya.user.id) as any;
    assert.deepEqual({ ...typed }, { verified: 0, payerId: null });
  } finally {
    await s.app.close();
  }
});

test("CSRF: state from another user, another session, a forged signature or none is rejected before any exchange", async () => {
  const provider = fakeProvider();
  const s = await setup(provider);
  try {
    // Attacker (org) starts a flow and tries to land it in Maya's session.
    const orgState = await s.start(s.org.token);
    assert.equal((await s.callback(orgState)).statusCode, 400);
    // Same user, different session (e.g. a second login) is not the starter.
    const mayaState = await s.start();
    const other = s.app.store.login("maya@example.test", "Correct-Horse-123");
    assert.equal((await s.callback(mayaState, other.token)).statusCode, 400);
    // Forged and unsigned states.
    const forged = signState("guess", "nonce", Date.now() + 60_000);
    assert.equal((await s.callback(forged)).statusCode, 400);
    assert.equal((await s.callback("not-a-state")).statusCode, 400);
    // No session at all.
    const anon = await s.app.inject({
      method: "POST",
      url: "/api/auth/paypal/callback",
      payload: { code: "x", state: "y" },
    });
    assert.equal(anon.statusCode, 401);
    assert.deepEqual(provider.codes, []);
    assert.equal(
      s.app.store.db
        .prepare("SELECT COUNT(*) AS n FROM fairshare_payout_accounts")
        .get()?.n as number,
      0,
    );
  } finally {
    await s.app.close();
  }
});

test("expired state is rejected", async () => {
  let now = Date.now();
  const provider = fakeProvider();
  const app = await buildApp({
    dbPath: ":memory:",
    clock: () => now,
    paypalIdentity: { provider, stateSecret: SECRET },
  });
  try {
    const maya = app.store.register({
      name: "Maya",
      email: "maya@example.test",
      password: "Correct-Horse-123",
    });
    const r = await app.inject({
      url: "/api/auth/paypal/connect",
      headers: auth(maya.token),
    });
    const state = new URL(r.json().authorizeUrl).searchParams.get("state")!;
    now += 11 * 60 * 1000;
    const late = await app.inject({
      method: "POST",
      url: "/api/auth/paypal/callback",
      headers: auth(maya.token),
      payload: { code: "c", state },
    });
    assert.ok([400, 401].includes(late.statusCode), late.body);
    assert.deepEqual(provider.codes, []);
  } finally {
    await app.close();
  }
});

test("exchange failure and unverified email save nothing and leak nothing", async () => {
  const failing = fakeProvider(() => {
    throw new PayPalError("PAYPAL_IDENTITY_REJECTED", 502);
  });
  let s = await setup(failing);
  try {
    const r = await s.callback(await s.start());
    assert.equal(r.statusCode, 502);
    assert.equal(r.json().error.code, "PAYPAL_CONNECT_FAILED");
    assert.doesNotMatch(r.body, /REJECTED|AUTHCODE/);
  } finally {
    await s.app.close();
  }
  for (const profile of [
    {
      email: "maya@example.test",
      emailVerified: false,
      payerId: "PAYERID12345",
    },
    { email: null, emailVerified: true, payerId: "PAYERID12345" },
  ]) {
    s = await setup(fakeProvider(profile));
    try {
      const r = await s.callback(await s.start());
      assert.equal(r.statusCode, 422);
      assert.equal(r.json().error.code, "PAYPAL_EMAIL_UNVERIFIED");
      assert.equal(
        s.app.store.db
          .prepare("SELECT COUNT(*) AS n FROM fairshare_payout_accounts")
          .get()?.n as number,
        0,
      );
    } finally {
      await s.app.close();
    }
  }
});

test("disconnect drops verification, keeps the email, audits once", async () => {
  const s = await setup(fakeProvider());
  try {
    await s.callback(await s.start());
    const r = await s.app.inject({
      method: "DELETE",
      url: "/api/auth/paypal/connect",
      headers: auth(s.maya.token),
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().destination.value, "maya.pay@example.test");
    assert.equal(r.json().destination.verified, false);
    await s.app.inject({
      method: "DELETE",
      url: "/api/auth/paypal/connect",
      headers: auth(s.maya.token),
    });
    const audits = s.app.store.db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit WHERE action='PAYPAL_DISCONNECTED'",
      )
      .get() as any;
    assert.equal(audits.n, 1);
    const row = s.app.store.db
      .prepare(
        "SELECT payer_id AS payerId, verified_at AS verifiedAt FROM fairshare_payout_accounts",
      )
      .get() as any;
    assert.deepEqual({ ...row }, { payerId: null, verifiedAt: null });
  } finally {
    await s.app.close();
  }
});

test("a delayed callback cannot replace a newer payout decision or a revoked session", async () => {
  for (const action of ["save", "remove", "disconnect", "logout"] as const) {
    const deferred = deferredProvider();
    const s = await setup(deferred.provider);
    try {
      if (action === "disconnect")
        await s.app.inject({
          method: "PUT",
          url: "/api/auth/payout-account",
          headers: auth(s.maya.token),
          payload: { email: "kept@example.test" },
        });
      const state = await s.start();
      const pending = s.callback(state);
      await deferred.waitForExchange();
      if (action === "save")
        await s.app.inject({
          method: "PUT",
          url: "/api/auth/payout-account",
          headers: auth(s.maya.token),
          payload: { email: "newer@example.test" },
        });
      if (action === "remove")
        await s.app.inject({
          method: "DELETE",
          url: "/api/auth/payout-account",
          headers: auth(s.maya.token),
        });
      if (action === "disconnect")
        await s.app.inject({
          method: "DELETE",
          url: "/api/auth/paypal/connect",
          headers: auth(s.maya.token),
        });
      if (action === "logout")
        await s.app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: auth(s.maya.token),
        });
      deferred.release();
      const completed = await pending;
      assert.equal(completed.statusCode, action === "logout" ? 401 : 409);
      const account = s.app.store.db
        .prepare(
          "SELECT receiver,verified FROM fairshare_payout_accounts WHERE user_id=?",
        )
        .get(s.maya.user.id) as
        | { receiver: string; verified: number }
        | undefined;
      if (action === "save")
        assert.deepEqual(
          { ...account },
          {
            receiver: "newer@example.test",
            verified: 0,
          },
        );
      else if (action === "disconnect")
        assert.deepEqual(
          { ...account },
          {
            receiver: "kept@example.test",
            verified: 0,
          },
        );
      else assert.equal(account, undefined);
    } finally {
      await s.app.close();
    }
  }
});

test("a newer Connect with PayPal start fences a callback already awaiting exchange", async () => {
  const deferred = deferredProvider();
  const s = await setup(deferred.provider);
  try {
    const firstState = await s.start();
    const pending = s.callback(firstState);
    await deferred.waitForExchange();
    await s.start();
    deferred.release();
    const completed = await pending;
    assert.equal(completed.statusCode, 409, completed.body);
    assert.equal(
      s.app.store.db
        .prepare("SELECT COUNT(*) AS n FROM fairshare_payout_accounts")
        .get()?.n,
      0,
    );
  } finally {
    await s.app.close();
  }
});

test("legacy payout writers fence a delayed callback", async () => {
  for (const action of ["save", "remove"] as const) {
    const deferred = deferredProvider();
    const s = await setup(deferred.provider);
    try {
      const mine = `/api/workspaces/${s.w.id}/payment-accounts/mine`;
      if (action === "remove")
        await s.app.inject({
          method: "PUT",
          url: mine,
          headers: auth(s.maya.token),
          payload: { paypalId: "ABCDEFGHIJKLM" },
        });
      const state = await s.start();
      const pending = s.callback(state);
      await deferred.waitForExchange();
      const newer = await s.app.inject({
        method: action === "save" ? "PUT" : "DELETE",
        url: mine,
        headers: auth(s.maya.token),
        payload: { paypalId: "NOPQRSTUVWXYZ" },
      });
      assert.equal(newer.statusCode, 200, newer.body);
      deferred.release();
      assert.equal((await pending).statusCode, 409);
      const legacy = s.app.store.db
        .prepare(
          "SELECT paypal_id AS paypalId FROM fairshare_recipients WHERE workspace_id=? AND user_id=?",
        )
        .get(s.w.id, s.maya.user.id) as { paypalId: string } | undefined;
      assert.equal(
        legacy?.paypalId,
        action === "save" ? "NOPQRSTUVWXYZ" : undefined,
      );
    } finally {
      await s.app.close();
    }
  }
});

test("legacy collaboration recipient writer fences a delayed callback", async () => {
  const deferred = deferredProvider();
  const s = await setup(deferred.provider);
  try {
    const collaboration = await s.app.inject({
      method: "POST",
      url: `/api/workspaces/${s.w.id}/collaborations`,
      headers: auth(s.org.token),
      payload: { name: "Legacy recipient" },
    });
    assert.equal(collaboration.statusCode, 201, collaboration.body);
    const state = await s.start(s.org.token);
    const pending = s.callback(state, s.org.token);
    await deferred.waitForExchange();
    const recipient = await s.app.inject({
      method: "PUT",
      url: `/api/workspaces/${s.w.id}/collaborations/${collaboration.json().id}/recipient`,
      headers: auth(s.org.token),
      payload: { paypalId: "NOPQRSTUVWXYZ" },
    });
    assert.equal(recipient.statusCode, 200, recipient.body);
    deferred.release();
    assert.equal((await pending).statusCode, 409);
  } finally {
    await s.app.close();
  }
});

test("startup adds generation to a pre-existing five-column connect-state table", async () => {
  const directory = mkdtempSync(join(tmpdir(), "fairshare-paypal-state-"));
  const dbPath = join(directory, "state.db");
  const db = new DatabaseSync(dbPath);
  db.exec(
    "CREATE TABLE fairshare_paypal_connect_states(nonce TEXT PRIMARY KEY,user_id TEXT NOT NULL,session_hash TEXT NOT NULL,return_to TEXT NOT NULL,expires_at INTEGER NOT NULL); INSERT INTO fairshare_paypal_connect_states VALUES('nonce','user','session','/app',1)",
  );
  db.close();
  const app = await buildApp({
    dbPath,
    paypalIdentity: { provider: fakeProvider(), stateSecret: SECRET },
  });
  try {
    const columns = app.store.db
      .prepare("PRAGMA table_info(fairshare_paypal_connect_states)")
      .all() as { name: string }[];
    assert(columns.some((column) => column.name === "generation"));
    assert.deepEqual(
      {
        ...(app.store.db
          .prepare(
            "SELECT nonce,user_id AS userId,generation FROM fairshare_paypal_connect_states",
          )
          .get() as any),
      },
      { nonce: "nonce", userId: "user", generation: 0 },
    );
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("organizer sees readiness only, never the verified email or payer ID", async () => {
  const s = await setup(fakeProvider());
  try {
    await s.callback(await s.start());
    const r = await s.app.inject({
      url: `/api/workspaces/${s.w.id}/payment-accounts?version=2`,
      headers: auth(s.org.token),
    });
    assert.equal(r.statusCode, 200, r.body);
    const maya = r.json().members.find((m: any) => m.id === s.maya.user.id);
    assert.equal(maya.status, "READY");
    assert.doesNotMatch(r.body, /maya\.pay|PAYERID|verified/i);
  } finally {
    await s.app.close();
  }
});

test("unconfigured: flag is false, start and callback are unavailable, email path unchanged", async () => {
  const s = await setup();
  try {
    const own = await s.app.inject({
      url: "/api/auth/payout-account",
      headers: auth(s.maya.token),
    });
    assert.equal(own.json().paypalConnect, false);
    const start = await s.app.inject({
      url: "/api/auth/paypal/connect",
      headers: auth(s.maya.token),
    });
    assert.equal(start.statusCode, 503);
    assert.equal(start.json().error.code, "PAYPAL_IDENTITY_NOT_CONFIGURED");
    assert.equal((await s.callback("x.1.y")).statusCode, 503);
    const saved = await s.app.inject({
      method: "PUT",
      url: "/api/auth/payout-account",
      headers: auth(s.maya.token),
      payload: { email: "maya@example.test" },
    });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().destination.verified, false);
  } finally {
    await s.app.close();
  }
});

test("start is rate limited per person", async () => {
  const s = await setup(fakeProvider());
  try {
    for (let i = 0; i < 10; i++) await s.start();
    const r = await s.app.inject({
      url: "/api/auth/paypal/connect",
      headers: auth(s.maya.token),
    });
    assert.equal(r.statusCode, 429);
  } finally {
    await s.app.close();
  }
});

test("userinfo mapping: OpenID and paypalv1.1 shapes, unverified and malformed values", () => {
  assert.deepEqual(
    mapPayPalUserInfo({
      email: " Maya@Example.TEST ",
      email_verified: true,
      payer_id: "PAYERID12345",
      name: "ignored",
    }),
    {
      email: "maya@example.test",
      emailVerified: true,
      payerId: "PAYERID12345",
    },
  );
  assert.deepEqual(
    mapPayPalUserInfo({
      emails: [
        { value: "old@example.test", primary: false, confirmed: true },
        { value: "main@example.test", primary: true, confirmed: false },
      ],
    }),
    { email: "main@example.test", emailVerified: false, payerId: null },
  );
  assert.deepEqual(
    mapPayPalUserInfo({ email: "nope", email_verified: "true", payer_id: "x" }),
    { email: null, emailVerified: false, payerId: null },
  );
  assert.deepEqual(mapPayPalUserInfo(null), {
    email: null,
    emailVerified: false,
    payerId: null,
  });
});

test("sandbox identity client exchanges the code and calls userinfo with a fake fetch", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(
      JSON.stringify(
        url.endsWith("/v1/oauth2/token")
          ? { access_token: "AT", token_type: "Bearer" }
          : {
              email: "maya@example.test",
              email_verified: true,
              payer_id: "PAYERID12345",
            },
      ),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  const client = new PayPalIdentitySandbox(
    {
      clientId: "cid",
      clientSecret: "sec",
      returnUrl: "https://web.test/paypal/return",
    },
    fetcher,
  );
  const url = new URL(client.authorizeUrl("STATE"));
  assert.equal(url.origin, "https://www.sandbox.paypal.com");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(
    url.searchParams.get("scope"),
    "openid email https://uri.paypal.com/services/paypalattributes",
  );
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "https://web.test/paypal/return",
  );
  assert.equal(url.searchParams.get("state"), "STATE");
  assert.doesNotMatch(url.toString(), /sec/);
  const profile = await client.exchange("CODE");
  assert.equal(profile.payerId, "PAYERID12345");
  assert.match(
    calls[0].url,
    /^https:\/\/api-m\.sandbox\.paypal\.com\/v1\/oauth2\/token$/,
  );
  assert.equal(
    String(calls[0].init.body),
    "grant_type=authorization_code&code=CODE",
  );
  assert.match(calls[1].url, /\/v1\/identity\/openidconnect\/userinfo$/);
  assert.equal((calls[1].init.headers as any).Authorization, "Bearer AT");
  const rejecting = new PayPalIdentitySandbox(
    { clientId: "cid", clientSecret: "sec", returnUrl: "https://web.test/r" },
    (async () =>
      new Response('{"error":"invalid_grant"}', {
        status: 400,
      })) as unknown as typeof fetch,
  );
  await assert.rejects(
    rejecting.exchange("bad"),
    (e: any) => e.code === "PAYPAL_IDENTITY_REJECTED",
  );
});

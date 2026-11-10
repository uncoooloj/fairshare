import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { totp } from "../src/mfa.js";
const key = Buffer.alloc(32, 42).toString("base64"),
  password = "Correct-Horse-123";
function decode(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0,
    buffer = 0;
  const bytes: number[] = [];
  for (const char of value) {
    buffer = (buffer << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
test("TOTP matches RFC6238 SHA1 six-digit vector", () => {
  assert.equal(totp(Buffer.from("12345678901234567890"), 1), "287082");
});
test("MFA requires verified enrollment and gates login; recovery is one-use and sessions revoke", async () => {
  let now = 300000;
  const app = await buildApp({
    dbPath: ":memory:",
    clock: () => now,
    mfaEncryptionKey: key,
  });
  try {
    const user = app.store.register({
      email: "mfa@example.test",
      name: "Maya",
      password,
    });
    assert.throws(() => app.store.mfa.start(user.user.id, "wrong"));
    const setup = app.store.mfa.start(user.user.id, password),
      secret = decode(setup.secret);
    assert(
      !JSON.stringify(app.store.db.prepare("SELECT * FROM mfa").all()).includes(
        setup.secret,
      ),
    );
    assert.equal(app.store.mfa.status(user.user.id).enabled, false);
    assert(app.store.login(user.user.email, password).token);
    assert.throws(() => app.store.mfa.activate(user.user.id, "000000"));
    const enabled = app.store.mfa.activate(user.user.id, totp(secret, 10));
    assert.equal(enabled.recoveryCodes.length, 10);
    assert.throws(() => app.store.userForToken(user.token));
    assert.throws(() => app.store.login(user.user.email, password));
    assert.throws(() =>
      app.store.login(user.user.email, password, totp(secret, 10)),
    );
    now += 30000;
    const signedIn = app.store.login(
      user.user.email,
      password,
      totp(secret, 11),
    );
    assert(signedIn.token);
    assert.throws(() =>
      app.store.login(user.user.email, password, totp(secret, 11)),
    );
    const recovered = app.store.login(
      user.user.email,
      password,
      enabled.recoveryCodes[0],
    );
    assert(recovered.token);
    assert.throws(() =>
      app.store.login(user.user.email, password, enabled.recoveryCodes[0]),
    );
    assert.equal(app.store.mfa.status(user.user.id).recoveryCodesRemaining, 9);
    assert.throws(() =>
      app.store.mfa.disable(user.user.id, "wrong", enabled.recoveryCodes[1]),
    );
    assert.throws(() => app.store.mfa.disable(user.user.id, password, "bad"));
    app.store.mfa.disable(user.user.id, password, enabled.recoveryCodes[1]);
    assert.throws(() => app.store.userForToken(signedIn.token));
    assert.throws(() => app.store.userForToken(recovered.token));
    assert.equal(app.store.mfa.status(user.user.id).enabled, false);
    assert(app.store.login(user.user.email, password).token);
  } finally {
    await app.close();
  }
});
test("setup expiry and missing key fail closed; password reset cannot bypass MFA", async () => {
  let now = 300000;
  const app = await buildApp({
    dbPath: ":memory:",
    clock: () => now,
    mfaEncryptionKey: key,
  });
  try {
    const user = app.store.register({
      email: "mfa@example.test",
      name: "Maya",
      password,
    });
    const proof = app.store.createEmailVerification(user.user.id);
    app.store.confirmEmail(user.user.id, proof.token);
    const expired = app.store.mfa.start(user.user.id, password);
    now += 600000;
    assert.throws(() =>
      app.store.mfa.activate(
        user.user.id,
        totp(decode(expired.secret), Math.floor(now / 30000)),
      ),
    );
    const setup = app.store.mfa.start(user.user.id, password);
    app.store.mfa.activate(
      user.user.id,
      totp(decode(setup.secret), Math.floor(now / 30000)),
    );
    const reset = app.store.createPasswordReset(user.user.email)!;
    app.store.resetPassword(reset.token, password + "!");
    assert.throws(() => app.store.login(user.user.email, password + "!"));
  } finally {
    await app.close();
  }
  const unavailable = await buildApp({
    dbPath: ":memory:",
    mfaEncryptionKey: "",
  });
  try {
    const user = unavailable.store.register({
      email: "x@example.test",
      name: "X",
      password,
    });
    assert.equal(unavailable.store.mfa.status(user.user.id).available, false);
    assert.throws(() => unavailable.store.mfa.start(user.user.id, password));
  } finally {
    await unavailable.close();
  }
});
test("API authentication routes accept factor and do not issue session before verification", async () => {
  let now = 300000;
  const app = await buildApp({
    dbPath: ":memory:",
    mfaEncryptionKey: key,
    clock: () => now,
  });
  try {
    const user = app.store.register({
        email: "mfa@example.test",
        name: "Maya",
        password,
      }),
      headers = { authorization: `Bearer ${user.token}` };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/mfa/setup",
          payload: { password },
        })
      ).statusCode,
      401,
    );
    const setup = (
      await app.inject({
        method: "POST",
        url: "/api/auth/mfa/setup",
        headers,
        payload: { password },
      })
    ).json();
    const activate = await app.inject({
      method: "POST",
      url: "/api/auth/mfa/activate",
      headers,
      payload: { code: totp(decode(setup.secret), 10) },
    });
    assert.equal(activate.statusCode, 200, activate.body);
    const blocked = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: user.user.email, password },
    });
    assert.equal(blocked.statusCode, 401);
    assert(!blocked.json().token);
    now += 30000;
    const accepted = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: user.user.email,
        password,
        mfaCode: totp(decode(setup.secret), 11),
      },
    });
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert(accepted.json().token);
  } finally {
    await app.close();
  }
});
test("cancel removes pending secret, and ciphertext cannot be moved between users", async () => {
  const app = await buildApp({
    dbPath: ":memory:",
    mfaEncryptionKey: key,
    clock: () => 300000,
  });
  try {
    const first = app.store.register({
        email: "first@example.test",
        name: "First",
        password,
      }),
      second = app.store.register({
        email: "second@example.test",
        name: "Second",
        password,
      });
    const cancelled = app.store.mfa.start(first.user.id, password);
    app.store.mfa.cancel(first.user.id);
    assert.throws(() =>
      app.store.mfa.activate(first.user.id, totp(decode(cancelled.secret), 10)),
    );
    const setup = app.store.mfa.start(first.user.id, password);
    app.store.mfa.activate(first.user.id, totp(decode(setup.secret), 10));
    const ciphertext = (
      app.store.db
        .prepare("SELECT secret FROM mfa WHERE user_id=?")
        .get(first.user.id) as any
    ).secret;
    app.store.mfa.start(second.user.id, password);
    app.store.db
      .prepare("UPDATE mfa SET secret=? WHERE user_id=?")
      .run(ciphertext, second.user.id);
    assert.throws(
      () =>
        app.store.mfa.activate(second.user.id, totp(decode(setup.secret), 10)),
      {
        code: "MFA_UNAVAILABLE",
      },
    );
    assert.equal(app.store.mfa.status(second.user.id).enabled, false);
    app.store.mfa.cancel(first.user.id);
    assert.equal(app.store.mfa.status(first.user.id).enabled, true);
  } finally {
    await app.close();
  }
});

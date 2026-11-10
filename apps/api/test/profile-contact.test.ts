import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import type { MailMessage } from "../src/mail.js";
const password = "Correct-Horse-123";
async function setup() {
  let now = 100000;
  const messages: MailMessage[] = [];
  const app = await buildApp({
    dbPath: ":memory:",
    clock: () => now,
    publicAppOrigin: "https://fairshare.example",
    mailTransport: {
      async send(m) {
        messages.push(m);
        return { providerId: "test" };
      },
    },
  });
  const a = app.store.register({
    name: "Alice",
    email: "alice@example.test",
    password,
  });
  const b = app.store.register({
    name: "Bob",
    email: "bob@example.test",
    password,
  });
  return {
    app,
    a,
    b,
    messages,
    headers: { authorization: `Bearer ${a.token}` },
    expire: () => {
      now += 31 * 60000;
    },
  };
}
const token = (messages: MailMessage[]) =>
  new URL(messages.at(-1)!.link).hash.split("=")[1];
test("photo upload is private, bounded, rejects SVG and permits removal", async () => {
  const { app, headers, b } = await setup();
  try {
    const photo =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=";
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: "/api/auth/profile/photo",
          headers,
          payload: { photo },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ url: "/api/auth/profile/photo", headers })).json()
        .photo,
      photo,
    );
    assert.equal(
      (
        await app.inject({
          url: "/api/auth/profile/photo",
          headers: { authorization: `Bearer ${b.token}` },
        })
      ).json().photo,
      null,
    );
    for (const value of [
      "data:image/svg+xml;base64,PHN2Zz4=",
      "data:image/png;base64,YmFk",
    ])
      assert.equal(
        (
          await app.inject({
            method: "PUT",
            url: "/api/auth/profile/photo",
            headers,
            payload: { photo: value },
          })
        ).statusCode,
        400,
      );
    assert.equal(
      (await app.inject({ url: "/api/auth/profile/photo" })).statusCode,
      401,
    );
    await app.inject({
      method: "PUT",
      url: "/api/auth/profile/photo",
      headers,
      payload: { photo: null },
    });
    assert.equal(
      (await app.inject({ url: "/api/auth/profile/photo", headers })).json()
        .photo,
      null,
    );
  } finally {
    await app.close();
  }
});
test("email change requires password, keeps current identity until confirmation, binds account and revokes sessions", async () => {
  const { app, a, b, headers, messages } = await setup();
  try {
    const url = "/api/auth/email-change/request";
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url,
          headers,
          payload: { email: "new@example.test", password: "wrong" },
        })
      ).statusCode,
      401,
    );
    const request = await app.inject({
      method: "POST",
      url,
      headers,
      payload: { email: "new@example.test", password },
    });
    assert.equal(request.statusCode, 200, request.body);
    assert(!request.body.includes(token(messages)!));
    assert.equal(app.store.userForToken(a.token).email, "alice@example.test");
    const payload = { token: token(messages) };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/email-change/confirm",
          headers: { authorization: `Bearer ${b.token}` },
          payload,
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/email-change/confirm",
          headers,
          payload,
        })
      ).statusCode,
      200,
    );
    assert.throws(() => app.store.userForToken(a.token));
    const login = app.store.login("new@example.test", password);
    assert.equal(login.user.emailVerified, true);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/email-change/confirm",
          headers: { authorization: `Bearer ${login.token}` },
          payload,
        })
      ).statusCode,
      400,
    );
  } finally {
    await app.close();
  }
});
test("expiry and password changes invalidate email-change tokens", async () => {
  for (const changedPassword of [false, true]) {
    const { app, headers, messages, a, expire } = await setup();
    try {
      await app.inject({
        method: "POST",
        url: "/api/auth/email-change/request",
        headers,
        payload: { email: "new@example.test", password },
      });
      let auth = headers;
      if (changedPassword) {
        app.store.changePassword(a.user.id, password, "Different-Password-123");
        auth = {
          authorization: `Bearer ${app.store.login(a.user.email, "Different-Password-123").token}`,
        };
      } else expire();
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/auth/email-change/confirm",
            headers: auth,
            payload: { token: token(messages) },
          })
        ).statusCode,
        400,
      );
    } finally {
      await app.close();
    }
  }
});
test("unconfigured email delivery fails closed, no unverified address replacement", async () => {
  const app = await buildApp({ dbPath: ":memory:" });
  try {
    const a = app.store.register({
      name: "Alice",
      email: "a@example.test",
      password,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/email-change/request",
      headers: { authorization: `Bearer ${a.token}` },
      payload: { email: "new@example.test", password },
    });
    assert.equal(response.statusCode, 503);
    assert.equal(app.store.userForToken(a.token).email, "a@example.test");
  } finally {
    await app.close();
  }
});
test("destination collision cannot merge accounts and latest request replaces old token", async () => {
  const { app, headers, messages, b } = await setup();
  try {
    await app.inject({
      method: "POST",
      url: "/api/auth/email-change/request",
      headers,
      payload: { email: "new@example.test", password },
    });
    const old = token(messages);
    await app.inject({
      method: "POST",
      url: "/api/auth/email-change/request",
      headers,
      payload: { email: b.user.email, password },
    });
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/email-change/confirm",
          headers,
          payload: { token: old },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/email-change/confirm",
          headers,
          payload: { token: token(messages) },
        })
      ).statusCode,
      409,
    );
    assert.equal(app.store.userForToken(b.token).email, b.user.email);
  } finally {
    await app.close();
  }
});
test("delivery failure invalidates token and leaves current email intact", async () => {
  let link = "";
  const app = await buildApp({
    dbPath: ":memory:",
    publicAppOrigin: "https://fairshare.example",
    mailTransport: {
      async send(m) {
        link = m.link;
        throw new Error("provider unavailable");
      },
    },
  });
  try {
    const a = app.store.register({
        name: "A",
        email: "a@example.test",
        password,
      }),
      headers = { authorization: `Bearer ${a.token}` };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/email-change/request",
          headers,
          payload: { email: "new@example.test", password },
        })
      ).statusCode,
      503,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/email-change/confirm",
          headers,
          payload: { token: new URL(link).hash.split("=")[1] },
        })
      ).statusCode,
      400,
    );
    assert.equal(app.store.userForToken(a.token).email, a.user.email);
  } finally {
    await app.close();
  }
});

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  RecipientType,
  type PayPalIdentityProvider,
} from "@fairshare/payments";
import type { FastifyRequest } from "fastify";
import type { FairshareApp } from "./app.js";
import { ApiError, digest } from "./identity.js";
import {
  ensurePayoutAccountSchema,
  readPayoutDestination,
} from "./payoutAccounts.js";

export type PayPalConnectOptions = {
  provider: PayPalIdentityProvider;
  /** HMAC key for the OAuth `state`. Server-only. */
  stateSecret: string;
};
/** Outcome flag the web return page appends to the page that started the flow. */
export enum PayPalConnectResult {
  CONNECTED = "connected",
  UNVERIFIED = "unverified",
  FAILED = "failed",
  CANCELLED = "cancelled",
}
const STATE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_RETURN = "/app";
// Same-origin path only: no scheme, no protocol-relative "//", no backslashes.
const RETURN_PATH = /^\/(?![/\\])[A-Za-z0-9\-._~/?=&%]{0,300}$/;

export function safeReturnPath(value: unknown): string {
  return typeof value === "string" && RETURN_PATH.test(value)
    ? value
    : DEFAULT_RETURN;
}
const sign = (secret: string, value: string) =>
  createHmac("sha256", secret).update(value).digest("base64url");
export function signState(secret: string, nonce: string, expiresAt: number) {
  return `${nonce}.${expiresAt}.${sign(secret, `${nonce}.${expiresAt}`)}`;
}
/** Returns the nonce of an untampered, unexpired state, else null. */
export function verifyState(
  secret: string,
  state: unknown,
  now: number,
): string | null {
  if (typeof state !== "string") return null;
  const [nonce, expires, signature, extra] = state.split(".");
  if (extra !== undefined || !nonce || !expires || !signature) return null;
  const expected = Buffer.from(sign(secret, `${nonce}.${expires}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return null;
  return Number(expires) > now ? nonce : null;
}

/** Self-only "Connect with PayPal". The PayPal return URL is a web page that
 * posts `code` and `state` back here with the person's own session. */
export function registerPayPalConnect(
  app: FairshareApp,
  options?: PayPalConnectOptions,
) {
  const db = app.store.db;
  ensurePayoutAccountSchema(db);
  db.exec(
    "CREATE TABLE IF NOT EXISTS fairshare_paypal_connect_states(nonce TEXT PRIMARY KEY,user_id TEXT NOT NULL,session_hash TEXT NOT NULL,return_to TEXT NOT NULL,expires_at INTEGER NOT NULL)",
  );
  const base = "/api/auth/paypal";
  const configured = () => {
    if (!options)
      throw new ApiError(
        503,
        "PAYPAL_IDENTITY_NOT_CONFIGURED",
        "Connecting PayPal isn’t available. Enter your PayPal email instead.",
      );
    return options;
  };
  // requireSession has already validated the Bearer header shape.
  const sessionHash = (req: FastifyRequest) =>
    digest((req.headers.authorization ?? "").slice(7));

  app.get<{ Querystring: { returnTo?: string } }>(
    `${base}/connect`,
    async (req) => {
      const user = app.requireSession(req);
      const { provider, stateSecret } = configured();
      app.store.limit(`paypal-connect:user:${user.id}`, 10);
      const now = app.store.now();
      const nonce = randomBytes(24).toString("base64url");
      const expiresAt = now + STATE_TTL_MS;
      app.store.tx(() => {
        db.prepare(
          "DELETE FROM fairshare_paypal_connect_states WHERE expires_at<=? OR user_id=?",
        ).run(now, user.id);
        db.prepare(
          "INSERT INTO fairshare_paypal_connect_states VALUES(?,?,?,?,?)",
        ).run(
          nonce,
          user.id,
          sessionHash(req),
          safeReturnPath(req.query.returnTo),
          expiresAt,
        );
      });
      return {
        authorizeUrl: provider.authorizeUrl(
          signState(stateSecret, nonce, expiresAt),
        ),
      };
    },
  );

  app.post(
    `${base}/callback`,
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["code", "state"],
          properties: {
            code: { type: "string", minLength: 1, maxLength: 2048 },
            state: { type: "string", minLength: 1, maxLength: 512 },
          },
        },
      },
    },
    async (req) => {
      const user = app.requireSession(req);
      const { provider, stateSecret } = configured();
      app.store.limit(`paypal-callback:user:${user.id}`, 20);
      const { code, state } = req.body as { code: string; state: string };
      const now = app.store.now();
      const nonce = verifyState(stateSecret, state, now);
      // Single use: the state is consumed before PayPal is asked anything.
      const row = nonce
        ? app.store.tx(() => {
            const found = db
              .prepare(
                "SELECT user_id AS userId, session_hash AS sessionHash, return_to AS returnTo, expires_at AS expiresAt FROM fairshare_paypal_connect_states WHERE nonce=?",
              )
              .get(nonce) as
              | {
                  userId: string;
                  sessionHash: string;
                  returnTo: string;
                  expiresAt: number;
                }
              | undefined;
            db.prepare(
              "DELETE FROM fairshare_paypal_connect_states WHERE nonce=?",
            ).run(nonce);
            return found;
          })
        : undefined;
      if (
        !row ||
        row.userId !== user.id ||
        row.sessionHash !== sessionHash(req) ||
        row.expiresAt <= now
      )
        throw new ApiError(
          400,
          "PAYPAL_STATE_INVALID",
          "That PayPal link expired or wasn’t started here. Try connecting again.",
        );
      let profile;
      try {
        profile = await provider.exchange(code);
      } catch {
        throw new ApiError(
          502,
          "PAYPAL_CONNECT_FAILED",
          "PayPal didn’t confirm your account. Try again, or enter your PayPal email instead.",
        );
      }
      if (!profile.email || !profile.emailVerified)
        throw new ApiError(
          422,
          "PAYPAL_EMAIL_UNVERIFIED",
          "PayPal hasn’t confirmed the email on that account yet. Confirm it with PayPal, or enter your PayPal email instead.",
        );
      const updatedAt = app.store.now();
      app.store.tx(() => {
        db.prepare(
          "INSERT INTO fairshare_payout_accounts(user_id,recipient_type,receiver,updated_at,verified,payer_id,verified_at) VALUES(?,?,?,?,1,?,?) ON CONFLICT(user_id) DO UPDATE SET recipient_type=excluded.recipient_type,receiver=excluded.receiver,updated_at=excluded.updated_at,verified=1,payer_id=excluded.payer_id,verified_at=excluded.verified_at",
        ).run(
          user.id,
          RecipientType.EMAIL,
          profile.email,
          updatedAt,
          profile.payerId,
          updatedAt,
        );
        app.store.audit(user.id, null, "PAYPAL_CONNECTED");
      });
      return {
        result: PayPalConnectResult.CONNECTED,
        returnTo: row.returnTo,
        destination: readPayoutDestination(db, user.id),
      };
    },
  );

  // Works even when Identity is unconfigured, so a person can always undo it.
  app.delete(`${base}/connect`, async (req) => {
    const user = app.requireSession(req);
    app.store.limit(`paypal-disconnect:user:${user.id}`, 10);
    app.store.tx(() => {
      const changed = db
        .prepare(
          "UPDATE fairshare_payout_accounts SET verified=0,payer_id=NULL,verified_at=NULL WHERE user_id=? AND verified=1",
        )
        .run(user.id).changes;
      if (changed) app.store.audit(user.id, null, "PAYPAL_DISCONNECTED");
    });
    // The email stays as a typed destination so payouts aren't interrupted.
    return { destination: readPayoutDestination(db, user.id) };
  });
}

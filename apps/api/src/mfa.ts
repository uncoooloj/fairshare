import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { ApiError, digest, type IdentityStore } from "./identity.js";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(bytes: Buffer) {
  let bits = 0,
    value = 0,
    result = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) result += ALPHABET[(value << (5 - bits)) & 31];
  return result;
}
export function totp(secret: Buffer, counter: number) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hash = createHmac("sha1", secret).update(message).digest();
  const offset = hash[hash.length - 1]! & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
    6,
    "0",
  );
}
export class MfaService {
  constructor(
    private store: IdentityStore,
    private encryptionKey?: string,
    private simulation = false,
  ) {
    if (
      simulation &&
      (store.mode !== "SANDBOX" ||
        process.env.NODE_ENV === "production" ||
        process.env.PAYPAL_ENV === "live")
    )
      throw new Error(
        "Hackathon MFA simulation requires non-production SANDBOX.",
      );
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS hackathon_mfa(user_id TEXT PRIMARY KEY REFERENCES users(id),enabled INTEGER NOT NULL DEFAULT 0,expires_at INTEGER NOT NULL)",
    );
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS mfa(user_id TEXT PRIMARY KEY REFERENCES users(id),secret TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,expires_at INTEGER NOT NULL,last_counter INTEGER NOT NULL DEFAULT -1,recovery TEXT NOT NULL DEFAULT '[]')",
    );
  }
  // Never bypass an existing real authenticator, even when simulation is opted in.
  private simulated(userId: string) {
    return (
      this.simulation &&
      this.store.mode === "SANDBOX" &&
      process.env.NODE_ENV !== "production" &&
      process.env.PAYPAL_ENV !== "live" &&
      !this.store.db.prepare("SELECT 1 FROM mfa WHERE user_id=?").get(userId)
    );
  }
  private simulationCode(code: unknown) {
    if (typeof code !== "string" || !code.trim() || code.length > 80)
      throw new ApiError(
        401,
        "MFA_REQUIRED",
        "Hackathon simulation: enter any nonempty value (up to 80 characters). This is not account protection.",
      );
  }
  private key() {
    const key = this.encryptionKey
      ? Buffer.from(this.encryptionKey, "base64")
      : Buffer.alloc(0);
    if (key.length !== 32)
      throw new ApiError(
        503,
        "MFA_UNAVAILABLE",
        "Authenticator setup requires a configured server encryption key.",
      );
    return key;
  }
  private encrypt(userId: string, secret: Buffer) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    cipher.setAAD(Buffer.from(userId));
    const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
      "base64",
    );
  }
  private decrypt(userId: string, encoded: string) {
    try {
      const value = Buffer.from(encoded, "base64"),
        cipher = createDecipheriv(
          "aes-256-gcm",
          this.key(),
          value.subarray(0, 12),
        );
      cipher.setAAD(Buffer.from(userId));
      cipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]);
    } catch {
      throw new ApiError(
        503,
        "MFA_UNAVAILABLE",
        "Authenticator verification is unavailable. Contact the service operator.",
      );
    }
  }
  status(userId: string) {
    if (this.simulated(userId)) {
      const row = this.store.db
        .prepare("SELECT enabled FROM hackathon_mfa WHERE user_id=?")
        .get(userId) as any;
      return {
        available: true,
        enabled: row?.enabled === 1,
        simulated: true,
        recoveryCodesRemaining: 0,
      };
    }
    const row = this.store.db
      .prepare("SELECT enabled,recovery FROM mfa WHERE user_id=?")
      .get(userId) as any;
    let available = true;
    try {
      this.key();
    } catch {
      available = false;
    }
    return {
      enabled: row?.enabled === 1,
      available,
      recoveryCodesRemaining:
        row?.enabled === 1 ? JSON.parse(row.recovery).length : 0,
    };
  }
  start(userId: string, password: unknown) {
    this.store.limit(`mfa-setup:${userId}`, 5, 30 * 60000);
    this.store.verifyPassword(userId, password);
    if (this.simulated(userId)) {
      if (this.status(userId).enabled)
        throw new ApiError(
          409,
          "MFA_ALREADY_ENABLED",
          "Simulated MFA is already enabled.",
        );
      const expiresAt = this.store.now() + 10 * 60000;
      this.store.db
        .prepare(
          "INSERT INTO hackathon_mfa(user_id,enabled,expires_at) VALUES(?,0,?) ON CONFLICT(user_id) DO UPDATE SET expires_at=excluded.expires_at",
        )
        .run(userId, expiresAt);
      return { simulated: true, secret: "", uri: "", expiresAt };
    }
    this.key();
    return this.store.tx(() => {
      if (this.status(userId).enabled)
        throw new ApiError(
          409,
          "MFA_ALREADY_ENABLED",
          "Disable the existing authenticator before replacing it.",
        );
      const secret = randomBytes(20),
        expiresAt = this.store.now() + 10 * 60000;
      this.store.db
        .prepare(
          "INSERT INTO mfa(user_id,secret,enabled,expires_at,last_counter,recovery) VALUES(?,?,0,?,-1,?) ON CONFLICT(user_id) DO UPDATE SET secret=excluded.secret,expires_at=excluded.expires_at,last_counter=-1,recovery=excluded.recovery",
        )
        .run(userId, this.encrypt(userId, secret), expiresAt, "[]");
      const user = this.store.db
        .prepare("SELECT email FROM users WHERE id=?")
        .get(userId) as any;
      const encoded = base32(secret);
      return {
        secret: encoded,
        uri: `otpauth://totp/${encodeURIComponent("Fairshare:" + user.email)}?secret=${encoded}&issuer=Fairshare&algorithm=SHA1&digits=6&period=30`,
        expiresAt,
      };
    });
  }
  /** Must execute inside the caller's transaction when consuming a login factor. */
  verify(userId: string, code: unknown, allowPending = false) {
    const simulatedRow = this.store.db
      .prepare("SELECT * FROM hackathon_mfa WHERE user_id=?")
      .get(userId) as any;
    if (
      simulatedRow &&
      !this.simulated(userId) &&
      !this.store.db.prepare("SELECT 1 FROM mfa WHERE user_id=?").get(userId)
    ) {
      if (simulatedRow.enabled)
        throw new ApiError(
          503,
          "MFA_UNAVAILABLE",
          "Hackathon MFA simulation is disabled. Contact the operator to reset this test account.",
        );
    }
    if (this.simulated(userId)) {
      if (!simulatedRow || (!simulatedRow.enabled && !allowPending)) return;
      if (!simulatedRow.enabled && simulatedRow.expires_at <= this.store.now())
        throw new ApiError(
          400,
          "MFA_SETUP_EXPIRED",
          "Simulation setup expired. Start again.",
        );
      this.simulationCode(code);
      return;
    }
    const row = this.store.db
      .prepare("SELECT * FROM mfa WHERE user_id=?")
      .get(userId) as any;
    if (!row || (!row.enabled && !allowPending)) return;
    if (!row.enabled && row.expires_at <= this.store.now())
      throw new ApiError(
        400,
        "MFA_SETUP_EXPIRED",
        "Authenticator setup expired. Start again.",
      );
    if (typeof code !== "string" || code.length > 80)
      throw new ApiError(
        401,
        "MFA_REQUIRED",
        "Enter your authenticator code or an unused recovery code.",
      );
    const normalized = code.trim().replace(/\s/g, "");
    if (row.enabled) {
      const recovery: string[] = JSON.parse(row.recovery),
        index = recovery.indexOf(digest(normalized.toUpperCase()));
      if (index >= 0) {
        recovery.splice(index, 1);
        this.store.db
          .prepare("UPDATE mfa SET recovery=? WHERE user_id=?")
          .run(JSON.stringify(recovery), userId);
        this.store.audit(userId, null, "MFA_RECOVERY_USED");
        return;
      }
    }
    const secret = this.decrypt(userId, row.secret),
      counter = Math.floor(this.store.now() / 30000);
    for (const candidate of [counter - 1, counter, counter + 1]) {
      if (candidate < 0 || candidate <= row.last_counter) continue;
      const expected = Buffer.from(totp(secret, candidate)),
        actual = Buffer.from(normalized);
      if (
        expected.length === actual.length &&
        timingSafeEqual(expected, actual)
      ) {
        this.store.db
          .prepare("UPDATE mfa SET last_counter=? WHERE user_id=?")
          .run(candidate, userId);
        return;
      }
    }
    throw new ApiError(
      401,
      "MFA_INVALID",
      "Authenticator code is invalid or already used.",
    );
  }
  cancel(userId: string) {
    this.store.db
      .prepare("DELETE FROM hackathon_mfa WHERE user_id=? AND enabled=0")
      .run(userId);
    this.store.db
      .prepare("DELETE FROM mfa WHERE user_id=? AND enabled=0")
      .run(userId);
    return { cancelled: true };
  }
  activate(userId: string, code: unknown) {
    this.store.limit(`mfa-activate:${userId}`, 10, 30 * 60000);
    if (this.simulated(userId))
      return this.store.tx(() => {
        const row = this.store.db
          .prepare("SELECT enabled FROM hackathon_mfa WHERE user_id=?")
          .get(userId) as any;
        if (!row || row.enabled)
          throw new ApiError(
            409,
            "MFA_SETUP_REQUIRED",
            "Start simulation setup first.",
          );
        this.verify(userId, code, true);
        this.store.db
          .prepare("UPDATE hackathon_mfa SET enabled=1 WHERE user_id=?")
          .run(userId);
        this.store.db
          .prepare("DELETE FROM sessions WHERE user_id=?")
          .run(userId);
        this.store.audit(userId, null, "HACKATHON_MFA_SIMULATED_ENABLED");
        return {
          enabled: true,
          simulated: true,
          recoveryCodes: [] as string[],
          signInRequired: true,
        };
      });
    return this.store.tx(() => {
      const row = this.store.db
        .prepare("SELECT enabled FROM mfa WHERE user_id=?")
        .get(userId) as any;
      if (!row || row.enabled)
        throw new ApiError(
          409,
          "MFA_SETUP_REQUIRED",
          "Start authenticator setup first.",
        );
      this.verify(userId, code, true);
      const recoveryCodes = Array.from({ length: 10 }, () =>
        randomBytes(10).toString("hex").toUpperCase(),
      );
      this.store.db
        .prepare("UPDATE mfa SET enabled=1,recovery=? WHERE user_id=?")
        .run(JSON.stringify(recoveryCodes.map(digest)), userId);
      this.store.db.prepare("DELETE FROM sessions WHERE user_id=?").run(userId);
      this.store.audit(userId, null, "MFA_ENABLED");
      return { enabled: true, recoveryCodes, signInRequired: true };
    });
  }
  disable(userId: string, password: unknown, code: unknown) {
    this.store.limit(`mfa-disable:${userId}`, 5, 30 * 60000);
    this.store.verifyPassword(userId, password);
    return this.store.tx(() => {
      if (!this.status(userId).enabled)
        throw new ApiError(
          409,
          "MFA_NOT_ENABLED",
          "No authenticator is enabled.",
        );
      this.verify(userId, code);
      const simulated = this.simulated(userId);
      if (simulated)
        this.store.db
          .prepare("DELETE FROM hackathon_mfa WHERE user_id=?")
          .run(userId);
      else this.store.db.prepare("DELETE FROM mfa WHERE user_id=?").run(userId);
      this.store.db.prepare("DELETE FROM sessions WHERE user_id=?").run(userId);
      this.store.audit(
        userId,
        null,
        simulated ? "HACKATHON_MFA_SIMULATED_DISABLED" : "MFA_DISABLED",
      );
      return { enabled: false, signInRequired: true };
    });
  }
}

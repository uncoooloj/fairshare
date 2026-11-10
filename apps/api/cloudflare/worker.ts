export { FairshareDocumentParser } from "./parser.js";
import { DurableObject } from "cloudflare:workers";
import { PayPalSandbox } from "@fairshare/payments";
import { cloudflareDocumentReaders } from "./documentReaders.js";
import { buildApp } from "../src/app.js";
import { DurableSqlDatabase } from "../../../packages/cloudflare-storage/src/index.js";

interface Env {
  AUTHORITY: DurableObjectNamespace;
  DOCUMENT_PARSER?: DurableObjectNamespace;
  OCR_ENABLED?: string;
  HACKATHON_MFA_SIMULATION?: string;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_MERCHANT_ID?: string;
  PAYPAL_WEBHOOK_ID?: string;
  PAYPAL_PAYOUTS_ENABLED?: string;
  PAYPAL_PAYOUTS_ELIGIBILITY_CONFIRMED?: string;
  PAYPAL_RECONCILIATION_ENABLED?: string;
  PUBLIC_API_URL?: string;
  PUBLIC_APP_ORIGIN?: string;
  FAIRSHARE_MFA_ENCRYPTION_KEY?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_AI_MODEL?: string;
}
const MAX_BODY_BYTES = 7 * 1024 * 1024;
const ALARM_INTERVAL_MS = 30_000;
async function boundedBody(request: Request): Promise<Uint8Array | undefined> {
  if (!request.body) return undefined;
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
export class FairshareAuthority extends DurableObject<Env> {
  private app: ReturnType<typeof buildApp>;
  private reconciliation: boolean;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const db = new DurableSqlDatabase(ctx.storage);
    const provider =
      env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET && env.PAYPAL_MERCHANT_ID
        ? new PayPalSandbox({
            clientId: env.PAYPAL_CLIENT_ID,
            clientSecret: env.PAYPAL_CLIENT_SECRET,
            merchantId: env.PAYPAL_MERCHANT_ID,
            webhookId: env.PAYPAL_WEBHOOK_ID,
            payoutsEnabled: env.PAYPAL_PAYOUTS_ENABLED === "true",
            payoutsEligibilityConfirmed:
              env.PAYPAL_PAYOUTS_ELIGIBILITY_CONFIRMED === "true",
          })
        : undefined;
    this.reconciliation =
      !!provider && env.PAYPAL_RECONCILIATION_ENABLED === "true";
    this.app = buildApp({
      documentReaders: cloudflareDocumentReaders(
        env.DOCUMENT_PARSER?.get(
          env.DOCUMENT_PARSER.idFromName("fairshare-parser-v1"),
        ),
      ),
      localOcrEnabled: !!env.DOCUMENT_PARSER && env.OCR_ENABLED === "true",
      database: { db, tx: (callback) => db.tx(callback), close() {} },
      hackathonMfaSimulation: env.HACKATHON_MFA_SIMULATION === "true",
      mfaEncryptionKey: env.FAIRSHARE_MFA_ENCRYPTION_KEY,
      publicAppOrigin: env.PUBLIC_APP_ORIGIN,
      payment: {
        provider,
        publicOrigin: env.PUBLIC_API_URL,
        reconciliation: {
          enabled: this.reconciliation,
          externalScheduling: true,
        },
      },
      ai: {
        accountId: env.CLOUDFLARE_ACCOUNT_ID,
        apiToken: env.CLOUDFLARE_API_TOKEN,
        model: env.CLOUDFLARE_AI_MODEL,
      },
    });
    ctx.blockConcurrencyWhile(async () => {
      await this.app;
      if (this.reconciliation && (await ctx.storage.getAlarm()) === null)
        await ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    });
  }
  async alarm(): Promise<void> {
    if (!this.reconciliation) return;
    const app = await this.app;
    try {
      await (app as any).paymentReconciliation.tick();
    } finally {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    }
  }
  async fetch(request: Request): Promise<Response> {
    const app = await this.app;
    const url = new URL(request.url);
    let payload: Uint8Array | undefined;
    try {
      payload = await boundedBody(request);
    } catch {
      return Response.json(
        {
          error: {
            code: "BODY_TOO_LARGE",
            message: "Request exceeds upload limit.",
          },
        },
        {
          status: 413,
          headers: {
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        },
      );
    }
    const response = await app.inject({
      method: request.method as any,
      url: url.pathname + url.search,
      headers: Object.fromEntries(request.headers),
      payload: payload ? Buffer.from(payload) : undefined,
      remoteAddress: request.headers.get("cf-connecting-ip") ?? "unknown",
    });
    const outgoing = new Headers();
    for (const [key, value] of Object.entries(response.headers)) {
      if (value !== undefined)
        outgoing.set(
          key,
          Array.isArray(value) ? value.join(", ") : String(value),
        );
    }
    return new Response(response.rawPayload, {
      status: response.statusCode,
      headers: outgoing,
    });
  }
}
export default {
  fetch(request: Request, env: Env): Promise<Response> {
    // One authority preserves globally unique capture IDs and identity transactions.
    return env.AUTHORITY.get(
      env.AUTHORITY.idFromName("fairshare-sandbox-v1"),
    ).fetch(request);
  },
};

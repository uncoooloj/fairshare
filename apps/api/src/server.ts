import { configuredMailTransport } from "./mail.js";
import { createHash } from "node:crypto";
import { PayPalIdentitySandbox, PayPalSandbox } from "@fairshare/payments";
import { buildApp } from "./app.js";
if (process.env.PAYPAL_ENV === "live")
  throw new Error("Fairshare supports sandbox only.");
const provider =
  process.env.DEMO_MODE !== "true" &&
  process.env.PAYPAL_CLIENT_ID &&
  process.env.PAYPAL_CLIENT_SECRET &&
  process.env.PAYPAL_MERCHANT_ID
    ? new PayPalSandbox({
        clientId: process.env.PAYPAL_CLIENT_ID,
        clientSecret: process.env.PAYPAL_CLIENT_SECRET,
        webhookId: process.env.PAYPAL_WEBHOOK_ID,
        merchantId: process.env.PAYPAL_MERCHANT_ID,
        payoutsEnabled: process.env.PAYPAL_PAYOUTS_ENABLED === "true",
        payoutsEligibilityConfirmed:
          process.env.PAYPAL_PAYOUTS_ELIGIBILITY_CONFIRMED === "true",
      })
    : undefined;
// "Connect with PayPal" uses the same sandbox REST app when "Log in with PayPal"
// is enabled on it; dedicated Identity credentials win when set.
const identityClientId =
  process.env.PAYPAL_IDENTITY_CLIENT_ID || process.env.PAYPAL_CLIENT_ID;
const identityClientSecret =
  process.env.PAYPAL_IDENTITY_CLIENT_SECRET || process.env.PAYPAL_CLIENT_SECRET;
const identityReturnUrl = process.env.PAYPAL_IDENTITY_RETURN_URL;
if (
  identityReturnUrl &&
  !/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/)/.test(
    identityReturnUrl,
  )
)
  throw new Error("PAYPAL_IDENTITY_RETURN_URL must be https (or localhost).");
const paypalIdentity =
  process.env.DEMO_MODE !== "true" &&
  identityClientId &&
  identityClientSecret &&
  identityReturnUrl
    ? {
        provider: new PayPalIdentitySandbox({
          clientId: identityClientId,
          clientSecret: identityClientSecret,
          returnUrl: identityReturnUrl,
        }),
        stateSecret: createHash("sha256")
          .update(`fairshare-paypal-connect-state:${identityClientSecret}`)
          .digest("hex"),
      }
    : undefined;
const mailTransport = configuredMailTransport();
const app = await buildApp({
  mailTransport,
  publicAppOrigin: process.env.PUBLIC_APP_ORIGIN,
  demo: process.env.DEMO_MODE === "true",
  logger: false,
  hackathonMfaSimulation: process.env.HACKATHON_MFA_SIMULATION === "true",
  localOcrEnabled: process.env.LOCAL_OCR_ENABLED === "true",
  paypalIdentity,
  payment: {
    provider,
    automaticPayoutsEnabled:
      process.env.PAYPAL_AUTOMATIC_PAYOUTS_ENABLED === "true",
    publicOrigin: process.env.PUBLIC_API_URL,
    reconciliation: {
      enabled: process.env.PAYPAL_RECONCILIATION_ENABLED === "true",
    },
  },
  ai: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    model: process.env.CLOUDFLARE_AI_MODEL,
    onFailure: (diagnostic) =>
      console.warn("contract_extraction_failed", diagnostic),
  },
});
await app.listen({
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 3001),
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close();
  });

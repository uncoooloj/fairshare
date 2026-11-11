import test from "node:test";
import assert from "node:assert/strict";
import { createSandboxCheckout } from "../lib/checkout-retry";

test("reuses the checkout key when the local payment refresh fails", async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  const requestKeys: string[] = [];
  const createPayment = async (requestKey: string) => {
    requestKeys.push(requestKey);
    return { approval_url: "https://www.sandbox.paypal.com/checkoutnow" };
  };
  const options = {
    storage,
    storageKey: "fairshare-checkout:user:agreement:100",
    amountCents: 100,
    source: { kind: "sandbox" },
    createRequestKey: () => "stable-request-key",
    createPayment,
  };

  await assert.rejects(
    createSandboxCheckout({
      ...options,
      refresh: async () => {
        throw new Error("local payment API unavailable");
      },
    }),
    /local payment API unavailable/,
  );
  assert.equal(storage.getItem(options.storageKey), "stable-request-key");

  await createSandboxCheckout({ ...options, refresh: async () => {} });
  assert.deepEqual(requestKeys, ["stable-request-key", "stable-request-key"]);
  assert.equal(storage.getItem(options.storageKey), null);
});

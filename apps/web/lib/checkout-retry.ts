type CheckoutResponse = { approval_url?: string };

type CheckoutDependencies = {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  storageKey: string;
  amountCents: number;
  createRequestKey: () => string;
  createPayment: (
    requestKey: string,
    amountCents: number,
  ) => Promise<CheckoutResponse>;
  refresh: () => Promise<void>;
};

export async function createSandboxCheckout({
  storage,
  storageKey,
  amountCents,
  createRequestKey,
  createPayment,
  refresh,
}: CheckoutDependencies) {
  const requestKey = storage.getItem(storageKey) || createRequestKey();
  storage.setItem(storageKey, requestKey);
  const payment = await createPayment(requestKey, amountCents);

  // The refreshed payment list is the confirmation shown to the organizer.
  // Keep the key if that refresh fails so the next attempt remains idempotent.
  await refresh();
  if (payment.approval_url) storage.removeItem(storageKey);

  return payment;
}

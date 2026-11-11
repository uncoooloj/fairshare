import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PaymentGridStatus as S,
  paymentStatusLabel,
  payoutGridStatus,
  type PaymentGridRow,
} from "../src/components/paymentGridModel";
import {
  payoutCsv,
  payoutGuidance,
} from "../src/components/payoutPresentation";
import { RECEIVED_DEFINITION, receivedTotals } from "../lib/received";
import {
  PaymentConfirmation,
  PAYMENT_NOT_CONFIGURED_NOTICE,
  PayoutWaitReason,
  WEBHOOK_NOT_CONFIGURED_NOTICE,
  automaticPayoutCopy,
  dispatchSummary,
  paymentConfirmationNotice,
} from "../lib/payment-setup";

const row = (status: S): PaymentGridRow => ({
  id: "k",
  payoutId: "p1",
  agreementId: "a",
  agreementKey: '["w","a"]',
  agreementName: "Album",
  recipientName: "Riley",
  amountCents: 3880,
  currency: "USD",
  status,
});

test("automatic payout statuses show plain labels, never Unknown", () => {
  const cases: [string, string][] = [
    ["WAITING_RECIPIENT", "Waiting for Riley's PayPal email"],
    ["AUTO_HELD", "On hold"],
    ["HELD", "On hold"],
    ["RESERVED", "Ready to send"],
    ["OUTCOME_UNKNOWN", "Checking with PayPal"],
  ];
  for (const [api, label] of cases) {
    const status = payoutGridStatus(api);
    assert.notEqual(status, S.Unknown, api);
    assert.equal(paymentStatusLabel(row(status)), label, api);
  }
  assert.equal(payoutGridStatus("SOMETHING_NEW"), S.Unknown);
  // The payouts page maps through this same function.
  assert.match(
    readFileSync(
      new URL("../components/agreement-widgets.tsx", import.meta.url),
      "utf8",
    ),
    /payoutStatus\(status: string\): PaymentGridStatus \{\s*return payoutGridStatus\(status\);/,
  );
});

test("details guidance and CSV use the same plain labels; uncertain sends say don't resend", () => {
  assert.match(payoutGuidance.WAITING_RECIPIENT, /Nothing has been sent/);
  assert.match(payoutGuidance.CHECKING, /Do not send it again/);
  assert.ok(
    payoutCsv([row(S.WaitingRecipient)]).includes(
      '"Waiting for Riley\'s PayPal email"',
    ),
  );
  const details = readFileSync(
    new URL("../src/components/PayoutDetails.tsx", import.meta.url),
    "utf8",
  );
  assert.match(details, /paymentStatusLabel\(row\)/);
  assert.match(details, /<AllocationCalculation[\s\S]*compact/);
});

test("Received means before PayPal's fee in both the overview and the agreement", () => {
  const totals = receivedTotals([
    { grossCents: 400, feeCents: 47, netCents: 353 },
    { grossCents: 10000, feeCents: 300, netCents: 9700 },
  ]);
  assert.deepEqual(totals, {
    receivedCents: 10400,
    paypalFeeCents: 347,
    afterFeeCents: 10053,
  });
  assert.match(RECEIVED_DEFINITION, /before PayPal’s fee/);
  const source = (f: string) =>
    readFileSync(new URL(`../components/${f}`, import.meta.url), "utf8");
  const overview = source("agreement-widgets.tsx");
  const money = source("agreement-workspace.tsx");
  assert.match(overview, /receivedTotals\(a\.value\.revenue\)\.receivedCents/);
  assert.doesNotMatch(overview, /sum \+ revenue\.netCents/);
  assert.match(money, /receivedTotals\(revenue\)/);
  assert.match(money, />Received</);
  assert.match(money, /PayPal fee/);
});

test("automatic-payout copy comes from the server flag, not hard-coded text", () => {
  const on = automaticPayoutCopy({
    automaticPayouts: true,
    paymentConfirmation: PaymentConfirmation.READY,
  });
  const off = automaticPayoutCopy({
    automaticPayouts: false,
    paymentConfirmation: PaymentConfirmation.READY,
  });
  assert.match(on, /Automatic payouts are on/);
  assert.match(off, /Automatic payouts are off/);
  assert.match(
    automaticPayoutCopy({
      automaticPayouts: false,
      paymentConfirmation: PaymentConfirmation.NOT_CONFIGURED,
    }),
    /can’t be sent/,
  );
  assert.match(
    automaticPayoutCopy({
      automaticPayouts: false,
      payoutsReady: false,
      paymentConfirmation: PaymentConfirmation.READY,
    }),
    /can’t be sent/,
  );
  assert.doesNotMatch(automaticPayoutCopy(null), /Automatic payouts are/);
  const breakdown = readFileSync(
    new URL(
      "../components/sections/agreement-tabs/payment-breakdown.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(breakdown, /scheduling is not enabled/);
  assert.match(breakdown, /automaticPayoutCopy\(setup\)/);
  assert.match(breakdown, /PaymentConfirmation\.NOT_CONFIGURED/);
});

test("organizer sees the webhook warning only when the server reports it", () => {
  assert.equal(
    paymentConfirmationNotice({
      automaticPayouts: false,
      paymentConfirmation: PaymentConfirmation.NOT_CONFIGURED,
    }),
    PAYMENT_NOT_CONFIGURED_NOTICE,
  );
  assert.equal(
    paymentConfirmationNotice({
      automaticPayouts: false,
      paymentConfirmation: PaymentConfirmation.WEBHOOK_NOT_CONFIGURED,
    }),
    WEBHOOK_NOT_CONFIGURED_NOTICE,
  );
  assert.equal(
    WEBHOOK_NOT_CONFIGURED_NOTICE,
    "Payments can’t be confirmed yet: webhook not configured.",
  );
  assert.equal(
    paymentConfirmationNotice({
      automaticPayouts: false,
      paymentConfirmation: PaymentConfirmation.READY,
    }),
    null,
  );
  assert.equal(paymentConfirmationNotice(null), null);
});

test("dispatch summary names who was paid and why others wait", () => {
  const names: Record<string, string> = { m: "Maya", r: "Riley", s: "Sam" };
  assert.equal(
    dispatchSummary(
      [
        { userId: "m", status: "PENDING" },
        {
          userId: "r",
          status: "WAITING_RECIPIENT",
          reason: PayoutWaitReason.NEEDS_PAYOUT_EMAIL,
        },
        { userId: "s", status: "HELD", reason: PayoutWaitReason.ON_HOLD },
      ],
      (id) => names[id],
    ),
    "Sent 1 payout to PayPal. Sending isn’t the same as paid; check each status. Waiting for Riley’s PayPal email. Sam’s payout is on hold.",
  );
});

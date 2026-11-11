import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterPayouts,
  payoutCsv,
  payoutGuidance,
} from "../src/components/payoutPresentation";
import {
  PaymentGridStatus as S,
  type PaymentGridRow,
} from "../src/components/paymentGridModel";
const row: PaymentGridRow = {
  id: '["workspace","agreement","p1"]',
  payoutId: "p1",
  agreementId: "a",
  agreementKey: '["w","a"]',
  agreementName: "Album",
  recipientName: "Riley",
  currency: "USD",
  amountCents: 101,
  status: S.Unknown,
};
test("search and status intersect, without changing source records", () => {
  assert.deepEqual(filterPayouts([row], S.Unknown, "album riley"), [row]);
  assert.deepEqual(filterPayouts([row], S.Paid, "album"), []);
  assert.deepEqual(filterPayouts([row], "", "being checked"), [row]);
  assert.deepEqual(filterPayouts([row], "", "missing"), []);
});
test("CSV preserves exact cents, status, missing evidence and safely quotes formulas", () => {
  const csv = payoutCsv([
    {
      ...row,
      agreementName: '=HYPERLINK("evil")',
      recipientName: "  +formula",
    },
  ]);
  assert.ok(csv.includes('"\'=HYPERLINK(""evil"")"'));
  assert.ok(csv.includes('"\'  +formula"'));
  assert.ok(csv.includes('"1.01","USD","Being checked","",""'));
  assert.ok(!csv.includes("Paid"));
});
test("CSV uses the payout operation ID, never the internal scoped grid key", () => {
  const csv = payoutCsv([row]);
  assert.ok(csv.includes('"p1","Album"'));
  assert.ok(!csv.includes(row.id));
});
test("all payout states have truthful guidance and uncertain transfers prohibit retry", () => {
  assert.equal(Object.keys(payoutGuidance).length, Object.values(S).length);
  assert.match(payoutGuidance.WAITING_RECIPIENT, /recipient’s PayPal details/);
  assert.match(payoutGuidance.FAILED, /payout evidence/);
  assert.doesNotMatch(payoutGuidance.FAILED, /try again|retry|resend/i);
  assert.match(payoutGuidance.UNKNOWN, /Don’t send it again/);
  assert.match(payoutGuidance.REVERSED, /doesn’t count as paid/);
  assert.match(payoutGuidance.UNCLAIMED, /haven’t collected/);
});

test("CSV never loses a cent near the safe integer boundary", () => {
  assert.ok(
    payoutCsv([{ ...row, amountCents: Number.MAX_SAFE_INTEGER }]).includes(
      '"90071992547409.91"',
    ),
  );
});

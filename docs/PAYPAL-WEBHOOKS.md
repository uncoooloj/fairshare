# PayPal webhook handling and recovery

This documents code behavior, not proof that the corresponding revision is
running or that the PayPal app has these subscriptions. Apply code first, then
verify the registered sandbox webhook ID, endpoint and subscriptions. Changing
provider subscriptions, deploying, or resending an event are separate operational
actions. Never create another invoice, capture, refund or payout to retry delivery.

## Required event coverage

`deploy/paypal/webhook-event-types.json` is the explicit event subscription
manifest for Fairshare's invoice, checkout, refund, payout and dispute flows. It
has no endpoint or webhook ID and does not change PayPal configuration by itself.
The planner test checks every manifest entry reaches a real handler. Verify the
app's available event types before applying it: `CHECKOUT.ORDER.COMPLETED` is
listed by PayPal for marketplaces/platforms, and invoice `SENT` availability can
vary between event catalogs. Do not replace an existing subscription with an
unverified partial list or `*`.

| Events                                                                                                         | Implemented behavior                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVOICING.INVOICE.CREATED`, `SENT`, `UPDATED`, `SCHEDULED`, `PAID`, `REFUNDED`, `CANCELLED`                   | Match the reserved provider invoice, read its latest state, verify settlement before allocation, and preserve adverse-event holds. Event amounts never credit revenue. |
| `PAYMENT.CAPTURE.COMPLETED`                                                                                    | Match the reserved order and reconcile fresh capture identity, merchant, amount, currency, reference and fees.                                                         |
| `PAYMENT.CAPTURE.PENDING`, `DECLINED`, `DENIED`, `REFUNDED`, `REVERSED`                                        | Preserve a hold. Refund IDs are not capture IDs: require an explicit trusted parent capture.                                                                           |
| `PAYMENT.SALE.COMPLETED`                                                                                       | Treat an INV2-shaped `invoice_number` only as an invoice lookup hint and verify the invoice and settlement afresh. Unrelated/unmatched sales remain pending.           |
| `PAYMENT.SALE.PENDING`, `DENIED`, `REVERSED`, `REFUNDED`                                                       | Preserve the same settlement holds. A sale refund requires `sale_id` or a verified sandbox sale parent link; never use its refund ID as the sale ID.                   |
| `PAYMENT.REFUND.PENDING`, `FAILED`                                                                             | Read the reserved refund and validate its ID, capture, amount, currency and request reference. Never regress terminal status or release the hold.                      |
| `PAYMENT.PAYOUTSBATCH.DENIED`, `PROCESSING`, `SUCCESS`                                                         | Read matching payout operations and recipient-item results. Batch success never proves a recipient received funds.                                                     |
| `PAYMENT.PAYOUTS-ITEM.BLOCKED`, `CANCELED`, `FAILED`, `HELD`, `REFUNDED`, `RETURNED`, `SUCCEEDED`, `UNCLAIMED` | Reconcile the containing batch using the existing recipient-level checks.                                                                                              |
| `CHECKOUT.ORDER.APPROVED`, `COMPLETED`                                                                         | Read the known order. Approval never triggers a capture write.                                                                                                         |
| `CHECKOUT.PAYMENT-APPROVAL.REVERSED`                                                                           | Hold the order identified by `resource.order_id`; prevent a later capture while unresolved.                                                                            |
| `CUSTOMER.DISPUTE.CREATED`, `UPDATED`, `RESOLVED`                                                              | Hold every identified disputed capture, not just the first. A resolution never automatically releases funds.                                                           |

Unknown types, including plausible names within supported namespaces, are not
handled by wildcard. A verified unknown event is persisted as `PENDING` with
`UNSUPPORTED_WEBHOOK_EVENT` and returns **HTTP 400**. Known events with missing
identity, unknown operations, unverified settlement or temporary provider failures
remain `PENDING` and return **503**. Invalid signatures return **401**, with no
inbox insertion. A processed event returns **200** with its action and `DONE`.

All financial processing is based on fresh matched provider evidence, not event
amounts or presumed ordering. Event handlers issue provider reads only. Allocation
can feed separately configured automatic payouts; run recovery only under the
intended payout configuration. No event clears a review hold or retries an
ambiguous provider money write.

## Retry an event, not the payment

PayPal treats any non-2xx response, including 400 and 503, as unsuccessful delivery
and retries up to 25 times over three days. A previously returned 200 is an
acknowledgment: code changes do not cause PayPal to retry it automatically.

1. Deploy and verify the corrected application revision first.
2. In the PayPal **Sandbox Webhooks Events** dashboard, select the correct app,
   find the original event, inspect its delivery status, and select **Resend**.
   The dashboard searches the last 30 days.
3. Alternatively use the authenticated Webhooks API, targeting the original
   event and the intended webhook ID:

   ```http
   POST https://api-m.sandbox.paypal.com/v1/notifications/webhooks-events/{event_id}/resend
   Content-Type: application/json
   Authorization: Bearer <server-side access token>

   { "webhook_ids": ["<registered webhook ID>"] }
   ```

   The API returns 202 when accepted. Pending notifications are not resent. A 202
   does not prove delivery or successful processing.

4. Verify the delivery response and the resulting invoice/payment/hold state. A
   signed duplicate that is already processed must not add another allocation.
   For a refund or dispute, verify the hold and retained liability instead of
   expecting a new payment.

The app also retries persisted pending events through its reconciliation worker
when that worker is enabled. An unknown event cannot be reinterpreted from its
old action alone: after adding a handler, resend the original signed payload.
The app keeps only a fingerprint and a minimized action, not a raw provider
payload or customer details.

## Previously acknowledged events and later support

Before this change, unhandled event names produced `IGNORE`, were marked `DONE`,
and returned 200. Resending without a repair mechanism would still be a no-op.
The corrected receiver verifies the new delivery signature and checks its
canonical payload fingerprint against the receipt, then replaces a legacy
ignored action with the newly supported plan. It also upgrades a pending
`UNSUPPORTED_WEBHOOK_EVENT` plan when that event type gains a handler. Reusing an
event ID with a changed payload is rejected. Already processed actionable events
are not reopened.

Do not delete inbox rows or clear holds to force replay. A local `DONE` receipt
is not evidence of which HTTP response PayPal actually received; inspect its
delivery record/logs when answering that question.

## Separate manual-payout safety gap

Pending unsupported events conservatively block automatic payouts. The manual
payout dispatcher does not currently inspect these pending unknown-event receipts;
it checks existing agreement and allocation holds. Manual-dispatch changes are
owned by the separate payout-fixes work and are not included here. Do not treat
this PR as closing that manual-path safety gap. Coordinate the corresponding
claim-time guard there before enabling manual payouts with unresolved events.

## Sources and acceptance boundary

- [Official event names](https://developer.paypal.com/api/rest/webhooks/event-names/)
- [Invoice event payloads](https://developer.paypal.com/api/invoicing/webhooks/)
- [Legacy refund parent identity](https://developer.paypal.com/api/deprecated/payments/v1/definitions/detailed_refund)
- [Uncaptured payment reversal shape](https://developer.paypal.com/v5/checkout/uncaptured-payments)
- [Delivery and retry rules](https://developer.paypal.com/api/rest/webhooks/rest/)
- [Event dashboard](https://developer.paypal.com/api/rest/webhooks/events-dashboard/)
- [Resend API](https://developer.paypal.com/api/webhooks/v1/webhooks-events-resend)

Unit and API integration tests use synthetic events and mocked signature/provider
responses. They do not prove actual signed PayPal delivery, the currently
registered subscription list, deployment parity, or recipient receipt.

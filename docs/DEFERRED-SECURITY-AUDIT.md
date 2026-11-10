# Deferred security audit — capture preconditions

## Reproduced and fixed

The capture endpoint previously sent a PayPal capture request before checking whether the agreement was held, its active rules had changed, or a matching adverse webhook was already pending. The later allocation step rejected unsafe allocation, but it was too late to prevent that provider write.

The capture reservation now atomically checks those conditions before entering CAPTURING and before calling the provider. Pending adverse capture events retain their provider order ID where supplied, allowing an exact match before a capture ID has been stored. Unrelated adverse events do not block unrelated orders.

Regression tests demonstrated provider writes before the fix and zero writes after it for held/changed agreements and matched adverse events. This is tested with provider doubles, not actual PayPal acceptance.

## Explicit limits

- A reversal or rule change can still arrive after the request is sent. Existing reconciliation/hold logic remains necessary; a local precondition does not create a distributed transaction with PayPal.
- Events without an identifiable matching order/capture remain pending for operator resolution. The fix does not guess an association.
- No live money, external credentials, or production environment was used.
- This focused audit is not a complete security certification.

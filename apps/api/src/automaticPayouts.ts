import { createHash } from "node:crypto";
import { AllocationStatus, DomainError } from "@fairshare/domain";
import { PayPalError, RecipientType } from "@fairshare/payments";
import type { AggregateStore } from "./fairshare.js";
import type { FairshareApp } from "./app.js";
import type { PaymentProvider } from "./paymentRoutes.js";
import { pendingWebhookBlocksPayout } from "./paymentSafety.js";
import {
  ensurePayoutAccountSchema,
  readPayoutDestination,
} from "./payoutAccounts.js";

/** Only verified, persisted capture allocations enter this queue. A reservation is
 * committed before network I/O; uncertain writes are never automatically retried. */
export function automaticPayouts(
  app: FairshareApp,
  aggregates: AggregateStore,
  provider: PaymentProvider,
) {
  const db = app.store.db;
  ensurePayoutAccountSchema(db);
  function captures() {
    return db.prepare("SELECT * FROM fairshare_captures").all() as any[];
  }
  function discover() {
    return captures().flatMap((capture) => {
      const agreement = aggregates.read(
        capture.workspace_id,
        capture.collaboration_id,
      ).value;
      const revenue = agreement.revenue.find(
        (r) => r.providerCaptureId === capture.provider_capture_id,
      );
      return (revenue?.allocations ?? [])
        .filter((a) => a.totalCents > 0)
        .flatMap((a) => {
          const prior = db
            .prepare(
              "SELECT status FROM fairshare_payout_ops WHERE capture_id=? AND user_id=?",
            )
            .get(capture.provider_capture_id, a.userId) as any;
          return !prior ||
            prior.status === "WAITING_RECIPIENT" ||
            prior.status === "AUTO_HELD"
            ? [
                {
                  kind: "AUTO_PAYOUT",
                  id: JSON.stringify([capture.provider_capture_id, a.userId]),
                },
              ]
            : [];
        });
    });
  }
  async function dispatch(jobId: string, assertLease: () => void) {
    const [captureId, userId] = JSON.parse(jobId) as [string, string];
    const op = app.store.tx(() => {
      assertLease();
      const capture = db
        .prepare("SELECT * FROM fairshare_captures WHERE provider_capture_id=?")
        .get(captureId) as any;
      if (!capture)
        throw new DomainError("NOT_FOUND", "Verified capture required");
      const agreement = aggregates.read(
        capture.workspace_id,
        capture.collaboration_id,
      ).value;
      const revenue = agreement.revenue.find(
        (r) => r.providerCaptureId === captureId,
      );
      const allocation = revenue?.allocations.find((a) => a.userId === userId);
      if (!allocation || allocation.totalCents <= 0) return;
      const prior = db
        .prepare(
          "SELECT * FROM fairshare_payout_ops WHERE capture_id=? AND user_id=?",
        )
        .get(captureId, userId) as any;
      if (prior && !["WAITING_RECIPIENT", "AUTO_HELD"].includes(prior.status))
        return;
      const recipient = readPayoutDestination(db, userId, capture.workspace_id);
      const version = agreement.versions.find(
        (v) => v.id === revenue!.versionId,
      );
      const refund = db
        .prepare(
          "SELECT id FROM fairshare_refund_ops WHERE capture_id=? LIMIT 1",
        )
        .get(captureId);
      const adverse = pendingWebhookBlocksPayout(db, capture);
      const held =
        agreement.reviewHold ||
        allocation.status !== AllocationStatus.ALLOCATED ||
        refund ||
        adverse ||
        !version ||
        !agreement.members.every((m) =>
          Object.hasOwn(version.approvals, m.userId),
        );
      const ready = recipient !== null;
      const status = held
        ? "AUTO_HELD"
        : ready
          ? "SUBMITTING"
          : "WAITING_RECIPIENT";
      const id = createHash("sha256")
        .update(`${captureId}:${userId}`)
        .digest("hex")
        .slice(0, 30);
      db.prepare(
        "INSERT INTO fairshare_payout_ops(id,workspace_id,collaboration_id,capture_id,user_id,recipient_type,recipient_id,amount,status) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(capture_id,user_id) DO UPDATE SET recipient_type=excluded.recipient_type,recipient_id=excluded.recipient_id,status=excluded.status",
      ).run(
        id,
        capture.workspace_id,
        capture.collaboration_id,
        captureId,
        userId,
        recipient?.type ?? RecipientType.PAYPAL_ID,
        recipient?.value ?? "",
        allocation.totalCents,
        status,
      );
      if (status !== "SUBMITTING") return;
      app.store.audit(
        "system",
        capture.workspace_id,
        "AUTOMATIC_PAYOUT_RESERVED",
        { payoutId: id, agreementId: capture.collaboration_id },
      );
      return db
        .prepare("SELECT * FROM fairshare_payout_ops WHERE id=?")
        .get(id) as any;
    });
    if (!op) return;
    // No await between the transactional eligibility check and provider invocation.
    let result;
    try {
      result = await provider.createPayout({
        requestId: op.id,
        recipientType: op.recipient_type,
        recipientId: op.recipient_id,
        amountCents: op.amount,
        currency: "USD",
      });
    } catch (error) {
      assertLease();
      if (
        error instanceof PayPalError &&
        error.code === "PAYOUT_NOT_CONFIGURED"
      ) {
        db.prepare(
          "UPDATE fairshare_payout_ops SET status='AUTO_HELD' WHERE id=? AND status='SUBMITTING'",
        ).run(op.id);
        app.store.audit("system", op.workspace_id, "PAYOUT_AUTOMATIC_HELD", {
          payoutId: op.id,
        });
        return;
      }
      db.prepare(
        "UPDATE fairshare_payout_ops SET status='OUTCOME_UNKNOWN' WHERE id=? AND status='SUBMITTING'",
      ).run(op.id);
      app.store.audit("system", op.workspace_id, "PAYOUT_OUTCOME_UNKNOWN", {
        payoutId: op.id,
      });
      return;
    }
    assertLease();
    db.prepare(
      "UPDATE fairshare_payout_ops SET batch_id=?,status='PENDING' WHERE id=? AND status='SUBMITTING'",
    ).run(result.batchId, op.id);
    app.store.audit("system", op.workspace_id, "PAYOUT_SUBMITTED", {
      payoutId: op.id,
      agreementId: op.collaboration_id,
    });
  }
  return { discover, dispatch };
}

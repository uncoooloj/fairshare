import type { Database } from "./database.js";

type AgreementScope = { workspace_id: string; collaboration_id: string };
type EventScope = {
  unscoped: boolean;
  unresolved: boolean;
  captureIds: string[];
  agreements: AgreementScope[];
};

const identifier = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 256;

/** References come only from the verified inbox, never from a recovery request.
 * An unmatched, explicit ID still identifies what to hold. Missing/ambiguous IDs
 * do not prove independence and keep the conservative, system-wide hold. */
export function webhookScope(db: Database, action: any): EventScope {
  const scope: EventScope = {
    unscoped: false,
    unresolved: false,
    captureIds: [],
    agreements: [],
  };
  const references: { table: string; column: string; value: string }[] = [];
  const add = (table: string, column: string, value: unknown) => {
    if (identifier(value)) references.push({ table, column, value });
    else if (value !== undefined) scope.unscoped = true;
  };
  const capture = (value: unknown) => {
    if (identifier(value)) scope.captureIds.push(value);
    add("fairshare_captures", "provider_capture_id", value);
  };
  if (!action || typeof action !== "object" || Array.isArray(action)) {
    scope.unscoped = true;
    return scope;
  }
  switch (action.kind) {
    case "HOLD_CAPTURE":
    case "HoldCapture": {
      const refund = [
        "PAYMENT.CAPTURE.REFUNDED",
        "PAYMENT.SALE.REFUNDED",
      ].includes(action.eventType);
      // A legacy refund plan used the refund ID as the capture ID. Only a new
      // verified plan with explicit capture provenance can narrow that hold.
      if (
        refund &&
        !["related_id", "parent_link"].includes(action.captureProvenance)
      ) {
        if (!identifier(action.orderId)) scope.unscoped = true;
      } else if (action.providerIds !== undefined) {
        if (
          !Array.isArray(action.providerIds) ||
          !action.providerIds.length ||
          !action.providerIds.every(identifier)
        )
          scope.unscoped = true;
        else action.providerIds.forEach(capture);
      } else capture(action.providerId);
      add("fairshare_payment_ops", "provider_order_id", action.orderId);
      break;
    }
    case "RECONCILE_CAPTURE":
    case "RECONCILE_ORDER":
      add("fairshare_payment_ops", "provider_order_id", action.orderId);
      add("fairshare_invoices", "provider_id", action.invoiceId);
      break;
    case "RECONCILE_INVOICE":
      add("fairshare_invoices", "provider_id", action.providerId);
      break;
    case "RECONCILE_REFUND":
      add("fairshare_refund_ops", "provider_refund_id", action.providerId);
      break;
    case "RECONCILE_PAYOUT":
      add("fairshare_payout_ops", "batch_id", action.providerId);
      break;
    default:
      scope.unscoped = true;
  }
  if (!references.length) scope.unscoped = true;
  for (const ref of references) {
    const matches = db
      .prepare(
        `SELECT workspace_id,collaboration_id FROM ${ref.table} WHERE ${ref.column}=?`,
      )
      .all(ref.value) as AgreementScope[];
    if (!matches.length) scope.unresolved = true;
    for (const match of matches) {
      if (
        !scope.agreements.some(
          (s) =>
            s.workspace_id === match.workspace_id &&
            s.collaboration_id === match.collaboration_id,
        )
      )
        scope.agreements.push(match);
    }
  }
  return scope;
}

export function pendingWebhookBlocksPayout(
  db: Database,
  target: AgreementScope & { provider_capture_id: string },
): boolean {
  return db
    .prepare(
      "SELECT action FROM fairshare_webhook_inbox WHERE status='PENDING'",
    )
    .all()
    .some((entry) => {
      try {
        const action = JSON.parse(entry.action);
        if (!action || typeof action !== "object" || Array.isArray(action))
          return true;
        if (action.reason === "UNSUPPORTED_WEBHOOK_EVENT") return true;
        if (
          ![
            "HOLD_CAPTURE",
            "HoldCapture",
            "RECONCILE_CAPTURE",
            "RECONCILE_ORDER",
            "RECONCILE_INVOICE",
            "RECONCILE_REFUND",
            "RECONCILE_PAYOUT",
            "RECORD_UNMATCHED",
            "IGNORE",
          ].includes(action.kind)
        )
          return true;
        const adverse =
          [
            "HOLD_CAPTURE",
            "HoldCapture",
            "RECONCILE_INVOICE",
            "RECONCILE_REFUND",
          ].includes(action.kind) ||
          (action.kind === "RECORD_UNMATCHED" &&
            (action.eventType?.startsWith("INVOICING.") ||
              action.eventType?.startsWith("PAYMENT.REFUND.")));
        if (!adverse) return false;
        const scope = webhookScope(db, action);
        return (
          scope.unscoped ||
          scope.captureIds.includes(target.provider_capture_id) ||
          scope.agreements.some(
            (s) =>
              s.workspace_id === target.workspace_id &&
              s.collaboration_id === target.collaboration_id,
          )
        );
      } catch {
        return true;
      }
    });
}

/** A PayPal event still waiting to be checked that is about this agreement: linked to it, or
 * naming one of its payments. Events that cannot be linked to any agreement still stop payouts
 * (pendingWebhookBlocksPayout) but do not block resuming every agreement. */
export function pendingWebhookForAgreement(
  db: Database,
  target: AgreementScope,
): boolean {
  const captures = new Set(
    (
      db
        .prepare(
          "SELECT provider_capture_id FROM fairshare_captures WHERE workspace_id=? AND collaboration_id=?",
        )
        .all(target.workspace_id, target.collaboration_id) as any[]
    ).map((r) => r.provider_capture_id as string),
  );
  return db
    .prepare(
      "SELECT action FROM fairshare_webhook_inbox WHERE status='PENDING'",
    )
    .all()
    .some((entry) => {
      try {
        const scope = webhookScope(db, JSON.parse(entry.action));
        return (
          scope.captureIds.some((id) => captures.has(id)) ||
          scope.agreements.some(
            (s) =>
              s.workspace_id === target.workspace_id &&
              s.collaboration_id === target.collaboration_id,
          )
        );
      } catch {
        return false;
      }
    });
}

/** Never expose or replay an event involving another agreement or an unknown
 * target through an agreement organizer's recovery endpoint. */
export function webhookBelongsOnlyTo(
  db: Database,
  action: any,
  target: AgreementScope,
): boolean {
  const scope = webhookScope(db, action);
  return (
    !scope.unscoped &&
    !scope.unresolved &&
    scope.agreements.length === 1 &&
    scope.agreements[0].workspace_id === target.workspace_id &&
    scope.agreements[0].collaboration_id === target.collaboration_id
  );
}

export function payoutWasNeverSubmitted(op: {
  status: string;
  batch_id: unknown;
  item_id: unknown;
}): boolean {
  return (
    ["WAITING_RECIPIENT", "AUTO_HELD", "RESERVED", "HELD"].includes(
      op.status,
    ) &&
    op.batch_id === null &&
    op.item_id === null
  );
}

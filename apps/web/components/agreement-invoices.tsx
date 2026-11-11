"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/model";
import {
  safeInvoiceUrl,
  invoiceStatusLabel,
  invoiceMoney,
  type Invoice,
  type InvoiceDetails,
} from "../lib/invoice";
import { InvoiceForm } from "./invoice-form";
import { Button, Notice } from "./ui";

export function AgreementInvoices({
  base,
  agreementName,
  userId,
  canCreate,
  onReconciled,
}: {
  base: string;
  agreementName: string;
  userId: string;
  canCreate: boolean;
  onReconciled?: () => Promise<void>;
}) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [checking, setChecking] = useState<string | null>(null);
  const mounted = useRef(true);
  const checkingLock = useRef(false);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  async function refresh() {
    const result = await api<{ invoices: Invoice[] }>(`${base}/invoices`);
    if (mounted.current) setInvoices(result.invoices);
  }
  useEffect(() => {
    mounted.current = true;
    refresh()
      .catch((cause) => setError(cause.message))
      .finally(() => setLoading(false));
    return () => {
      mounted.current = false;
    };
  }, [base]);
  async function createInvoice(details: InvoiceDetails) {
    const storageKey = `fairshare-invoice:${userId}:${base}:${JSON.stringify(details)}`;
    const requestKey =
      sessionStorage.getItem(storageKey) || crypto.randomUUID();
    sessionStorage.setItem(storageKey, requestKey);
    const { invoice } = await api<{ invoice: Invoice }>(
      `${base}/invoices`,
      "POST",
      { ...details, requestKey },
    );
    if (!invoice?.id)
      throw new Error(
        "No invoice confirmation received. Retry with the same details to check this request.",
      );
    setInvoices((current) => [
      invoice,
      ...current.filter((item) => item.id !== invoice.id),
    ]);
    // Retain the key for incomplete/uncertain requests, including browser refreshes.
    if (invoice.status === "SHARED" && safeInvoiceUrl(invoice.shareUrl)) {
      sessionStorage.removeItem(storageKey);
      setCreating(false);
      setNotice(
        "Invoice ready. Copy the link and share it with your customer. No email was sent.",
      );
      requestAnimationFrame(() => resultHeading.current?.focus());
    } else {
      throw new Error(
        "Invoice recorded, but its payment link is not ready. Check status below before trying again.",
      );
    }
  }
  return (
    <section aria-label="Agreement invoices">
      <div className="actions">
        <h3 ref={resultHeading} tabIndex={-1}>
          Invoices
        </h3>
        {canCreate && !creating && (
          <Button
            onClick={() => {
              setCreating(true);
              setNotice("");
            }}
          >
            Create invoice
          </Button>
        )}
      </div>
      <p className="muted">
        Request payment against this agreement, then share a payment link with
        your customer.
      </p>
      <p className="muted">
        PayPal reporting an invoice paid is not a verified allocation. Shares
        are allocated only after capture amounts and actual PayPal fees are
        verified. Manual or external payments are not allocated. Refunds can
        place the agreement on hold for review.
      </p>
      {notice && (
        <div role="status">
          <Notice>{notice}</Notice>
        </div>
      )}
      {error && (
        <div role="alert">
          <Notice warning>{error}</Notice>
          <Button
            variant="quiet"
            onClick={() => {
              setError("");
              refresh().catch((cause) => setError(cause.message));
            }}
          >
            Try again
          </Button>
        </div>
      )}
      {creating && (
        <InvoiceForm
          agreementName={agreementName}
          onSubmit={createInvoice}
          onCancel={() => setCreating(false)}
        />
      )}
      {loading ? (
        <p role="status">Loading invoices…</p>
      ) : !invoices.length ? (
        <p className="muted">
          No invoices yet. Create an invoice to request a payment.
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Invoice total</th>
                <th>Paid at PayPal</th>
                <th>Balance due</th>
                <th>Due</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td>
                    {invoice.customerName}
                    <br />
                    <small>{invoice.description}</small>
                  </td>
                  <td>{invoiceMoney(invoice.amountCents, invoice.currency)}</td>
                  <td>
                    {invoiceMoney(invoice.paidAmountCents, invoice.currency)}
                  </td>
                  <td>
                    {invoiceMoney(invoice.dueAmountCents, invoice.currency)}
                  </td>
                  <td>{invoice.dueDate}</td>
                  <td>
                    <InvoiceStatus invoice={invoice} />
                  </td>
                  <td>
                    <div className="actions">
                      {safeInvoiceUrl(invoice.shareUrl) && (
                        <>
                          <a
                            href={invoice.shareUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open invoice ↗
                          </a>
                          <Button
                            variant="quiet"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(
                                  invoice.shareUrl!,
                                );
                                setNotice("Invoice link copied.");
                              } catch {
                                setError(
                                  "Could not copy. Open the invoice and copy its address instead.",
                                );
                              }
                            }}
                          >
                            Copy link
                          </Button>
                        </>
                      )}
                      {canCreate && (
                        <Button
                          variant="quiet"
                          disabled={checking !== null}
                          onClick={async () => {
                            if (checkingLock.current) return;
                            checkingLock.current = true;
                            setChecking(invoice.id);
                            setError("");
                            try {
                              const result = await api<{ invoice: Invoice }>(
                                `${base}/invoices/${invoice.id}/reconcile`,
                                "POST",
                                {},
                              );
                              setInvoices((current) =>
                                current.map((item) =>
                                  item.id === invoice.id
                                    ? result.invoice
                                    : item,
                                ),
                              );
                              await onReconciled?.();
                            } catch (cause) {
                              setError(
                                cause instanceof Error
                                  ? cause.message
                                  : "Unable to check invoice.",
                              );
                            } finally {
                              checkingLock.current = false;
                              setChecking(null);
                            }
                          }}
                        >
                          {checking === invoice.id
                            ? "Checking…"
                            : "Check status"}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function InvoiceStatus({ invoice }: { invoice: Invoice }) {
  return (
    <>
      <span>
        {invoice.settlementStatus === "HELD" && invoice.status === "PAID"
          ? "Payment on hold · review required"
          : invoiceStatusLabel(invoice.status)}
      </span>
      <br />
      <small>PayPal: {invoice.providerStatus || "Not checked"}</small>
      <br />
      <small>
        Settlement:{" "}
        {invoice.settlementStatus === "VERIFIED"
          ? "Verified"
          : invoice.settlementStatus === "HELD"
            ? "On hold · review required"
            : "Unverified · no verified allocation"}
      </small>
      {invoice.settlementError && <p>{invoice.settlementError}</p>}
      {invoice.paidDate && (
        <>
          <br />
          <small>PayPal payment date: {invoice.paidDate}</small>
        </>
      )}
      {invoice.checkedAt && (
        <>
          <br />
          <small>Last checked: {invoice.checkedAt}</small>
        </>
      )}
    </>
  );
}

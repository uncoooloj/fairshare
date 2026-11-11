"use client";
import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/model";
import {
  safeInvoiceUrl,
  invoiceChip,
  invoiceDay,
  invoiceMoney,
  invoiceSplitLabel,
  invoiceStatusLabel,
  type Invoice,
  type InvoiceDetails,
} from "../lib/invoice";
import { formatExact } from "../lib/dates";
import { statusLabel } from "../lib/status-labels";
import { InvoiceForm } from "./invoice-form";
import { RowMenu, Tip, type RowMenuItem } from "./row-menu";
import { Button, Notice } from "./ui";

/** The few facts about splitting invoice money that people actually need. */
export const INVOICE_SPLIT_FACTS = [
  "A payment is split once PayPal confirms the amount and its fee.",
  "Money paid outside PayPal isn’t split.",
  "A refund pauses payouts until it’s sorted.",
];

export function AgreementInvoices({
  base,
  agreementName,
  userId,
  canCreate,
  onReconciled,
  intro = "Bill someone and share the link. When it’s paid, it’s split automatically.",
}: {
  intro?: string;
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
        "We didn’t hear back. Try again with the same details; you won’t be billed twice.",
      );
    setInvoices((current) => [
      invoice,
      ...current.filter((item) => item.id !== invoice.id),
    ]);
    // Retain the key for incomplete/uncertain requests, including browser refreshes.
    if (invoice.status === "SHARED" && safeInvoiceUrl(invoice.shareUrl)) {
      sessionStorage.removeItem(storageKey);
      setCreating(false);
      setNotice("Invoice ready. Copy the link and send it to your customer.");
      requestAnimationFrame(() => resultHeading.current?.focus());
    } else {
      throw new Error(
        "The invoice is saved but its link isn’t ready. Check status before trying again.",
      );
    }
  }
  async function checkStatus(invoice: Invoice) {
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
        current.map((item) => (item.id === invoice.id ? result.invoice : item)),
      );
      await onReconciled?.();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to check invoice.",
      );
    } finally {
      checkingLock.current = false;
      setChecking(null);
    }
  }
  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setNotice("Invoice link copied.");
    } catch {
      setError(
        "Could not copy. Open the invoice and copy its address instead.",
      );
    }
  }
  /** Row overflow items; shaped like the shared ActionMenu's items. */
  function menuItems(invoice: Invoice): RowMenuItem[] {
    const items: RowMenuItem[] = [];
    if (safeInvoiceUrl(invoice.shareUrl)) {
      const url = invoice.shareUrl;
      items.push({
        id: "open",
        label: "Open invoice ↗",
        onSelect: () => window.open(url, "_blank", "noopener,noreferrer"),
      });
    }
    if (canCreate)
      items.push({
        id: "check",
        label: checking === invoice.id ? "Checking…" : "Check status",
        disabled: checking !== null,
        onSelect: () => void checkStatus(invoice),
      });
    return items;
  }
  return (
    <section className="ag-invoices" aria-label="Agreement invoices">
      <header className="ag-invoices-head">
        <div>
          <div className="ag-invoices-title">
            <h2 ref={resultHeading} tabIndex={-1}>
              Invoices
            </h2>
            <Tip
              className="ag-info"
              label="How invoice payments are split"
              trigger={<span aria-hidden="true">i</span>}
            >
              {INVOICE_SPLIT_FACTS.join(" ")}
            </Tip>
          </div>
          <p className="muted">{intro}</p>
        </div>
        {canCreate && !creating && (
          <Button
            variant="secondary"
            onClick={() => {
              setCreating(true);
              setNotice("");
            }}
          >
            Create invoice
          </Button>
        )}
      </header>
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
        <p className="muted ag-invoices-empty">No invoices yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="ag-invoices-table">
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col" className="numeric">
                  Amount
                </th>
                <th scope="col" className="numeric">
                  Paid
                </th>
                <th scope="col" className="numeric">
                  Balance
                </th>
                <th scope="col">Due</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td>
                    {invoice.customerName}
                    <small className="ag-invoice-note">
                      {invoice.description}
                    </small>
                  </td>
                  <td className="numeric">
                    {invoiceMoney(invoice.amountCents, invoice.currency)}
                  </td>
                  <td className="numeric">
                    {invoiceMoney(invoice.paidAmountCents, invoice.currency)}
                  </td>
                  <td className="numeric">
                    {invoiceMoney(invoice.dueAmountCents, invoice.currency)}
                  </td>
                  <td className="ag-invoice-due">
                    {invoiceDay(invoice.dueDate)}
                  </td>
                  <td>
                    <InvoiceStatus invoice={invoice} />
                  </td>
                  <td>
                    <div className="ag-row-actions">
                      {safeInvoiceUrl(invoice.shareUrl) && (
                        <Button
                          variant="quiet"
                          onClick={() => copyLink(invoice.shareUrl!)}
                        >
                          Copy link
                        </Button>
                      )}
                      <RowMenu
                        label={`More for ${invoice.customerName}’s invoice`}
                        items={menuItems(invoice)}
                      />
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

/** One chip; what PayPal said, when it was paid and when we last looked sit in its tooltip. */
export function InvoiceStatus({ invoice }: { invoice: Invoice }) {
  const chip = invoiceChip(invoice);
  // The invoice's own state, without the split claim the chip makes.
  const state =
    invoice.status === "PAID" ? "Paid" : invoiceStatusLabel(invoice.status);
  const checked = formatExact(invoice.checkedAt ?? undefined);
  return (
    <Tip
      className="ag-invoice-status"
      trigger={
        <span className={`status-chip ${chip.tone}`.trim()}>{chip.label}</span>
      }
    >
      <span className="tip-lines">
        {!chip.label.startsWith(state) && <span>Invoice: {state}</span>}
        <span>
          PayPal says:{" "}
          {invoice.providerStatus
            ? statusLabel(invoice.providerStatus)
            : "Not checked yet"}
        </span>
        <span>{invoiceSplitLabel(invoice.settlementStatus)}</span>
        {invoice.settlementError && <span>{invoice.settlementError}</span>}
        {invoice.paidDate && <span>Paid {invoiceDay(invoice.paidDate)}</span>}
        {checked && <span>Last checked {checked}</span>}
      </span>
    </Tip>
  );
}

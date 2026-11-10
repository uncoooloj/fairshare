"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Field, Notice } from "./ui";
import { validateInvoice, type InvoiceDetails } from "../lib/invoice";

/** Preview is local. Only Generate invoice authorizes a provider write. */
export function InvoiceForm({
  agreementName,
  onSubmit,
  onCancel,
}: {
  agreementName: string;
  onSubmit: (details: InvoiceDetails) => Promise<void>;
  onCancel: () => void;
}) {
  const [details, setDetails] = useState({
    customerName: "",
    customerEmail: "",
    description: "",
    amount: "",
    dueDate: "",
  });
  const [preview, setPreview] = useState<InvoiceDetails | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const name = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const target = preview ? heading.current : name.current;
    target?.focus();
    target?.scrollIntoView?.({ block: "nearest", behavior: "auto" });
  }, [preview]);
  const update = (key: keyof typeof details, value: string) =>
    setDetails((current) => ({ ...current, [key]: value }));
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending.current) return;
        setError("");
        try {
          const validated = validateInvoice(details);
          if (!preview) {
            setPreview(validated);
            return;
          }
          pending.current = true;
          setBusy(true);
          await onSubmit(validated);
        } catch (cause) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to generate invoice. Your details are still here.",
          );
        } finally {
          pending.current = false;
          setBusy(false);
        }
      }}
    >
      {error && (
        <div role="alert">
          <Notice warning>{error}</Notice>
        </div>
      )}
      <fieldset disabled={busy}>
        {!preview ? (
          <>
            <h3>Create invoice</h3>
            <p className="muted">
              Request payment for {agreementName}. Share the link yourself; no
              email will be sent.
            </p>
            <Field label="Customer name">
              <input
                ref={name}
                value={details.customerName}
                onChange={(e) => update("customerName", e.target.value)}
                autoComplete="name"
                required
                maxLength={100}
              />
            </Field>
            <Field label="Customer email">
              <input
                type="email"
                value={details.customerEmail}
                onChange={(e) => update("customerEmail", e.target.value)}
                autoComplete="email"
                required
                maxLength={254}
              />
            </Field>
            <Field label="What is this invoice for?">
              <textarea
                value={details.description}
                onChange={(e) => update("description", e.target.value)}
                placeholder="For example, November licensing revenue"
                required
                maxLength={500}
              />
            </Field>
            <Field label="Amount (USD)">
              <input
                value={details.amount}
                onChange={(e) => update("amount", e.target.value)}
                inputMode="decimal"
                pattern="[0-9]+([.][0-9]{1,2})?"
                required
                placeholder="0.00"
              />
            </Field>
            <Field label="Due date">
              <input
                type="date"
                value={details.dueDate}
                onChange={(e) => update("dueDate", e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
                required
              />
            </Field>
          </>
        ) : (
          <section aria-label="Invoice preview">
            <h3 ref={heading} tabIndex={-1}>
              Review invoice
            </h3>
            <dl>
              <dt>Agreement</dt>
              <dd>{agreementName}</dd>
              <dt>Bill to</dt>
              <dd>
                {preview.customerName}
                <br />
                {preview.customerEmail}
              </dd>
              <dt>Description</dt>
              <dd>{preview.description}</dd>
              <dt>Total</dt>
              <dd>
                {(preview.amountCents / 100).toLocaleString("en-US", {
                  style: "currency",
                  currency: "USD",
                })}{" "}
                USD
              </dd>
              <dt>Due date</dt>
              <dd>{preview.dueDate}</dd>
            </dl>
            <p className="muted">
              Generate a PayPal payment link to copy and share. An invoice is
              not a payment; revenue is recorded only after payment is verified.
            </p>
          </section>
        )}
        <div className="actions">
          <Button type="submit" disabled={busy}>
            {busy
              ? "Generating invoice…"
              : preview
                ? "Generate invoice"
                : "Review invoice"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => (preview ? setPreview(null) : onCancel())}
          >
            {preview ? "Edit details" : "Cancel"}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

"use client";
import { useRef, useState } from "react";
import { Button } from "./ui";

export interface CheckoutSource {
  type: "PAYPAL" | "OTHER";
  name: string;
}

export function SandboxCheckoutForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (amount: string, source: CheckoutSource) => Promise<void>;
}) {
  const [type, setType] = useState<CheckoutSource["type"]>("PAYPAL");
  const pending = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || pending.current) return;
        const values = new FormData(event.currentTarget);
        const name =
          type === "PAYPAL"
            ? "PayPal"
            : String(values.get("sourceName") || "").trim();
        if (!name) return;
        pending.current = true;
        setSubmitting(true);
        try {
          await onSubmit(String(values.get("amount") || ""), { type, name });
        } finally {
          pending.current = false;
          setSubmitting(false);
        }
      }}
    >
      <fieldset disabled={busy || submitting}>
        <label>
          Sandbox checkout amount (USD)
          <input name="amount" required inputMode="decimal" />
        </label>
        <label>
          Source label
          <select
            name="sourceType"
            value={type}
            onChange={(event) =>
              setType(event.target.value as CheckoutSource["type"])
            }
          >
            <option value="PAYPAL">PayPal</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        {type === "OTHER" && (
          <label>
            Source name
            <input
              name="sourceName"
              required
              maxLength={100}
              placeholder="For example, Bandcamp"
            />
          </label>
        )}
        <p className="muted">
          Source is a label for your records. Every checkout here still uses
          PayPal sandbox; this does not import or confirm external revenue.
        </p>
        <Button type="submit" disabled={busy || submitting}>
          {submitting ? "Creating checkout…" : "Create sandbox checkout"}
        </Button>
      </fieldset>
    </form>
  );
}

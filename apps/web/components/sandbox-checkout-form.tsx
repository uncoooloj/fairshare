'use client';
import { useEffect, useRef, useState } from 'react';
import { Button, Notice } from './ui';
import { parseCents } from '../lib/model';

export interface CheckoutSource { type: 'PAYPAL' | 'OTHER'; name: string }

/** Review is local only. Only the final submit requests a checkout from the API. */
export function SandboxCheckoutForm({ busy, onSubmit }: {
  busy: boolean;
  onSubmit: (amount: string, source: CheckoutSource) => Promise<void>;
}) {
  const [type, setType] = useState<CheckoutSource['type']>('PAYPAL');
  const [amount, setAmount] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const amountInput = useRef<HTMLInputElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) { moved.current = true; return; }
    const target = reviewing ? heading.current : amountInput.current;
    target?.focus();
    target?.scrollIntoView?.({ behavior: 'auto', block: 'nearest' });
  }, [reviewing]);
  const name = type === 'PAYPAL' ? 'PayPal' : sourceName.trim();
  return <form onSubmit={async event => {
    event.preventDefault();
    if (busy || pending.current) return;
    if (!name) return;
    setError('');
    try { const cents=parseCents(amount); if(cents<1||cents>1_000_000)throw new Error('Enter a sandbox amount from $0.01 to $10,000.00.'); if(name.length>100||/[\x00-\x1f\x7f]/.test(name))throw new Error('Use a source name of 1–100 printable characters.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Enter a valid USD amount.'); return; }
    if (!reviewing) { setReviewing(true); return; }
    pending.current = true;
    setSubmitting(true);
    try { await onSubmit(amount, { type, name }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to create checkout. Your details are still here.'); }
    finally { pending.current = false; setSubmitting(false); }
  }}>
    {error && <div role="alert"><Notice warning>{error}</Notice></div>}
    <fieldset disabled={busy || submitting}>
      {!reviewing ? <>
        <label>Sandbox checkout amount (USD)<input ref={amountInput} name="amount" required inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" title="Enter a USD amount with up to two decimal places" value={amount} onChange={event => setAmount(event.target.value)} /></label>
        <label>Source label<select name="sourceType" value={type} onChange={event => setType(event.target.value as CheckoutSource['type'])}>
          <option value="PAYPAL">PayPal</option><option value="OTHER">Other</option>
        </select></label>
        {type === 'OTHER' && <label>Source name<input name="sourceName" required maxLength={100} placeholder="For example, Bandcamp" value={sourceName} onChange={event => setSourceName(event.target.value)} /></label>}
      </> : <section aria-label="Review checkout">
        <h4 ref={heading} tabIndex={-1}>Review checkout</h4>
        <dl><dt>Amount</dt><dd>{amount} USD</dd><dt>Source label</dt><dd>{name}</dd></dl>
        <p>Next, open PayPal to approve the sandbox payment. Creating a checkout does not mean a payment has been completed.</p>
        <Button type="button" variant="secondary" onClick={() => setReviewing(false)}>Edit checkout details</Button>
      </section>}
      <p className="muted">Source is a label for your records. Every checkout here still uses PayPal sandbox; this does not import or confirm external revenue.</p>
      <Button type="submit" disabled={busy || submitting}>{submitting ? 'Creating checkout…' : reviewing ? 'Create sandbox checkout' : 'Review checkout'}</Button>
    </fieldset>
  </form>;
}

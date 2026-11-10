"use client";

import { useMemo, useState, useId } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
} from "ag-grid-community";
import {
  PaymentGridStatus,
  formatPaymentAmount,
  paymentStatusLabels,
  validatePaymentRows,
  type PaymentGridRow,
} from "./paymentGridModel";

import { summarizePayouts } from "./payoutSummary";
import styles from "./payouts.module.css";

ModuleRegistry.registerModules([AllCommunityModule]);
const theme = themeQuartz.withParams({
  accentColor: "var(--color-brand)",
  backgroundColor: "#ffffff",
  foregroundColor: "var(--color-ink)",
  borderColor: "var(--color-line)",
  headerBackgroundColor: "var(--color-surface)",
  fontFamily: "inherit",
  fontSize: 14,
  headerFontSize: 12,
  rowHeight: 58,
  headerHeight: 44,
  wrapperBorderRadius: 12,
});
export interface PaymentGridProps {
  rows: readonly PaymentGridRow[];
  loading?: boolean;
  error?: string;
  /** Parent controls navigation; no sensitive data or actions are embedded in URLs. */
  onOpenAgreement?: (agreementId: string) => void;
}
/** Community-only grid. No enterprise modules, licensing, trial or provider writes. */
export function PaymentGrid({
  rows,
  loading = false,
  error,
  onOpenAgreement,
}: PaymentGridProps) {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const statusId = useId();
  const [status, setStatus] = useState<PaymentGridStatus | "">("");
  const data = useMemo(() => {
    try {
      return { rows: validatePaymentRows(rows), summary: summarizePayouts(rows), invalid: false };
    } catch {
      return { rows: [] as PaymentGridRow[], summary: summarizePayouts([]), invalid: true };
    }
  }, [rows]);
  const filteredRows = useMemo(() => data.rows.filter(row => !status || row.status === status), [data.rows, status]);
  const columns = useMemo<ColDef<PaymentGridRow>[]>(
    () => [
      {
        field: "agreementName",
        headerName: "Agreement",
        minWidth: 210,
        flex: 1.5,
        cellRenderer: ({ data: row }: { data?: PaymentGridRow }) =>
          row && onOpenAgreement ? (
            <button
              type="button"
              onClick={() => onOpenAgreement(row.agreementId)}
              style={{
                border: 0,
                padding: 0,
                background: "none",
                color: "var(--color-brand)",
                textDecoration: "underline",
                cursor: "pointer",
                font: "inherit",
              }}
            >
              {row.agreementName}
            </button>
          ) : (
            (row?.agreementName ?? "")
          ),
      },
      {
        field: "recipientName",
        headerName: "Person",
        minWidth: 180,
        flex: 1,
      },
      {
        field: "amountCents",
        headerName: "Amount (USD)",
        minWidth: 150,
        type: "numericColumn",
        filter: "agNumberColumnFilter",
        valueGetter: (p) => (p.data ? p.data.amountCents / 100 : null),
        valueFormatter: (p) =>
          p.data
            ? formatPaymentAmount(p.data.amountCents, p.data.currency)
            : "",
      },
      {
        field: "status",
        headerName: "Status",
        minWidth: 185,
        cellRenderer: ({ data: row }: { data?: PaymentGridRow }) => row ? <span className={styles.status} data-status={row.status}>{paymentStatusLabels[row.status]}</span> : null,
        valueFormatter: (p) =>
          p.data ? paymentStatusLabels[p.data.status] : "",
        filterValueGetter: (p) =>
          p.data ? paymentStatusLabels[p.data.status] : "",
      },
      {
        field: "createdAt",
        headerName: "Created",
        minWidth: 170,
        sort: "desc",
        comparator: (a?: string, b?: string) =>
          (a ? Date.parse(a) : 0) - (b ? Date.parse(b) : 0),
        valueFormatter: (p) =>
          p.value
            ? new Date(p.value).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })
            : "Not recorded",
      },
      {
        field: "providerReference",
        headerName: "Provider reference",
        minWidth: 185,
      },
    ],
    [onOpenAgreement],
  );
  if (error || data.invalid)
    return (
      <div role="alert">
        Payments could not be displayed. Refresh to try again.
      </div>
    );
  return (
    <section aria-label="Payout history">
      <div className={styles.summary} aria-label="Recorded payout totals">
        {([
          ['Paid out', data.summary.paid, data.summary.paidCount, 'Provider-confirmed payouts'],
          ['Pending or processing', data.summary.processing, data.summary.processingCount, 'Not yet completed transfers'],
          ['Needs attention', data.summary.attention, data.summary.attentionCount, 'Failed, held, unclaimed or uncertain'],
        ] as const).map(([label, amount, count, detail]) => <div className={styles.card} key={label}>
          <span className={styles.label}>{label}</span>
          <strong className={styles.amount}>{loading ? '—' : formatPaymentAmount(amount, 'USD')}</strong>
          <span className={styles.caption}>{loading ? 'Loading…' : `${count} payouts · ${detail}`}</span>
        </div>)}
      </div>
      <div className={styles.toolbar}>
        <label className={styles.field} htmlFor={searchId}>Search payouts
          <input id={searchId} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Agreement, person or reference" />
        </label>
        <label className={styles.field} htmlFor={statusId}>Status
          <select id={statusId} value={status} onChange={event => setStatus(event.target.value as PaymentGridStatus | '')}>
            <option value="">All statuses</option>
            {Object.values(PaymentGridStatus).map(value => <option key={value} value={value}>{paymentStatusLabels[value]}</option>)}
          </select>
        </label>
        <span className={styles.count} aria-live="polite">{loading ? 'Loading payouts…' : `${data.rows.length} recorded payouts`}</span>
      </div>
      <div style={{ height: 460, width: "100%" }}>
        <AgGridReact<PaymentGridRow>
          theme={theme}
          rowData={filteredRows}
          columnDefs={columns}
          defaultColDef={{ sortable: true, filter: true, resizable: true }}
          getRowId={(p) => p.data.id}
          quickFilterText={query}
          loading={loading}
          pagination
          paginationPageSize={20}
          paginationPageSizeSelector={[20, 50, 100]}
          overlayNoRowsTemplate="<span>No payouts to display. Payouts appear after submission; try clearing your filters.</span>"
          suppressCellFocus={false}
          ensureDomOrder
          onGridReady={(event) =>
            event.api.setGridAriaProperty("label", "Agreement payout history")
          }
        />
      </div>
      <p style={{ fontSize: 12, color: "var(--color-muted)" }}>
        Totals cover all recorded payouts, not a monthly period. Amounts follow the approved agreement. On-hold and pending entries are
        not completed transfers.
      </p>
    </section>
  );
}

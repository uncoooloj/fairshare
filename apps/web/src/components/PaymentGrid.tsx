"use client";

import { useMemo, useState, useId, type ReactNode } from "react";
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
import { filterPayouts, payoutCsv } from "./payoutPresentation";
import { PayoutDetails } from "./PayoutDetails";
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
  title?: string;
  description?: string;
  emptyActions?: ReactNode;
  error?: string;
  /** Parent controls navigation; no sensitive data or actions are embedded in URLs. */
  onOpenAgreement?: (agreementKey: string) => void;
}
/** Community-only grid. No enterprise modules, licensing, trial or provider writes. */
export function PaymentGrid({
  rows,
  loading = false,
  title,
  description,
  emptyActions,
  error,
  onOpenAgreement,
}: PaymentGridProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const searchId = useId();
  const statusId = useId();
  const [status, setStatus] = useState<PaymentGridStatus | "">("");
  const data = useMemo(() => {
    try {
      return {
        rows: validatePaymentRows(rows),
        summary: summarizePayouts(rows),
        invalid: false,
      };
    } catch {
      return {
        rows: [] as PaymentGridRow[],
        summary: summarizePayouts([]),
        invalid: true,
      };
    }
  }, [rows]);
  const filteredRows = useMemo(
    () => filterPayouts(data.rows, status, query),
    [data.rows, status, query],
  );
  const selected = !loading
    ? data.rows.find((row) => row.id === selectedId)
    : undefined;
  function exportCsv() {
    const url = URL.createObjectURL(
      new Blob([payoutCsv(filteredRows)], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "fairshare-payouts.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
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
              onClick={() => onOpenAgreement(row.agreementKey)}
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
        cellRenderer: ({ data: row }: { data?: PaymentGridRow }) =>
          row ? (
            <span className={styles.status} data-status={row.status}>
              {paymentStatusLabels[row.status]}
            </span>
          ) : null,
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
        headerName: "Details",
        minWidth: 100,
        width: 110,
        sortable: false,
        filter: false,
        cellRenderer: ({ data: row }: { data?: PaymentGridRow }) =>
          row ? (
            <button
              type="button"
              className={styles.control}
              aria-label={`View payout to ${row.recipientName}`}
              onClick={() => setSelectedId(row.id)}
            >
              View
            </button>
          ) : null,
      },
      {
        field: "providerReference",
        headerName: "PayPal reference",
        minWidth: 185,
      },
    ],
    [onOpenAgreement],
  );
  if (error || data.invalid)
    return (
      <div role="alert">
        Couldn’t load payouts. Refresh the page; don’t send anything again.
      </div>
    );
  return (
    <section aria-label="Payout history" aria-busy={loading}>
      {title && (
        <header className={styles.header}>
          <div>
            <h1>{title}</h1>
            {description && <p>{description}</p>}
          </div>
          <button
            className={styles.control}
            type="button"
            onClick={exportCsv}
            disabled={loading || !filteredRows.length}
          >
            Export CSV
          </button>
        </header>
      )}
      <div className={styles.summary} aria-label="Recorded payout totals">
        {(
          [
            [
              "Paid out",
              data.summary.paid,
              data.summary.paidCount,
              "Confirmed by PayPal",
            ],
            [
              "Pending or processing",
              data.summary.processing,
              data.summary.processingCount,
              "On the way",
            ],
            [
              "Needs attention",
              data.summary.attention,
              data.summary.attentionCount,
              "Failed, paused, not collected or missing PayPal details",
            ],
          ] as const
        ).map(([label, amount, count, detail]) => (
          <div className={styles.card} key={label}>
            <span className={styles.label}>{label}</span>
            <strong className={styles.amount}>
              {loading ? "—" : formatPaymentAmount(amount, "USD")}
            </strong>
            <span className={styles.caption}>
              {loading ? "Loading…" : `${count} payouts · ${detail}`}
            </span>
          </div>
        ))}
      </div>
      <div className={styles.toolbar}>
        <label className={styles.field} htmlFor={searchId}>
          Search payouts
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Agreement, person or reference"
          />
        </label>
        <label className={styles.field} htmlFor={statusId}>
          Status
          <select
            id={statusId}
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as PaymentGridStatus | "")
            }
          >
            <option value="">All statuses</option>
            {Object.values(PaymentGridStatus).map((value) => (
              <option key={value} value={value}>
                {paymentStatusLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <span className={styles.count} aria-live="polite">
          {loading
            ? "Loading payouts…"
            : `${filteredRows.length} of ${data.rows.length} payouts`}
        </span>
        {(query || status) && (
          <button
            className={styles.control}
            type="button"
            onClick={() => {
              setQuery("");
              setStatus("");
            }}
          >
            Clear filters
          </button>
        )}
        {!title && (
          <button
            className={styles.control}
            type="button"
            onClick={exportCsv}
            disabled={loading || !filteredRows.length}
          >
            Export CSV
          </button>
        )}
      </div>
      {!loading && !data.rows.length ? (
        <div className={styles.empty}>
          <h3>No payouts yet</h3>
          <p>When you pay people, it shows up here.</p>
          {emptyActions && (
            <div className={styles.emptyActions}>{emptyActions}</div>
          )}
        </div>
      ) : !loading && !filteredRows.length ? (
        <div className={styles.empty} role="status">
          <h3>No matching payouts</h3>
          <p>Try another search, or clear your filters.</p>
          <button
            className={styles.control}
            type="button"
            onClick={() => {
              setQuery("");
              setStatus("");
            }}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div style={{ height: 460, width: "100%" }}>
          <AgGridReact<PaymentGridRow>
            theme={theme}
            rowData={loading ? [] : filteredRows}
            columnDefs={columns}
            defaultColDef={{ sortable: true, filter: false, resizable: true }}
            getRowId={(p) => p.data.id}
            loading={loading}
            pagination
            paginationPageSize={20}
            paginationPageSizeSelector={[20, 50, 100]}
            overlayNoRowsTemplate="<span>No payouts match. Try clearing your filters.</span>"
            suppressCellFocus={false}
            ensureDomOrder
            onGridReady={(event) =>
              event.api.setGridAriaProperty("label", "Agreement payout history")
            }
          />
        </div>
      )}
      {selected && (
        <PayoutDetails
          row={selected}
          onClose={() => setSelectedId(null)}
          onOpenAgreement={onOpenAgreement}
        />
      )}
      <p style={{ fontSize: 12, color: "var(--color-muted)" }}>
        Totals are for all time.
      </p>
    </section>
  );
}

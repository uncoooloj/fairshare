"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type GridApi,
} from "ag-grid-community";
import {
  PaymentGridStatus,
  formatPaymentAmount,
  paymentStatusLabel,
  paymentStatusLabels,
  validatePaymentRows,
  type PaymentGridRow,
} from "./paymentGridModel";

import { payoutCards, payoutCount, summarizePayouts } from "./payoutSummary";
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
/** Above this many rows the grid pages; at or below it, no pagination shows at all. */
export const PAYOUT_PAGE_SIZE = 20;
const NO_DATE_HINT = "No date was recorded for this payout.";
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
  const gridApiRef = useRef<GridApi<PaymentGridRow> | null>(null);
  const searchId = useId();
  const statusId = useId();
  const tipId = useId();
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
  // One readout only: AG Grid's pager when there are pages, our count otherwise.
  const paginated = !loading && filteredRows.length > PAYOUT_PAGE_SIZE;
  useEffect(() => {
    const api = gridApiRef.current;
    if (!api) return;

    // External filtering replaces rowData. Update the pagination option and
    // reset the page in place so the grid keeps sorting and column state.
    api.setGridOption("pagination", paginated);
    api.paginationGoToFirstPage();
  }, [filteredRows.length, paginated, query, status]);
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
        cellClass: styles.cell,
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
        cellClass: styles.cell,
        cellRenderer: ({ data: row }: { data?: PaymentGridRow }) =>
          row ? (
            <span className={styles.status} data-status={row.status}>
              {paymentStatusLabel(row)}
            </span>
          ) : null,
        valueFormatter: (p) => (p.data ? paymentStatusLabel(p.data) : ""),
        filterValueGetter: (p) => (p.data ? paymentStatusLabel(p.data) : ""),
      },
      {
        field: "createdAt",
        headerName: "Created",
        minWidth: 170,
        sort: "desc",
        comparator: (a?: string, b?: string) =>
          (a ? Date.parse(a) : 0) - (b ? Date.parse(b) : 0),
        cellClass: styles.cell,
        valueFormatter: (p) =>
          p.value
            ? new Date(p.value).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })
            : "—",
        // The API stores no payout timestamp yet; say so instead of guessing.
        cellRenderer: (p: {
          value?: string;
          valueFormatted?: string | null;
        }) =>
          p.value ? (
            p.valueFormatted
          ) : (
            <span title={NO_DATE_HINT}>
              <span aria-hidden="true">—</span>
              <span className={styles.srOnly}>{NO_DATE_HINT}</span>
            </span>
          ),
      },
      {
        headerName: "Details",
        minWidth: 100,
        width: 110,
        sortable: false,
        filter: false,
        cellClass: styles.cell,
        cellRenderer: ({ data: row }: { data?: PaymentGridRow }) =>
          row ? (
            <button
              type="button"
              className={`${styles.control} ${styles.cellButton}`}
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
        {payoutCards(data.summary).map((card) => (
          <div className={styles.card} key={card.kind}>
            <span className={styles.label}>
              {card.label}
              <span className={styles.info}>
                <button
                  type="button"
                  className={styles.infoButton}
                  aria-label={`About ${card.label}`}
                  aria-describedby={`${tipId}-${card.kind}`}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <circle cx="8" cy="8" r="6.5" />
                    <path d="M8 7.2v3.8M8 5h.01" />
                  </svg>
                </button>
                <span
                  role="tooltip"
                  id={`${tipId}-${card.kind}`}
                  className={styles.tooltip}
                >
                  {card.explanation}
                </span>
              </span>
            </span>
            <strong className={styles.amount}>
              {loading ? "—" : formatPaymentAmount(card.amountCents, "USD")}
            </strong>
            <span className={styles.caption}>
              {loading ? "Loading…" : card.caption}
            </span>
          </div>
        ))}
      </div>
      <p className={styles.totalsNote}>Totals are for all time.</p>
      {(loading || data.rows.length > 0) && (
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
          {!paginated && (
            <span className={styles.count} aria-live="polite">
              {loading
                ? "Loading payouts…"
                : filteredRows.length === data.rows.length
                  ? payoutCount(data.rows.length)
                  : `${filteredRows.length} of ${payoutCount(data.rows.length)}`}
            </span>
          )}
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
      )}
      {!loading && !data.rows.length ? (
        <div className={styles.empty}>
          <svg
            className={styles.emptyIcon}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <rect x="3" y="6" width="18" height="13" rx="2.5" />
            <path d="M3 10h18M7 15h3" />
          </svg>
          <h3>No payouts yet</h3>
          <p>When a payment splits, each person's payout shows here.</p>
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
        <div className={styles.grid}>
          <AgGridReact<PaymentGridRow>
            theme={theme}
            rowData={loading ? [] : filteredRows}
            columnDefs={columns}
            defaultColDef={{ sortable: true, filter: false, resizable: true }}
            getRowId={(p) => p.data.id}
            loading={loading}
            domLayout="autoHeight"
            pagination={paginated}
            paginationPageSize={PAYOUT_PAGE_SIZE}
            paginationPageSizeSelector={false}
            overlayNoRowsTemplate="<span>No payouts match. Try clearing your filters.</span>"
            suppressCellFocus={false}
            ensureDomOrder
            onGridReady={(event) => {
              gridApiRef.current = event.api;
              event.api.setGridAriaProperty("label", "Agreement payout history");
              event.api.setGridOption("pagination", paginated);
              event.api.paginationGoToFirstPage();
            }}
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
    </section>
  );
}

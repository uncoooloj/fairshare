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
  formatPaymentAmount,
  paymentStatusLabels,
  validatePaymentRows,
  type PaymentGridRow,
} from "./paymentGridModel";

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
  const data = useMemo(() => {
    try {
      return { rows: validatePaymentRows(rows), invalid: false };
    } catch {
      return { rows: [] as PaymentGridRow[], invalid: true };
    }
  }, [rows]);
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
        headerName: "Recipient",
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
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <label htmlFor={searchId}>Search payouts</label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Agreement, recipient or reference"
          style={{
            minWidth: 260,
            padding: "10px 12px",
            border: "1px solid var(--color-line)",
            borderRadius: 8,
          }}
        />
        <span
          aria-live="polite"
          style={{ color: "var(--color-muted)", fontSize: 13 }}
        >
          {loading ? "Loading payouts…" : `${data.rows.length} payouts`}
        </span>
      </div>
      <div style={{ height: 460, width: "100%" }}>
        <AgGridReact<PaymentGridRow>
          theme={theme}
          rowData={data.rows}
          columnDefs={columns}
          defaultColDef={{ sortable: true, filter: true, resizable: true }}
          getRowId={(p) => p.data.id}
          quickFilterText={query}
          loading={loading}
          pagination
          paginationPageSize={20}
          paginationPageSizeSelector={[20, 50, 100]}
          overlayNoRowsTemplate="<span>No payouts yet. They will appear here after an allocation is submitted for payout.</span>"
          suppressCellFocus={false}
          ensureDomOrder
          onGridReady={(event) =>
            event.api.setGridAriaProperty("label", "Agreement payout history")
          }
        />
      </div>
      <p style={{ fontSize: 12, color: "var(--color-muted)" }}>
        Amounts follow the approved agreement. On-hold and pending entries are
        not completed transfers.
      </p>
    </section>
  );
}

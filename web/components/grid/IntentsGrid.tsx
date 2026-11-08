"use client";

// AG Grid table of intents. Client-only: loaded with next/dynamic and ssr:false.
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
} from "ag-grid-community";
import { LicenseManager } from "ag-grid-enterprise";
import { AgGridReact } from "ag-grid-react";
import { useMemo } from "react";

import { formatMoney } from "../../lib/money";
import { getPublicEnv } from "../../lib/publicEnv";
import type { Intent } from "../../lib/types";
import { RiskMeter, StatusPill } from "../ui/Badge";

ModuleRegistry.registerModules([AllCommunityModule]);
const licenseKey = getPublicEnv().agGridLicenseKey;
if (licenseKey) LicenseManager.setLicenseKey(licenseKey);

/**
 * Grid theme wired to the CSS variables in globals.css, so it follows the
 * light/dark switch with no JS (browserColorScheme "inherit" uses <html>).
 */
export const gridTheme = themeQuartz.withParams({
  backgroundColor: "var(--surface)",
  foregroundColor: "var(--text)",
  accentColor: "var(--brand)",
  borderColor: "var(--border)",
  headerBackgroundColor: "var(--raised)",
  headerTextColor: "var(--text-2)",
  headerFontWeight: 600,
  rowHoverColor: "var(--hover)",
  selectedRowBackgroundColor: "var(--brand-tint)",
  chromeBackgroundColor: "var(--surface)",
  browserColorScheme: "inherit",
  fontFamily: "inherit",
  fontSize: 13,
  borderRadius: 10,
  wrapperBorderRadius: 0,
});
export default function IntentsGrid({
  rows,
  onSelect,
}: {
  rows: Intent[];
  onSelect: (id: string) => void;
}) {
  const columns = useMemo<ColDef<Intent>[]>(
    () => [
      {
        field: "createdAt",
        headerName: "Created",
        sort: "desc",
        valueFormatter: (p) =>
          p.value ? new Date(String(p.value)).toLocaleString() : "",
        minWidth: 170,
        cellClass: "num",
      },
      {
        field: "state",
        headerName: "State",
        minWidth: 130,
        cellRenderer: (p: ICellRendererParams<Intent>) =>
          p.value ? <StatusPill status={String(p.value)} /> : null,
      },
      {
        field: "decision",
        headerName: "Decision",
        minWidth: 120,
        cellRenderer: (p: ICellRendererParams<Intent>) =>
          p.value ? <StatusPill status={String(p.value)} /> : "-",
      },
      {
        field: "amountCents",
        headerName: "Amount",
        type: "rightAligned",
        cellClass: "num",
        minWidth: 110,
        // Integer cents -> display only; sorting uses the integer value.
        valueFormatter: (p) =>
          p.data
            ? formatMoney({
                amountCents: p.data.amountCents,
                currency: p.data.currency,
              })
            : "",
      },
      { field: "payee", headerName: "Payee", minWidth: 160, flex: 1 },
      { field: "category", headerName: "Category", minWidth: 110 },
      {
        field: "riskScore",
        headerName: "Risk",
        minWidth: 130,
        cellRenderer: (p: ICellRendererParams<Intent>) => (
          <RiskMeter score={p.data?.riskScore} compact />
        ),
      },
      { field: "agentId", headerName: "Agent", minWidth: 140 },
    ],
    []
  );

  return (
    <div className="grid-wrap">
      <AgGridReact<Intent>
        theme={gridTheme}
        rowData={rows}
        columnDefs={columns}
        defaultColDef={{ sortable: true, resizable: true }}
        getRowId={(p) => p.data.id}
        rowSelection={{
          mode: "singleRow",
          checkboxes: false,
          enableClickSelection: true,
        }}
        onRowClicked={(e) => e.data && onSelect(e.data.id)}
        onCellKeyDown={(e) => {
          const key = (e.event as KeyboardEvent | undefined)?.key;
          if (key === "Enter" && e.data) onSelect(e.data.id);
        }}
        overlayNoRowsTemplate="No intents for this filter"
      />
    </div>
  );
}

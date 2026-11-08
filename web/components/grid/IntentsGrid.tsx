"use client";

// AG Grid table of intents. Client-only: loaded with next/dynamic and ssr:false.
import {
  AllCommunityModule,
  ModuleRegistry,
  colorSchemeDark,
  themeQuartz,
  type ColDef,
} from "ag-grid-community";
import { LicenseManager } from "ag-grid-enterprise";
import { AgGridReact } from "ag-grid-react";
import { useMemo } from "react";

import { formatMoney } from "../../lib/money";
import { getPublicEnv } from "../../lib/publicEnv";
import type { Intent } from "../../lib/types";

ModuleRegistry.registerModules([AllCommunityModule]);
const licenseKey = getPublicEnv().agGridLicenseKey;
if (licenseKey) LicenseManager.setLicenseKey(licenseKey);

/** Dark theme matching globals.css. */
export const gridTheme = themeQuartz.withPart(colorSchemeDark).withParams({
  backgroundColor: "#1b1d21",
  foregroundColor: "#f2f2f2",
  accentColor: "#8ab4ff",
  borderColor: "#3a3a3a",
  headerBackgroundColor: "#23262b",
  fontFamily: "inherit",
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
      },
      { field: "state", headerName: "State", minWidth: 110 },
      {
        field: "decision",
        headerName: "Decision",
        minWidth: 110,
        valueFormatter: (p) => (p.value ? String(p.value) : "-"),
      },
      {
        field: "amountCents",
        headerName: "Amount",
        type: "rightAligned",
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
        minWidth: 80,
        valueFormatter: (p) =>
          p.value === null || p.value === undefined ? "-" : String(p.value),
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

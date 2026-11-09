"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useOwnerData } from "../../lib/client/useOwnerData";
import { missingPublicEnv } from "../../lib/publicEnv";
import { INTENT_STATES, type Intent } from "../../lib/types";
import { EnvNotice } from "../EnvNotice";
import { useLive } from "../live/LiveProvider";
import { PageHeader } from "../ui/PageHeader";
import { Skeleton } from "../ui/Skeleton";
import { Toast } from "../ui/Toast";
import { IntentDetailEmpty, IntentDetailPanel } from "./IntentDetail";

// AG Grid touches the DOM at import time, so it never renders on the server.
const IntentsGrid = dynamic(() => import("../grid/IntentsGrid"), {
  ssr: false,
  loading: () => (
    <div className="grid-wrap" role="status">
      <span className="sr-only">Loading table</span>
      <Skeleton width="100%" height="100%" />
    </div>
  ),
});

export function Intents() {
  const { version } = useLive();
  const [state, setState] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const path = `owner/intents?limit=200${state ? `&state=${encodeURIComponent(state)}` : ""}`;
  const { data, error } = useOwnerData<{ intents: Intent[] }>(path, version);
  const missing = missingPublicEnv().filter(
    (n) => n === "NEXT_PUBLIC_AG_GRID_LICENSE_KEY"
  );

  return (
    <div className="stack">
      <PageHeader
        title="Intents"
        description="Every purchase request your agents have made, with the Risk Guard outcome."
        actions={
          <label htmlFor="state-filter" style={{ minWidth: "12rem" }}>
            Filter by state
            <select
              id="state-filter"
              value={state}
              onChange={(e) => setState(e.target.value)}
            >
              <option value="">All states</option>
              {INTENT_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        }
      />
      <EnvNotice names={missing} />
      <Toast message={error ? `Could not load intents: ${error}` : null} />
      <div className="split">
        <IntentsGrid rows={data?.intents ?? []} onSelect={setSelected} />
        <div>
          {selected ? (
            <IntentDetailPanel id={selected} version={version} />
          ) : (
            <IntentDetailEmpty />
          )}
        </div>
      </div>
    </div>
  );
}

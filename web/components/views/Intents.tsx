"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { useOwnerData } from "../../lib/client/useOwnerData";
import { missingPublicEnv } from "../../lib/publicEnv";
import { INTENT_STATES, type Intent } from "../../lib/types";
import { EnvNotice } from "../EnvNotice";
import { useLive } from "../live/LiveProvider";
import { IntentDetailPanel } from "./IntentDetail";

// AG Grid touches the DOM at import time, so it never renders on the server.
const IntentsGrid = dynamic(() => import("../grid/IntentsGrid"), {
  ssr: false,
  loading: () => <p className="muted">Loading table</p>,
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
      <h1>Intents</h1>
      <EnvNotice names={missing} />
      <label htmlFor="state-filter" style={{ maxWidth: "16rem" }}>
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
      {error ? (
        <p role="alert" className="notice error">
          Could not load intents: {error}
        </p>
      ) : null}
      <div className="split">
        <IntentsGrid rows={data?.intents ?? []} onSelect={setSelected} />
        <div>
          {selected ? (
            <IntentDetailPanel id={selected} version={version} />
          ) : (
            <p className="muted">
              Select a row to see its details and audit events.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

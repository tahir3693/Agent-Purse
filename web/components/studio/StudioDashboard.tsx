"use client";

// AG Studio dashboard (spec-09b). Client-only: loaded through next/dynamic with
// ssr:false by StudioView. Custom AgentPurse widgets, dark theme, a saved
// default layout, and a READ-ONLY assistant whose adapter talks to the BFF.
import {
  AgStudioAiModule,
  createAiHarness,
  directLlmRunner,
  studioTheme,
  type AgAiHarnessSetup,
  type AgStudioApi,
  type AgWidgetsConfig,
} from "ag-studio";
import { AgStudio, AgStudioProvider, createWidgets } from "ag-studio-react";
import { RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { createAssistantAdapter } from "../../lib/assistant/adapter";
import { owner } from "../../lib/client/api";
import { toStudioRows } from "../../lib/studio/aggregate";
import {
  DEFAULT_STATE,
  loadSavedState,
  resetSavedState,
  saveState,
} from "../../lib/studio/layout";
import { createOwnerStore } from "../../lib/studio/ownerStore";
import { buildIntentsSource } from "../../lib/studio/schema";
import { useLive } from "../live/LiveProvider";
import { Button } from "../ui/Button";
import { AP_WIDGETS, type StudioContext } from "./widgets";

/**
 * Studio theme wired to the CSS variables in globals.css, so it follows the
 * light/dark switch (browserColorScheme "inherit" reads <html>).
 */
export const apStudioTheme = studioTheme.withParams({
  backgroundColor: "var(--bg)",
  foregroundColor: "var(--text)",
  accentColor: "var(--brand)",
  borderColor: "var(--border)",
  fontFamily: "inherit",
  browserColorScheme: "inherit",
});

const PROMPT_STARTERS = [
  {
    label: "Why escalated?",
    prompt:
      "Which of my purchases are waiting for approval, and why were they escalated?",
  },
  {
    label: "Spend today",
    prompt:
      "How much have my agents spent today, and how many purchases were denied?",
  },
  { label: "My policies", prompt: "Summarise each agent's spending policy." },
];

const adapter = createAssistantAdapter({ endpoint: "/api/assistant" });

// READ-ONLY: the agent has no Studio tools (cannot change the dashboard) and the
// server-side tools only read owner data. Instructions here are display-only;
// the API uses its own system prompt.
const ai: AgAiHarnessSetup = ({ api }) =>
  // The setup callback is typed with the core API; it is the full Studio API at runtime.
  createAiHarness(api as unknown as AgStudioApi, () => ({
    agents: [
      directLlmRunner({
        id: "analyst",
        name: "AgentPurse assistant",
        description:
          "Answers questions about your agents, spend and Risk Guard decisions. Read-only.",
        adapter,
        schema: (s) => s.undefined(),
        instructions: () => "Read-only AgentPurse analyst.",
        tools: () => [],
        maxTurns: 2,
      }),
    ],
    primary: "analyst",
    promptStarters: PROMPT_STARTERS,
  }));

const storage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

export default function StudioDashboard({
  licenseKey,
}: {
  licenseKey: string;
}) {
  const { version } = useLive();
  // Captured from onApiReady (the documented way to reach the Studio API).
  const apiRef = useRef<{ setState(state: never): void } | null>(null);
  const store = useMemo(
    () => createOwnerStore((path, init) => owner(path, init)),
    []
  );
  const context = useMemo<StudioContext>(() => ({ store }), [store]);
  const [rows, setRows] = useState(() =>
    toStudioRows(store.getSnapshot().intents)
  );
  const [notice, setNotice] = useState("");
  const initialState = useMemo(() => loadSavedState(storage()) as never, []);

  useEffect(() => {
    void store.refresh();
  }, [store, version]);
  useEffect(
    () =>
      store.subscribe(() => setRows(toStudioRows(store.getSnapshot().intents))),
    [store]
  );

  // Custom widget types are not in the default registry typing, so the config is
  // cast once here; the widget components themselves are fully typed.
  const widgets = useMemo(
    () =>
      createWidgets({
        additionalTypes: [...AP_WIDGETS],
        menu: [{ label: "AgentPurse", widgetIds: AP_WIDGETS.map((w) => w.id) }],
      } as never) as AgWidgetsConfig,
    []
  );
  const data = useMemo(() => ({ sources: [buildIntentsSource(rows)] }), [rows]);

  return (
    <div className="stack">
      <div className="row">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            resetSavedState(storage());
            apiRef.current?.setState(DEFAULT_STATE as never);
            setNotice("Layout reset to the default.");
          }}
        >
          <RotateCcw size={16} aria-hidden="true" />
          Reset layout
        </Button>
        <span role="status" aria-live="polite" className="form-status">
          {notice}
        </span>
      </div>
      <div className="studio-frame">
        <AgStudioProvider modules={[AgStudioAiModule]} licenseKey={licenseKey}>
          <AgStudio
            style={{ height: "100%", width: "100%" }}
            data={data}
            mode="edit"
            theme={apStudioTheme}
            initialState={initialState}
            widgets={widgets}
            context={context}
            ai={ai}
            onApiReady={(e) => {
              apiRef.current = e.api as unknown as {
                setState(state: never): void;
              };
            }}
            onStateUpdated={(e) => saveState(storage(), e.api.getState())}
          />
        </AgStudioProvider>
      </div>
    </div>
  );
}

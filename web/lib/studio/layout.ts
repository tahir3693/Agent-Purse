// Default Studio layout and its localStorage persistence (spec-09b).
export const LAYOUT_KEY = "ap-studio-layout-v1";

export const INTENT_GRID_COLUMNS = [
  "createdAt",
  "state",
  "decision",
  "amountCents",
  "currency",
  "payee",
  "category",
  "riskScore",
];

export const DEFAULT_STATE = {
  pages: [
    {
      id: "overview",
      widgets: {
        spend: {
          type: "ap-spend-per-day",
          dataMapping: {},
          format: { title: { enabled: true, text: "Spend per day" } },
        },
        decisions: {
          type: "ap-decisions",
          dataMapping: {},
          format: { title: { enabled: true, text: "Decisions" } },
        },
        queue: {
          type: "ap-escalation-queue",
          dataMapping: {},
          format: { title: { enabled: true, text: "Escalation queue" } },
        },
        grid: {
          type: "grid",
          dataMapping: {
            cols: INTENT_GRID_COLUMNS.map((c) => ({ id: `intents.${c}` })),
          },
          format: {
            title: { enabled: true, text: "Intents (amounts in cents)" },
          },
        },
      },
      widgetLayout: {
        spend: { xTrack: 0, yTrack: 0, xSpan: 14, ySpan: 14 },
        decisions: { xTrack: 14, yTrack: 0, xSpan: 10, ySpan: 14 },
        queue: { xTrack: 0, yTrack: 14, xSpan: 24, ySpan: 16 },
        grid: { xTrack: 0, yTrack: 30, xSpan: 24, ySpan: 20 },
      },
    },
  ],
  selectedPageId: "overview",
  panels: { filters: { collapsed: true } },
} as const;

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Saved state if it is well-formed, otherwise the default. Never throws. */
export function loadSavedState(storage: StorageLike | null): unknown {
  if (!storage) return DEFAULT_STATE;
  try {
    const raw = storage.getItem(LAYOUT_KEY);
    if (!raw || raw.length > 500_000) return DEFAULT_STATE;
    const v = JSON.parse(raw) as unknown;
    if (!isObj(v) || !Array.isArray(v["pages"]) || v["pages"].length === 0)
      return DEFAULT_STATE;
    if (!v["pages"].every((p) => isObj(p) && typeof p["id"] === "string"))
      return DEFAULT_STATE;
    return v;
  } catch {
    return DEFAULT_STATE;
  }
}

export function saveState(storage: StorageLike | null, state: unknown): void {
  if (!storage) return;
  try {
    storage.setItem(LAYOUT_KEY, JSON.stringify(state));
  } catch {
    // quota or privacy mode: layout simply is not persisted
  }
}

export function resetSavedState(storage: StorageLike | null): void {
  try {
    storage?.removeItem(LAYOUT_KEY);
  } catch {
    // ignore
  }
}

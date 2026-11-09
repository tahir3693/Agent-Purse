// Default Studio layout and its localStorage persistence (spec-09b).
import { INTENT_FIELD_IDS } from "./schema";

// v2: v1 states could reference fields the schema did not define.
export const LAYOUT_KEY = "ap-studio-layout-v2";

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

/** Every field id referenced by a widget `dataMapping` anywhere in a layout state. */
export function layoutFieldIds(state: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown, inMapping: boolean): void => {
    if (Array.isArray(v)) return v.forEach((x) => walk(x, inMapping));
    if (typeof v !== "object" || v === null) return;
    for (const [k, val] of Object.entries(v)) {
      if (inMapping && k === "id" && typeof val === "string") out.push(val);
      else walk(val, inMapping || k === "dataMapping");
    }
  };
  walk(state, false);
  return out;
}

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
    // A saved layout that maps a field the schema lacks would fail Studio state validation.
    const known = new Set(INTENT_FIELD_IDS);
    if (layoutFieldIds(v).some((id) => !known.has(id))) return DEFAULT_STATE;
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

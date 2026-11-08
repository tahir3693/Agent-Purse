// Static AG Studio schema for the `intents` table.
//
// AG Studio infers a simple data source's fields from its rows only when
// `fields` is omitted ("If not provided, will be inferred from the data"). With
// zero rows nothing is inferred, so a layout that maps `intents.state` fails
// state validation ("Field with id ... does not exist in the schema"). The
// fields are therefore declared here, independent of the data.
import type {
  AgFieldDefinition,
  AgSimpleDataSourceDefinition,
} from "ag-studio";
import type { toStudioRows } from "./aggregate";

export type StudioRow = ReturnType<typeof toStudioRows>[number];

export const INTENTS_TABLE_ID = "intents";

type FieldDef = AgFieldDefinition<never, StudioRow>;

const text = (id: string, name: string): FieldDef =>
  ({ id, name, format: "textFormat" }) as FieldDef;

/** Every field of the intents table, in display order. */
export const INTENT_FIELDS: FieldDef[] = [
  text("id", "Intent id"),
  {
    id: "createdAt",
    name: "Created",
    format: "dateTimeFormat",
    // Rows carry ISO strings; the datetime type needs a Date.
    accessor: (r: StudioRow) => {
      const d = new Date(r.createdAt);
      return Number.isNaN(d.getTime()) ? null : d;
    },
  } as unknown as FieldDef,
  text("day", "Day"),
  text("state", "State"),
  text("decision", "Decision"),
  // Integer cents; never converted to a float.
  {
    id: "amountCents",
    name: "Amount (cents)",
    format: "integerFormat",
  } as FieldDef,
  text("currency", "Currency"),
  text("payee", "Payee"),
  text("category", "Category"),
  { id: "riskScore", name: "Risk score", format: "integerFormat" } as FieldDef,
  text("agentId", "Agent"),
];

/** Field ids as the layout refers to them: `<table>.<field>`. */
export const INTENT_FIELD_IDS: string[] = INTENT_FIELDS.map(
  (f) => `${INTENTS_TABLE_ID}.${f.id}`
);

/** The data source for Studio. Complete and stable even when `rows` is empty. */
export function buildIntentsSource(
  rows: StudioRow[]
): AgSimpleDataSourceDefinition {
  return {
    id: INTENTS_TABLE_ID,
    name: "Intents",
    primaryKeyField: "id",
    data: rows,
    fields: INTENT_FIELDS as unknown as AgFieldDefinition[],
  } as AgSimpleDataSourceDefinition;
}

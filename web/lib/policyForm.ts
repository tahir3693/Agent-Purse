// Policy editor helpers. Dollar strings exist only in form fields; they are
// parsed to integer cents by string manipulation, never floating point.
import { PolicySchema, type Policy } from "@agentpurse/shared";

const DOLLARS_RE = /^(\d{1,10})(?:\.(\d{1,2}))?$/;
const COUNT_RE = /^\d{1,6}$/;

export function parseDollarsToCents(input: string): number | null {
  const m = DOLLARS_RE.exec(input.trim().replace(/^\$/, ""));
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function centsToDollarString(cents: number): string {
  const whole = Math.trunc(cents / 100);
  return `${whole}.${String(cents % 100).padStart(2, "0")}`;
}

export interface PolicyFormValues {
  dailyBudget: string;
  perPurchaseCap: string;
  allowedCategories: string;
  blockedPayees: string;
  allowedPayees: string;
  velocityPerHour: string;
  velocityPerDay: string;
}

export type PolicyFormErrors = Partial<Record<keyof PolicyFormValues, string>>;

export const EMPTY_POLICY_FORM: PolicyFormValues = {
  dailyBudget: "",
  perPurchaseCap: "",
  allowedCategories: "",
  blockedPayees: "",
  allowedPayees: "",
  velocityPerHour: "",
  velocityPerDay: "",
};

const list = (s: string): string[] =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);

export function policyToForm(p: Policy): PolicyFormValues {
  return {
    dailyBudget: centsToDollarString(p.dailyBudgetCents),
    perPurchaseCap: centsToDollarString(p.perPurchaseCapCents),
    allowedCategories: p.allowedCategories.join(", "),
    blockedPayees: p.blockedPayees.join(", "),
    allowedPayees: (p.allowedPayees ?? []).join(", "),
    velocityPerHour: String(p.velocityPerHour),
    velocityPerDay: String(p.velocityPerDay),
  };
}

const MONEY_ERROR =
  "Enter a non-negative amount with at most 2 decimals, for example 25.00";
const COUNT_ERROR = "Enter a whole number, 0 or more";

export function validatePolicyForm(
  v: PolicyFormValues
): { ok: true; policy: Policy } | { ok: false; errors: PolicyFormErrors } {
  const errors: PolicyFormErrors = {};
  const daily = parseDollarsToCents(v.dailyBudget);
  const cap = parseDollarsToCents(v.perPurchaseCap);
  if (daily === null) errors.dailyBudget = MONEY_ERROR;
  if (cap === null) errors.perPurchaseCap = MONEY_ERROR;
  const perHour = COUNT_RE.test(v.velocityPerHour.trim())
    ? Number(v.velocityPerHour.trim())
    : null;
  const perDay = COUNT_RE.test(v.velocityPerDay.trim())
    ? Number(v.velocityPerDay.trim())
    : null;
  if (perHour === null) errors.velocityPerHour = COUNT_ERROR;
  if (perDay === null) errors.velocityPerDay = COUNT_ERROR;
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const allowedPayees = list(v.allowedPayees);
  const candidate = {
    dailyBudgetCents: daily!,
    perPurchaseCapCents: cap!,
    allowedCategories: list(v.allowedCategories),
    blockedPayees: list(v.blockedPayees),
    ...(allowedPayees.length > 0 ? { allowedPayees } : {}),
    velocityPerHour: perHour!,
    velocityPerDay: perDay!,
  };
  const parsed = PolicySchema.safeParse(candidate);
  if (!parsed.success)
    return { ok: false, errors: { dailyBudget: "Policy is not valid" } };
  return { ok: true, policy: parsed.data };
}

export function policySummary(p: Policy | null): string {
  if (!p) return "No policy";
  const fmt = (c: number) => `$${centsToDollarString(c)}`;
  return `${fmt(p.perPurchaseCapCents)} per purchase, ${fmt(p.dailyBudgetCents)} per day, ${p.velocityPerHour}/h`;
}

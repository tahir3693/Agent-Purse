"use client";

import type { Policy } from "@agentpurse/shared";
import { useId, useState, type FormEvent } from "react";

import {
  EMPTY_POLICY_FORM,
  policyToForm,
  validatePolicyForm,
  type PolicyFormErrors,
  type PolicyFormValues,
} from "../../lib/policyForm";

const FIELDS: {
  key: keyof PolicyFormValues;
  label: string;
  hint: string;
  full?: boolean;
}[] = [
  {
    key: "perPurchaseCap",
    label: "Per-purchase cap (USD)",
    hint: "for example 200.00",
  },
  {
    key: "dailyBudget",
    label: "Daily budget (USD)",
    hint: "for example 500.00",
  },
  { key: "velocityPerHour", label: "Purchases per hour", hint: "whole number" },
  { key: "velocityPerDay", label: "Purchases per day", hint: "whole number" },
  {
    key: "allowedCategories",
    label: "Allowed categories",
    hint: "comma-separated, empty allows all",
    full: true,
  },
  {
    key: "blockedPayees",
    label: "Blocked payees",
    hint: "comma-separated domains",
    full: true,
  },
  {
    key: "allowedPayees",
    label: "Allowed payees (optional)",
    hint: "comma-separated; empty means any",
    full: true,
  },
];

export const DEFAULT_POLICY_FORM: PolicyFormValues = {
  ...EMPTY_POLICY_FORM,
  perPurchaseCap: "200.00",
  dailyBudget: "500.00",
  velocityPerHour: "10",
  velocityPerDay: "30",
  allowedCategories: "office, electronics, books, software",
};

export function PolicyEditor({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial: Policy | null;
  submitLabel: string;
  /** Returns an error message, or null on success. */
  onSubmit: (policy: Policy) => Promise<string | null>;
}) {
  const id = useId();
  const [values, setValues] = useState<PolicyFormValues>(
    initial ? policyToForm(initial) : DEFAULT_POLICY_FORM
  );
  const [errors, setErrors] = useState<PolicyFormErrors>({});
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = validatePolicyForm(values);
    if (!r.ok) {
      setErrors(r.errors);
      setStatus("Fix the highlighted fields.");
      return; // invalid: no API call
    }
    setErrors({});
    setBusy(true);
    setStatus("Saving");
    const err = await onSubmit(r.policy);
    setBusy(false);
    setStatus(err ? `Not saved: ${err}` : "Saved.");
  }

  return (
    <form className="policy-form" onSubmit={submit} noValidate>
      {FIELDS.map((f) => {
        const err = errors[f.key];
        const inputId = `${id}-${f.key}`;
        return (
          <label
            key={f.key}
            htmlFor={inputId}
            className={f.full ? "full" : undefined}
          >
            {f.label}
            <input
              id={inputId}
              value={values[f.key]}
              inputMode={
                f.key.startsWith("velocity")
                  ? "numeric"
                  : f.full
                    ? "text"
                    : "decimal"
              }
              aria-invalid={err ? true : undefined}
              aria-describedby={`${inputId}-hint${err ? ` ${inputId}-err` : ""}`}
              onChange={(e) =>
                setValues((v) => ({ ...v, [f.key]: e.target.value }))
              }
            />
            <span id={`${inputId}-hint`} className="muted">
              {f.hint}
            </span>
            {err ? (
              <span id={`${inputId}-err`} className="error-text">
                {err}
              </span>
            ) : null}
          </label>
        );
      })}
      <div className="row full">
        <button type="submit" disabled={busy}>
          {submitLabel}
        </button>
        <span role="status" aria-live="polite">
          {status}
        </span>
      </div>
    </form>
  );
}

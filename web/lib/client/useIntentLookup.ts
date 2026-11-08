"use client";
// Lookup of recent intents by id, from the existing owner intents endpoint.
// Used to show an amount and payee next to an event instead of a bare id.
import { useMemo } from "react";
import type { Intent } from "../types";
import { useOwnerData } from "./useOwnerData";

export function useIntentLookup(version: number): ReadonlyMap<string, Intent> {
  const { data } = useOwnerData<{ intents: Intent[] }>(
    "owner/intents?limit=200",
    version
  );
  return useMemo(
    () => new Map((data?.intents ?? []).map((i) => [i.id, i])),
    [data]
  );
}

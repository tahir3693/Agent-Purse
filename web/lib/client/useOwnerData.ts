"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { owner } from "./api";

/** Loads an owner API path; refetches when `version` changes (live updates). */
export function useOwnerData<T>(path: string | null, version = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (path === null) return;
    const mine = ++seq.current;
    setLoading(true);
    const r = await owner<T>(path);
    if (mine !== seq.current) return; // a newer request superseded this one
    setLoading(false);
    if (r.ok) {
      setData(r.data);
      setError(null);
    } else {
      setError(r.message);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load, version]);

  return { data, error, loading, reload: load, setData };
}

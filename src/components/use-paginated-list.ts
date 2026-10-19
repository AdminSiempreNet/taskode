"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchJSON } from "@/lib/http-client";
import { initialPage, type Paginated } from "@/lib/pagination";

export function usePaginatedList<T>(endpoint: string, initialData?: Paginated<T>, enabled = true) {
  const [data, setData] = useState<Paginated<T>>(() => initialData ?? initialPage([]));
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(initialData?.page ?? 1);
  const [pageSize, setPageSize] = useState(initialData?.pageSize ?? 25);
  const [revision, setRevision] = useState(0);
  const [filters, setFilters] = useState("");
  const [loading, setLoading] = useState(enabled && !initialData);
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    setLoading(true); setError("");
    const params = new URLSearchParams(filters);
    params.set("page", String(page)); params.set("pageSize", String(pageSize)); params.set("q", debouncedQuery);
    void fetchJSON<Paginated<T>>(`${endpoint}?${params}`, { signal: abort.signal })
      .then((result) => { if (!abort.signal.aborted) { setData(result); setPage(result.page); } })
      .catch((cause) => { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "No se pudo cargar la lista."); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [endpoint, page, pageSize, debouncedQuery, revision, enabled, filters]);
  const search = useCallback((value: string) => { setQuery(value); setPage(1); }, []);
  const resize = useCallback((value: number) => { setPageSize(value); setPage(1); }, []);
  const refresh = useCallback(() => setRevision((current) => current + 1), []);
  const changeFilters = useCallback((values: Record<string, string>) => { setFilters(new URLSearchParams(values).toString()); setPage(1); }, []);
  return { data, query, search, changePage: setPage, changePageSize: resize, changeFilters, loading: loading || query !== debouncedQuery, error, refresh };
}

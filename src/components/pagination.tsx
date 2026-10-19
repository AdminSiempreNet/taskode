"use client";

import { useId } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { PAGE_SIZES, pageMetadata } from "@/lib/pagination";
import { Button } from "./ui/button";
import styles from "./pagination.module.css";

export function Pagination({ page, pageSize, total, changePage, changePageSize, disabled = false, label = "Paginación", compact = false }: {
  page: number; pageSize: number; total: number;
  changePage: (page: number) => void; changePageSize: (size: number) => void;
  disabled?: boolean; label?: string; compact?: boolean;
}) {
  const id = useId(), meta = pageMetadata(total, page, pageSize);
  const start = total ? (meta.page - 1) * pageSize + 1 : 0;
  const end = Math.min(meta.page * pageSize, total);
  return <nav className={styles.pagination} aria-label={label}>
    <span role="status" aria-live="polite">Mostrando {start}–{end} de {total}</span>
    <div className={styles.controls}>
      {!compact && <><label htmlFor={id}>Filas por página</label>
      <select id={id} value={pageSize} onChange={(event) => changePageSize(Number(event.target.value))} disabled={disabled}>
        {PAGE_SIZES.map((size) => <option value={size} key={size}>{size}</option>)}
      </select></>}
      <span className={styles.page}>Página {meta.page} de {meta.totalPages}</span>
      <div className={styles.buttons}>
        {!compact && <Button type="button" variant="outline" size="icon" aria-label="Primera página" disabled={disabled || meta.page === 1} onClick={() => changePage(1)}><ChevronsLeft size={15} /></Button>}
        <Button type="button" variant="outline" size="icon" aria-label="Página anterior" disabled={disabled || meta.page === 1} onClick={() => changePage(meta.page - 1)}><ChevronLeft size={15} /></Button>
        <Button type="button" variant="outline" size="icon" aria-label="Página siguiente" disabled={disabled || meta.page === meta.totalPages} onClick={() => changePage(meta.page + 1)}><ChevronRight size={15} /></Button>
        {!compact && <Button type="button" variant="outline" size="icon" aria-label="Última página" disabled={disabled || meta.page === meta.totalPages} onClick={() => changePage(meta.totalPages)}><ChevronsRight size={15} /></Button>}
      </div>
    </div>
  </nav>;
}

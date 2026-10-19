import { z } from "zod";

export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().refine((value) => PAGE_SIZES.some((size) => size === value), "Tamaño de página inválido.").default(DEFAULT_PAGE_SIZE),
  q: z.string().trim().max(200).default(""),
});
export type PageQuery = z.infer<typeof paginationSchema>;
export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function pageMetadata(total: number, page = 1, pageSize = DEFAULT_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { total, page: Math.min(Math.max(1, page), totalPages), pageSize, totalPages };
}

export function initialPage<T>(items: T[]): Paginated<T> {
  return { items: items.slice(0, DEFAULT_PAGE_SIZE), ...pageMetadata(items.length) };
}

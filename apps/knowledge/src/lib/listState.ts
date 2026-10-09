import { ALL, DEFAULT_PAGE_SIZE, MASTERY_ORDER, PAGE_SIZES, PRIORITY_ORDER } from "../constants.ts";
import type { Filters, SortKey, SortState } from "../types.ts";

/** 一覧の絞り込み・並び順・ページ。URLに載せて、詳細から戻る・再読込・共有URLで同じ一覧を開く（#137）。 */
export interface ListState {
  filters: Filters;
  sort: SortState;
  page: number;
  pageSize: number;
}

export const DEFAULT_FILTERS: Filters = { search: "", category: ALL, mastery: ALL, priority: ALL, review: "all" };
export const DEFAULT_SORT: SortState = { key: "created_at", direction: "desc" };

const SORT_KEYS: SortKey[] = ["created_at", "title", "category", "mastery", "priority", "accuracy", "next_review_on"];
const REVIEW_FILTERS: Filters["review"][] = ["all", "due", "today", "overdue"];
/** ほかの画面（view / knowledge など）のパラメータと重ならない名前にする。 */
const PARAMS = ["q", "category", "mastery", "priority", "review", "sort", "dir", "page", "size"] as const;

function asUrl(value: string | URL): URL {
  return value instanceof URL ? new URL(value.toString()) : new URL(value, "https://knowledge.invalid");
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return value !== null && (allowed as readonly string[]).includes(value) ? value as T : null;
}

function positiveInteger(value: string | null): number | null {
  return value !== null && /^[1-9]\d{0,5}$/.test(value) ? Number(value) : null;
}

export function parseListState(value: string | URL): ListState {
  const params = asUrl(value).searchParams;
  const search = (params.get("q") ?? "").slice(0, 200);
  const category = (params.get("category") ?? "").trim().slice(0, 100);
  const sortKey = oneOf(params.get("sort"), SORT_KEYS);
  const size = positiveInteger(params.get("size"));
  return {
    filters: {
      search,
      category: category || ALL,
      mastery: oneOf(params.get("mastery"), MASTERY_ORDER) ?? ALL,
      priority: oneOf(params.get("priority"), PRIORITY_ORDER) ?? ALL,
      review: oneOf(params.get("review"), REVIEW_FILTERS) ?? "all",
    },
    sort: sortKey
      ? { key: sortKey, direction: oneOf(params.get("dir"), ["asc", "desc"] as const) ?? "asc" }
      : DEFAULT_SORT,
    page: positiveInteger(params.get("page")) ?? 1,
    pageSize: size !== null && (PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_PAGE_SIZE,
  };
}

/** 既定値は書かず、ほかのパラメータ（view・knowledge など）は残す。 */
export function listStatePath(value: string | URL, state: ListState): string {
  const url = asUrl(value);
  for (const name of PARAMS) url.searchParams.delete(name);
  const { filters, sort, page, pageSize } = state;
  if (filters.search) url.searchParams.set("q", filters.search);
  if (filters.category !== ALL) url.searchParams.set("category", filters.category);
  if (filters.mastery !== ALL) url.searchParams.set("mastery", filters.mastery);
  if (filters.priority !== ALL) url.searchParams.set("priority", filters.priority);
  if (filters.review !== "all") url.searchParams.set("review", filters.review);
  if (sort.key !== DEFAULT_SORT.key || sort.direction !== DEFAULT_SORT.direction) {
    url.searchParams.set("sort", sort.key);
    url.searchParams.set("dir", sort.direction);
  }
  if (page > 1) url.searchParams.set("page", String(page));
  if (pageSize !== DEFAULT_PAGE_SIZE) url.searchParams.set("size", String(pageSize));
  return `${url.pathname}${url.search}${url.hash}`;
}

export function sameListState(a: ListState, b: ListState): boolean {
  return listStatePath("https://knowledge.invalid/", a) === listStatePath("https://knowledge.invalid/", b);
}

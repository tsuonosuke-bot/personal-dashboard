import type {
  Filters, Knowledge, SortDirection, SortKey, SortState,
} from "../types";
import { ALL, MASTERY_ORDER, PRIORITY_ORDER } from "../constants.ts";

/** 画面に出すタグ。自分で付けたタグの後に、同じ名前を除いた自動タグを近い順に続ける。 */
export function displayTags(item: Pick<Knowledge, "tags" | "auto_tags">): { tag: string; auto: boolean }[] {
  const own = new Set(item.tags);
  return [
    ...item.tags.map((tag) => ({ tag, auto: false })),
    ...(item.auto_tags ?? []).filter((tag) => !own.has(tag)).map((tag) => ({ tag, auto: true })),
  ];
}

/** 絞り込み・集計に使う、自分で付けたタグと自動タグを合わせた名前。 */
export function allTagNames(item: Pick<Knowledge, "tags" | "auto_tags">): string[] {
  return displayTags(item).map((entry) => entry.tag);
}

export interface WeakCategory {
  category: string;
  accuracy: number;
  attempts: number;
}

export function getJstToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function filterKnowledge(
  knowledge: Knowledge[],
  filters: Filters,
  today = getJstToday(),
  now = new Date(),
): Knowledge[] {
  const search = filters.search.trim().toLowerCase();
  const todayStart = Date.parse(`${today}T00:00:00+09:00`);
  const nowMs = now.getTime();
  return knowledge.filter((item) => {
    if (filters.category !== ALL && item.category !== filters.category) return false;
    if (filters.mastery !== ALL && item.mastery !== filters.mastery) return false;
    if (filters.priority !== ALL && item.priority !== filters.priority) return false;
    const dueAt = Date.parse(item.next_review_at);
    if (filters.review === "today" && getJstToday(new Date(dueAt)) !== today) return false;
    if (filters.review === "overdue" && !(dueAt < todayStart)) return false;
    if (filters.review === "due" && !(dueAt <= nowMs)) return false;
    if (search) {
      const haystack = [
        item.title, item.explanation ?? "", item.source_note ?? "",
        item.category, allTagNames(item).join(" "),
      ].join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

function compareValues(
  a: Knowledge,
  b: Knowledge,
  key: SortKey,
  direction: SortDirection,
): number {
  const left = a[key];
  const right = b[key];
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;

  let comparison: number;
  if (key === "mastery") {
    comparison = MASTERY_ORDER.indexOf(a.mastery) - MASTERY_ORDER.indexOf(b.mastery);
  } else if (key === "priority") {
    comparison = PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
  } else if (typeof left === "number" && typeof right === "number") {
    comparison = left - right;
  } else {
    comparison = String(left).localeCompare(String(right), "ja");
  }
  return direction === "asc" ? comparison : -comparison;
}

export function sortKnowledge(knowledge: Knowledge[], sort: SortState): Knowledge[] {
  return [...knowledge].sort((a, b) => {
    const primary = compareValues(a, b, sort.key, sort.direction);
    return primary || b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id);
  });
}

export function filterAndSortKnowledge(
  knowledge: Knowledge[],
  filters: Filters,
  sort: SortState,
  today = getJstToday(),
  now = new Date(),
): Knowledge[] {
  return sortKnowledge(filterKnowledge(knowledge, filters, today, now), sort);
}

export function getReviewCounts(knowledge: Knowledge[], today = getJstToday(), now = new Date()) {
  const todayStart = Date.parse(`${today}T00:00:00+09:00`);
  const nowMs = now.getTime();
  const todayCount = knowledge.filter((item) => getJstToday(new Date(item.next_review_at)) === today).length;
  const overdue = knowledge.filter((item) => Date.parse(item.next_review_at) < todayStart).length;
  const due = knowledge.filter((item) => Date.parse(item.next_review_at) <= nowMs).length;
  return { today: todayCount, overdue, due };
}

export function getWeakCategories(knowledge: Knowledge[], limit = 3): WeakCategory[] {
  const totals = new Map<string, { correct: number; attempts: number }>();
  for (const item of knowledge) {
    const current = totals.get(item.category) ?? { correct: 0, attempts: 0 };
    current.correct += item.times_correct;
    current.attempts += item.times_asked;
    totals.set(item.category, current);
  }
  return [...totals.entries()]
    .filter(([, value]) => value.attempts > 0)
    .map(([category, value]) => ({
      category,
      accuracy: value.correct / value.attempts,
      attempts: value.attempts,
    }))
    .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts || a.category.localeCompare(b.category, "ja"))
    .slice(0, limit);
}

import type { Knowledge } from "../types";
import { allTagNames } from "./knowledge.ts";

export type TagSelection =
  | { kind: "all" }
  | { kind: "tag"; tag: string }
  | { kind: "untagged" };

export type TagGroup =
  | { kind: "tag"; tag: string; count: number }
  | { kind: "untagged"; count: number };

/** The saved tag text is the identity. Trim incidental whitespace, but keep case distinct. */
export function distinctTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

/** 自分で付けたタグと自動タグ（#93）を合わせて数える。 */
export function tagGroupsForKnowledge(knowledge: readonly Pick<Knowledge, "tags" | "auto_tags">[]): TagGroup[] {
  const counts = new Map<string, number>();
  let untaggedCount = 0;
  for (const item of knowledge) {
    const tags = distinctTags(allTagNames(item));
    if (tags.length === 0) untaggedCount += 1;
    for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const groups: TagGroup[] = [...counts.entries()]
    .map(([tag, count]) => ({ kind: "tag" as const, tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "ja"));
  return [...groups, { kind: "untagged", count: untaggedCount }];
}

export function filterTagKnowledge<T extends Pick<Knowledge, "tags" | "auto_tags" | "category" | "title" | "explanation" | "source_note">>(
  knowledge: readonly T[],
  selection: TagSelection,
  category: string,
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  return knowledge.filter((item) => {
    if (category && item.category !== category) return false;
    const tags = distinctTags(allTagNames(item));
    if (selection.kind === "tag" && !tags.includes(selection.tag)) return false;
    if (selection.kind === "untagged" && tags.length !== 0) return false;
    if (!needle) return true;
    return [item.title, item.explanation ?? "", item.source_note ?? ""]
      .some((text) => text.toLowerCase().includes(needle));
  });
}

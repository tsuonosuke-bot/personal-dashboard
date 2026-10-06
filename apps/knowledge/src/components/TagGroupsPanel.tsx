import { useMemo, useState } from "react";
import { filterTagKnowledge, tagGroupsForKnowledge, type TagSelection } from "../lib/tagGroups";
import type { Knowledge, KnowledgeInsight } from "../types";
import { TagChips } from "./TagChips";
import "./tagGroups.css";

interface Props {
  knowledge: Knowledge[];
  insights: KnowledgeInsight[];
  onOpenKnowledge: (item: Knowledge) => void;
  loading?: boolean;
  error?: string | null;
}

const PAGE_SIZE = 20;

/** 「タグ」タブ。カテゴリ内の小分類としてのタグからナレッジを探す。 */
export function TagGroupsPanel({
  knowledge, insights, onOpenKnowledge, loading = false, error = null,
}: Props) {
  const [selection, setSelection] = useState<TagSelection>({ kind: "all" });
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const categories = useMemo(
    () => [...new Set(knowledge.map((item) => item.category))].sort((a, b) => a.localeCompare(b, "ja")),
    [knowledge],
  );
  const categoryKnowledge = useMemo(
    () => category ? knowledge.filter((item) => item.category === category) : knowledge,
    [category, knowledge],
  );
  const groups = useMemo(() => tagGroupsForKnowledge(categoryKnowledge), [categoryKnowledge]);
  const matching = useMemo(() => filterTagKnowledge(categoryKnowledge, selection, "", query)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.title.localeCompare(b.title, "ja")),
  [categoryKnowledge, query, selection]);
  const insightCount = useMemo(() => {
    const count = new Map<string, number>();
    for (const insight of insights) count.set(insight.knowledge_id, (count.get(insight.knowledge_id) ?? 0) + 1);
    return count;
  }, [insights]);
  const visible = matching.slice(0, visibleCount);
  const selectionLabel = selection.kind === "all" ? "すべてのナレッジ"
    : selection.kind === "untagged" ? "タグなし" : `#${selection.tag}`;

  const select = (next: TagSelection) => {
    setSelection(next);
    setVisibleCount(PAGE_SIZE);
  };

  return (
      <div className="tag-groups-view">
        <div className="tag-groups-intro card">
          <p>タグからナレッジを探せます。復習の予定や記録は、この画面を見ても変わりません。</p>
          <label className="tag-groups-category">
            <span>カテゴリ</span>
            <select value={category} onChange={(event) => { setCategory(event.target.value); setSelection({ kind: "all" }); setVisibleCount(PAGE_SIZE); }}>
              <option value="">すべてのカテゴリ</option>
              {categories.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        </div>

        {error && <div className="err compact" role="alert">ナレッジを読み込めませんでした。{error}</div>}
        {loading && knowledge.length === 0 ? <div className="msg" role="status">ナレッジを読み込み中...</div> : (
          <div className="tag-groups-layout">
            <nav className="tag-groups-picker card" aria-label="タグのグループ">
              <h2>グループ</h2>
              <p>{category ? `「${category}」のナレッジ` : "すべてのナレッジ"}から集計しています。</p>
              <div className="tag-groups-options">
                <button type="button" className="tag-groups-option" aria-pressed={selection.kind === "all"}
                  onClick={() => select({ kind: "all" })}>
                  <span>すべて</span><span>{categoryKnowledge.length}件</span>
                </button>
                {groups.map((group) => group.kind === "tag" ? (
                  <button type="button" className="tag-groups-option" key={group.tag}
                    aria-pressed={selection.kind === "tag" && selection.tag === group.tag}
                    onClick={() => select({ kind: "tag", tag: group.tag })}>
                    <span>#{group.tag}</span><span>{group.count}件</span>
                  </button>
                ) : (
                  <button type="button" className="tag-groups-option" key="untagged"
                    aria-pressed={selection.kind === "untagged"}
                    onClick={() => select({ kind: "untagged" })}>
                    <span>タグなし</span><span>{group.count}件</span>
                  </button>
                ))}
              </div>
            </nav>

            <section className="tag-groups-results" aria-label="選択したタグのナレッジ">
              <div className="tag-groups-results-head">
                <div>
                  <h2>{selectionLabel}</h2>
                  <p aria-live="polite">{matching.length}件のナレッジ</p>
                </div>
                <input type="search" aria-label="ナレッジを検索" placeholder="タイトル・説明・出典で検索"
                  value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(PAGE_SIZE); }} />
              </div>
              {matching.length === 0 ? (
                <div className="card tag-groups-empty">
                  {query.trim() ? "検索条件に合うナレッジはありません。" : "このグループにナレッジはありません。"}
                </div>
              ) : (
                <>
                  <ul className="tag-knowledge-list">
                    {visible.map((item) => (
                      <li className="tag-knowledge-card card" key={item.id}>
                        <div className="tag-knowledge-meta">
                          <span>{item.category}</span>
                          <span>示唆 {insightCount.get(item.id) ?? 0}件</span>
                        </div>
                        <h3>{item.title}</h3>
                        {item.explanation && <p className="tag-knowledge-summary">{item.explanation}</p>}
                        {item.source_note && <p className="tag-knowledge-source"><b>出典</b> {item.source_note}</p>}
                        <div className="tag-knowledge-footer">
                          <div className="tag-knowledge-tags" aria-label="タグ">
                            <TagChips item={item} />
                          </div>
                          <button type="button" className="text-button" onClick={() => onOpenKnowledge(item)}>
                            詳細を見る<span className="sr-only">: {item.title}</span>
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {visible.length < matching.length && (
                    <button type="button" className="tag-groups-more" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
                      さらに表示（残り{matching.length - visible.length}件）
                    </button>
                  )}
                </>
              )}
            </section>
          </div>
        )}
      </div>
  );
}

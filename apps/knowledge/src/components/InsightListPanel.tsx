import { useMemo, useState } from "react";
import type { InsightGroupStore } from "../hooks/useInsightGroups";
import type { InsightStore } from "../hooks/useInsights";
import { useInsightAnalysis } from "../hooks/useInsightAnalysis";
import { dashboardRoutePath } from "../lib/dashboardRoute";
import type { Knowledge, KnowledgeInsight } from "../types";
import { QuestionChips, ThemeToQuestion } from "./InsightQuestions";

interface Props {
  knowledge: Knowledge[];
  store: InsightStore;
  groupStore: InsightGroupStore;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" });
}

/** 「すべての示唆」タブ。ナレッジごとの示唆一覧と、AIによる共通点のまとめ。 */
export function InsightListPanel({ knowledge, store, groupStore }: Props) {
  const [query, setQuery] = useState("");
  const { analysis, checking, analyzing, error: analysisError, analyze } = useInsightAnalysis(store.insights, knowledge, !store.loading && !store.error);

  const knowledgeById = useMemo(() => new Map(knowledge.map((item) => [item.id, item])), [knowledge]);
  const insightById = useMemo(() => new Map(store.insights.map((item) => [item.id, item])), [store.insights]);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = store.insights.filter((insight) => {
      if (!needle) return true;
      const source = knowledgeById.get(insight.knowledge_id);
      return insight.body.toLowerCase().includes(needle)
        || (source?.title.toLowerCase().includes(needle) ?? false)
        || (source?.category.toLowerCase().includes(needle) ?? false);
    });
    const byKnowledge = new Map<string, KnowledgeInsight[]>();
    for (const insight of matched) {
      byKnowledge.set(insight.knowledge_id, [...(byKnowledge.get(insight.knowledge_id) ?? []), insight]);
    }
    return [...byKnowledge.entries()];
  }, [knowledgeById, query, store.insights]);

  const knowledgeHref = (id: string) => dashboardRoutePath(window.location.href, { kind: "knowledge", knowledgeId: id });
  const knowledgeTitle = (id: string) => knowledgeById.get(id)?.title ?? "アーカイブ済みのナレッジ";

  return (
    <div className="insights-view">
        <div className="insights-toolbar card">
          <p>
            {store.insights.length}件・{new Set(store.insights.map((item) => item.knowledge_id)).size}ナレッジ
          </p>
          <div className="insights-toolbar-actions">
            <input
              type="search"
              value={query}
              placeholder="示唆・ナレッジ名で検索"
              aria-label="示唆を検索"
              onChange={(event) => setQuery(event.target.value)}
            />
            <button
              className="primary-button"
              onClick={() => void analyze(Boolean(analysis))}
              disabled={checking || analyzing || store.loading || Boolean(store.error) || store.insights.length < 2}
              title={store.insights.length < 2 ? "示唆が2件以上になるとまとめられます" : undefined}
            >
              {checking ? "前回のまとめを確認中…" : analyzing ? "まとめ中…" : analysis ? "再分析" : "AIで共通点をまとめる"}
            </button>
          </div>
        </div>

        {analysisError && <div className="err compact" role="alert">{analysisError}</div>}
        {analysis && (
          <section className="insight-themes" aria-label="AIがまとめた共通の示唆">
            <h2>共通して現れる示唆 <span>{analysis.analyzed_count}件から</span></h2>
            {analysis.analyzed_at && <p className="insight-analysis-status" role="status">{analysis.saved ? "保存済み" : "保存できませんでした。この画面では結果を確認できます。"} · {new Date(analysis.analyzed_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</p>}
            <ol>
              {analysis.themes.map((theme) => {
                const related = theme.insight_ids.flatMap((id) => insightById.get(id) ?? []);
                const knowledgeCount = new Set(related.map((item) => item.knowledge_id)).size;
                return (
                  <li key={theme.title} className="insight-theme card">
                    <div className="insight-theme-head">
                      <strong>{theme.title}</strong>
                      <span className="badge">{related.length}件・{knowledgeCount}ナレッジ</span>
                    </div>
                    <p>{theme.summary}</p>
                    <p className="insight-theme-importance"><b>重要そうな理由:</b> {theme.importance}</p>
                    <ThemeToQuestion
                      store={groupStore}
                      title={theme.title}
                      guidingQuestion={theme.guiding_question}
                      insightIds={related.map((item) => item.id)}
                    />
                    <details>
                      <summary>根拠の示唆を見る</summary>
                      <ul>
                        {related.map((item) => (
                          <li key={item.id}>
                            <a href={knowledgeHref(item.knowledge_id)}>{knowledgeTitle(item.knowledge_id)}</a>
                            <span>{item.body}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {store.error && <div className="err compact" role="alert">{store.error}</div>}
        {store.loading && store.insights.length === 0 && <div className="msg">読み込み中...</div>}
        {!store.loading && !store.error && store.insights.length === 0 && (
          <div className="msg">まだ示唆はありません。ナレッジの詳細や採点結果から書けます。</div>
        )}
        {groups.length === 0 && store.insights.length > 0 && <div className="msg">条件に合う示唆はありません。</div>}

        <ul className="insight-group-list">
          {groups.map(([knowledgeId, notes]) => (
            <li key={knowledgeId} className="insight-group card">
              <div className="insight-group-head">
                <a href={knowledgeHref(knowledgeId)}>{knowledgeTitle(knowledgeId)}</a>
                {knowledgeById.get(knowledgeId) && <span className="muted">{knowledgeById.get(knowledgeId)?.category}</span>}
              </div>
              <ul className="insight-note-list">
                {notes.map((note) => (
                  <li key={note.id} className="insight-note">
                    <p>{note.body}</p>
                    <QuestionChips store={groupStore} insightId={note.id} />
                    <div className="insight-note-meta"><span>{formatDate(note.created_at)}</span></div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
    </div>
  );
}

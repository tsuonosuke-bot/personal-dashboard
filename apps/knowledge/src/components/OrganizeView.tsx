import type { InsightGroupStore } from "../hooks/useInsightGroups";
import type { InsightStore } from "../hooks/useInsights";
import type { OrganizeTab } from "../lib/dashboardRoute";
import { allTagNames } from "../lib/knowledge";
import type { Knowledge } from "../types";
import { InsightGroupsPanel } from "./InsightGroupsPanel";
import { InsightListPanel } from "./InsightListPanel";
import { NotesPanel, type NoteSelection } from "./NotesPanel";
import type { ReviewScope } from "./ReviewView";
import { TagGroupsPanel } from "./TagGroupsPanel";

interface Props {
  tab: OrganizeTab;
  questionId: number | null;
  /** 問い・示唆の出典表示にはアーカイブ済みも含めたナレッジを使う。 */
  allKnowledge: Knowledge[];
  /** タグは現役のナレッジだけを集計する。 */
  activeKnowledge: Knowledge[];
  insightStore: InsightStore;
  groupStore: InsightGroupStore;
  loading: boolean;
  error: string | null;
  onTabChange: (tab: OrganizeTab) => void;
  onOpenKnowledge: (item: Knowledge) => void;
  onExit: () => void;
  /** ノートタブ（#96）で開いているノート。 */
  noteSelection: NoteSelection | null;
  onNoteSelect: (selection: NoteSelection | null) => void;
  onReviewNote: (scope: ReviewScope) => void;
  onRemoveAutoTag: (knowledgeId: string, tag: string) => Promise<void>;
  onRestoreAutoTag: (knowledgeId: string, tag: string) => Promise<void>;
}

const TABS: { tab: OrganizeTab; label: string }[] = [
  { tab: "questions", label: "問い" },
  { tab: "insights", label: "示唆" },
  { tab: "tags", label: "タグ" },
  { tab: "notes", label: "ノート" },
];

/** ナレッジ→示唆→問いを整理する画面。問い・示唆・タグを1ページのタブで切り替える。 */
export function OrganizeView({
  tab, questionId, allKnowledge, activeKnowledge, insightStore, groupStore, loading, error,
  onTabChange, onOpenKnowledge, onExit, noteSelection, onNoteSelect, onReviewNote, onRemoveAutoTag, onRestoreAutoTag,
}: Props) {
  // ノートは問いとテーマの数。テーマの数はノートの一覧を読むまで分からないので出さない。
  const counts: Record<OrganizeTab, number | null> = {
    notes: null,
    questions: groupStore.groups.length,
    insights: insightStore.insights.length,
    tags: new Set(activeKnowledge.flatMap((item) => allTagNames(item))).size,
  };

  return (
    <div className="quiz-page">
      <header className="quiz-header">
        <button className="text-button" onClick={onExit}>← ダッシュボードへ戻る</button>
        <h1>問い・示唆・タグ</h1>
      </header>
      <main className="quiz-body organize-view">
        <section className="organize-guide card" aria-label="整理の考え方">
          <p>ナレッジから「自分にとってどう役立つか」を示唆に書き、示唆を分野をまたぐ問いで束ねます。</p>
          <dl>
            <div><dt>カテゴリ</dt><dd>分野。1つのナレッジに1つ（英語・ビジネスなど）</dd></div>
            <div><dt>タグ</dt><dd>分野の中の小分類や出典。複数付けられる（#単語・#読書など）</dd></div>
            <div><dt>問い</dt><dd>分野をまたいで示唆を束ねる「何を判断したいか」</dd></div>
            <div><dt>ノート</dt><dd>問いやテーマ（自動タグ）ごとに、ナレッジ・示唆・日記をまとめて読む</dd></div>
          </dl>
        </section>

        <div className="organize-tabs card" role="group" aria-label="表示する内容">
          {TABS.map((item) => (
            <button key={item.tab} type="button" aria-pressed={tab === item.tab} onClick={() => onTabChange(item.tab)}>
              {item.label} {counts[item.tab] !== null && <span>{counts[item.tab]}</span>}
            </button>
          ))}
        </div>

        {tab === "notes" && (
          <NotesPanel
            knowledge={allKnowledge}
            insights={insightStore.insights}
            groupStore={groupStore}
            selection={noteSelection}
            onSelect={onNoteSelect}
            onOpenKnowledge={onOpenKnowledge}
            onReview={onReviewNote}
            onRemoveAutoTag={onRemoveAutoTag}
            onRestoreAutoTag={onRestoreAutoTag}
          />
        )}
        {tab === "questions" && (
          <InsightGroupsPanel
            key={questionId ?? "none"}
            knowledge={allKnowledge}
            insights={insightStore.insights}
            store={groupStore}
            initialGroupId={questionId}
          />
        )}
        {tab === "insights" && (
          <InsightListPanel knowledge={allKnowledge} store={insightStore} groupStore={groupStore} />
        )}
        {tab === "tags" && (
          <TagGroupsPanel
            knowledge={activeKnowledge}
            insights={insightStore.insights}
            loading={loading}
            error={error}
            onOpenKnowledge={onOpenKnowledge}
          />
        )}
      </main>
    </div>
  );
}

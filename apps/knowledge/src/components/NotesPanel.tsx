import { useCallback, useEffect, useMemo, useState } from "react";
import type { InsightGroupStore } from "../hooks/useInsightGroups";
import {
  changeQuestionMaterial, changeThemeMaterial, getNoteTopics, getQuestionMaterials, getThemeNote,
} from "../lib/api";
import type { Knowledge, KnowledgeInsight, NoteTopic, SemanticSourceType, ThemeOrigin } from "../types";
import type { ReviewScope } from "./ReviewView";
import "./tagGroups.css";

export type NoteSelection = { kind: "question"; id: number } | { kind: "theme"; tag: string };

interface Props {
  /** 詳細を開くためのナレッジ（アーカイブ済みも含む）。 */
  knowledge: Knowledge[];
  insights: KnowledgeInsight[];
  groupStore: InsightGroupStore;
  selection: NoteSelection | null;
  onSelect: (selection: NoteSelection | null) => void;
  onOpenKnowledge: (item: Knowledge) => void;
  onReview: (scope: ReviewScope) => void;
  onRemoveAutoTag: (knowledgeId: string, tag: string) => Promise<void>;
  onRestoreAutoTag: (knowledgeId: string, tag: string) => Promise<void>;
}

/** ノートの1項目。問いの材料とテーマの材料を同じ形にそろえる。 */
interface NoteItem {
  type: SemanticSourceType;
  id: string;
  title: string;
  body: string;
  meta: string | null;
  knowledgeId: string | null;
  similarity: number | null;
  /** 項目の横に出す、ノートに入った理由。 */
  reason: string | null;
  /** 外せないもの（自分で入れた示唆・自分で付けたタグ）はfalse。 */
  removable: boolean;
}

interface NoteData {
  items: NoteItem[];
  excluded: { type: SemanticSourceType; id: string; title: string; body: string }[];
  note: string | null;
}

const SECTIONS: { type: SemanticSourceType; label: string }[] = [
  { type: "insight", label: "示唆" },
  { type: "knowledge", label: "ナレッジ" },
  { type: "journal", label: "日記" },
];

const THEME_REASON: Record<ThemeOrigin, string | null> = {
  own_tag: "自分で付けたタグ",
  auto_tag: "自動タグ",
  tagged_knowledge: "このテーマのナレッジの示唆",
  nearby: null,
};

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : "操作を完了できませんでした。";
}

function sameSelection(a: NoteSelection | null, topic: NoteTopic): boolean {
  if (!a) return false;
  return a.kind === "question" ? topic.kind === "question" && topic.key === String(a.id) : topic.kind === "theme" && topic.key === a.tag;
}

function topicSelection(topic: NoteTopic): NoteSelection {
  return topic.kind === "question" ? { kind: "question", id: Number(topic.key) } : { kind: "theme", tag: topic.key };
}

/**
 * 問い・テーマ別のノート（#96）。問いやテーマを選ぶと、集まったナレッジ・示唆・日記を1枚で読める。
 * 的外れなものはその場で外せ、外したものは次に集め直しても戻らない（下の一覧から戻せる）。
 * ノートのナレッジから詳細を開き、期限が来たものだけを復習できる。予定は変えない。
 */
export function NotesPanel({
  knowledge, insights, groupStore, selection, onSelect, onOpenKnowledge, onReview, onRemoveAutoTag, onRestoreAutoTag,
}: Props) {
  const [topics, setTopics] = useState<NoteTopic[] | null>(null);
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const [data, setData] = useState<NoteData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);

  const knowledgeById = useMemo(() => new Map(knowledge.map((item) => [item.id, item])), [knowledge]);
  const insightById = useMemo(() => new Map(insights.map((item) => [item.id, item])), [insights]);

  const loadTopics = useCallback(async () => {
    setTopicsError(null);
    try {
      setTopics(await getNoteTopics());
    } catch (caught) {
      setTopicsError(errorMessage(caught));
    }
  }, []);
  useEffect(() => { void loadTopics(); }, [loadTopics]);

  const group = selection?.kind === "question" ? groupStore.groups.find((item) => item.id === selection.id) ?? null : null;
  const memberIds = useMemo(() => (selection?.kind === "question"
    ? groupStore.members.filter((member) => member.group_id === selection.id).map((member) => member.insight_id)
    : []), [groupStore.members, selection]);

  const loadNote = useCallback(async () => {
    if (!selection) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (selection.kind === "theme") {
        const note = await getThemeNote(selection.tag);
        setData({
          items: note.materials.map((item) => ({
            type: item.source_type,
            id: item.source_id,
            title: item.title,
            body: item.body,
            meta: item.meta,
            knowledgeId: item.knowledge_id,
            similarity: item.similarity,
            reason: THEME_REASON[item.origin],
            removable: item.origin !== "own_tag",
          })),
          excluded: note.excluded.map((item) => ({ type: item.source_type, id: item.source_id, title: item.title, body: item.body })),
          note: null,
        });
      } else {
        const materials = await getQuestionMaterials(selection.id);
        const own: NoteItem[] = memberIds.flatMap((id) => {
          const insight = insightById.get(id);
          if (!insight) return [];
          return [{
            type: "insight" as const,
            id: String(id),
            title: knowledgeById.get(insight.knowledge_id)?.title ?? "削除されたナレッジ",
            body: insight.body,
            meta: null,
            knowledgeId: insight.knowledge_id,
            similarity: null,
            reason: "自分で入れた示唆",
            removable: false,
          }];
        });
        setData({
          items: [...own, ...materials.materials.map((item) => ({
            type: item.source_type,
            id: item.source_id,
            title: item.title,
            body: item.body,
            meta: item.meta,
            knowledgeId: item.knowledge_id,
            similarity: item.similarity,
            reason: null,
            removable: true,
          }))],
          excluded: materials.excluded.map((item) => ({ type: item.source_type, id: item.source_id, title: item.title, body: item.body })),
          note: materials.note,
        });
      }
    } catch (caught) {
      setData(null);
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [insightById, knowledgeById, memberIds, selection]);

  // 別のノートを選んだら、前のノートを残したまま見せない。
  useEffect(() => { setData(null); setShowExcluded(false); }, [selection]);
  useEffect(() => { void loadNote(); }, [loadNote]);

  /** 外す・戻す。テーマのナレッジは自動タグを外す・戻す。終わったら件数も読み直す。 */
  const change = async (action: "exclude" | "restore", type: SemanticSourceType, id: string) => {
    if (!selection) return;
    setWorking(true);
    setError(null);
    try {
      if (selection.kind === "question") {
        await changeQuestionMaterial(selection.id, action, type, id);
      } else if (type === "knowledge") {
        await (action === "exclude" ? onRemoveAutoTag(id, selection.tag) : onRestoreAutoTag(id, selection.tag));
      } else {
        await changeThemeMaterial(selection.tag, action, type, id);
      }
      await Promise.all([loadNote(), loadTopics()]);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setWorking(false);
    }
  };

  const questions = (topics ?? []).filter((topic) => topic.kind === "question");
  const themes = (topics ?? []).filter((topic) => topic.kind === "theme")
    .sort((a, b) => b.knowledge_count - a.knowledge_count || a.title.localeCompare(b.title, "ja"));
  const current = topics?.find((topic) => sameSelection(selection, topic)) ?? null;
  const title = selection?.kind === "theme" ? `#${selection.tag}` : group?.title ?? current?.title ?? "問い";
  const noteKnowledge = (data?.items ?? []).filter((item) => item.type === "knowledge" && item.knowledgeId)
    .map((item) => item.knowledgeId as string);
  const now = Date.now();
  const dueCount = noteKnowledge.filter((id) => {
    const item = knowledgeById.get(id);
    return item && !item.archived && Date.parse(item.next_review_at) <= now;
  }).length;
  const disabled = working || loading;

  const topicButton = (topic: NoteTopic) => {
    const total = topic.knowledge_count + topic.insight_count + topic.journal_count;
    return (
      <button type="button" className="tag-groups-option" key={`${topic.kind}:${topic.key}`}
        aria-pressed={sameSelection(selection, topic)} onClick={() => onSelect(topicSelection(topic))}
        title={`ナレッジ ${topic.knowledge_count}・示唆 ${topic.insight_count}・日記 ${topic.journal_count}`}>
        <span>{topic.kind === "theme" ? `#${topic.title}` : topic.title}</span>
        <span>{topic.kind === "question" && !topic.materials_ready ? "未集計" : `${total}件`}</span>
      </button>
    );
  };

  return (
    <div className="tag-groups-view">
      <div className="tag-groups-intro card">
        <p>
          問いやテーマを選ぶと、集まったナレッジ・示唆・日記を1枚のノートとして読めます。テーマは自動タグで、
          そのタグのナレッジと、意味の近い示唆・日記が集まります。合わないものは「外す」と、そのノートには二度と出ません。
        </p>
      </div>

      {topicsError && <div className="err compact" role="alert">ノートの一覧を読み込めませんでした。{topicsError}</div>}
      <div className="tag-groups-layout">
        <nav className="tag-groups-picker card notes-picker" aria-label="ノートの一覧">
          {!topics && !topicsError && <p role="status">ノートを読み込み中…</p>}
          {topics && (
            <>
              <h2>問い</h2>
              {questions.length === 0
                ? <p>問いはまだありません。「問い」タブで立てられます。</p>
                : <div className="tag-groups-options">{questions.map(topicButton)}</div>}
              <h2 className="notes-picker-heading">テーマ</h2>
              <div className="tag-groups-options">{themes.map(topicButton)}</div>
            </>
          )}
        </nav>

        <section className="tag-groups-results note-view" aria-label="ノート">
          {!selection ? (
            <div className="card tag-groups-empty">左の一覧から問いかテーマを選んでください。</div>
          ) : (
            <article className="card note-sheet">
              <header className="note-head">
                <div>
                  <span className="note-kind">{selection.kind === "theme" ? "テーマ" : "問い"}</span>
                  <h2>{title}</h2>
                  {selection.kind === "question" && (group?.guiding_question ?? current?.guiding_question) && (
                    <p className="note-question">{group?.guiding_question ?? current?.guiding_question}</p>
                  )}
                  {data && (
                    <p className="note-counts" aria-live="polite">
                      {SECTIONS.map(({ type, label }) => `${label} ${data.items.filter((item) => item.type === type).length}`).join("・")}
                    </p>
                  )}
                </div>
                <button type="button" className="primary-button note-review"
                  disabled={disabled || noteKnowledge.length === 0}
                  onClick={() => onReview({ label: selection.kind === "theme" ? selection.tag : title, knowledgeIds: noteKnowledge })}>
                  このノートを復習（期限 {dueCount}枚）
                </button>
              </header>

              {loading && !data && <p className="muted" role="status">ノートを集めています…</p>}
              {error && <div className="err compact" role="alert">{error}</div>}
              {data?.note && <p className="question-materials-note">{data.note}</p>}

              {data && SECTIONS.map(({ type, label }) => {
                const items = data.items.filter((item) => item.type === type);
                return (
                  <section className="note-section question-materials-group" key={type} aria-label={label}>
                    <h3>{label} <span>{items.length}件</span></h3>
                    {items.length === 0 ? <p className="muted">集まった{label}はありません。</p> : (
                      <ul>
                        {items.map((item) => {
                          const source = item.knowledgeId ? knowledgeById.get(item.knowledgeId) : undefined;
                          return (
                            <li key={`${type}:${item.id}`} className={`question-material ${type}`}>
                              <div className="question-material-text">
                                {type === "insight" ? (
                                  <>
                                    <p>{item.body}</p>
                                    <small>{item.title}</small>
                                  </>
                                ) : (
                                  <>
                                    <strong>{item.title}</strong>
                                    {item.body && <p className="question-material-body">{item.body}</p>}
                                  </>
                                )}
                                {(item.reason || (type === "knowledge" && item.meta)) && (
                                  <small className="note-reason">
                                    {[type === "knowledge" ? item.meta : null, item.reason].filter(Boolean).join("・")}
                                  </small>
                                )}
                              </div>
                              <div className="question-material-actions">
                                {item.similarity !== null && (
                                  <span className="question-material-similarity" title="意味の近さ（1に近いほど近い）">{item.similarity.toFixed(2)}</span>
                                )}
                                {source && (
                                  <button type="button" onClick={() => onOpenKnowledge(source)}>
                                    詳細<span className="sr-only">: {source.title}</span>
                                  </button>
                                )}
                                {item.removable && (
                                  <button type="button" className="text-button" disabled={disabled}
                                    onClick={() => void change("exclude", type, item.id)}>
                                    外す<span className="sr-only">: {type === "insight" ? item.body : item.title}</span>
                                  </button>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                );
              })}

              {data && data.excluded.length > 0 && (
                <div className="question-materials-excluded">
                  <button type="button" className="text-button" aria-expanded={showExcluded} onClick={() => setShowExcluded((value) => !value)}>
                    {showExcluded ? "外したものを閉じる" : `外したもの ${data.excluded.length}件`}
                  </button>
                  {showExcluded && (
                    <ul>
                      {data.excluded.map((item) => (
                        <li key={`${item.type}:${item.id}`}>
                          <span>{SECTIONS.find((section) => section.type === item.type)?.label}</span>
                          <p>{item.type === "insight" ? item.body : item.title}</p>
                          <button type="button" onClick={() => void change("restore", item.type, item.id)} disabled={disabled}>戻す</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </article>
          )}
        </section>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { getSemanticIndexStatus, runEmbeddingBatch, searchSemantic } from "../lib/api";
import type {
  EmbeddingBatchSummary, Knowledge, SemanticIndexStatus, SemanticSearchResult, SemanticSourceType,
} from "../types";

interface Props {
  /** 検索結果からナレッジを開くため、アーカイブ済みも含めて渡す。 */
  knowledge: Knowledge[];
  onOpenKnowledge: (item: Knowledge) => void;
  onExit: () => void;
}

const TYPE_LABELS: Record<SemanticSourceType, string> = {
  knowledge: "ナレッジ",
  insight: "示唆",
  journal: "日記",
};
const ALL_TYPES: SemanticSourceType[] = ["knowledge", "insight", "journal"];

function formatTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function batchMessage(summary: EmbeddingBatchSummary): string {
  if (summary.status === "skipped") return summary.note ?? "付け直す項目はありませんでした。";
  const head = summary.status === "failed" ? "途中で止まりました。" : `${summary.saved}件にembeddingを付けました。`;
  return [head, summary.note].filter(Boolean).join(" ");
}

/** ナレッジ・示唆・日記を、言葉が一致しなくても意味の近さで横断して探す画面（#45）。 */
export function SemanticSearchView({ knowledge, onOpenKnowledge, onExit }: Props) {
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState<SemanticSourceType[]>(ALL_TYPES);
  const [results, setResults] = useState<SemanticSearchResult[] | null>(null);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SemanticIndexStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [indexMessage, setIndexMessage] = useState<string | null>(null);
  const knowledgeById = useMemo(() => new Map(knowledge.map((item) => [item.id, item])), [knowledge]);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await getSemanticIndexStatus());
      setStatusError(null);
    } catch (caught) {
      setStatusError(caught instanceof Error ? caught.message : "索引の状態を取得できませんでした。");
    }
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const toggleType = (type: SemanticSourceType) => {
    setTypes((current) => current.includes(type)
      ? current.filter((item) => item !== type)
      : ALL_TYPES.filter((item) => item === type || current.includes(item)));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = query.trim();
    if (!text || types.length === 0 || searching) return;
    setSearching(true);
    setError(null);
    try {
      setResults(await searchSemantic(text, types));
      setSearchedQuery(text);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "検索できませんでした。");
    } finally {
      setSearching(false);
    }
  };

  const updateIndex = async () => {
    setIndexing(true);
    setIndexMessage(null);
    try {
      setIndexMessage(batchMessage(await runEmbeddingBatch()));
    } catch (caught) {
      setIndexMessage(caught instanceof Error ? caught.message : "索引を更新できませんでした。");
    } finally {
      setIndexing(false);
      void loadStatus();
    }
  };

  const pending = status?.items.reduce((sum, item) => sum + Math.max(0, item.total - item.embedded), 0) ?? 0;
  const embeddedTimes = status?.items
    .map((item) => item.last_embedded_at)
    .filter((value): value is string => value !== null)
    .sort() ?? [];
  const lastEmbedded = formatTime(embeddedTimes[embeddedTimes.length - 1] ?? null);

  return (
    <div className="quiz-page">
      <header className="quiz-header">
        <button className="text-button" onClick={onExit}>← ダッシュボードへ戻る</button>
        <h1>意味で検索</h1>
      </header>
      <main className="quiz-body semantic-search">
        <form className="semantic-search-form card" onSubmit={(event) => void submit(event)}>
          <label className="semantic-search-query">
            <span>探したいこと</span>
            <textarea
              value={query}
              rows={2}
              maxLength={500}
              placeholder="例: 失敗から学ぶ仕組み、疲れているときの判断"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit(event);
              }}
            />
          </label>
          <div className="semantic-search-controls">
            <fieldset className="semantic-search-types">
              <legend>対象</legend>
              {ALL_TYPES.map((type) => (
                <label key={type}>
                  <input type="checkbox" checked={types.includes(type)} onChange={() => toggleType(type)} />
                  {TYPE_LABELS[type]}
                </label>
              ))}
            </fieldset>
            <button className="primary-button" type="submit" disabled={searching || !query.trim() || types.length === 0}>
              {searching ? "検索中..." : "検索"}
            </button>
          </div>
          <p className="semantic-search-hint">言葉が一致しなくても、意味の近いナレッジ・示唆・日記を近い順に表示します。</p>
        </form>

        <section className="semantic-index card" aria-label="検索できる件数">
          {statusError && <p className="semantic-index-error">{statusError}</p>}
          {status && (
            <>
              <dl>
                {status.items.map((item) => (
                  <div key={item.source_type}>
                    <dt>{TYPE_LABELS[item.source_type]}</dt>
                    <dd>{item.embedded} / {item.total}</dd>
                  </div>
                ))}
              </dl>
              <p>
                {!status.configured
                  ? "VOYAGE_API_KEY が未設定のため、まだ検索できません。"
                  : pending > 0
                    ? `未登録の${pending}件は、毎時40分の更新で検索できるようになります。`
                    : "すべて検索できます。"}
                {lastEmbedded && ` 最終更新 ${lastEmbedded}`}
              </p>
            </>
          )}
          <div className="semantic-index-actions">
            <button type="button" onClick={() => void updateIndex()} disabled={indexing || !status?.configured || pending === 0}>
              {indexing ? "更新中..." : "今すぐ索引を更新"}
            </button>
            {indexMessage && <span role="status">{indexMessage}</span>}
          </div>
        </section>

        {error && <div className="err compact" role="alert">{error}</div>}

        {results && (
          <section className="semantic-results" aria-label="検索結果">
            <h2>「{searchedQuery}」に近いもの {results.length}件</h2>
            {results.length === 0 && (
              <p className="semantic-empty card">近いものが見つかりませんでした。索引がまだ作られていない可能性があります。</p>
            )}
            <ol>
              {results.map((item) => {
                const target = item.knowledge_id ? knowledgeById.get(item.knowledge_id) : undefined;
                return (
                  <li key={`${item.source_type}:${item.source_id}`} className={`semantic-result card ${item.source_type}`}>
                    <div className="semantic-result-head">
                      <span className={`semantic-type ${item.source_type}`}>{TYPE_LABELS[item.source_type]}</span>
                      {item.meta && item.source_type !== "insight" && <span className="semantic-meta">{item.meta}</span>}
                      <span className="semantic-similarity" title="意味の近さ（1に近いほど近い）">近さ {item.similarity.toFixed(2)}</span>
                    </div>
                    {item.source_type === "insight" ? (
                      <>
                        <p className="semantic-result-body insight">{item.body}</p>
                        <p className="semantic-result-source">元のナレッジ: {item.title}</p>
                      </>
                    ) : (
                      <>
                        <h3>{item.title}</h3>
                        <p className={`semantic-result-body ${item.source_type}`}>{item.body}</p>
                      </>
                    )}
                    {target && (
                      <button type="button" className="text-button" onClick={() => onOpenKnowledge(target)}>
                        ナレッジを開く
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        )}
      </main>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { changeQuestionMaterial, getQuestionMaterials } from "../lib/api";
import { dashboardRoutePath } from "../lib/dashboardRoute";
import type { QuestionMaterials, SemanticSearchResult, SemanticSourceType } from "../types";

interface Props {
  groupId: number;
  /** 問い文。変わったら集め直す（サーバーがembeddingを作り直す）。 */
  question: string;
  /** 自分で入れた示唆の数。入れた示唆はAIの一覧から消えるので、変わったら読み直す。 */
  memberCount: number;
  busy: boolean;
  onAddInsight: (insightId: number) => Promise<void>;
}

const SECTIONS: { type: SemanticSourceType; label: string }[] = [
  { type: "insight", label: "示唆" },
  { type: "knowledge", label: "ナレッジ" },
  { type: "journal", label: "日記" },
];

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : "操作を完了できませんでした。";
}

/**
 * 問いに近い示唆・ナレッジ・日記をAIが並べる（#95）。確認はせず、合わないものだけ「外す」。
 * 外したものはこの問いには二度と出ない（下の一覧から戻せる）。示唆は「問いに入れる」で自分の示唆にできる。
 */
export function QuestionMaterialsPanel({ groupId, question, memberCount, busy, onAddInsight }: Props) {
  const [data, setData] = useState<QuestionMaterials | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getQuestionMaterials(groupId));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => { void load(); }, [load, question, memberCount]);
  useEffect(() => { setShowExcluded(false); }, [groupId]);

  const change = async (action: "exclude" | "restore", type: SemanticSourceType, id: string) => {
    setWorking(true);
    setError(null);
    try {
      await changeQuestionMaterial(groupId, action, type, id);
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setWorking(false);
    }
  };

  const addInsight = async (item: SemanticSearchResult) => {
    setWorking(true);
    setError(null);
    try {
      await onAddInsight(Number(item.source_id));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setWorking(false);
    }
  };

  const disabled = busy || working || loading;
  const knowledgeLink = (id: string, label: string) => (
    <a href={dashboardRoutePath(window.location.href, { kind: "knowledge", knowledgeId: id })}>{label}</a>
  );

  return (
    <section className="question-materials" aria-label="AIが集めた材料">
      <div className="question-materials-head">
        <h4>AIが集めた材料</h4>
        <p>問い文に意味が近いもの（近さ0.45以上）を並べています。合わないものは「外す」と、この問いには二度と出ません。</p>
      </div>
      {loading && !data && <p className="muted" role="status">材料を集めています…</p>}
      {error && <div className="err compact" role="alert">{error}</div>}
      {data?.note && <p className="question-materials-note">{data.note}</p>}

      {data && !data.note && SECTIONS.map(({ type, label }) => {
        const items = data.materials.filter((item) => item.source_type === type);
        return (
          <div className="question-materials-group" key={type}>
            <h5>{label} <span>{items.length}件</span></h5>
            {items.length === 0 ? <p className="muted">近い{label}はありません。</p> : (
              <ul>
                {items.map((item) => (
                  <li key={`${type}:${item.source_id}`} className={`question-material ${type}`}>
                    <div className="question-material-text">
                      {type === "insight" ? (
                        <>
                          <p>{item.body}</p>
                          <small>{item.knowledge_id ? knowledgeLink(item.knowledge_id, item.title) : item.title}</small>
                        </>
                      ) : type === "knowledge" ? (
                        <>
                          <strong>{item.knowledge_id ? knowledgeLink(item.knowledge_id, item.title) : item.title}</strong>
                          <p className="question-material-body">{item.body}</p>
                        </>
                      ) : (
                        <>
                          <strong>{item.title}</strong>
                          <p className="question-material-body">{item.body}</p>
                        </>
                      )}
                    </div>
                    <div className="question-material-actions">
                      <span className="question-material-similarity" title="問い文との意味の近さ（1に近いほど近い）">{item.similarity.toFixed(2)}</span>
                      {type === "insight" && (
                        <button type="button" onClick={() => void addInsight(item)} disabled={disabled}>問いに入れる</button>
                      )}
                      <button type="button" className="text-button" onClick={() => void change("exclude", type, item.source_id)} disabled={disabled}>外す</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
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
                <li key={`${item.source_type}:${item.source_id}`}>
                  <span>{SECTIONS.find((section) => section.type === item.source_type)?.label}</span>
                  <p>{item.source_type === "insight" ? item.body : item.title}</p>
                  <button type="button" onClick={() => void change("restore", item.source_type, item.source_id)} disabled={disabled}>戻す</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

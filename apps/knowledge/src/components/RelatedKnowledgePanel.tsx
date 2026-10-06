import { useEffect, useState } from "react";
import { getRelatedKnowledge } from "../lib/api";
import { dashboardRoutePath } from "../lib/dashboardRoute";
import type { RelatedItem } from "../types";

interface Props {
  knowledgeId: string;
  /** 関連するナレッジ（示唆なら元のナレッジ）を、復習画面の上で詳細として開く。 */
  onOpenKnowledge: (id: string) => void;
}

const SECTIONS: { kind: RelatedItem["kind"]; label: string }[] = [
  { kind: "knowledge", label: "近いナレッジ" },
  { kind: "insight", label: "ほかのナレッジの示唆" },
  { kind: "question", label: "関係しそうな問い" },
];

/**
 * 答え合わせ画面の「関連」欄（#97）。このナレッジに意味の近いナレッジ・示唆・問いを並べる。
 * 読むだけで、採点・習熟度・次回の復習には関わらない。取得に失敗しても復習は続けられる。
 */
export function RelatedKnowledgePanel({ knowledgeId, onOpenKnowledge }: Props) {
  const [items, setItems] = useState<RelatedItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setItems(null);
    setFailed(false);
    getRelatedKnowledge(knowledgeId)
      .then((result) => { if (active) setItems(result); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [knowledgeId]);

  if (failed) return <p className="muted related-knowledge-error">関連ナレッジを読み込めませんでした。</p>;
  if (!items) return <p className="muted related-knowledge-loading" role="status">関連を探しています…</p>;
  if (items.length === 0) return null;

  return (
    <section className="related-knowledge" aria-label="関連">
      <h3>関連</h3>
      {SECTIONS.map(({ kind, label }) => {
        const rows = items.filter((item) => item.kind === kind);
        if (rows.length === 0) return null;
        return (
          <div className="related-knowledge-group" key={kind}>
            <h4>{label}</h4>
            <ul>
              {rows.map((item) => (
                <li key={`${kind}:${item.item_id}`}>
                  {kind === "question" ? (
                    <a
                      className="related-knowledge-item"
                      href={dashboardRoutePath(window.location.href, { kind: "organize", tab: "questions", questionId: Number(item.item_id) })}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <strong>{item.body}</strong>
                      <small>問いを開く（別タブ）</small>
                    </a>
                  ) : (
                    <button
                      type="button"
                      className="related-knowledge-item"
                      onClick={() => item.knowledge_id && onOpenKnowledge(item.knowledge_id)}
                      disabled={!item.knowledge_id}
                    >
                      {kind === "insight" ? (
                        <><span>{item.body}</span><small>{item.title}</small></>
                      ) : (
                        <><strong>{item.title}</strong><small className="related-knowledge-body">{item.body}</small></>
                      )}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

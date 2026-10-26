import { useState } from "react";
import { useCardMasteryHistory } from "../hooks/useCardMasteryHistory";
import { useCardAnswers } from "../hooks/useCardAnswers";

const VERDICT_CLASS: Record<string, string> = {
  正解: "quiz-verdict-ok", 部分正解: "quiz-verdict-partial", 不正解: "quiz-verdict-ng",
};
function dateTime(value: string): string {
  return new Date(value).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** 詳細から見返す読み取り専用の履歴。開いても採点結果を確認済みにはしない。 */
export function KnowledgeReviewHistory({ knowledgeId, reloadKey }: { knowledgeId: string; reloadKey: unknown }) {
  const [masteryOpen, setMasteryOpen] = useState(false);
  const mastery = useCardMasteryHistory(knowledgeId, masteryOpen, reloadKey);
  const history = useCardAnswers(knowledgeId, reloadKey);
  const answers = history.items;
  const changes = mastery.changes;

  return (
    <section className="history-section knowledge-review-history" aria-label="このナレッジの復習履歴">
      <h3>復習履歴 <span>{history.total}件</span></h3>
      {history.loading && <p role="status">読み込み中…</p>}
      {history.error && <p className="err compact" role="alert">{history.error}<button onClick={() => void history.load()}>再試行</button></p>}
      {!history.loading && !history.error && answers.length === 0 ? <p className="muted">回答履歴はありません。</p> : (
        <>
          <ol className="knowledge-answer-list">
            {answers.map((entry) => (
              <li key={entry.id}>
                <details>
                  <summary>
                    <time dateTime={entry.answered_at ?? entry.asked_on}>{entry.answered_at ? dateTime(entry.answered_at) : entry.asked_on}</time>
                    <span className={`badge ${VERDICT_CLASS[entry.verdict] ?? ""}`}>{entry.verdict}</span>
                    <span>{entry.format}</span><span className="muted">評価 {entry.quality} / 5</span>
                  </summary>
                  <dl className="review-result-body">
                    {entry.question && <div><dt>問題</dt><dd>{entry.question}</dd></div>}
                    {entry.user_answer !== null && <div><dt>あなたの回答</dt><dd>{entry.user_answer || "（空欄）"}</dd></div>}
                    {entry.correct_answer && <div><dt>模範解答</dt><dd>{entry.correct_answer}</dd></div>}
                    {entry.explanation && <div><dt>講評</dt><dd>{entry.explanation}</dd></div>}
                    {entry.note && <div><dt>メモ</dt><dd>{entry.note}</dd></div>}
                  </dl>
                  {!entry.question && entry.user_answer === null && !entry.correct_answer && !entry.explanation && !entry.note && (
                    <p className="muted">問題・回答の記録はありません。</p>
                  )}
                </details>
              </li>
            ))}
          </ol>
          {history.total > answers.length && <button disabled={history.loading} onClick={() => void history.load()}>回答をさらに表示（残り{history.total - answers.length}件）</button>}
        </>
      )}
      <details className="knowledge-mastery-history" onToggle={(event) => setMasteryOpen(event.currentTarget.open)}>
        <summary>習熟度の変化 <span>{mastery.loading ? "読み込み中…" : mastery.error ? "取得失敗" : masteryOpen ? `${mastery.total}件` : ""}</span></summary>
        {mastery.loading ? <p role="status">読み込み中…</p> : mastery.error ? (
          <p className="err compact" role="alert">習熟度の履歴を取得できませんでした。<button onClick={() => void mastery.load()}>再試行</button></p>
        ) : changes.length === 0 ? <p className="muted">習熟度の変更履歴はありません。</p> : (
          <>
            <ol className="knowledge-mastery-list">
              {changes.map((entry) => (
                <li key={entry.id}>
                  <time dateTime={entry.changed_at}>{dateTime(entry.changed_at)}</time>
                  <span>{entry.is_baseline ? `記録開始時点：${entry.to_mastery}` : entry.from_mastery ? `${entry.from_mastery} → ${entry.to_mastery}` : entry.to_mastery}</span>
                </li>
              ))}
            </ol>
            {mastery.total > changes.length && <button disabled={mastery.loading} onClick={() => void mastery.load()}>習熟度をさらに表示（残り{mastery.total - changes.length}件）</button>}
          </>
        )}
      </details>
    </section>
  );
}

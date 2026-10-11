import { useMemo } from "react";
import { pastAnswers } from "../lib/answerHistory";
import type { QuizLog } from "../types";

const VERDICT_CLASS: Record<string, string> = {
  正解: "quiz-verdict-ok",
  部分正解: "quiz-verdict-partial",
  不正解: "quiz-verdict-ng",
};

function answeredAt(entry: QuizLog): string {
  if (!entry.answered_at) return entry.asked_on;
  return new Date(entry.answered_at).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/**
 * 答え合わせ画面で、そのカードの過去の回答を見返す。答えを見た後だけ出す（回答前に出すとヒントになる）。
 * 問題キュー経由の記録は問題・回答・模範解答・講評まで、以前の記録は判定とメモだけを持つ。
 */
export function ReviewAnswerHistory({ quizLog, knowledgeId, currentQueueId }: {
  quizLog: QuizLog[];
  knowledgeId: string;
  currentQueueId: number;
}) {
  const history = useMemo(
    () => pastAnswers(quizLog, knowledgeId, currentQueueId),
    [quizLog, knowledgeId, currentQueueId],
  );

  return (
    <details className="review-answer-history">
      <summary>過去の回答履歴 <span>{history.length}件</span></summary>
      {history.length === 0 ? <p className="muted">このカードに答えるのは今回が初めてです。</p> : (
        <ol>
          {history.map((entry) => (
            <li key={entry.id}>
              <p className="review-answer-history-head">
                <span>{answeredAt(entry)}</span>
                <span className={`badge ${VERDICT_CLASS[entry.verdict] ?? ""}`}>{entry.verdict}</span>
                <span className="quiz-question-format">{entry.format}</span>
                <span className="muted">q{entry.quality}</span>
              </p>
              <dl className="review-result-body">
                {entry.question && <div><dt>問題</dt><dd>{entry.question}</dd></div>}
                {entry.user_answer !== null && <div><dt>あなたの回答</dt><dd>{entry.user_answer || "（空欄）"}</dd></div>}
                {entry.correct_answer && <div><dt>模範解答</dt><dd>{entry.correct_answer}</dd></div>}
                {entry.explanation && <div><dt>講評</dt><dd>{entry.explanation}</dd></div>}
                {entry.note && <div><dt>メモ</dt><dd>{entry.note}</dd></div>}
              </dl>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}

import { useState } from "react";
import { useQuiz } from "../hooks/useQuiz";
import type { QuizMode } from "../types";

const MODE_LABELS: Record<QuizMode, string> = {
  english: "英語",
  non_english: "英語以外",
  all: "すべて",
};

const VERDICT_CLASS: Record<string, string> = {
  正解: "quiz-verdict-ok",
  部分正解: "quiz-verdict-partial",
  不正解: "quiz-verdict-ng",
};

export function QuizView({ onExit }: { onExit: () => void }) {
  const quiz = useQuiz();
  const [mode, setMode] = useState<QuizMode>("all");

  return (
    <div className="quiz-page">
      <header className="quiz-header">
        <button className="text-button" onClick={onExit}>← ダッシュボードへ戻る</button>
        <h1>復習クイズ</h1>
      </header>

      <main className="quiz-body">
        {quiz.error && <div className="err compact" role="alert">{quiz.error}</div>}

        {quiz.stage === "setup" && (
          <div className="quiz-setup card">
            <p>出題するカテゴリを選んでください。</p>
            <div className="quiz-mode-select" role="radiogroup" aria-label="出題カテゴリ">
              {(Object.keys(MODE_LABELS) as QuizMode[]).map((value) => (
                <button
                  key={value}
                  role="radio"
                  aria-checked={mode === value}
                  className={mode === value ? "active" : ""}
                  onClick={() => setMode(value)}
                >
                  {MODE_LABELS[value]}
                </button>
              ))}
            </div>
            <button className="primary-button quiz-start-button" onClick={() => void quiz.start(mode)}>
              出題する
            </button>
          </div>
        )}

        {quiz.stage === "loading" && <div className="msg">出題を準備中...</div>}

        {quiz.stage === "empty" && (
          <div className="quiz-setup card">
            <p>
              {quiz.emptyReason === "done_today"
                ? "本日の出題は終わっています。このカテゴリは全問採点済みです。"
                : "このカテゴリに出題できるナレッジがありません。"}
            </p>
            <button className="primary-button" onClick={quiz.reset}>戻る</button>
          </div>
        )}

        {quiz.stage === "quiz" && quiz.early && (
          <p className="quiz-early-note">本日期限の分はないので、復習日が近い順に出します。</p>
        )}

        {quiz.stage === "quiz" && (
          <QuizQuestionCard
            index={quiz.index}
            total={quiz.questions.length}
            question={quiz.questions[quiz.index]?.question ?? ""}
            answer={quiz.answers[quiz.questions[quiz.index]?.id ?? ""] ?? ""}
            onAnswer={quiz.answerCurrent}
            onBack={quiz.goBack}
            onNext={quiz.goNext}
            onSubmit={() => void quiz.submit()}
            isLast={quiz.index === quiz.questions.length - 1}
          />
        )}

        {quiz.stage === "grading" && <div className="msg">採点中...</div>}

        {quiz.stage === "results" && (
          <div className="quiz-results">
            <ul className="quiz-result-list">
              {quiz.questions.map((question) => {
                const result = quiz.results.find((r) => r.id === question.id);
                if (!result) return null;
                return (
                  <li key={question.id} className="quiz-result-item card">
                    <div className="quiz-result-head">
                      <span className={`badge ${VERDICT_CLASS[result.verdict] ?? ""}`}>{result.verdict}</span>
                      <span className="quiz-result-q">q{result.quality}</span>
                      {!result.recorded && <span className="muted">（本日分は記録済み）</span>}
                    </div>
                    <p className="quiz-result-question">{question.question}</p>
                    <div className="content-block">
                      <h3>正解</h3>
                      <p>{result.correct_answer}</p>
                      <p className="quiz-result-source">{result.title}</p>
                    </div>
                    <div className="content-block">
                      <h3>解説</h3>
                      <p>{result.explanation}</p>
                    </div>
                    {result.next_review_on && (
                      <p className="muted">次回復習日: {result.next_review_on}</p>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="quiz-result-actions">
              <button className="primary-button" onClick={quiz.reset}>もう一度</button>
              <button onClick={onExit}>ダッシュボードへ戻る</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function QuizQuestionCard({
  index, total, question, answer, onAnswer, onBack, onNext, onSubmit, isLast,
}: {
  index: number;
  total: number;
  question: string;
  answer: string;
  onAnswer: (text: string) => void;
  onBack: () => void;
  onNext: () => void;
  onSubmit: () => void;
  isLast: boolean;
}) {
  return (
    <div className="quiz-question card">
      <p className="quiz-progress">{index + 1} / {total}</p>
      <p className="quiz-question-text">{question}</p>
      <textarea
        className="quiz-answer-input"
        rows={5}
        value={answer}
        placeholder="回答を入力"
        autoFocus
        onChange={(event) => onAnswer(event.target.value)}
      />
      <div className="quiz-question-actions">
        <button onClick={onBack} disabled={index === 0}>← 前へ</button>
        {isLast ? (
          <button className="primary-button" onClick={onSubmit}>採点する</button>
        ) : (
          <button className="primary-button" onClick={onNext}>次へ →</button>
        )}
      </div>
    </div>
  );
}

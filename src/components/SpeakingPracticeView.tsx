import { useEffect, useMemo, useState } from "react";
import { getSpeakingPracticeLog, recordSpeakingPractice } from "../lib/api";
import {
  buildSpeakingPracticeSession,
  speakingPracticeCandidates,
  speakingPracticeStats,
  type SpeakingPracticeCard,
  type SpeakingPracticeMode,
} from "../lib/speakingPractice";
import type {
  Knowledge,
  SpeakingPracticeLog,
  SpeakingPracticeRating,
} from "../types";

interface Props {
  knowledge: Knowledge[];
  loading: boolean;
  error: string | null;
  onExit: () => void;
}

interface SessionCard extends SpeakingPracticeCard {
  attemptId: string;
}

const MODE_LABELS: Record<SpeakingPracticeMode, string> = {
  mixed: "ミックス",
  instant_composition: "瞬間英作文",
  read_aloud: "音読",
};

const RATING_LABELS: Record<SpeakingPracticeRating, string> = {
  smooth: "言えた",
  almost: "ほぼ言えた",
  retry: "もう一度",
};

function recentFrom(): string {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
}

export function SpeakingPracticeView({ knowledge, loading, error, onExit }: Props) {
  const candidates = useMemo(() => speakingPracticeCandidates(knowledge), [knowledge]);
  const [mode, setMode] = useState<SpeakingPracticeMode>("mixed");
  const [limit, setLimit] = useState(5);
  const [phase, setPhase] = useState<"setup" | "practice" | "complete">("setup");
  const [cards, setCards] = useState<SessionCard[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [answer, setAnswer] = useState("");
  const [repetitions, setRepetitions] = useState(0);
  const [ratings, setRatings] = useState<SpeakingPracticeRating[]>([]);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [logs, setLogs] = useState<SpeakingPracticeLog[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getSpeakingPracticeLog(recentFrom())
      .then((items) => { if (active) setLogs(items); })
      .catch((caught) => {
        if (active) setHistoryError(caught instanceof Error ? caught.message : "練習履歴を取得できませんでした。");
      });
    return () => {
      active = false;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  const stats = useMemo(() => speakingPracticeStats(logs), [logs]);
  const current = cards[index];
  const canRate = current?.type === "instant_composition" ? revealed : repetitions >= 3;

  const start = () => {
    const nextCards = buildSpeakingPracticeSession(knowledge, mode, limit).map((card) => ({
      ...card,
      attemptId: crypto.randomUUID(),
    }));
    if (nextCards.length === 0) return;
    setCards(nextCards);
    setSessionId(crypto.randomUUID());
    setIndex(0);
    setRevealed(false);
    setAnswer("");
    setRepetitions(0);
    setRatings([]);
    setActionError(null);
    setPhase("practice");
  };

  const speakSample = () => {
    if (!current || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(current.target);
    utterance.lang = "en-US";
    utterance.rate = 0.82;
    const voice = window.speechSynthesis.getVoices().find((item) => item.lang.toLowerCase().startsWith("en"));
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  };

  const rate = async (rating: SpeakingPracticeRating) => {
    if (!current || !canRate || saving) return;
    setSaving(true);
    setActionError(null);
    try {
      const recorded = await recordSpeakingPractice({
        attempt_id: current.attemptId,
        session_id: sessionId,
        knowledge_id: current.knowledge.id,
        practice_type: current.type,
        rating,
        answer_text: current.type === "instant_composition" ? answer.trim() || null : null,
        repetitions: current.type === "read_aloud" ? repetitions : 1,
      });
      setLogs((items) => [recorded, ...items.filter((item) => item.attempt_id !== recorded.attempt_id)]);
      setRatings((items) => [...items, rating]);
      if (index + 1 >= cards.length) {
        setPhase("complete");
      } else {
        setIndex((value) => value + 1);
        setRevealed(false);
        setAnswer("");
        setRepetitions(0);
      }
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "練習記録を保存できませんでした。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="speaking-page">
      <header className="speaking-header">
        <button className="secondary-button" onClick={onExit}>← Knowledge</button>
        <div>
          <span>ENGLISH SPEAKING</span>
          <h1>英会話練習</h1>
        </div>
        <span className="speaking-independent">復習とは別に記録</span>
      </header>

      <main className="speaking-body">
        {loading && <div className="msg">英語ナレッジを読み込み中...</div>}
        {!loading && error && <div className="err">エラー: {error}</div>}

        {!loading && !error && phase === "setup" && (
          <section className="card speaking-setup">
            <div className="speaking-setup-intro">
              <span className="speaking-kicker">PRACTICE, NOT REVIEW</span>
              <h2>声に出すための練習</h2>
              <p>英語ナレッジの意味から表現を思い出す練習と、表示されたフレーズを3回読む練習です。採点や次回復習日は変更しません。</p>
            </div>

            <div className="speaking-history" aria-label="最近の練習記録">
              <div><strong>{stats.today}</strong><span>今日の練習</span></div>
              <div><strong>{stats.smooth}</strong><span>今日「言えた」</span></div>
              <div><strong>{stats.recent}</strong><span>直近7日</span></div>
            </div>
            {historyError && <p className="speaking-history-error">履歴のみ取得できません: {historyError}</p>}

            <fieldset className="speaking-options">
              <legend>練習メニュー</legend>
              <div className="speaking-choice-row">
                {(Object.keys(MODE_LABELS) as SpeakingPracticeMode[]).map((value) => (
                  <button
                    type="button"
                    key={value}
                    className={mode === value ? "active" : ""}
                    onClick={() => setMode(value)}
                  >
                    {MODE_LABELS[value]}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="speaking-options">
              <legend>問題数</legend>
              <div className="speaking-choice-row">
                {[5, 10, 15].map((value) => (
                  <button
                    type="button"
                    key={value}
                    className={limit === value ? "active" : ""}
                    onClick={() => setLimit(value)}
                  >
                    {value}問
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="speaking-start-row">
              <span>練習候補 {candidates.length}件</span>
              <button className="primary-button" onClick={start} disabled={candidates.length === 0}>
                この内容で始める
              </button>
            </div>
            {candidates.length === 0 && (
              <div className="msg">カテゴリまたはタグが「英語」で、英字タイトルを持つナレッジがありません。</div>
            )}
          </section>
        )}

        {!loading && !error && phase === "practice" && current && (
          <section className="card speaking-card">
            <div className="speaking-progress">
              <span>{index + 1} / {cards.length}</span>
              <div aria-hidden="true"><span style={{ width: `${((index + 1) / cards.length) * 100}%` }} /></div>
              <strong>{MODE_LABELS[current.type]}</strong>
            </div>

            <div className={`speaking-task ${current.type}`}>
              <p className="speaking-prompt">{current.prompt}</p>
              {current.type === "read_aloud" && (
                <blockquote lang="en">{current.target}</blockquote>
              )}
            </div>

            {current.type === "instant_composition" && !revealed && (
              <div className="speaking-answer-area">
                <label htmlFor="speaking-answer">言った表現を入力（任意）</label>
                <textarea
                  id="speaking-answer"
                  rows={3}
                  maxLength={2000}
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  placeholder="入力せず、声に出すだけでも記録できます"
                />
                <button className="primary-button" onClick={() => setRevealed(true)}>答えを見る</button>
              </div>
            )}

            {current.type === "instant_composition" && revealed && (
              <div className="speaking-reveal" role="status">
                <span>登録されている表現</span>
                <strong lang="en">{current.target}</strong>
                {current.knowledge.explanation && <p>{current.knowledge.explanation.slice(0, 800)}</p>}
                <button className="secondary-button" onClick={speakSample}>🔊 お手本を聞く</button>
              </div>
            )}

            {current.type === "read_aloud" && (
              <div className="read-aloud-controls">
                <button className="secondary-button" onClick={speakSample}>🔊 お手本を聞く</button>
                <button
                  className="primary-button"
                  onClick={() => setRepetitions((value) => Math.min(3, value + 1))}
                  disabled={repetitions >= 3}
                >
                  {repetitions >= 3 ? "3回音読しました" : `音読した（${repetitions + 1}回目）`}
                </button>
                <div className="repetition-dots" aria-label={`${repetitions}回音読済み`}>
                  {[1, 2, 3].map((value) => <span key={value} className={value <= repetitions ? "done" : ""} />)}
                </div>
              </div>
            )}

            {canRate && (
              <div className="speaking-rating">
                <span>声に出した感触は？</span>
                <div>
                  {(Object.keys(RATING_LABELS) as SpeakingPracticeRating[]).map((rating) => (
                    <button
                      key={rating}
                      className={`rating-${rating}`}
                      disabled={saving}
                      onClick={() => void rate(rating)}
                    >
                      {RATING_LABELS[rating]}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {actionError && <div className="err compact" role="alert">{actionError}</div>}
          </section>
        )}

        {!loading && !error && phase === "complete" && (
          <section className="card speaking-complete">
            <span className="speaking-complete-mark" aria-hidden="true">✓</span>
            <h2>{cards.length}件の練習を記録しました</h2>
            <p>復習スケジュールは変更していません。</p>
            <div className="speaking-result-counts">
              {(Object.keys(RATING_LABELS) as SpeakingPracticeRating[]).map((rating) => (
                <div key={rating}>
                  <strong>{ratings.filter((value) => value === rating).length}</strong>
                  <span>{RATING_LABELS[rating]}</span>
                </div>
              ))}
            </div>
            <div className="speaking-complete-actions">
              <button className="secondary-button" onClick={onExit}>Knowledgeへ戻る</button>
              <button className="primary-button" onClick={() => setPhase("setup")}>もう一度練習する</button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

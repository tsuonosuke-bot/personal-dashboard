import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  getSpeakingPracticeLog,
  recordSpeakingPractice,
  startSpeakingPractice,
} from "../lib/api";
import {
  readingChunks,
  selectSpeakingPracticeKnowledge,
  SPEAKING_MAX_ITEMS,
  speakingPracticeCandidates,
  speakingPracticeEmptyReason,
  speakingPracticeGroups,
  speakingPracticePool,
  speakingPracticeStats,
  speechSynthesisSupported,
  type SpeakingPracticeCard,
  type SpeakingPracticeMode,
  type SpeakingPracticeScope,
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

const SCOPE_LABELS: Record<SpeakingPracticeScope["kind"], string> = {
  all: "おまかせ",
  category: "カテゴリ",
  tag: "タグ",
  cards: "カードを選ぶ",
};

const RATING_LABELS: Record<SpeakingPracticeRating, string> = {
  smooth: "言えた",
  almost: "ほぼ言えた",
  retry: "もう一度",
};

function recentFrom(): string {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
}

function generationErrorMessage(caught: unknown): string {
  if (!(caught instanceof ApiError)) {
    return caught instanceof Error ? caught.message : "AI例文を生成できませんでした。";
  }
  return [caught.message, caught.reason, caught.action].filter(Boolean).join(" ");
}

export function SpeakingPracticeView({ knowledge, loading, error, onExit }: Props) {
  const candidates = useMemo(() => speakingPracticeCandidates(knowledge), [knowledge]);
  const groups = useMemo(() => speakingPracticeGroups(candidates), [candidates]);
  const [scopeKind, setScopeKind] = useState<SpeakingPracticeScope["kind"]>("all");
  const [scopeCategory, setScopeCategory] = useState("");
  const [scopeTag, setScopeTag] = useState("");
  const [scopeCards, setScopeCards] = useState<string[]>([]);
  const [cardQuery, setCardQuery] = useState("");
  const scope: SpeakingPracticeScope = scopeKind === "category" ? { kind: "category", category: scopeCategory }
    : scopeKind === "tag" ? { kind: "tag", tag: scopeTag }
      : scopeKind === "cards" ? { kind: "cards", ids: scopeCards }
        : { kind: "all" };
  const pool = speakingPracticePool(candidates, scope);
  const emptyReason = speakingPracticeEmptyReason(candidates, scope);
  const visibleCards = useMemo(() => {
    const query = cardQuery.trim().toLowerCase();
    return query ? candidates.filter((item) => `${item.title} ${item.category} ${item.tags.join(" ")}`.toLowerCase().includes(query)) : candidates;
  }, [candidates, cardQuery]);
  const speechSupported = useMemo(() => speechSynthesisSupported(window), []);
  const [speechError, setSpeechError] = useState<string | null>(null);
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
  const [generating, setGenerating] = useState(false);
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

  const start = async () => {
    if (generating) return;
    const selected = selectSpeakingPracticeKnowledge(knowledge, limit, Math.random, scope);
    if (selected.length === 0) return;
    setGenerating(true);
    setActionError(null);
    try {
      const generated = await startSpeakingPractice(selected.map((item) => item.id), mode);
      const selectedById = new Map(selected.map((item) => [item.id, item]));
      const nextCards: SessionCard[] = generated.items.map((item) => {
        const source = selectedById.get(item.knowledge_id);
        if (!source) throw new Error("AI例文と元のナレッジを対応できませんでした。");
        return {
          knowledge: source,
          type: item.practice_type,
          prompt: item.prompt_ja,
          target: item.target_en,
          attemptId: crypto.randomUUID(),
        };
      });
      if (nextCards.length !== selected.length) {
        throw new Error("AI例文の件数がナレッジと一致しませんでした。");
      }
      setCards(nextCards);
      setSessionId(crypto.randomUUID());
      setIndex(0);
      setRevealed(false);
      setAnswer("");
      setRepetitions(0);
      setRatings([]);
      setPhase("practice");
    } catch (caught) {
      setActionError(generationErrorMessage(caught));
    } finally {
      setGenerating(false);
    }
  };

  const speakSample = () => {
    if (!current || !speechSupported) return;
    setSpeechError(null);
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(current.target);
      utterance.lang = "en-US";
      utterance.rate = 0.82;
      const voice = window.speechSynthesis.getVoices().find((item) => item.lang.toLowerCase().startsWith("en"));
      if (voice) utterance.voice = voice;
      utterance.onerror = (event) => {
        if (event.error === "canceled" || event.error === "interrupted") return;
        setSpeechError("お手本を再生できませんでした。下の区切りを目安に、ゆっくり読んでください。");
      };
      window.speechSynthesis.speak(utterance);
    } catch {
      setSpeechError("お手本を再生できませんでした。下の区切りを目安に、ゆっくり読んでください。");
    }
  };

  // 音声が使えない（非対応・再生失敗）ときは、ボタンを無反応にせず理由と区切り読みを示す。
  const sampleControls = (target: string) => (
    <div className="speaking-sample">
      <button
        className="secondary-button"
        onClick={speakSample}
        disabled={!speechSupported}
        aria-describedby={!speechSupported || speechError ? "speaking-sample-note" : undefined}
      >
        🔊 お手本を聞く
      </button>
      {(!speechSupported || speechError) && (
        <div id="speaking-sample-note" className="speaking-sample-note" role="note">
          <p>{speechError ?? "このブラウザは音声の読み上げに対応していないため、お手本を再生できません。区切りごとに、ゆっくり読んでみてください。"}</p>
          <p className="speaking-chunks" lang="en">{readingChunks(target).map((chunk, chunkIndex) => <span key={chunkIndex}>{chunk}</span>)}</p>
        </div>
      )}
    </div>
  );

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
        setSpeechError(null);
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
            <h2 className="speaking-setup-title">練習を始める</h2>

            <fieldset className="speaking-options">
              <legend>練習する対象</legend>
              <div className="speaking-choice-row" role="radiogroup" aria-label="練習する対象">
                {(Object.keys(SCOPE_LABELS) as SpeakingPracticeScope["kind"][]).map((value) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={scopeKind === value}
                    key={value}
                    className={scopeKind === value ? "active" : ""}
                    onClick={() => setScopeKind(value)}
                  >
                    {SCOPE_LABELS[value]}
                  </button>
                ))}
              </div>
              {scopeKind === "category" && (
                <label className="speaking-scope-field">
                  <span>カテゴリ</span>
                  <select value={scopeCategory} onChange={(event) => setScopeCategory(event.target.value)}>
                    <option value="">選んでください</option>
                    {groups.categories.map((item) => <option key={item.name} value={item.name}>{item.name}（{item.total}件）</option>)}
                  </select>
                </label>
              )}
              {scopeKind === "tag" && (
                <label className="speaking-scope-field">
                  <span>タグ</span>
                  <select value={scopeTag} onChange={(event) => setScopeTag(event.target.value)}>
                    <option value="">選んでください</option>
                    {groups.tags.map((item) => <option key={item.name} value={item.name}>#{item.name}（{item.total}件）</option>)}
                  </select>
                </label>
              )}
              {scopeKind === "cards" && (
                <div className="speaking-card-picker">
                  <label className="speaking-scope-field">
                    <span>カードを探す</span>
                    <input type="text" value={cardQuery} onChange={(event) => setCardQuery(event.target.value)} placeholder="タイトル・カテゴリ・タグ" />
                  </label>
                  <p className="speaking-card-picker-count" aria-live="polite">{scopeCards.length}件を選択（最大{SPEAKING_MAX_ITEMS}件）{scopeCards.length > 0 && <button type="button" className="text-button" onClick={() => setScopeCards([])}>選択を解除</button>}</p>
                  <ul>
                    {visibleCards.map((item) => {
                      const checked = scopeCards.includes(item.id);
                      return (
                        <li key={item.id}>
                          <label>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!checked && scopeCards.length >= SPEAKING_MAX_ITEMS}
                              onChange={() => setScopeCards((ids) => checked ? ids.filter((id) => id !== item.id) : [...ids, item.id])}
                            />
                            <span lang="en">{item.title}</span>
                            <small>{item.category}</small>
                          </label>
                        </li>
                      );
                    })}
                    {visibleCards.length === 0 && <li className="speaking-card-picker-empty">一致するカードがありません。</li>}
                  </ul>
                </div>
              )}
            </fieldset>

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

            {scopeKind !== "cards" && (
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
            )}

            <div className="speaking-start-row">
              <span>
                対象 {pool.length}件
                {scopeKind !== "cards" && pool.length > 0 && pool.length < limit && `（${pool.length}問で始めます）`}
              </span>
              <button
                className="primary-button"
                onClick={() => void start()}
                disabled={pool.length === 0 || generating}
                aria-describedby={emptyReason ? "speaking-empty-reason" : undefined}
              >
                {generating ? "AIが例文を作成中..." : "AIで例文を作って始める"}
              </button>
            </div>
            {generating && <p className="speaking-generation-note">ナレッジの意味を確認しています。数秒かかることがあります。</p>}
            {actionError && <div className="err compact" role="alert">{actionError}</div>}
            {emptyReason && <div id="speaking-empty-reason" className="msg speaking-empty-reason">{emptyReason}</div>}

            <div className="speaking-history" aria-label="最近の練習記録">
              <div><strong>{stats.today}</strong><span>今日の練習</span></div>
              <div><strong>{stats.smooth}</strong><span>今日「言えた」</span></div>
              <div><strong>{stats.recent}</strong><span>直近7日</span></div>
            </div>
            {historyError && <p className="speaking-history-error">履歴のみ取得できません: {historyError}</p>}

            <details className="speaking-setup-intro">
              <summary>この練習について</summary>
              <p>AIが英語ナレッジから短いビジネス例文を作ります。平易な日本語からの瞬間英作文と、実際の仕事場面に合う例文の音読を練習できます。記録は復習とは別に残り、復習スケジュールは変わりません。</p>
            </details>
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
              <p className="speaking-prompt">
                {current.type === "instant_composition"
                  ? "次の日本語を英語で言ってください。"
                  : "次の短いビジネス例文を3回音読してください。"}
              </p>
              {current.type === "instant_composition" && (
                <blockquote className="speaking-japanese-prompt" lang="ja">{current.prompt}</blockquote>
              )}
              {current.type === "read_aloud" && (
                <>
                  <blockquote lang="en">{current.target}</blockquote>
                  <p className="speaking-translation">意味: {current.prompt}</p>
                </>
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
                <span>AIが作成したビジネス例文</span>
                <strong lang="en">{current.target}</strong>
                <p>使ったナレッジ: <span lang="en">{current.knowledge.title}</span></p>
                {sampleControls(current.target)}
              </div>
            )}

            {current.type === "read_aloud" && (
              <div className="read-aloud-controls">
                {sampleControls(current.target)}
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

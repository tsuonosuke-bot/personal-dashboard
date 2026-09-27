import { speakingPracticeCandidates } from "../lib/speakingPractice";
import type { Knowledge } from "../types";

interface Props {
  knowledge: Knowledge[];
  onStart: () => void;
}

export function SpeakingPracticePanel({ knowledge, onStart }: Props) {
  const count = speakingPracticeCandidates(knowledge).length;
  return (
    <section className="card speaking-entry" aria-labelledby="speaking-entry-title">
      <div>
        <span className="speaking-kicker">SPEAKING PRACTICE</span>
        <h2 id="speaking-entry-title">英会話練習</h2>
        <p>英語ナレッジを使って、瞬間英作文とフレーズ音読を練習します。復習の進捗には影響しません。</p>
      </div>
      <div className="speaking-entry-action">
        <strong>{count}</strong>
        <span>練習候補</span>
        <button className="primary-button" onClick={onStart} disabled={count === 0}>
          練習を始める
        </button>
      </div>
    </section>
  );
}

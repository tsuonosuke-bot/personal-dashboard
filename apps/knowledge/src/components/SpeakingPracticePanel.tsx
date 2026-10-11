import { speakingPracticeCandidates } from "../lib/speakingPractice";
import type { Knowledge } from "../types";

interface Props {
  knowledge: Knowledge[];
  onStart: () => void;
}

export function SpeakingPracticePanel({ knowledge, onStart }: Props) {
  const count = speakingPracticeCandidates(knowledge).length;
  return (
    <section className="speaking-entry" aria-labelledby="speaking-entry-title">
      <h2 id="speaking-entry-title">英会話練習<span>候補 {count}</span></h2>
      <button onClick={onStart} disabled={count === 0}>練習を始める</button>
    </section>
  );
}

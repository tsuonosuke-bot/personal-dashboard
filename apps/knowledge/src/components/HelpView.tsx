interface Props {
  /** 未出題の新規を1日に何件までキューへ入れるか。日次キューの状態が読めないときは既定値を出す。 */
  newLimit: number;
  onExit: () => void;
}

const SECTIONS = [
  { id: "help-today", title: "今日の学習" },
  { id: "help-schedule", title: "出題の仕組み" },
  { id: "help-progress", title: "学習の進み具合" },
  { id: "help-speaking", title: "英会話練習" },
  { id: "help-card", title: "習熟度と優先度" },
] as const;

/**
 * 画面には数字と操作だけを出し、仕組みや定義の説明はこのページにまとめる。
 * 画面の文言を変えたら、ここも合わせて直す。
 */
export function HelpView({ newLimit, onExit }: Props) {
  return (
    <div className="quiz-page help-page">
      <header className="quiz-header">
        <button className="text-button" onClick={onExit}>← ダッシュボードへ戻る</button>
      </header>
      <main className="help-body">
        <h1>ヘルプ</h1>
        <nav className="help-toc" aria-label="目次">
          {SECTIONS.map((section) => <a key={section.id} href={`#${section.id}`}>{section.title}</a>)}
        </nav>

        <section id="help-today" aria-labelledby="help-today-title">
          <h2 id="help-today-title">今日の学習</h2>
          <dl>
            <dt>今すぐ解ける</dt>
            <dd>期限が来て、問題が用意できている数です。「期限超過」は予定日を過ぎたもの、「再学習」は外してすぐにやり直すものです。</dd>
            <dt>今日の回答</dt>
            <dd>今日答えた問題数と正答率です。</dd>
            <dt>見直す講評</dt>
            <dd>外した問題（不正解・部分正解）のうち、まだ講評を確認していない数です。正解した問題の講評は確認しなくてかまいません。</dd>
          </dl>
          <p>復習はキューの上から順に、問題がある限り解き続けられます。答えた分はその都度記録されるので、途中で終えても大丈夫です。</p>
        </section>

        <section id="help-schedule" aria-labelledby="help-schedule-title">
          <h2 id="help-schedule-title">出題の仕組み</h2>
          <p>問題は30分ごとに、期限が来たナレッジの分をまとめて作ります。回答は1時間ごとに自動で採点され、外した問題の講評は「見直す講評」から確認できます。</p>
          <p>次回までの基準間隔は、q0=10分、q1=30分、q2=6時間、q3=12時間、q4=2日以上、q5=4日以上です。q4・q5は覚えていられた期間に応じて伸び（q4は2倍、q5は2.8倍）、q0〜q3は段階ごとの時刻に戻ります。</p>
          <p>正解・不正解にかかわらず、次回までの間隔には優先度の倍率がかかります（最高0.5・高1・中1.5・低2・最低3倍）。</p>
          <p>まだ出題していない新規のナレッジは、1日{newLimit}件までキューに入ります。超えた分は「今すぐ解ける」に数えず、翌日以降に回します。15件のうち通常の期限到来が5件以上あれば、再学習は最大10件です。</p>
        </section>

        <section id="help-progress" aria-labelledby="help-progress-title">
          <h2 id="help-progress-title">学習の進み具合</h2>
          <p>登録した件数ではなく、どれだけ覚えていられるかで進み具合を見ます。</p>
          <dl>
            <dt>記憶のもち</dt>
            <dd>次に忘れるまでの見込み期間ごとに、カードの枚数を数えます。未出題のカードは、出題されるとどれかの期間に入ります。</dd>
            <dt>復習の正答率（週別）</dt>
            <dd>2回目以降の出題だけで計算します。新しく覚える分は含めません。今週の棒は集計途中なので斜線で示します。</dd>
            <dt>その他のグラフ</dt>
            <dd>登録数の推移・習熟度の推移・カテゴリ別分布・習熟度分布です。毎日見る必要はないので折りたたんでいます。</dd>
          </dl>
        </section>

        <section id="help-speaking" aria-labelledby="help-speaking-title">
          <h2 id="help-speaking-title">英会話練習</h2>
          <p>英語のナレッジを使って、瞬間英作文とフレーズの音読を練習します。「候補」は練習に使える英語のナレッジの数です。練習の結果は復習の進み具合（習熟度や次回の復習日）には影響しません。</p>
        </section>

        <section id="help-card" aria-labelledby="help-card-title">
          <h2 id="help-card-title">習熟度と優先度</h2>
          <dl>
            <dt>習熟度</dt>
            <dd>未学習 → 学習中 → 習得中 → 定着 の4段階です。主に回答の結果に応じて変わります。</dd>
            <dt>優先度</dt>
            <dd>最高・高・中・低・最低の5段階です。同じ期限の中での出題順と、次回までの間隔の倍率に使います。</dd>
          </dl>
        </section>
      </main>
    </div>
  );
}

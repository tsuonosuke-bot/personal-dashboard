interface Props {
  onExit: () => void
}

/**
 * 画面には数字と操作だけを出し、仕組み・定義の説明はこのページにまとめる。
 * 画面の文言を変えたら、ここも合わせて直す。
 */
export function HelpView({ onExit }: Props) {
  return (
    <div className="help-page">
      <header className="help-header">
        <button type="button" className="text-button" onClick={onExit}>← 家計簿へ戻る</button>
      </header>
      <main className="help-body">
        <h1>ヘルプ</h1>
        <nav className="help-toc" aria-label="目次">
          <a href="#help-filters">表示条件と集計</a>
          <a href="#help-transactions">明細</a>
          <a href="#help-recurring">定期登録</a>
          <a href="#help-export">書き出し</a>
        </nav>

        <section id="help-filters" aria-labelledby="help-filters-title">
          <h2 id="help-filters-title">表示条件と集計</h2>
          <p>月・カテゴリ・支払者を組み合わせて集計します。カテゴリは「含む」と「除外」を切り替えて複数選べます。</p>
          <dl>
            <dt>選択月の支出・収入</dt>
            <dd>表示条件に合う明細の合計です。収入は収入カテゴリの明細を集計します。</dd>
            <dt>選択月の収支</dt>
            <dd>収入 − 支出です。</dd>
            <dt>収支前月比</dt>
            <dd>今月の収支と前月の収支の差です。</dd>
          </dl>
        </section>

        <section id="help-transactions" aria-labelledby="help-transactions-title">
          <h2 id="help-transactions-title">明細</h2>
          <p>収入の金額は集計・明細ともに正の金額で表示します。明細では「収入」「支出」「支出の相殺」を表示し、返金などの支出の相殺はマイナスのまま区別します。保存データや集計の計算方法は変わりません。</p>
          <p>スマートフォンでは1件ずつカードで表示し、日付・金額・内容・カテゴリ・支払者と編集ボタンを確認できます。検索・詳細条件・並び順・ページ移動は、パソコンの表と共通です。未分類の一括選択もカードから行えます。</p>
          <p>誤って登録した明細は取り消せます。取り消した明細は集計とCSVに含まれず、明細一覧の「取消済みの明細」から元に戻せます。</p>
          <p>未分類の明細は、まとめてカテゴリを変更できます。1件ずつ保存し、別の画面で更新された明細は上書きせずに残します。</p>
        </section>

        <section id="help-recurring" aria-labelledby="help-recurring-title">
          <h2 id="help-recurring-title">定期登録</h2>
          <p>家賃やサブスクなど、決まった日に発生する収支を登録すると、自動で明細を作ります。</p>
          <p>毎日0:10（日本時間）にSupabaseで自動反映するので、PCの電源は不要です。すぐに反映したいときは「今すぐ反映」を押します。似たルールは各行の「複製」から追加できます。</p>
        </section>

        <section id="help-export" aria-labelledby="help-export-title">
          <h2 id="help-export-title">書き出し</h2>
          <dl>
            <dt>CSV書き出し</dt>
            <dd>取り消していない明細をCSVで書き出します。</dd>
            <dt>監査用CSV（取消含む）</dt>
            <dd>取り消した明細も、取消日時つきで含めて書き出します。</dd>
          </dl>
        </section>
      </main>
    </div>
  )
}

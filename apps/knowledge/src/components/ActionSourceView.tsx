import { useActionSource } from "../hooks/useActionSource";
import { InsightAction } from "./InsightAction";

/** Inboxの出典リンク。URLにはIDだけを置き、保護されたAPIから現在の本文を読む。 */
export function ActionSourceView() {
  const { data, error } = useActionSource();
  return (
    <div className="quiz-page">
      <header className="quiz-header">
        <a href="https://personal-dashboard-7md.pages.dev/compass/">← Inbox</a>
        <h1>行動の出典</h1>
        <a href={import.meta.env.BASE_URL}>Knowledge</a>
      </header>
      <main className="quiz-body action-source-view">
        {error ? <p className="err" role="alert">{error}</p> : !data ? <p role="status">出典を読み込み中…</p> : (
          <article className="card">
            <span className="muted">{data.sourceType === "insight" ? "示唆" : "日記"}</span>
            <h2>{data.title}</h2>
            <p className="action-source-body">{data.body || "本文はありません。"}</p>
            {data.knowledgeId && <a href={`?knowledge=${encodeURIComponent(data.knowledgeId)}`}>元のナレッジを開く</a>}
            <InsightAction sourceType={data.sourceType} sourceId={data.sourceId} />
          </article>
        )}
      </main>
    </div>
  );
}

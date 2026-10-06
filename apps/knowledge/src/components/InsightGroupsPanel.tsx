import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { InsightGroupStore } from "../hooks/useInsightGroups";
import { dashboardRoutePath } from "../lib/dashboardRoute";
import type { InsightGroup, Knowledge, KnowledgeInsight } from "../types";
import { QuestionMaterialsPanel } from "./QuestionMaterialsPanel";

interface Props {
  knowledge: Knowledge[];
  insights: KnowledgeInsight[];
  store: InsightGroupStore;
  /** URLで指定された問いを最初に開く。 */
  initialGroupId?: number | null;
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : "操作を完了できませんでした。";
}

export function InsightGroupsPanel({ knowledge, insights, store, initialGroupId = null }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(initialGroupId);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [recallDraft, setRecallDraft] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const knowledgeById = useMemo(() => new Map(knowledge.map((item) => [item.id, item])), [knowledge]);
  const insightById = useMemo(() => new Map(insights.map((item) => [item.id, item])), [insights]);
  const selected = store.groups.find((group) => group.id === selectedId) ?? store.groups[0] ?? null;
  const membershipByGroup = useMemo(() => {
    const byGroup = new Map<number, Set<number>>();
    for (const member of store.members) {
      const ids = byGroup.get(member.group_id) ?? new Set<number>();
      ids.add(member.insight_id);
      byGroup.set(member.group_id, ids);
    }
    return byGroup;
  }, [store.members]);
  const selectedIds = selected ? membershipByGroup.get(selected.id) ?? new Set<number>() : new Set<number>();
  const selectedInsights = [...selectedIds].flatMap((id) => insightById.get(id) ?? [])
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
  const groupedIds = useMemo(() => new Set(store.members.map((member) => member.insight_id)), [store.members]);
  const ungrouped = insights.filter((item) => !groupedIds.has(item.id));
  const candidates = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return insights.filter((item) => {
      if (selectedIds.has(item.id)) return false;
      if (!needle) return true;
      const source = knowledgeById.get(item.knowledge_id);
      return item.body.toLocaleLowerCase().includes(needle)
        || (source?.title.toLocaleLowerCase().includes(needle) ?? false);
    });
  }, [insights, knowledgeById, query, selectedIds]);

  useEffect(() => {
    if (selectedId !== null && !store.loading && !store.groups.some((group) => group.id === selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, store.groups, store.loading]);

  const sourceLink = (item: KnowledgeInsight) => {
    const source = knowledgeById.get(item.knowledge_id);
    return (
      <a href={dashboardRoutePath(window.location.href, { kind: "knowledge", knowledgeId: item.knowledge_id })}>
        {source?.title ?? "元のナレッジを開く"}
      </a>
    );
  };

  const startCreate = () => {
    setTitle("");
    setQuestion("");
    setCreating(true);
    setEditing(false);
    setActionError(null);
  };

  const startEdit = (group: InsightGroup) => {
    setTitle(group.title);
    setQuestion(group.guiding_question);
    setEditing(true);
    setCreating(false);
    setActionError(null);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    // 名前は任意。空ならサーバーが問い文から付ける。
    if (busy || !question.trim()) return;
    setBusy(true);
    setActionError(null);
    try {
      if (editing && selected) await store.update(selected, title, question);
      else {
        const created = await store.create(title, question);
        setSelectedId(created.id);
        setRevealed(false);
        setRecallDraft("");
        setChoosing(false);
      }
      setCreating(false);
      setEditing(false);
      setTitle("");
      setQuestion("");
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (group: InsightGroup) => {
    if (busy || !window.confirm(`「${group.title}」を削除しますか？示唆の本文は残ります。`)) return;
    setBusy(true);
    setActionError(null);
    try {
      await store.remove(group);
      setSelectedId(null);
      setRevealed(false);
      setRecallDraft("");
      setChoosing(false);
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const changeMembership = async (insightId: number, add: boolean) => {
    if (!selected || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      if (add) await store.addMember(selected.id, insightId);
      else await store.removeMember(selected.id, insightId);
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="insight-organizer" aria-label="問い別の示唆グループ">
      <div className="insight-organizer-intro card">
        <div>
          <h2>問いで考える</h2>
          <p>「何を判断したいか」を問いとして立てると、意味の近い示唆・ナレッジ・日記をAIが集めます。まず自分で答えを考え、次に材料を開いて確かめます。</p>
          <small>ここで読むだけでは、通常の復習記録や次回復習日は変わりません。</small>
        </div>
        <button className="primary-button" type="button" onClick={startCreate} disabled={busy || store.loading || Boolean(store.error)}>＋ 問いを作る</button>
      </div>

      {store.loading && <p className="msg">問いを読み込み中...</p>}
      {store.error && <div className="err compact" role="alert">
        <span>{store.error} 表示中の内容が最新でない可能性があります。</span>
        <button type="button" onClick={() => void store.reload()} disabled={store.loading}>再読み込み</button>
      </div>}
      {actionError && <div className="err compact" role="alert">{actionError}</div>}

      {(creating || editing) && (
        <form className="insight-group-form card" onSubmit={(event) => void save(event)}>
          <h3>{editing ? "問いを編集" : "新しい問い"}</h3>
          <label>
            <span>問い文</span>
            <textarea required maxLength={300} rows={2} value={question} placeholder="例：失敗を改善につなげるには？" onChange={(event) => setQuestion(event.target.value)} />
          </label>
          <label>
            <span>短い名前（任意）</span>
            <input type="text" maxLength={120} value={title} placeholder="空なら問い文から付けます" onChange={(event) => setTitle(event.target.value)} />
          </label>
          <div className="insight-group-form-actions">
            <button type="button" onClick={() => { setCreating(false); setEditing(false); setActionError(null); }} disabled={busy}>やめる</button>
            <button className="primary-button" type="submit" disabled={busy || !question.trim()}>{busy ? "保存中…" : "保存する"}</button>
          </div>
        </form>
      )}

      {!store.loading && !store.error && store.groups.length === 0 && (
        <div className="card insight-group-empty">
          <h3>問いはまだありません</h3>
          <p>「＋ 問いを作る」で問い文を書くと、関係する示唆・ナレッジ・日記をAIが集めます。</p>
        </div>
      )}

      {!store.loading && store.groups.length > 0 && (
        <div className="insight-group-layout">
          <nav className="insight-group-picker" aria-label="問いを選ぶ">
            {store.groups.map((group) => (
              <button
                type="button"
                key={group.id}
                className="insight-group-pick card"
                aria-current={selected?.id === group.id ? "true" : undefined}
                onClick={() => { setSelectedId(group.id); setRevealed(false); setRecallDraft(""); setChoosing(false); setQuery(""); setEditing(false); setActionError(null); }}
              >
                <strong>{group.title}</strong>
                <span>{membershipByGroup.get(group.id)?.size ?? 0}件の示唆</span>
              </button>
            ))}
          </nav>

          {selected ? (
            <div className="insight-group-detail card">
              <div className="insight-group-detail-head">
                <div><span className="eyebrow">QUESTION</span><h3>{selected.title}</h3></div>
                <div className="insight-group-detail-actions">
                  <button type="button" onClick={() => startEdit(selected)}>編集</button>
                  <button className="danger-button" type="button" onClick={() => void remove(selected)} disabled={busy}>削除</button>
                </div>
              </div>
              <p className="insight-recall-question">{selected.guiding_question}</p>
              {selectedInsights.length === 0 ? (
                <p className="muted">自分で入れた示唆はまだありません。下のAIが集めた材料から「問いに入れる」か、検索して追加できます。</p>
              ) : (
                <>
                  <label className="insight-recall-input">
                    <span>自分の答えをメモする（任意・保存されません）</span>
                    <textarea rows={3} maxLength={2_000} value={recallDraft} readOnly={revealed}
                      placeholder="頭の中で答えてから開いても構いません。"
                      onChange={(event) => setRecallDraft(event.target.value)} />
                  </label>
                  <button type="button" className={revealed ? "" : "primary-button"} onClick={() => {
                    if (revealed) setRecallDraft("");
                    setRevealed(!revealed);
                  }}>
                    {revealed ? "もう一度、自分で考える" : "自分で答えたら示唆を見る"}
                  </button>
                  {revealed && (
                    <ul className="insight-group-evidence">
                      {selectedInsights.map((item) => (
                        <li key={item.id}>
                          <p>{item.body}</p>
                          <div className="insight-group-source">{sourceLink(item)} <span>{knowledgeById.get(item.knowledge_id)?.category}</span></div>
                          <button className="text-button" type="button" onClick={() => void changeMembership(item.id, false)} disabled={busy}>この問いから外す</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              <QuestionMaterialsPanel
                groupId={selected.id}
                question={selected.guiding_question}
                memberCount={selectedIds.size}
                busy={busy}
                onAddInsight={(insightId) => store.addMember(selected.id, insightId)}
              />
              <div className="insight-group-add">
                <button type="button" onClick={() => setChoosing((value) => !value)} aria-expanded={choosing}>
                  {choosing ? "追加候補を閉じる" : "＋ この問いに示唆を追加"}
                </button>
                {choosing && (
                  <>
                    <input type="search" value={query} aria-label="追加する示唆を検索" placeholder="示唆・ナレッジ名で検索" onChange={(event) => setQuery(event.target.value)} />
                    <ul className="insight-group-candidates">
                      {candidates.map((item) => (
                        <li key={item.id}>
                          <div><p>{item.body}</p><small>{knowledgeById.get(item.knowledge_id)?.title ?? "元のナレッジ"}</small></div>
                          <button type="button" onClick={() => void changeMembership(item.id, true)} disabled={busy}>追加</button>
                        </li>
                      ))}
                    </ul>
                    {candidates.length === 0 && <p className="muted">追加できる示唆はありません。</p>}
                  </>
                )}
              </div>
            </div>
          ) : <div className="card insight-group-empty"><p>問いを選ぶと、関連する示唆を思い出しながら読めます。</p></div>}
        </div>
      )}

      {!store.loading && (store.groups.length > 0 || !store.error) && <section className="insight-ungrouped card" aria-label="未分類の示唆">
        <h3>未分類の示唆 <span>{ungrouped.length}件</span></h3>
        {ungrouped.length === 0 ? <p className="muted">今ある示唆はすべて問いに整理されています。</p> : (
          <ul>
            {ungrouped.map((item) => (
              <li key={item.id}><p>{item.body}</p><small>{sourceLink(item)}</small></li>
            ))}
          </ul>
        )}
      </section>}
    </section>
  );
}

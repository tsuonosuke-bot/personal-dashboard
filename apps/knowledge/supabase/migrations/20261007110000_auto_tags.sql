-- Automatic tags (issue #93). Knowledge gets 1-3 tags from a fixed vocabulary, chosen by how
-- close its embedding is to each tag's centroid. The vocabulary was built once from the current
-- knowledge (seed cards per tag, reviewed by the owner on 2026-10-07); new knowledge is tagged from
-- the same vocabulary by the embedding batch. Automatic tags live apart from knowledge.tags so that
-- the owner's own tags are never changed, a removed automatic tag never comes back, and question
-- generation keeps using only the owner's tags (単語・文法 decide the English question style).
-- English knowledge is not tagged automatically.
begin;

create table if not exists public.knowledge_tag_vocabulary (
  tag text primary key check (char_length(btrim(tag)) between 1 and 40),
  model text not null,
  -- average embedding of the seed cards; the tag's position in meaning space.
  centroid extensions.vector(1024) not null,
  seed_count integer not null check (seed_count > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.knowledge_auto_tags (
  knowledge_id uuid not null references public.knowledge(id) on delete cascade,
  tag text not null references public.knowledge_tag_vocabulary(tag) on delete cascade on update cascade,
  similarity double precision not null,
  assigned_at timestamptz not null default now(),
  -- set when the owner removes the tag; the row stays so the tag is never assigned again.
  removed_at timestamptz,
  primary key (knowledge_id, tag)
);
create index if not exists knowledge_auto_tags_tag_idx on public.knowledge_auto_tags (tag) where removed_at is null;

-- Which embedding text each card was last tagged from, so only new or edited cards are re-tagged.
create table if not exists public.knowledge_auto_tag_state (
  knowledge_id uuid primary key references public.knowledge(id) on delete cascade,
  input_hash text not null,
  model text not null,
  evaluated_at timestamptz not null default now()
);

alter table public.knowledge_tag_vocabulary enable row level security;
alter table public.knowledge_auto_tags enable row level security;
alter table public.knowledge_auto_tag_state enable row level security;
revoke all on table public.knowledge_tag_vocabulary, public.knowledge_auto_tags, public.knowledge_auto_tag_state from public, anon, authenticated;
grant select, insert, update, delete on table public.knowledge_tag_vocabulary, public.knowledge_auto_tags, public.knowledge_auto_tag_state to service_role;

comment on table public.knowledge_tag_vocabulary is 'Fixed vocabulary of automatic knowledge tags with the centroid embedding of each tag (#93).';
comment on table public.knowledge_auto_tags is 'Automatic tags per knowledge. removed_at marks tags the owner removed; they are not assigned again.';
comment on table public.knowledge_auto_tag_state is 'Embedding text hash each knowledge card was last auto-tagged from.';

-- Tags new or edited cards (or every card, the first time). For each card the closest tags win:
-- up to 3, similarity >= 0.6 and within 0.04 of the best one. Tags the owner already set by hand
-- and tags the owner removed are skipped. Returns how many cards were evaluated.
create or replace function public.assign_auto_tags(p_model text, p_limit integer default 1000)
returns integer
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_ids uuid[];
begin
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'limit must be between 1 and 5000' using errcode = '22023';
  end if;

  select coalesce(array_agg(k.id), '{}') into v_ids
    from (
      select k.id
        from public.knowledge k
        join public.semantic_embeddings e
          on e.source_type = 'knowledge' and e.source_id = k.id::text and e.model = p_model
        left join public.knowledge_auto_tag_state st on st.knowledge_id = k.id
       where not k.archived
         and k.category <> '英語'
         and (st.knowledge_id is null or st.input_hash <> e.input_hash or st.model <> p_model)
       order by k.created_at
       limit p_limit
    ) k;

  if cardinality(v_ids) = 0 then
    return 0;
  end if;

  -- An edited card is tagged afresh; removed tags stay removed.
  delete from public.knowledge_auto_tags a
   where a.knowledge_id = any(v_ids) and a.removed_at is null;

  insert into public.knowledge_auto_tags (knowledge_id, tag, similarity)
  select r.id, r.tag, r.sim
    from (
      select s.*, max(s.sim) over (partition by s.id) as best,
             row_number() over (partition by s.id order by s.sim desc) as rn
        from (
          select k.id, v.tag, 1 - (e.embedding <=> v.centroid) as sim
            from public.knowledge k
            join public.semantic_embeddings e
              on e.source_type = 'knowledge' and e.source_id = k.id::text and e.model = p_model
            cross join public.knowledge_tag_vocabulary v
           where k.id = any(v_ids) and v.model = p_model and not (v.tag = any(coalesce(k.tags, array[]::text[])))
        ) s
    ) r
   where r.rn <= 3 and r.sim >= 0.6 and r.sim >= r.best - 0.04
  on conflict (knowledge_id, tag) do nothing;

  insert into public.knowledge_auto_tag_state (knowledge_id, input_hash, model, evaluated_at)
  select k.id, e.input_hash, p_model, now()
    from public.knowledge k
    join public.semantic_embeddings e
      on e.source_type = 'knowledge' and e.source_id = k.id::text and e.model = p_model
   where k.id = any(v_ids)
  on conflict (knowledge_id) do update
    set input_hash = excluded.input_hash, model = excluded.model, evaluated_at = excluded.evaluated_at;

  return cardinality(v_ids);
end
$$;

revoke all on function public.assign_auto_tags(text, integer) from public, anon, authenticated;
grant execute on function public.assign_auto_tags(text, integer) to service_role;

-- The vocabulary (46 tags) from the reviewed draft: seed cards by title prefix, plus the owner's
-- existing tags WWI and 戦車. 読書・人物・WWII stay hand-only (they describe a source or a fact,
-- not a topic, and auto-assigning them went wrong in the draft); 単語・文法 are English and hand-only.
with seed_def(tag, prefix, existing_tag) as (values
('抽象化・具体と抽象', '具体と抽象の往復', null),('抽象化・具体と抽象', '抽象化と構造化', null),('抽象化・具体と抽象', '抽象化とは公理への変換', null),('抽象化・具体と抽象', '仕事の上流と下流', null),('抽象化・具体と抽象', '抽象化はデフォルメ', null),('解像度', '解像度の4つの軸', null),('解像度', '解像度の「深さ」', null),('解像度', '解像度の「構造」', null),('解像度', '発言が浅い＝解像度が低い', null),('イシュー・論点', '仕事の進め方：①イシュー', null),('イシュー・論点', '「これがイシューだ」', null),('イシュー・論点', 'イシューの言語化', null),('イシュー・論点', '問われていることを見極める', null),('イシュー・論点', '課題以上の価値は生まれない', null),('仮説思考', '仮説設定→情報収集→検証', null),('仮説思考', '前提・仮説・コンティンジェンシー', null),('仮説思考', '深い仮説をもつため', null),('仮説思考', '新しい構造の２つめ', null),('戦略思考', '戦略を左右する分岐', null),('戦略思考', '田の字は戦略思考', null),('戦略思考', '戦略思考は「意外と地味', null),('戦略思考', '本当の敵を見極める', null),('戦略思考', '直感に頼らず勝ちパターン', null),('独学・インプット', '独学は「①戦略', null),('独学・インプット', '独学における「戦略」', null),('独学・インプット', '何をインプットしないか', null),('独学・インプット', '無目的なインプットの蓄積', null),('独学・インプット', 'インプット量が多くても', null),('学習法・記憶', 'ファインマン学習法', null),('学習法・記憶', 'デリバレイト・プレイ', null),('学習法・記憶', 'マルチタスクを続けると', null),('学習法・記憶', '間違えること、できないこと', null),('学習法・記憶', '新しい分野のことを学ぶとき', null),('ノート・知識管理', 'PARAメソッド', null),('ノート・知識管理', 'ツェッテルカステン', null),('ノート・知識管理', 'コーネル式ノート術', null),('ノート・知識管理', 'セカンドブレインと事実', null),('ノート・知識管理', '記録を作ることは第2の脳', null),('発想・アイデア', 'SCAMPER', null),('発想・アイデア', 'ブレストよりブレインライティング', null),('発想・アイデア', 'イノベーション＝既存アイデア', null),('発想・アイデア', 'マンダラート', null),('発想・アイデア', '創造的プロセスの4ステージ', null),('プロジェクト管理', 'PMBOKの10', null),('プロジェクト管理', 'プロジェクトの定義', null),('プロジェクト管理', 'WBSはスコープ定義', null),('プロジェクト管理', '変更管理の4ステップ', null),('プロジェクト管理', '見積りの3手法', null),('TOC・バッファ', 'クリティカルチェーン', null),('TOC・バッファ', 'プロジェクトバッファ', null),('TOC・バッファ', '合流バッファ', null),('TOC・バッファ', '学生症候群', null),('TOC・バッファ', 'スループットワールド', null),('リスク・障害対応', 'リスク洗い出しの4ステップ', null),('リスク・障害対応', 'リスク・問題・課題の使い分け', null),('リスク・障害対応', 'フェールセーフとフールプルーフ', null),('リスク・障害対応', 'ポストモーテム', null),('リーダーシップ', 'リーダーの情報に関する5つ', null),('リーダーシップ', 'この人と働きたい', null),('リーダーシップ', '優れたリーダーは必ず嫌われる', null),('リーダーシップ', 'リーダーはいつも上機嫌', null),('リーダーシップ', '仕事への情熱・真剣さ', null),('マネジメント・任せ方', '動機付けと権限移譲', null),('マネジメント・任せ方', '権限を手放すとマネジメント', null),('マネジメント・任せ方', 'メンバーの強みを見る', null),('マネジメント・任せ方', 'タックマンモデル', null),('組織論', 'マックス・ヴェーバーの組織論', null),('組織論', 'コンウェイの法則', null),('組織論', 'ラティス型とラダー型', null),('組織論', '働きアリの法則', null),('人を動かす', '人を変える（顔を潰さない', null),('人を動かす', '自己重要感', null),('人を動かす', '小さいことでも褒める', null),('人を動かす', '相手が欲しがっているもの', null),('人を動かす', '善意に訴えかける', null),('話し方・プレゼン', '結論から話すとは要旨', null),('話し方・プレゼン', 'PREP法', null),('話し方・プレゼン', 'スライドは「メッセージ', null),('話し方・プレゼン', '例え話がうまい人', null),('話し方・プレゼン', '一番最初に話し始める', null),('議論・交渉', '議論が噛み合わない理由', null),('議論・交渉', '交渉への回答は即時に', null),('議論・交渉', 'コンフリクトを恐れない', null),('議論・交渉', '議論しない（負けるが勝ち）', null),('議論・交渉', '相手に主導権を渡す', null),('言語化', '些細なことでも、ネーミング', null),('言語化', '良質なアウトプットは良質な定義', null),('言語化', 'ロジックの反意語はストーリー', null),('言語化', '借りてきた言葉', null),('目標設定', 'SMART', null),('目標設定', 'ゴール・ビジョン・目的', null),('目標設定', 'ドラッカーの5つの質問', null),('目標設定', '計画が戦いの趨勢', null),('仕事の進め方', '1W&1PとIPO', null),('仕事の進め方', '状況整理で思考時間', null),('仕事の進め方', '調査を闇雲に行わない', null),('仕事の進め方', '論点スライド、ワークプラン', null),('仕事の進め方', '魔の11分', null),('評価・キャリア', '評価を得たければ', null),('評価・キャリア', '頭のよさは他者の認識', null),('評価・キャリア', '賢いかどうかを決めるのは', null),('評価・キャリア', '潜在能力の測り方', null),('評価・キャリア', 'コンサルタントぶらない', null),('新規事業・市場', '新規事業の判断基準', null),('新規事業・市場', 'いい課題の条件とバーニングニーズ', null),('新規事業・市場', 'SaaSの死', null),('新規事業・市場', 'ターゲット分類・分析', null),('業界分類', 'GICS', null),('業界分類', '東証33業種分類', null),('業界分類', 'UNSPSCコード', null),('認知バイアス', '確証バイアスと認知バイアス', null),('認知バイアス', '認知的不協和', null),('認知バイアス', 'コンコルド効果', null),('認知バイアス', 'センセーショナルな物語', null),('認知バイアス', 'クレバー・ハンス効果', null),('失敗と改善', 'クローズドループ現象', null),('失敗と改善', '失敗できる分野ほど発展', null),('失敗と改善', 'ユナイテッド航空173便', null),('失敗と改善', '反省するときは良かった点', null),('習慣・継続', '目標を下げる、動ける時に動く', null),('習慣・継続', '100回練習するのではなく', null),('習慣・継続', '我慢する意思の力', null),('習慣・継続', '小さい努力の積み重ね', null),('脳・ドーパミン', 'ドーパミン受容体', null),('脳・ドーパミン', '脳を', null),('脳・ドーパミン', 'イリシンとBDNF', null),('脳・ドーパミン', '大脳皮質のニューロン', null),('感情・メンタル', '怒りの6秒ルール', null),('感情・メンタル', '緊張は理想と現実', null),('感情・メンタル', '行動が感情を作る', null),('感情・メンタル', '思考をする自分は', null),('休息・余裕', '良い休息の4要素', null),('休息・余裕', 'スラック（余裕）', null),('休息・余裕', '余裕こそが', null),('休息・余裕', '疲れた心が求めているのは変化', null),('休息・余裕', '精神の輪作', null),('集中・時間', '集中ボーナス', null),('集中・時間', 'トンネリング', null),('集中・時間', 'クロノス時間とカイロス時間', null),('集中・時間', 'ジャグリング（欠乏のループ）', null),('集中・時間', '幸福度を高める時間', null),('マクロ経済・為替', '経常収支の定義', null),('マクロ経済・為替', '円安のメリット', null),('マクロ経済・為替', '購買力平価', null),('マクロ経済・為替', '貿易赤字と為替', null),('マクロ経済・為替', '金利上昇が資産価格', null),('制度と繁栄', '名誉革命によって', null),('制度と繁栄', '産業革命が名誉革命', null),('制度と繁栄', '特定のグループの成功', null),('制度と繁栄', '再版農奴制', null),('制度と繁栄', 'アメリカ合衆国の成り立ち', null),('ルネサンス・科学史', '6/3 ガリレオ', null),('ルネサンス・科学史', '6/3 コペルニクス', null),('ルネサンス・科学史', '6/3 12世紀ルネサンス', null),('ルネサンス・科学史', '6/3 三大発明', null),('ルネサンス・科学史', '6/3 ダ・ヴィンチ', null),('ヨーロッパ史', '5/2 カールの戴冠', null),('ヨーロッパ史', 'イタリア統一が完遂', null),('ヨーロッパ史', '5/22 ノルマンディー', null),('ヨーロッパ史', '5/22 スウェーデン', null),('ヨーロッパ史', 'ガリバルディ', null),('AI・データ', 'ディープラーニング', null),('AI・データ', 'ベクトルデータベース', null),('AI・データ', 'データ分析（統計学）', null),('AI・データ', 'WikiSkill', null),('進化・生物', '中立進化', null),('進化・生物', '厳しい環境→淘汰', null),('進化・生物', '選択と結果が継承される', null),('進化・生物', 'ミームとは', null),('進化・生物', '深海生物', null),('宇宙・自然科学', 'Voyager 2', null),('宇宙・自然科学', '太陽圏とは', null),('宇宙・自然科学', 'エントロピーは', null),('宇宙・自然科学', '全ての物質は鉄', null),('宇宙・自然科学', '降水量', null),('言葉の由来', 'ゴキブリの名前', null),('言葉の由来', 'スコレー', null),('言葉の由来', 'ロスチャイルドとは', null),('言葉の由来', '5/25 ブエノスアイレス', null),('言葉の由来', '5/25 みかんのみ', null),('食', '5/15うすしお', null),('食', '5/16 特級JAS', null),('食', '愛文マンゴー', null),('食', 'ビーフ・ウェリントン', null),('食', 'スクラロース', null),('名言・心構え', 'ビスマルクの名言', null),('名言・心構え', '一日ひとつだけ強くなる', null),('名言・心構え', '疑問を何にでも', null),('名言・心構え', '語り得ぬこと', null),('名言・心構え', '拍手は君を', null),('投資・会計', 'インデックス投資がアクティブ', null),('投資・会計', 'ETFは', null),('投資・会計', 'REITとインデックス', null),('投資・会計', '相関係数と分散投資', null),('投資・会計', 'リスクプレミアム', null),('投資・会計', '研究開発費は', null),('投資・会計', '特許を取得した場合', null),('設計・アーキテクチャ', 'MVC、MVP', null),('設計・アーキテクチャ', '関数型プログラミング', null),('設計・アーキテクチャ', '5/13 ScriptableObject', null),('設計・アーキテクチャ', 'SQLのTRUNCATE', null),('設計・アーキテクチャ', 'オープンモジュラー', null),('設計・アーキテクチャ', 'クローズドインテグラル', null),('設計・アーキテクチャ', 'クローズドモジュラー', null),('世界史・文化', 'ソグド人', null),('世界史・文化', 'シモン・ボリバル', null),('世界史・文化', '5/16 弥助', null),('世界史・文化', 'インド発祥の仏教', null),('世界史・文化', 'コルテスはメキシコ', null),('WWI', null, 'WWI'),('戦車', null, '戦車')
), seeds as (
  select distinct d.tag, k.id
    from seed_def d
    join public.knowledge k on not k.archived
     and ((d.prefix is not null and k.title like d.prefix || '%')
       or (d.existing_tag is not null and d.existing_tag = any(k.tags)))
)
insert into public.knowledge_tag_vocabulary (tag, model, centroid, seed_count)
select s.tag, 'voyage-4', avg(e.embedding), count(*)
  from seeds s
  join public.semantic_embeddings e on e.source_type = 'knowledge' and e.source_id = s.id::text and e.model = 'voyage-4'
 group by s.tag
on conflict (tag) do nothing;

-- Tag every current card once.
select public.assign_auto_tags('voyage-4', 5000);

insert into public.dashboard_schema_versions (app_id, migration, updated_at)
values ('knowledge-dashboard', '20261007110000_auto_tags', now())
on conflict (app_id) do update
set migration = excluded.migration,
    updated_at = excluded.updated_at;

notify pgrst, 'reload schema';

commit;

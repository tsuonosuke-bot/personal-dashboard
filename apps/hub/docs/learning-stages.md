# 学習の4段階とDashboardの対応（#115）

Hubの「学習の流れ」は既存の画面へ進む入口とする。段階の順番は目安で、入力済みの内容から整理・検索・復習へ直接進める。

| 段階 | 既存の画面・操作 | 正本となるデータ | チャットでの対応 |
| --- | --- | --- | --- |
| 戦略 | IdeaのWantsで選び、Projectsで到達点・テーマ・Next Actionを決める。Focusで意識することを保つ | `wants`, `want_routes`, `projects`, `project_items`, `project_actions`, `project_milestones`, `focus_items` | 実行対象を選び、Projectに整理。`pending-routes` は確定した振り分けの未処理分を確認する |
| インプット | Inboxに素材や疑問を捕獲し、調査候補へ振り分ける。Journalを読み返す。学んだ事実はKnowledgeへ登録 | `idea_inbox`, `daily_journal`, `knowledge`。調査候補は `want_routes` であり、振り分けだけではKnowledgeに登録されない | `knowledge-db` は登録・補完、重複確認と保存結果の検証を担当する |
| 抽象化・構造化 | Knowledgeの「整理」で示唆・問い・タグ・ノートをまとめ、関連資料・元のナレッジへ戻る | `knowledge_insights`, `insight_groups`, `insight_group_members`, `knowledge_auto_tags`, `knowledge_tag_vocabulary`。ノートは既存の問い・テーマと出典から組み立てる | 既存の整理画面と示唆・関連候補の処理を使う。新たな保存先や自動生成の経路は増やさない |
| ストック・取り出し | Knowledgeの一覧・検索で取り出す。問い・テーマのノートから絞って復習し、学習ログで振り返る | `knowledge`, `review_queue`, `quiz_log`, `knowledge_mastery_history`。意味検索は既存のembeddingと検索APIを使用 | `knowledge-quiz` は同じ復習キューを出題し、採点結果を同じ履歴に記録する |

関連する実装は [Inbox振り分け契約](inbox-route-rpc.md)、[Projectsの運用](projects-operation.md)、[Knowledge README](../../knowledge/README.md)、[Knowledgeの経路](../../knowledge/src/lib/dashboardRoute.ts)、[問い・示唆・タグ・ノートの整理](../../knowledge/src/components/OrganizeView.tsx) を参照する。チャット用スキル名は既存環境との対応を表し、Hubからスキルを実行するものではない。リポジトリの `apps/knowledge/skills/knowledge-quiz/` と `apps/hub/skills/pending-routes/` が関連する正本で、デスクトップの `knowledge-db` / `knowledge-quiz` はその環境にあるアダプターを使用する。

## 段階間の接続と判断

- **戦略 → 入力**：Wants/InboxをProjectへ新規作成・関連付けする既存の経路を使う。Projectのテーマを入力候補へ自動反映する機能は導入しない。テーマは自由記述であり、Knowledgeのカテゴリ・自動タグと同一の識別子ではないため、文字一致で優先度を変更しない。
- **入力 → 構造化**：Inboxの調査候補を実際に調査・登録した後、Knowledgeの整理へ進む。日記・示唆から行動化するときは、既存のInboxへの登録と出典リンクを使う。Hubに表示された少数のプレビューを全件数として扱わない。
- **構造化 → 取り出し**：既存の問い・テーマのノートと対象を絞った復習を使う。学習の目的による手動選択と、既存の期限・習熟度に基づく復習スケジュールを維持する。Projectによる自動の出題順変更は行わない。
- **振り返り → 戦略**：Projectsの週次レビューとKnowledgeの学習ログを見て、次の一手を選び直す。自動でProjectを完了したり、予定・データを書き換える処理は設けない。

既存機能で4段階をたどれるため、今回必要な不足はHubからの入口と対応表で解消する。目的別の自動優先順位は、テーマの共通ID・利用者の優先ルール・復習間隔への影響を別途定義するまで採用しない。このIssueを曖昧な自動化の子Issueに分割しない。

## Hubの表示と検証

`public/learning-stages.js` は既存の `/api/hub` の集計値だけを使う。戦略はActive Project、入力は未整理Inbox、取り出しは「今解ける」期限到来済みの問題数。構造化は集計値を持たないので操作名だけを表示する。取得失敗・欠損・不正な値を0件へ置換しない。すべてのリンクは固定の同一オリジン経路であり、追加のAI/API呼出しやDB変更は発生しない。

`tests/learningStages.test.ts` が件数の意味・取得不能・対応するKnowledge直リンクを検証する。画面の説明は [Hubヘルプ](../public/help/index.html) に置く。

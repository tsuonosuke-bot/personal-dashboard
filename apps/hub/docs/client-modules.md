# Hubのクライアントモジュール

HTMLから読み込む入口のURLは保ち、Viteが静的importをまとめる。モジュール読込時のDOM参照は画面の入口だけに置く。`shared/html.js` はHTMLのテキスト・引用符つき属性のエスケープ、`api-client.js` はJSON応答の確認と共通HTTP処理を担当する。URLの許可判定は呼び出し側に残す。

| 入口 | 分割先と責務 |
| --- | --- |
| `public/projects.js` | イベント・編集・保存・URLの同期。`projects/state.js` は画面ごとの状態とDOM参照、`model.js` は検索・並び順・週次レビュー計算、`view.js` は一覧・詳細の描画、`api.js` はHTTP処理の入口 |
| `public/today-panel.js` | 従来のexportを保つ入口。`today/controller.js` が読込・更新・取消・期限切れ見直しを接続し、`state.js` / `model.js` / `view.js` / `api.js` がそれぞれ状態・計算・描画・通信を担当 |
| `public/sf6.js` | データ更新・タブ・イベントの接続。`sf6/records.js` は記録一覧と条件、`frames.js` は技データと確反、`routes.js` はルートとフロー、`editor.js` は編集。`state.js` / `constants.js` / `format.js` / `api.js` が状態・定義・表示補助・通信を担当 |

SF6の既存の `sf6-plan.js` / `sf6-frames.js` / `sf6-graph.js` / `sf6-notation.js` はDOMを使わない計算として維持する。画面状態に依存する機能はfactoryで必要な状態・コールバックを受け取り、別機能のfactoryをimportしない。相互の操作は入口が遅延コールバックで接続する。

`npm run check` は `public/` と `scripts/` のJavaScriptを再帰的に構文検査し、未定義名・import/exportの不一致・初期化前の参照と、既存TypeScriptの型チェックを行う。CIも `check:client` でブラウザ側の検査を実行する。UIのソース検査は `tests/clientScript.ts` で実際の静的import先まで読む。追加したモジュールを検査対象へ手作業で列挙する必要はない。HTMLエスケープ・競合時の失敗・更新前の値の保持・状態の分離は `tests/clientModules.test.ts` で検証する。

## サーバー側の分割判断（#214）

`functions/_shared/sf6.ts`、`projects.ts`、`scheduledActions.ts` の追加分割は今回行わない。これらはHTTP入力の検証・DB列への変換・RPC呼出しをそれぞれの業務境界に集約しており、クライアントの描画コードとは共有しない。認証と共通REST処理は既に `@personal-dashboards/auth` にある。サーバーを分割するときはトランザクションと競合チェックを一組として扱い、機能の変更に合わせて既存のAPIテストとDB検証を更新する。今回のブラウザ側整理ではAPI・DB契約を変更しない。

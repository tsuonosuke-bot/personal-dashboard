// 一覧・振り分け・編集で共有する、表示名や選択肢などの定数。

export const viewMeta = {
  inbox: { title: "Inbox", singular: "Inbox", empty: "Inboxはすべて整理されています" },
  wants: { title: "Wants", singular: "Want", empty: "該当するWantsはありません" },
  todos: { title: "ToDo", singular: "ToDo", empty: "該当するToDoはありません" },
};

export const defaultStatusByView = {
  inbox: "pending",
  wants: "active",
  todos: "pending",
};

export const closedStatusesByView = {
  inbox: new Set(["done", "skipped", "completed", "closed", "cancelled", "archived"]),
  wants: new Set(["completed", "dropped", "done", "closed", "cancelled", "archived"]),
  todos: new Set(["completed", "skipped"]),
};

export const itemEditMeta = {
  wants: {
    title: "Wantを編集",
    button: "Wantを編集",
    endpoint: "/api/wants",
    actionHeader: "want-update",
    statuses: ["active", "completed", "dropped"],
    success: "Wantを更新しました。",
  },
};

export const closeMeta = {
  inbox: {
    endpoint: "/api/inbox",
    actionHeader: "inbox-update",
    closedStatus: "done",
    button: "Inboxをクローズ",
    confirm: "このInboxをクローズしますか？\n\nクローズ後も、ステータスフィルターから確認・再開できます。",
    success: "Inboxをクローズしました。",
  },
  wants: {
    endpoint: "/api/wants",
    actionHeader: "want-update",
    closedStatus: "completed",
    button: "Wantをクローズ",
    confirm: "このWantをクローズしますか？\n\nクローズ後も、ステータスフィルターから確認・再開できます。",
    success: "Wantをクローズしました。",
  },
};

export const DEFER_ROUTE = "defer";

// Inboxの詳細で最初から並べる振り分け先。直近30日の振り分けで多い順（開発・調査・執筆）と、
// 今は決めない「保留」。残りは「その他の振り分け先」に畳む。
export const PRIMARY_INBOX_ROUTES = ["github", "knowledge", "writing", "defer"];

export const WISH_ROUTE = "wish";

export const inboxQuickRoutes = {
  calendar: { label: "予定", description: "日付を決めて動く", intent: "act", destination: "calendar" },
  wish: { label: "欲しいもの", description: "欲しいものとして残す" },
  writing: { label: "執筆", description: "Writingで考えを育てる", intent: "explore", destination: "writing" },
  knowledge: { label: "調査", description: "Knowledge候補として残す", intent: "explore", destination: "knowledge" },
  habit: { label: "習慣", description: "繰り返す行動にする", intent: "continue", destination: "habit" },
  focus: { label: "Focus", description: "意識し続ける", intent: "keep", destination: "focus" },
  github: { label: "開発", description: "GitHub候補として残す", intent: "act", destination: "github" },
  journal: { label: "日記", description: "Journal候補として残す", intent: "keep", destination: "journal" },
  defer: { label: "保留", description: "再訪日を決めて置く" },
};

export const routeIntentMeta = {
  act: { label: "行動する", description: "日時を確保する、またはソフトウェアを変更する" },
  continue: { label: "継続する", description: "繰り返したい行動として管理する" },
  explore: { label: "掘り下げる", description: "調べる、理解する、文章へ育てる" },
  keep: { label: "残しておく", description: "意識事項や記録として保存する" },
  discard: { label: "今回は見送る", description: "理由を残して整理を終える" },
};

export const routeDestinationMeta = {
  wish: { label: "欲しい", description: "欲しいものとしてWantsに残す", internal: true },
  calendar: { label: "Google Calendar", description: "タスク・予定・調査時間をメインカレンダーへ登録", internal: false },
  github: { label: "GitHub Issue", description: "ソフトウェアの実装候補として保存", internal: false },
  writing: { label: "Writing", description: "掘り下げたいエッセイ候補として登録", internal: true },
  habit: { label: "Habits", description: "継続する習慣として登録", internal: true },
  knowledge: { label: "Knowledge候補", description: "調査・検証後のDB登録候補として保存", internal: false },
  focus: { label: "Focus", description: "繰り返し意識したい言葉として登録", internal: true },
  journal: { label: "Journal候補", description: "その日の記録として保存する計画", internal: false },
  archive: { label: "アーカイブ", description: "外部へ登録せず整理記録だけを残す", internal: true },
};

export const destinationsByIntent = {
  act: ["calendar", "github"],
  continue: ["habit"],
  explore: ["calendar", "knowledge", "writing"],
  keep: ["focus", "journal", "archive"],
  discard: ["archive"],
};

export const quickWantRoutes = {
  calendar: { label: "予定", description: "日付を決めて動く", intent: "act", destination: "calendar" },
  writing: { label: "執筆", description: "Writingで考えを育てる", intent: "explore", destination: "writing" },
  knowledge: { label: "調査", description: "Knowledge候補として残す", intent: "explore", destination: "knowledge" },
  habit: { label: "習慣", description: "繰り返す行動にする", intent: "continue", destination: "habit" },
  focus: { label: "Focus", description: "意識し続ける", intent: "keep", destination: "focus" },
  github: { label: "開発", description: "GitHub候補として残す", intent: "act", destination: "github" },
  journal: { label: "日記", description: "Journal候補として残す", intent: "keep", destination: "journal" },
  archive: { label: "見送り", description: "今回は見送る", intent: "discard", destination: "archive" },
};

export const cadenceLabels = {
  daily: "毎日",
  weekdays: "平日",
  weekly: "毎週",
  flexible: "頻度を固定しない",
};

// 予定と習慣は日時・頻度を1件ずつ決める必要があるため、一括振り分けの対象にしない。
export const BULK_ROUTE_KEYS = ["wish", "writing", "knowledge", "focus", "github", "journal", DEFER_ROUTE];

export const routeCompletionMeta = {
  knowledge: {
    action: "Knowledge登録済みにする",
    candidate: "Knowledge候補",
    note: "ナレッジDBへ登録済みの候補だけを登録済みにします。この操作はナレッジDBへ書き込まず、登録待ちの表示を解除するだけです。",
    field: "knowledgeId",
    label: "Knowledge ID",
    placeholder: "ナレッジDBのUUID",
    maxLength: 36,
    help: "入力すると振り分け履歴から正本のナレッジを開けます。",
  },
  github: {
    action: "GitHub登録済みにする",
    candidate: "GitHub Issue候補",
    note: "GitHub Issueを作成済みの候補だけを登録済みにします。この操作はGitHubへ書き込まず、登録待ちの表示を解除するだけです。",
    field: "issueUrl",
    label: "Issue URL",
    placeholder: "https://github.com/owner/repo/issues/123",
    maxLength: 300,
    help: "入力すると振り分け履歴から正本のIssueを開けます。",
  },
};

// Idea画面の状態（state）とDOM要素（els）。

export const state = {
  data: null,
  view: "inbox",
  status: "pending",
  search: "",
  metricFilter: "",
  drawerItem: null,
  triageSource: "wants",
  aiRequestToken: 0,
  calendarConnection: null,
  todosLoaded: false,
  todoSource: null,
  bulkMode: false,
  bulkSelected: new Set(),
  bulkSubmitting: false,
  bulkError: "",
  bulkRouteKeys: new Map(),
  todoLayout: "list",
  calendarMonth: "",
  calendarDragId: null,
  calendarBusy: false,
};

export const els = Object.fromEntries([
  "sourceBadge", "refreshButton",
  "inboxTabCount", "wantsTabCount", "todosTabCount", "listTitle", "searchInput",
  "statusFilter", "pendingFilterGroup", "knowledgeFilter", "knowledgePendingCount", "githubFilter", "githubPendingCount", "todoFilterGroup", "todoLayoutGroup", "resultCount", "clearFilter", "cardList", "drawerBackdrop",
  "bulkModeButton", "bulkToolbar", "bulkSelectAll", "bulkSelectionCount", "bulkStatusSelect", "bulkRevisitField", "bulkRevisitOn", "bulkApplyButton", "bulkCancelButton", "bulkError",
  "drawer", "drawerClose", "drawerKicker", "drawerTitle", "drawerBody", "dashboardSwitcher", "dashboardNav",
  "addInboxButton", "inboxModal", "inboxModalClose", "inboxCancelButton", "inboxForm",
  "inboxContent", "inboxCharacterCount", "inboxFormError", "inboxSubmitButton", "toast",
].map((id) => [id, document.getElementById(id)]));

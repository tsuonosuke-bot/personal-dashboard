// Panelごとに状態とDOM参照を新しく作る。モジュールの読み込み時にはDOMを参照しない。
export function todayElements(document) {
  const $ = (id) => document.getElementById(id);
  const els = {
    counter: $("todayDoneCounter"),
    allDone: $("todayAllDone"),
    todos: $("todayTodos"),
    habits: $("todayHabits"),
    projects: $("todayProjects"),
    todoLink: $("todayTodoLink"),
    sheet: $("todaySheet"),
    sheetStep: $("todaySheetStep"),
    sheetBar: $("todaySheetBar"),
    sheetTitle: $("todaySheetTitle"),
    sheetMeta: $("todaySheetMeta"),
    sheetNotice: $("todaySheetNotice"),
    sheetActions: $("todaySheetActions"),
    sheetClose: $("todaySheetClose"),
    toast: $("todayToast"),
    toastText: $("todayToastText"),
    toastUndo: $("todayToastUndo"),
  };
  return els;
}

export function createTodayState() {
  return {
    todos: { status: "loading", data: null, error: null },
    habits: { status: "loading", data: null, error: null },
    projects: { status: "loading", data: null, error: null },
    compassUrl: "/compass/",
    showAllTodos: false,
    showAllProjects: false,
    resolvingActionId: null,
    triage: null,
  };
}

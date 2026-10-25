// 呼び出しごとに独立した画面状態を作る。DOM参照は初期化時に受け取る。
export function createSf6State() {
  return {
    data: null,
    tab: "sequences",
    sequenceCharacter: "",
    sequencePosition: "",
    /** 状況タブのキャラと位置の絞り込み。 */
    situationCharacter: "",
    situationPosition: "",
    /** 「状況から引く」の条件。situationId は状況の id（"none" は状況なし）、drive・sa・punishWindow は null なら指定なし。 */
    conditions: { situationId: null, drive: null, sa: null, ca: false, burnout: false, punishWindow: null },
    frames: { character: "", query: "", category: "", sort: "official", punishableOnly: false, heavyPunishableOnly: false, cancelableOnly: false, open: null },
    opponent: { character: "", moveId: null, loading: false, error: "" },
    /** キャラ名 → GET /api/sf6/moves の応答。タブやモーダルで初めて要るときに1回だけ読む。 */
    moves: new Map(),
    /** シート：{ type: "route", path, character } / { type: "routeStart", character } / { type: "situations", character }
     *  / { type: "flow", character, startSituationId, selected, picking, linking } */
    sheet: null,
    /** モーダルで編集中の記録。{ resource, item(null=追加), values, startRefs, openNext } */
    editing: null,
    saving: false,
  };
}

export function sf6Elements(document) {
  const ids = [
    "sourceBadge", "refreshButton", "addButton", "addLabel", "loadingState", "errorState", "errorMessage", "retryButton",
    "countSequences", "countSituations", "countDrills", "countMatches",
    "situationCharacter", "situationPosition", "situationList", "situationArchiveFold", "situationArchiveCount", "situationArchive",
    "sequenceCharacter", "sequencePosition", "sequenceSituation", "sequenceConditions", "conditionDrive", "conditionSa", "conditionCa", "conditionBurnout",
    "conditionPunish", "opponentCharacter", "opponentMove", "opponentMoveStatus", "opponentMoveRetry", "conditionSummary", "sequenceList", "sequenceArchiveFold", "sequenceArchiveCount", "sequenceArchive",
    "frameCharacter", "frameQuery", "frameCategory", "frameSort", "framePunishable", "frameHeavyPunishable", "frameCancelable", "frameVersion", "frameTable",
    "drillList", "logList", "drillDoneFold", "drillDoneCount", "drillDone",
    "matchStats", "matchList",
    "editModal", "modalTitle", "modalClose", "editForm", "formFields", "formError", "deleteConfirm", "deleteButton", "cancelButton", "saveButton", "inboxContext", "inboxBoundary", "inboxStatus",
    "sheet", "sheetTitle", "sheetClose", "sheetBody",
    "characterOptions", "toast",
  ];
  const els = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
  return els;
}

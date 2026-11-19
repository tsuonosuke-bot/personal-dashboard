export function jstToday(now = new Date()) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** The queue and today's graded answers are independent, nullable measurements. */
export function knowledgeActivity(summary, now = new Date()) {
  const ready = Number.isSafeInteger(summary.reviewReadyDue) && summary.reviewReadyDue >= 0 ? summary.reviewReadyDue : null;
  const answered = summary.knowledgeAnsweredOn === jstToday(now) && Number.isSafeInteger(summary.knowledgeAnsweredToday) && summary.knowledgeAnsweredToday >= 0
    ? summary.knowledgeAnsweredToday : null;
  return {
    label: ready === null ? '復習数不明' : ready > 0 ? `復習 ${ready}問` : answered > 0 ? `今日 ${answered}問回答` : '復習なし',
    startReview: ready !== null && ready > 0,
    detail: answered === null ? '今日の回答数は取得できません' : `今日の回答 ${answered}問（採点記録済み）`,
  };
}

/**
 * ホームの「復習」欄に出すもの（#341）。問題はKnowledgeと同じ問題キューから出し、Hubで独自に選ばない。
 * 状態: 'ready'（すぐ解ける問題あり）/ 'done'（0問で今日の回答あり）/ 'idle'（0問で回答なし・回答数不明）/ 'unknown'（復習数を取得できない）
 */
export function reviewPanel(summary, now = new Date()) {
  const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const ready = count(summary.reviewReadyDue);
  const activity = knowledgeActivity(summary, now);
  const answered = summary.knowledgeAnsweredOn === jstToday(now) ? count(summary.knowledgeAnsweredToday) : null;
  const waiting = count(summary.reviewWaitingGrading);
  const unconfirmed = count(summary.reviewUnconfirmed);
  const state = ready === null ? 'unknown' : ready > 0 ? 'ready' : answered > 0 ? 'done' : 'idle';
  const message = {
    ready: null,
    done: '今解ける問題は終わりました',
    idle: '今解ける問題はありません',
    unknown: '復習数を取得できませんでした',
  }[state];
  return {
    state,
    message,
    startReview: activity.startReview,
    stats: [
      { key: 'ready', label: 'すぐ解ける', value: ready === null ? '—' : `${ready}問` },
      { key: 'answered', label: '今日の回答', value: answered === null ? '—' : `${answered}問` },
      // 採点待ち・未確認は、あるときだけ出す。
      ...(waiting > 0 ? [{ key: 'waiting', label: '採点待ち', value: `${waiting}件` }] : []),
      ...(unconfirmed > 0 ? [{ key: 'unconfirmed', label: '未確認', value: `${unconfirmed}件` }] : []),
    ],
    // 未確認の採点結果があれば、学習ログへの導線を出す。
    showLog: unconfirmed > 0,
  };
}

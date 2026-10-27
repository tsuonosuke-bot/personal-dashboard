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

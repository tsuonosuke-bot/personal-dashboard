const DEEP_DIVE_SOURCE = /^([\s\S]*?)\n\n深掘り元: ([^\n]+?)（knowledge ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})）\s*$/i;
const ACTION_SOURCE = /^([\s\S]*?)\n\n行動元: ([^\n]+?)（(insight|journal) ([0-9-]+)）\s*$/;

/** 登録APIが付けた出典行だけをリンクにする。任意のURLを本文から実行しない。 */
/** @type {typeof import("./inbox-source.d.ts").splitInboxSource} */
export function splitInboxSource(content) {
  const text = String(content ?? "");
  const action = ACTION_SOURCE.exec(text);
  if (action && action[1].trim()) {
    const [, body, label, type, id] = action;
    const validInsight = type === "insight" && /^[1-9]\d{0,15}$/.test(id) && Number.isSafeInteger(Number(id));
    const date = type === "journal" && /^\d{4}-\d{2}-\d{2}$/.test(id) ? new Date(`${id}T00:00:00Z`) : null;
    const validJournal = date && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === id;
    if (validInsight || validJournal) return {
      body: body.trim(),
      source: { prefix: "行動元", label: label.trim(), url: `/knowledge/?view=action-source&sourceType=${type}&sourceId=${id}` },
    };
  }
  const match = DEEP_DIVE_SOURCE.exec(text);
  if (!match || !match[1].trim()) return { body: text, source: null };
  return {
    body: match[1].trim(),
    source: { label: match[2].trim(), knowledgeId: match[3].toLowerCase(), url: `/knowledge/?knowledge=${match[3].toLowerCase()}` },
  };
}

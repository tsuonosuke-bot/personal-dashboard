// ホームの家計簿欄のうち、DOMに触れない部分（#340）。

/** 今月の支出を、先月の同じ日までの支出と比べた差。比較できなければnull。 */
/** @type {typeof import("./home-finance.d.ts").spendDifference} */
export function spendDifference(current, previousToDate) {
  if (!Number.isFinite(current) || !Number.isFinite(previousToDate)) return null;
  const diff = current - previousToDate;
  return { diff, sign: diff > 0 ? "＋" : diff < 0 ? "−" : "±", trend: diff > 0 ? "up" : diff < 0 ? "down" : "flat" };
}

/** 未分類の明細の件数。1件以上のときだけ数を返し、0件・取得不可はnull（欄に出さない）。 */
/** @type {typeof import("./home-finance.d.ts").unclassifiedToShow} */
export function unclassifiedToShow(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

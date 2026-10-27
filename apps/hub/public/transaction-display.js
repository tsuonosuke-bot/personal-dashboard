/** Finance transactionDisplay と同じ表示規約。保存値・集計値は変更しない。 */
export function transactionDisplay(expense) {
  const amount = Number(expense.amount);
  if (expense.category.startsWith("80_")) return { kind: "income", label: "収入", amount: Math.abs(amount) };
  return amount < 0
    ? { kind: "offset", label: "支出の相殺", amount }
    : { kind: "expense", label: "支出", amount };
}

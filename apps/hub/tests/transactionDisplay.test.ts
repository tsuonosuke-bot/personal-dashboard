import assert from "node:assert/strict";
import test from "node:test";
import { transactionDisplay as financeDisplay } from "../../finance/src/lib/finance.ts";
import type { Expense } from "../../finance/src/lib/types.ts";
const displayModule = "../public/transaction-display.js";
const { transactionDisplay: hubDisplay } = await import(displayModule);

test("Hub and Finance use the same income/expense/offset labels and display signs", () => {
  const cases = [
    { category: "80_収入", amount: -1000, expected: { kind: "income", label: "収入", amount: 1000 } },
    { category: "80_臨時収入", amount: 1000, expected: { kind: "income", label: "収入", amount: 1000 } },
    { category: "01_食費", amount: 1000, expected: { kind: "expense", label: "支出", amount: 1000 } },
    { category: "01_食費", amount: -200, expected: { kind: "offset", label: "支出の相殺", amount: -200 } },
    { category: "80_収入", amount: 0, expected: { kind: "income", label: "収入", amount: 0 } },
    { category: "01_食費", amount: 0, expected: { kind: "expense", label: "支出", amount: 0 } },
    { category: "800_通常", amount: -200, expected: { kind: "offset", label: "支出の相殺", amount: -200 } },
  ];
  for (const { category, amount, expected } of cases) {
    const row = { category, amount } as Expense;
    const saved = structuredClone(row);
    assert.deepEqual(hubDisplay(row), expected);
    assert.deepEqual(hubDisplay(row), financeDisplay(row));
    assert.deepEqual(row, saved, "display conversion must not mutate saved signs");
  }
});

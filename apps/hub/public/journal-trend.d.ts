export interface JournalTrendDay {
  date: string;
  mood: number | null;
  /** その日のJournalの行があるか（気分が空でも行があればtrue）。古い応答では欠ける。 */
  recorded?: boolean;
}

export interface JournalTrendData {
  startDate: string;
  endDate: string;
  days: JournalTrendDay[];
}

export interface JournalWeek {
  startDate: string;
  endDate: string;
  /** 気分を記録した日数。 */
  recorded: number;
  /** 記録した日の気分の平均（小数1桁）。記録がなければnull。 */
  average: number | null;
}

export function weeklyMoodAverages(days: JournalTrendDay[]): JournalWeek[];
export function yesterdayMissing(trend: JournalTrendData | null | undefined): boolean;
export function renderJournalTrendHtml(trend: JournalTrendData | null, available?: boolean): string;

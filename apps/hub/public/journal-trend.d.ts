export interface JournalTrendDay {
  date: string;
  mood: number | null;
}

export interface JournalTrendData {
  startDate: string;
  endDate: string;
  days: JournalTrendDay[];
}

export function renderJournalTrendHtml(trend: JournalTrendData | null, available?: boolean): string;

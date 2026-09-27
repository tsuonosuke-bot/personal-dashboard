export interface RouteAdapterInput {
  routeId: number;
  wantId: number;
  title: string;
  detail: string | null;
  cadence: "daily" | "weekdays" | "weekly" | "flexible" | null;
}

export type RouteAdapterDefinition =
  | { mode: "planned" }
  | { mode: "archive" }
  | { mode: "external"; provider: "google_calendar" }
  | {
      mode: "internal";
      table: "writing_topics" | "habits" | "focus_items";
      payload: (input: RouteAdapterInput) => Record<string, unknown>;
    };

export const WANT_ROUTE_ADAPTERS: Record<string, RouteAdapterDefinition> = {
  calendar: { mode: "external", provider: "google_calendar" },
  github: { mode: "planned" },
  knowledge: { mode: "planned" },
  journal: { mode: "planned" },
  writing: {
    mode: "internal",
    table: "writing_topics",
    payload: (input) => ({
      source_route_id: input.routeId,
      source_want_id: input.wantId,
      title: input.title,
      question: input.detail,
      status: "candidate",
    }),
  },
  habit: {
    mode: "internal",
    table: "habits",
    payload: (input) => ({
      source_route_id: input.routeId,
      source_want_id: input.wantId,
      name: input.title,
      purpose: input.detail,
      cadence: input.cadence,
      status: "active",
    }),
  },
  focus: {
    mode: "internal",
    table: "focus_items",
    payload: (input) => ({
      source_route_id: input.routeId,
      source_want_id: input.wantId,
      content: input.title,
      note: input.detail,
      status: "active",
    }),
  },
  archive: { mode: "archive" },
};

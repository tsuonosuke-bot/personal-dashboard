export interface CompassRoute {
  view: "inbox" | "wants" | "todos";
  id: number | null;
  filter: "untriaged" | "knowledge" | "github" | "overdue" | "today" | "upcoming" | null;
  error: "invalid-target" | null;
}

export function parseCompassRoute(value: string | URL): CompassRoute;
export function compassRoutePath(
  value: string | URL,
  view: "inbox" | "wants" | "todos",
  id?: number | null,
  filter?: "untriaged" | "knowledge" | "github" | "overdue" | "today" | "upcoming" | null,
): string;

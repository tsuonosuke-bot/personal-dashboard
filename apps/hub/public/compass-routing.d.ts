export interface CompassRoute {
  view: "inbox" | "wants" | "todos";
  id: number | null;
  filter: "untriaged" | "knowledge" | "github" | "overdue" | "today" | "upcoming" | null;
  error: "invalid-target" | null;
  /** Explicit completed Inbox/ToDo reference. Ordinary stale links still fall back. */
  history?: true;
}

export function parseCompassRoute(value: string | URL): CompassRoute;
export function compassRoutePath(
  value: string | URL,
  view: "inbox" | "wants" | "todos",
  id?: number | null,
  filter?: "untriaged" | "knowledge" | "github" | "overdue" | "today" | "upcoming" | null,
  history?: boolean,
): string;
export function compassHistoryPath(view: "inbox" | "todos", id: number): string;
export function compassRouteAllowsClosed(route: CompassRoute, status: string): boolean;

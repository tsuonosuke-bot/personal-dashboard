export interface CompassRoute {
  view: "inbox" | "wants";
  id: number | null;
  filter: "untriaged" | "knowledge" | null;
  error: "invalid-target" | null;
}

export function parseCompassRoute(value: string | URL): CompassRoute;
export function compassRoutePath(
  value: string | URL,
  view: "inbox" | "wants",
  id?: number | null,
  filter?: "untriaged" | "knowledge" | null,
): string;

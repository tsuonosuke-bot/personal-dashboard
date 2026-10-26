import { readFile } from "node:fs/promises";

// UI wiring assertions cover the assembled screen after App delegates to controllers/components.
// Behavior is also covered by the API/model/confirmation suites; this helper does not execute React.
export async function readAppSource(): Promise<string> {
  const files = [
  "App.tsx",
  "hooks/useKnowledgeNavigation.ts",
  "hooks/useKnowledgeActions.ts",
  "components/KnowledgeHeader.tsx",
  "components/KnowledgeDashboard.tsx"
];
  return (await Promise.all(files.map((path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8"))))
    .map((source) => source.replaceAll("\r\n", "\n")).join("\n");
}

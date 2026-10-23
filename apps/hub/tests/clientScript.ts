import { readFile } from "node:fs/promises";

/** Read an entry's real static module graph so feature assertions survive file moves. */
export async function readClientScript(entry: string): Promise<string> {
  const root = new URL("../public/", import.meta.url);
  const visited = new Set<string>();
  const sources: string[] = [];
  async function visit(url: URL): Promise<void> {
    if (visited.has(url.href)) return;
    if (!url.href.startsWith(root.href)) throw new Error("Client import left public/");
    visited.add(url.href);
    const source = await readFile(url, "utf8");
    sources.push(source.replace(/\r\n/g, "\n"));
    const imports = source.matchAll(/(?:import|export)\s+[\s\S]*?\sfrom\s+["'](\.[^"']+\.js)["']/g);
    for (const match of imports) await visit(new URL(match[1], url));
  }
  await visit(new URL(`${entry}.js`, root));
  return sources.join("\n");
}

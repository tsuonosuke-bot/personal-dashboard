#!/usr/bin/env node
// Generates `<name>.dark.css` next to each given stylesheet. The output re-declares only the
// color-bearing declarations under :root[data-theme="dark"], so the authored light CSS stays the
// single source of truth. Run with --check to fail when a generated file is stale.
// This file is shared verbatim by personal-dashboard, knowledge-dashboard and financial-dashboard.
import { readFileSync, writeFileSync } from "node:fs";

const DARK = ':root[data-theme="dark"]';

// ---------- color math ----------
function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function parseHex(hex) {
  let value = hex.slice(1);
  if (value.length === 3 || value.length === 4) value = [...value].map((c) => c + c).join("");
  const alpha = value.length === 8 ? parseInt(value.slice(6, 8), 16) / 255 : 1;
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
    a: alpha,
  };
}

function toHsl({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h / 6, s, l };
}

function fromHsl({ h, s, l }) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue = (p, q, t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue(p, q, h + 1 / 3) * 255),
    g: Math.round(hue(p, q, h) * 255),
    b: Math.round(hue(p, q, h - 1 / 3) * 255),
  };
}

function formatColor({ r, g, b }, alpha) {
  const hex = `#${[r, g, b].map((v) => clamp(v, 0, 255).toString(16).padStart(2, "0")).join("")}`;
  if (alpha >= 1) return hex;
  return `rgba(${r}, ${g}, ${b}, ${Number(alpha.toFixed(3))})`;
}

/** Maps a light-theme color to its dark counterpart according to how it is used. */
function mapColor(rgba, role) {
  const hsl = toHsl(rgba);
  let { h, s, l } = hsl;
  // Near-white colors can report full HSL saturation; limit darkened tints by their real chroma.
  const chroma = (Math.max(rgba.r, rgba.g, rgba.b) - Math.min(rgba.r, rgba.g, rgba.b)) / 255;
  if (role === "bg") {
    if (l < 0.72) return null; // accents, dark fills and overlays keep their color
    // White surfaces sit slightly above the page; tinted fills stay visible on both.
    if (l >= 0.985) l = 0.16;
    else if (l >= 0.94) l = 0.1 + (l - 0.94) * 0.9;
    else l = 0.2 + (0.94 - l) * 0.25;
    s = Math.min(s * 0.5, chroma * 3);
  } else if (role === "border") {
    if (l >= 0.62) {
      l = 0.24 + (l - 0.62) * 0.3;
      s = Math.min(s * 0.45, chroma * 3);
    } else {
      l = Math.max(l, 0.52);
    }
  } else if (role === "fg") {
    if (l > 0.68) return null; // already light (text on accent fills)
    l = 0.93 - l * 0.55;
  } else if (role === "glow") {
    if (l < 0.6) return null; // dark shadows work on dark surfaces too
    l = 0.3;
    s = Math.min(s * 0.45, chroma * 3);
  } else {
    return null;
  }
  return formatColor(fromHsl({ h, s, l: clamp(l) }), rgba.a);
}

const COLOR_PATTERN = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|rgba?\(\s*[\d.]+[\s,]+[\d.]+[\s,]+[\d.]+(?:\s*[,/]\s*[\d.]+%?)?\s*\)|\b(?:white|black)\b/g;

function parseColorToken(token) {
  if (token.startsWith("#")) return parseHex(token);
  if (token === "white") return { r: 255, g: 255, b: 255, a: 1 };
  if (token === "black") return { r: 0, g: 0, b: 0, a: 1 };
  const parts = token.match(/[\d.]+%?/g).map((part) => part);
  const alphaPart = parts[3];
  const alpha = alphaPart === undefined
    ? 1
    : alphaPart.endsWith("%") ? Number(alphaPart.slice(0, -1)) / 100 : Number(alphaPart);
  return { r: Number(parts[0]), g: Number(parts[1]), b: Number(parts[2]), a: alpha };
}

function mapValue(value, role) {
  let changed = false;
  const mapped = value.replace(COLOR_PATTERN, (token) => {
    const next = mapColor(parseColorToken(token), role);
    if (next === null) return token;
    changed = true;
    return next;
  });
  return changed ? mapped : null;
}

// ---------- roles ----------
function propertyRole(property) {
  if (property === "background" || property === "background-color" || property === "background-image") return "bg";
  if (/^(border|outline|column-rule)/.test(property)) return "border";
  if (property === "box-shadow" || property === "text-shadow") return "glow";
  if (/^(color|fill|stroke|caret-color|accent-color|text-decoration|text-decoration-color|-webkit-text-fill-color)$/.test(property)) return "fg";
  return null;
}

function tokenRole(name, value) {
  if (/line|border|rule|divider/.test(name)) return "border";
  if (/shadow/.test(name)) return "glow";
  const first = value.match(COLOR_PATTERN)?.[0];
  if (!first) return null;
  return toHsl(parseColorToken(first)).l >= 0.72 ? "bg" : "fg";
}

// ---------- CSS parsing ----------
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Parses a stylesheet into nested blocks: { type: "rule", selector, body } or { type: "at", prelude, children }. */
function parseBlocks(css) {
  const blocks = [];
  let index = 0;
  while (index < css.length) {
    const open = css.indexOf("{", index);
    if (open === -1) break;
    const prelude = css.slice(index, open).trim();
    let depth = 1;
    let cursor = open + 1;
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === "{") depth += 1;
      else if (css[cursor] === "}") depth -= 1;
      cursor += 1;
    }
    const body = css.slice(open + 1, cursor - 1);
    const statementEnd = prelude.lastIndexOf(";");
    const cleanPrelude = statementEnd >= 0 ? prelude.slice(statementEnd + 1).trim() : prelude;
    if (cleanPrelude.startsWith("@")) {
      blocks.push({ type: "at", prelude: cleanPrelude, children: /^@(media|supports|layer|container)/.test(cleanPrelude) ? parseBlocks(body) : [] });
    } else {
      blocks.push({ type: "rule", selector: cleanPrelude, body });
    }
    index = cursor;
  }
  return blocks;
}

function declarations(body) {
  const result = [];
  let depth = 0;
  let current = "";
  for (const char of body) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === ";" && depth === 0) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result
    .map((decl) => decl.trim())
    .filter(Boolean)
    .map((decl) => {
      const colon = decl.indexOf(":");
      return { property: decl.slice(0, colon).trim().toLowerCase(), value: decl.slice(colon + 1).trim() };
    })
    .filter((decl) => decl.property && decl.value);
}

function darkSelector(selector) {
  return selector
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith(":root")) return `${DARK}${part.slice(":root".length)}`;
      if (/^html\b/.test(part)) return `html[data-theme="dark"]${part.slice(4)}`;
      return `${DARK} ${part}`;
    })
    .join(",\n");
}

// ---------- generation ----------
function collectTokens(blocks, tokens = new Map()) {
  const aliases = [];
  for (const block of blocks) {
    if (block.type === "at") collectTokens(block.children, tokens);
    else for (const decl of declarations(block.body)) {
      if (!decl.property.startsWith("--")) continue;
      const alias = decl.value.match(/^var\((--[a-zA-Z0-9-]+)\)$/);
      if (alias) {
        aliases.push({ name: decl.property, target: alias[1] });
        continue;
      }
      const role = tokenRole(decl.property, decl.value);
      if (role) tokens.set(decl.property, { role, value: decl.value });
    }
  }
  // `--page-accent: var(--green)` behaves like --green, so it is pinned the same way.
  for (const { name, target } of aliases) {
    const resolved = tokens.get(target);
    if (resolved) tokens.set(name, { role: resolved.role, value: `var(${target})`, alias: target });
  }
  return tokens;
}

function darkDeclarations(body, tokens, isRoot) {
  const out = [];
  for (const { property, value } of declarations(body)) {
    const important = /!important\s*$/.test(value);
    const cleanValue = value.replace(/\s*!important\s*$/, "");
    const suffix = important ? " !important" : "";
    if (property === "color-scheme") {
      if (/\blight\b/.test(cleanValue)) out.push(`color-scheme: dark${suffix}`);
      continue;
    }
    if (property.startsWith("--")) {
      const token = tokens.get(property);
      if (!token) continue;
      if (token.alias) {
        if (token.role !== "border") out.push(`${property}--light: var(${token.alias}--light, var(${token.alias}))${suffix}`);
        continue;
      }
      const mapped = mapValue(cleanValue, token.role);
      if (mapped) out.push(`${property}: ${mapped}${suffix}`);
      // Fills that use a text-colored token keep the light value so white text stays readable.
      if (isRoot && token.role !== "border") out.push(`${property}--light: ${cleanValue}${suffix}`);
      continue;
    }
    const role = propertyRole(property);
    if (!role) continue;
    let next = mapValue(cleanValue, role);
    const pinned = (next ?? cleanValue).replace(/var\((--[a-zA-Z0-9-]+)((?:\s*,[^()]*(?:\([^()]*\)[^()]*)*)?)\)/g, (match, name, fallback) => {
      const token = tokens.get(name);
      if (!token) return match;
      if ((role === "bg" && token.role === "fg") || (role === "fg" && token.role === "bg")) {
        return `var(${name}--light, var(${name}${fallback}))`;
      }
      return match;
    });
    if (pinned !== (next ?? cleanValue)) next = pinned;
    // Unchanged color declarations are repeated too: the dark copy of an earlier rule would
    // otherwise outrank a later light rule and break the authored cascade order.
    out.push(`${property}: ${next ?? cleanValue}${suffix}`);
  }
  return out;
}

function render(blocks, tokens, indent = "") {
  const chunks = [];
  for (const block of blocks) {
    if (block.type === "at") {
      if (!block.children.length) continue;
      const inner = render(block.children, tokens, `${indent}  `);
      if (inner) chunks.push(`${indent}${block.prelude} {\n${inner}\n${indent}}`);
      continue;
    }
    if (block.selector.includes("[data-theme") || block.selector.startsWith("@")) continue;
    const isRoot = block.selector.split(",").some((part) => part.trim() === ":root");
    const decls = darkDeclarations(block.body, tokens, isRoot);
    if (!decls.length) continue;
    const selector = darkSelector(block.selector)
      .split("\n")
      .map((line) => `${indent}${line}`)
      .join("\n");
    chunks.push(`${selector} {\n${decls.map((decl) => `${indent}  ${decl};`).join("\n")}\n${indent}}`);
  }
  return chunks.join("\n");
}

/** sharedTokens lets a stylesheet pin tokens that another stylesheet on the same page defines. */
export function buildDarkTheme(css, sourceName, sharedTokens = new Map()) {
  const blocks = parseBlocks(stripComments(css));
  const tokens = collectTokens(blocks, new Map(sharedTokens));
  const body = render(blocks, tokens);
  return `/* Generated from ${sourceName} by scripts/build-dark-theme.mjs. Do not edit. */\n${body}\n`;
}

function outputPath(input) {
  return input.replace(/\.css$/, ".dark.css");
}

const args = process.argv.slice(2);
const check = args.includes("--check");
const inputs = args.filter((arg) => arg !== "--check");
if (inputs.length > 0) {
  let stale = false;
  const sources = new Map(inputs.map((input) => [input, readFileSync(input, "utf8")]));
  const sharedTokens = new Map();
  for (const css of sources.values()) collectTokens(parseBlocks(stripComments(css)), sharedTokens);
  for (const input of inputs) {
    const output = outputPath(input);
    const generated = buildDarkTheme(sources.get(input), input.split("/").pop(), sharedTokens);
    if (check) {
      let current = "";
      try { current = readFileSync(output, "utf8"); } catch { /* missing counts as stale */ }
      if (current !== generated) {
        stale = true;
        console.error(`${output} is stale. Run the theme build script.`);
      }
    } else {
      writeFileSync(output, generated);
    }
  }
  if (stale) process.exitCode = 1;
}

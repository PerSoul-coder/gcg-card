#!/usr/bin/env node
/* 七元素矢量图标构建 —— 把 assets/原神元素图标-矢量 里的官方 SVG 归一成可直接内联的 JS 注册表。
 *
 *   node scripts/build-icons.mjs
 *
 * 归一化内容：
 *   · 根 <svg> 只保留 xmlns / viewBox，补 preserveAspectRatio 与可访问性属性；
 *   · 所有具体填充色替换为 currentColor——界面按元素色着色，亮/暗上下文自动适配；
 *   · 去掉 width/height，尺寸交给 CSS（1em 跟随字号）；
 *   · 生成前断言不含 <script / </script / 外链引用，避免内联进单文件时破坏页面。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(ROOT, "assets/原神元素图标-矢量");
const OUT = resolve(ROOT, "gi-data/element-icons.js");

const FILES = [
  ["CRYO", "冰.svg"],
  ["HYDRO", "水.svg"],
  ["PYRO", "火.svg"],
  ["ELECTRO", "电.svg"],
  ["ANEMO", "风.svg"],
  ["GEO", "岩.svg"],
  ["DENDRO", "草.svg"],
];

function normalize(file) {
  const raw = readFileSync(resolve(SRC, file), "utf8");
  if (/<script|<\/script|<foreignObject|<image|href="(?!#)/i.test(raw))
    throw new Error(`${file} 含不可内联的内容（脚本 / 外链 / 位图）`);
  const open = raw.match(/<svg\b[^>]*>/);
  if (!open) throw new Error(`${file} 不是合法 SVG`);
  const viewBox = open[0].match(/viewBox="([^"]+)"/);
  if (!viewBox) throw new Error(`${file} 缺少 viewBox`);
  const inner = raw.slice(open[0].length, raw.lastIndexOf("</svg>"));
  const body = inner.replace(/fill="#[0-9A-Fa-f]{3,8}"/g, 'fill="currentColor"');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox[1]}" preserveAspectRatio="xMidYMid meet" class="ele-svg" aria-hidden="true" focusable="false">${body}</svg>`;
}

const map = {};
for (const [key, file] of FILES) map[key] = normalize(file);

const js = `/* 自动生成：build-icons.mjs —— 七元素官方矢量图标（填充色已归一为 currentColor）。请勿手改。 */
window.ELEMENT_ICONS_SVG = ${JSON.stringify(map, null, 2)};
`;
writeFileSync(OUT, js);
console.log("输出：gi-data/element-icons.js");
for (const [key, file] of FILES) console.log(`  ${key.padEnd(8)} ← ${file}  ${(map[key].length / 1024).toFixed(1)} KB`);

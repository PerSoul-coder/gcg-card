#!/usr/bin/env node
/* 单文件构建 —— 把样式、脚本、数据快照全部内联进一个 HTML，双击即可打开。
 *
 *   node scripts/build-single.mjs              内置数据快照（约 2.6MB，断网可用）
 *   node scripts/build-single.mjs --lite       不内嵌数据（约 440KB，首次打开需联网拉取）
 *   node scripts/build-single.mjs --out=x.html 指定输出文件名（相对项目根目录）
 *
 * 为什么不直接复制三份文件：单文件没有相对路径依赖，微信/邮件传一个文件就能用，
 * 也不会出现「只发了 html 没发 css」这类问题。内置快照还能消除首次加载失败的风险。
 *
 * 内联安全要点：
 *   · 数据以 <script type="application/json"> 承载，JSON 中所有 "<" 转义为 \u003c，
 *     保证任何数据文本都不会提前闭合标签、也不会触发注释转义状态；
 *   · 脚本/样式内联前断言不含 </script、</style，避免静默产出坏文件；
 *   · 替换一律用函数形式，防止数据里的 $& / $' 被 String.replace 当成替换模式。
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = p => readFileSync(resolve(ROOT, p), "utf8");
const kb = n => (n / 1024).toFixed(1) + " KB";
const mb = n => (n / 1024 / 1024).toFixed(2) + " MB";

const argv = process.argv.slice(2);
const lite = argv.includes("--lite");
const outArg = argv.find(a => a.startsWith("--out="));
const OUT = outArg
  ? outArg.slice("--out=".length)
  : (lite ? "dist/七圣召唤-卡牌与牌组浏览器-轻量.html" : "dist/七圣召唤-卡牌与牌组浏览器.html");

/* 先构建应用包：单文件版内联的就是 dist/app.js，避免产物落后于 TS 源码 */
{
  const r = spawnSync(process.execPath, [resolve(ROOT, "scripts/build-app.mjs")], {
    cwd: ROOT, encoding: "utf8",
  });
  if (r.status !== 0) throw new Error("构建 dist/app.js 失败：\n" + (r.stderr || r.stdout || ""));
}

const DATASETS = [
  ["characters", "gi-data/characters.json"],
  ["entities", "gi-data/entities.json"],
  ["keywords", "gi-data/keywords.json"],
];

/* 内联前的硬性检查：命中就报错，而不是产出「看起来正常、打开却白屏」的文件 */
function assertInlinable(code, kind) {
  if (kind === "script" && /<\/script/i.test(code)) throw new Error("脚本含 </script 序列，不能直接内联");
  if (kind === "style" && /<\/style/i.test(code)) throw new Error("样式含 </style 序列，不能直接内联");
  return code;
}

let html = read("deck-viewer.html");
const css = assertInlinable(read("deck-viewer.css"), "style");
/* 应用包：资源（拼音索引 / 概念库 / 元素图标）已是 ESM 模块，被打进同一个包，
   这里只需内联 dist/app.js，不再单独处理资源脚本 */
const app = assertInlinable(read("dist/app.js"), "script");

/* ---------- 1. 样式内联 ---------- */
const cssTag = /<link\s+rel="stylesheet"\s+href="deck-viewer\.css[^"]*"\s*>/;
if (!cssTag.test(html)) throw new Error("未找到指向 deck-viewer.css 的 <link> 标签");
html = html.replace(cssTag, () => `<style>\n${css}\n</style>`);

/* ---------- 2. 数据快照 + 应用脚本 ---------- */
let payload = "";
const counts = [];
/* 统一数据集（gzip）：两种模式都内联。浏览器原生 DecompressionStream 不支持 brotli，
   所以运行时主路径用 gzip；Brotli 包仍由 build-dataset 产出于 gi-data/dataset.br。 */
let dsB64 = "";
try { dsB64 = readFileSync(resolve(ROOT, "gi-data/dataset.gz")).toString("base64"); } catch (e) {}
const dsPayload = dsB64
  ? `<script id="builtin-dataset" type="text/plain">${dsB64}</script>
<script>
/* 单文件版：压缩数据集交给运行时数据层（内置，无需联网） */
try { window.BUILTIN_DATASET_GZ_B64 = document.getElementById("builtin-dataset").textContent.trim(); }
catch (e) { console.error("内置数据集读取失败：", e); }
</script>
`
  : "";
if (!lite) {
  const data = {};
  for (const [key, file] of DATASETS) {
    const j = JSON.parse(read(file));
    if (!j || !Array.isArray(j.data) || !j.data.length) throw new Error(`${file} 结构异常（缺少 data 数组）`);
    data[key] = j.data;
    counts.push(`${key} ${j.data.length}`);
  }
  /* 每个 "<" 转成 \u003c：JSON 中合法，解析后原样还原；文本层面彻底排除标签注入 */
  const jsonText = JSON.stringify(data).replace(/</g, "\\u003c");
  payload = `<script id="builtin-data" type="application/json">${jsonText}</script>
<script>
/* 单文件版：把内嵌数据快照交给应用。多文件版没有这一段，应用会自动走缓存/现网 */
try { window.BUILTIN_DATA = JSON.parse(document.getElementById("builtin-data").textContent); }
catch (e) { console.error("内置数据快照解析失败：", e); }
</script>
${dsPayload}`;
} else {
  payload = dsPayload;
}

/* 应用脚本整块替换：多文件版是 16 个 <script src="src/...">，单文件版按同一顺序合并为一段 */
const appBlock = /<!-- app-sources:start[\s\S]*?<!-- app-sources:end -->/;
if (!appBlock.test(html)) throw new Error("未找到 app-sources 标记块");
html = html.replace(appBlock, () => `${payload}<script>\n${app}\n</script>`);

/* ---------- 5. 头部版本戳注释换成构建信息 ---------- */
const stamp = new Date();
const stampText = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, "0")}-${String(stamp.getDate()).padStart(2, "0")} ${String(stamp.getHours()).padStart(2, "0")}:${String(stamp.getMinutes()).padStart(2, "0")}`;
const buildNote = `<!-- 单文件版 · build-single.mjs 生成于 ${stampText}
     样式、脚本、${lite ? "（未内嵌数据，首次打开需联网）" : `数据快照（${counts.join(" / ")}）`} 均已内联，单文件即可运行
     重新生成：node scripts/build-single.mjs${lite ? " --lite" : ""} -->`;
html = html.replace(/<!--\s*\?v=\s*版本戳[^]*?-->/, () => buildNote);

/* ---------- 6. 残留外部引用自检 ----------
   注意排除 JS 模板字符串里的动态地址（src="${...}"），它们运行时才求值，不算静态依赖。 */
const leftovers = [];
const notStatic = String.raw`(?!https?:|data:|\$\{)`;
for (const re of [
  new RegExp(`<link[^>]+href="${notStatic}[^"]*"`, "g"),
  new RegExp(`<script[^>]+src="${notStatic}[^"]*"`, "g"),
  new RegExp(`<img[^>]+src="${notStatic}[^"]*"`, "g"),
]) {
  for (const m of html.matchAll(re)) leftovers.push(m[0].slice(0, 60));
}

mkdirSync(resolve(ROOT, dirname(OUT)), { recursive: true });
writeFileSync(resolve(ROOT, OUT), html, "utf8");
const bytes = Buffer.byteLength(html);
const gz = gzipSync(Buffer.from(html)).length;

console.log(`输出：${OUT}`);
console.log(`  原始体积 ${mb(bytes)}　gzip 后 ${kb(gz)}`);
console.log(`  模式：${lite ? "轻量（不内嵌数据，首次打开需联网）" : "内置数据快照（离线可用）"}`);
if (counts.length) console.log(`  内置数据：${counts.join(" · ")}`);
if (leftovers.length) {
  console.log(`\n⚠ 仍有 ${leftovers.length} 处外部本地引用，单文件可能不完整：`);
  for (const l of leftovers.slice(0, 5)) console.log("   " + l);
  process.exitCode = 1;
} else {
  console.log("  外部本地依赖：0（仅卡面图走 HTTPS）");
}

#!/usr/bin/env node
/* 单文件构建 —— 把样式、脚本、统一数据包全部内联进一个 HTML，双击即可打开。
 *
 *   node scripts/build-single.mjs              内置数据包（离线可用）
 *   node scripts/build-single.mjs --out=x.html 指定输出文件名（相对项目根目录）
 *
 * 为什么不直接复制几份文件：单文件没有相对路径依赖，微信/邮件传一个文件就能用，
 * 也不会出现「只发了 html 没发 css」这类问题。内置数据包还能消除首次加载失败的风险。
 *
 * 内联的是**统一数据集**（gi-data/dataset.gz，构建期归一化产物），不是三份原始 JSON。
 * 以前两者都内联，单文件因此有 3MB：原始 JSON 只是给运行时的启发式兜底用的，
 * 现在运行时只读数据集，再内联它们就是纯粹的重复。
 *
 * 内联安全要点：
 *   · 数据以 <script type="text/plain"> 承载 base64，不存在转义与标签闭合问题；
 *   · 脚本/样式内联前断言不含 </script、</style，避免静默产出坏文件；
 *   · 替换一律用函数形式，防止数据里的 $& / $' 被 String.replace 当成替换模式。 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = p => readFileSync(resolve(ROOT, p), "utf8");
const kb = n => (n / 1024).toFixed(1) + " KB";
const mb = n => (n / 1024 / 1024).toFixed(2) + " MB";

const argv = process.argv.slice(2);
const outArg = argv.find(a => a.startsWith("--out="));
const OUT = outArg
  ? outArg.slice("--out=".length)
  : "dist/七圣召唤-卡牌与牌组浏览器.html";

/* 先构建应用包：单文件版内联的就是 dist/app.js，避免产物落后于 TS 源码 */
{
  const r = spawnSync(process.execPath, [resolve(ROOT, "scripts/build-app.mjs")], {
    cwd: ROOT, encoding: "utf8",
  });
  if (r.status !== 0) throw new Error("构建 dist/app.js 失败：\n" + (r.stderr || r.stdout || ""));
}

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

/* ---------- 2. 数据包 + 应用脚本 ---------- */
/* 统一数据集（gzip）：浏览器原生 DecompressionStream 不支持 brotli，
   所以运行时主路径用 gzip；Brotli 包仍由 build-dataset 产出于 gi-data/dataset.br。 */
const gzPath = resolve(ROOT, "gi-data/dataset.gz");
let dsB64 = "";
let dsBytes = 0;
try {
  dsB64 = readFileSync(gzPath).toString("base64");
  dsBytes = statSync(gzPath).size;
} catch (e) { /* 未构建数据集时留空：运行时回退到站点数据包（http(s) 下才可行，file:// 下必然被拦） */ }
const dsPayload = dsB64
  ? `<script id="builtin-dataset" type="text/plain">${dsB64}</script>
<script>
/* 单文件版：压缩数据集交给运行时数据层（内置，无需联网） */
try { window.BUILTIN_DATASET_GZ_B64 = document.getElementById("builtin-dataset").textContent.trim(); }
catch (e) { console.error("内置数据集读取失败：", e); }
</script>
`
  : "";
const payload = dsPayload;

/* 应用脚本整块替换：多文件版是 16 个 <script src="src/...">，单文件版按同一顺序合并为一段 */
const appBlock = /<!-- app-sources:start[\s\S]*?<!-- app-sources:end -->/;
if (!appBlock.test(html)) throw new Error("未找到 app-sources 标记块");
html = html.replace(appBlock, () => `${payload}<script>\n${app}\n</script>`);

/* ---------- 3. 头部版本戳注释换成构建信息 ---------- */
const stamp = new Date();
const stampText = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, "0")}-${String(stamp.getDate()).padStart(2, "0")} ${String(stamp.getHours()).padStart(2, "0")}:${String(stamp.getMinutes()).padStart(2, "0")}`;
const buildNote = `<!-- 单文件版 · build-single.mjs 生成于 ${stampText}
     样式、脚本、统一数据集（${kb(dsBytes)} gzip） 均已内联，单文件即可运行
     重新生成：node scripts/build-single.mjs -->`;
html = html.replace(/<!--\s*\?v=\s*版本戳[^]*?-->/, () => buildNote);

/* ---------- 4. 残留外部引用自检 ----------
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
console.log(`  模式：内置数据包（离线可用）`);
if (dsBytes) console.log(`  内置数据集：${kb(dsBytes)}（gzip，base64 内联）`);
if (leftovers.length) {
  console.log(`\n⚠ 仍有 ${leftovers.length} 处外部本地引用，单文件可能不完整：`);
  for (const l of leftovers.slice(0, 5)) console.log("   " + l);
  process.exitCode = 1;
} else {
  console.log("  外部本地依赖：0（仅卡面图走 HTTPS）");
}

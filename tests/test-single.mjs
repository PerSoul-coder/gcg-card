/* 单文件版完整性验证：外部依赖为零、内置快照与源数据逐字节一致、脚本顺序正确。
   这些断言的意义：单文件一旦漏内联某个资源，用 file:// 打开时不会报错、
   只会静默白屏或样式错乱，所以必须由断言守住。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAppSource } from "./test-lib.mjs";


const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(here, "dist", "七圣召唤-卡牌与牌组浏览器.html");

let fails = 0;
const assert = (cond, msg) => { if (cond) console.log("  ok:", msg); else { console.error("  FAIL:", msg); fails++; } };

console.log("== 单文件产物 ==");
assert(fs.existsSync(OUT), "产物存在（七圣召唤-卡牌与牌组浏览器.html）");
if (!fs.existsSync(OUT)) process.exit(1);
const html = fs.readFileSync(OUT, "utf8");
const bytes = Buffer.byteLength(html);

/* ===== 1. 外部依赖 ===== */
assert(!/<link[^>]+rel="stylesheet"/i.test(html), "无外链样式表（CSS 已内联）");
assert(!/<script[^>]+src=/i.test(html), "无外链脚本（JS 已内联）");
assert(!/<img[^>]+src="(?!https?:|data:|\$\{)/.test(html), "无本地图片引用（卡面图仅走 HTTPS）");
assert(/<style>[\s\S]*:root\s*\{/.test(html), "样式表内容已内联（含 :root 变量）");

/* ===== 2. 内置数据包 =====
   内联的是构建期归一化的数据集（gzip + base64），不是三份原始 JSON：
   运行时只读数据集，再内联原始快照就是纯粹的重复（单文件因此从 3.1MB 降到 0.9MB）。 */
const m = html.match(/<script id="builtin-dataset" type="text\/plain">([\s\S]*?)<\/script>/);
assert(!!m, "内置数据包存在");
if (m) {
  const b64 = m[1].trim();
  assert(/^[A-Za-z0-9+/=]+$/.test(b64), "内联数据是可解析的 base64（无换行污染）");
  const gzSrc = fs.readFileSync(path.join(here, "gi-data/dataset.gz"));
  assert(Buffer.from(b64, "base64").equals(gzSrc), "内联内容与 gi-data/dataset.gz 逐字节一致");
  assert(!/<\/script/i.test(b64), "数据块不含 </script 序列");
}

/* ===== 3. 脚本顺序与内容 ===== */
const iStyle = html.indexOf("<style>");
const iData = html.indexOf('id="builtin-dataset"');
const iHook = html.indexOf("window.BUILTIN_DATASET_GZ_B64");
const iApp = html.indexOf("function decodeRaw(src)");
assert(iStyle > 0 && iData > iStyle, "样式在数据包之前内联");
assert(iHook > iData && iHook < iApp, "数据包读取钩子位于数据块之后、应用之前（否则数据集不可见）");
assert(iApp > 0, "应用脚本已内联");

/* 资源（拼音索引 / 补充概念库 / 元素图标）已是 ESM 模块，随应用包一起内联 */
const appSrc = fs.readFileSync(path.join(here, "dist/app.js"), "utf8");
const cssSrc = fs.readFileSync(path.join(here, "deck-viewer.css"), "utf8");
/* 整段逐字比对：只比前缀会让「产物落后于源码」静默通过 */
const appBlock = `<script>\n${appSrc}\n</script>`;
assert(html.includes(appBlock), "内联的应用脚本与打包产物逐字一致（整段比对）");
assert(html.includes(`<style>\n${cssSrc}\n</style>`), "内联的样式与源文件逐字一致（整段比对）");
assert(html.includes("ELEMENT_ICONS_SVG"), "官方七元素矢量图标已随应用包内联");
/* 补充概念库（genshin-db 快照）不再作为运行时依赖：它在构建期被归一进 dataset.terms，
   运行时只读归一化结果。断言它没有随包内联，防止有人把旧的全局写法加回来。 */
assert(!html.includes("CONCEPTS_EXTRA"), "补充概念库已并入数据集，不再随应用包内联");
assert(html.includes("PINYIN_DATA"), "拼音索引已随应用包内联");

/* ===== 4. 体积与构建信息 ===== */
/* 主文件 = 应用包（约 0.34MB）+ 数据集 gzip base64（约 0.55MB）+ 样式。
   上限用来兜住"把未压缩数据或原始三份快照又内联回来"的回归，不是抠几十 KB。 */
assert(bytes > 700_000 && bytes < 1_300_000, `文件体积在预期区间（${(bytes / 1024 / 1024).toFixed(2)} MB）`);
assert(html.includes('id="builtin-dataset"') && html.includes("BUILTIN_DATASET_GZ_B64"), "压缩数据集已内联并交给运行时");
assert(/单文件版 · build-single\.mjs 生成于 \d{4}-\d{2}-\d{2}/.test(html), "头部含构建时间戳（可追溯版本）");
assert(/统一数据集（[\d.]+ KB gzip）/.test(html), "头部标注内置数据集规模");
assert(!/deck-viewer\.(?:css|js|html)\?v=/.test(html), "无残留的资源版本戳查询串（单文件不靠 URL 版本戳）");

/* ===== 5. 轻量版 ===== */
const LITE = path.join(here, "dist", "七圣召唤-卡牌与牌组浏览器-轻量.html");
if (fs.existsSync(LITE)) {
  const liteHtml = fs.readFileSync(LITE, "utf8");
  assert(!liteHtml.includes('id="builtin-dataset"'), "轻量版不内嵌数据包");
  assert(!/<script[^>]+src=/i.test(liteHtml), "轻量版脚本同样全内联");
  assert(liteHtml.includes(appBlock), "轻量版应用脚本与源文件逐字一致（整段比对）");
  assert(liteHtml.includes(`<style>\n${cssSrc}\n</style>`), "轻量版样式与源文件逐字一致（整段比对）");
  /* 轻量版只有应用包 + 样式：数据首次打开时从站点取。 */
  assert(Buffer.byteLength(liteHtml) < 600_000, `轻量版体积 < 600KB（${(Buffer.byteLength(liteHtml) / 1024).toFixed(0)} KB）`);
  assert(liteHtml.includes("dataset.gz"), "轻量版保留数据包的获取路径（运行时按需拉取）");
}

console.log(fails ? `\n${fails} 条断言失败` : "\n全部通过");
process.exit(fails ? 1 : 0);

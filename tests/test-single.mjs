/* 单文件版完整性验证：外部依赖为零、内置快照与源数据逐字节一致、脚本顺序正确。
   这些断言的意义：单文件一旦漏内联某个资源，用 file:// 打开时不会报错、
   只会静默白屏或样式错乱，所以必须由断言守住。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAppSource } from "./test-lib.mjs";
import { ASSET_SOURCES } from "../src/sources.mjs";

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

/* ===== 2. 内置数据快照 ===== */
const m = html.match(/<script id="builtin-data" type="application\/json">([\s\S]*?)<\/script>/);
assert(!!m, "内置数据块存在");
if (m) {
  const raw = m[1];
  assert(raw.length > 1_000_000, `数据块体积合理（${(raw.length / 1024 / 1024).toFixed(2)} MB 文本）`);
  assert(!raw.includes("<"), "数据块不含裸 <（全部转义为 \\u003c，杜绝标签提前闭合）");
  assert(!/<\/script/i.test(raw), "数据块不含 </script 序列");

  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (e) { console.error("  FAIL: 内置数据 JSON 解析失败 -", e.message); fails++; }
  assert(!!parsed, "内置数据可被 JSON.parse 还原");
  if (parsed) {
    for (const cat of ["characters", "entities", "keywords"]) {
      const src = JSON.parse(fs.readFileSync(path.join(here, `gi-data/${cat}.json`), "utf8")).data;
      assert(Array.isArray(parsed[cat]) && parsed[cat].length === src.length,
        `内置 ${cat} 条目数与源一致（${src.length}）`);
      /* 逐条深比较：确保没有截断、没有字段丢失 */
      assert(JSON.stringify(parsed[cat]) === JSON.stringify(src), `内置 ${cat} 内容与源快照完全一致`);
    }
  }
}

/* ===== 3. 脚本顺序与内容 ===== */
const iStyle = html.indexOf("<style>");
const iConcepts = html.indexOf("window.CONCEPTS_EXTRA = {");
const iData = html.indexOf('id="builtin-data"');
const iHook = html.indexOf("window.BUILTIN_DATA = JSON.parse");
const iApp = html.indexOf("function decodeRaw(src)");
assert(iStyle > 0 && iConcepts > iStyle, "概念库脚本在样式之后内联");
assert(iData > 0 && iData > iConcepts, "数据块位于概念库之后");
assert(iHook > iData && iHook < iApp, "数据解析钩子位于数据块之后、应用之前（否则 BUILTIN_DATA 不可见）");
assert(iApp > 0, "应用脚本已内联");

const appSrc = readAppSource({ withAssets: false });
const cssSrc = fs.readFileSync(path.join(here, "deck-viewer.css"), "utf8");
/* 整段逐字比对：只比前缀会让「产物落后于源码」静默通过 */
const appBlock = `<script>\n${appSrc}\n</script>`;
assert(html.includes(appBlock), "内联的应用脚本与源文件逐字一致（整段比对）");
assert(html.includes(`<style>\n${cssSrc}\n</style>`), "内联的样式与源文件逐字一致（整段比对）");
assert(html.includes("window.ELEMENT_ICONS_SVG"), "官方七元素矢量图标已内联");
for (const p of ASSET_SOURCES) {
  const code = fs.readFileSync(path.join(here, p), "utf8");
  assert(html.includes(`<script>\n${code}\n</script>`), `资源脚本完整内联：${p}`);
}

/* ===== 4. 体积与构建信息 ===== */
assert(bytes > 2_000_000 && bytes < 3_000_000, `文件体积在预期区间（${(bytes / 1024 / 1024).toFixed(2)} MB）`);
assert(/单文件版 · build-single\.mjs 生成于 \d{4}-\d{2}-\d{2}/.test(html), "头部含构建时间戳（可追溯版本）");
assert(/数据快照（characters 155 \/ entities 1347 \/ keywords 149）/.test(html), "头部标注内置数据规模");
assert(!/deck-viewer\.(?:css|js|html)\?v=/.test(html), "无残留的资源版本戳查询串（单文件不靠 URL 版本戳）");

/* ===== 5. 轻量版 ===== */
const LITE = path.join(here, "dist", "七圣召唤-卡牌与牌组浏览器-轻量.html");
if (fs.existsSync(LITE)) {
  const liteHtml = fs.readFileSync(LITE, "utf8");
  assert(!liteHtml.includes('id="builtin-data"'), "轻量版不内嵌数据块");
  assert(!/<script[^>]+src=/i.test(liteHtml), "轻量版脚本同样全内联");
  assert(liteHtml.includes(appBlock), "轻量版应用脚本与源文件逐字一致（整段比对）");
  assert(liteHtml.includes(`<style>\n${cssSrc}\n</style>`), "轻量版样式与源文件逐字一致（整段比对）");
  /* 轻量版 = 应用脚本 + 资源脚本（拼音 102KB + 概念库 91KB + 官方元素矢量 48KB），
     这条上限只用来兜住"误把数据快照内联进来"（那样会到 2.7MB），不是抠几十 KB */
  assert(Buffer.byteLength(liteHtml) < 620_000, `轻量版体积 < 620KB（${(Buffer.byteLength(liteHtml) / 1024).toFixed(0)} KB）`);
}

console.log(fails ? `\n${fails} 条断言失败` : "\n全部通过");
process.exit(fails ? 1 : 0);

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

/* 资源（补充概念库 / 元素图标）已是 ESM 模块，随应用包一起内联 */
const appSrc = fs.readFileSync(path.join(here, "dist/app.js"), "utf8");
const cssSrc = fs.readFileSync(path.join(here, "deck-viewer.css"), "utf8");
/* 整段逐字比对：只比前缀会让「产物落后于源码」静默通过 */
const appBlock = `<script>\n${appSrc}\n</script>`;
assert(html.includes(appBlock), "内联的应用脚本与打包产物逐字一致（整段比对）");
assert(html.includes(`<style>\n${cssSrc}\n</style>`), "内联的样式与源文件逐字一致（整段比对）");
assert(html.includes("ELEMENT_ICONS_SVG"), "官方七元素矢量图标已随应用包内联");
/* 补充概念库（genshin-db 快照）不再作为运行时依赖：它在构建期被归一进 dataset.terms，
   运行时只读归一化结果。断言它没有随包内联，防止有人把旧的全局写法加回来。
   拼音同理：它写进记录别名（aliases.pinyin）随 dataset.gz 内联，不再有独立的
   PINYIN_DATA 索引——出现旧标识说明把废弃管线又接了回来。 */
assert(!html.includes("CONCEPTS_EXTRA"), "补充概念库已并入数据集，不再随应用包内联");
assert(!html.includes("PINYIN_DATA"), "拼音已并入数据集记录，拼音索引不再随包内联");

/* ===== 4. 体积与构建信息 ===== */
/* 主文件 = 应用包（约 0.34MB）+ 数据集 gzip base64（约 0.55MB）+ 样式。
   上限用来兜住"把未压缩数据或原始三份快照又内联回来"的回归，不是抠几十 KB。 */
assert(bytes > 700_000 && bytes < 1_300_000, `文件体积在预期区间（${(bytes / 1024 / 1024).toFixed(2)} MB）`);
assert(html.includes('id="builtin-dataset"') && html.includes("BUILTIN_DATASET_GZ_B64"), "压缩数据集已内联并交给运行时");
assert(/单文件版 · build-single\.mjs 生成于 \d{4}-\d{2}-\d{2}/.test(html), "头部含构建时间戳（可追溯版本）");
assert(/统一数据集（[\d.]+ KB gzip）/.test(html), "头部标注内置数据集规模");
assert(!/deck-viewer\.(?:css|js|html)\?v=/.test(html), "无残留的资源版本戳查询串（单文件不靠 URL 版本戳）");

/* ===== 5. 轻量版已移除 =====
   数据归一化后单文件只内联一份 dataset.gz（<1MB），「不内嵌数据、联网取包」的轻量版
   没有存在意义；这里守住它不再被加回来。 */
assert(!fs.existsSync(path.join(here, "dist", "七圣召唤-卡牌与牌组浏览器-轻量.html")), "轻量版产物已删除");

/* ===== 6. PWA 壳（同目录伴生文件） =====
   托管部署（deploy-pages.yml 上传 site/ 全部产物）靠它们获得安装与离线能力。
   断言守住三件事：build-single 忘了复制伴生文件、manifest 写坏、SW 清缓存误伤
   应用自己的卡面缓存（49-cache 的 gi-card-art-v1）。 */
assert(/<link rel="manifest" href="manifest\.json">/.test(html), "HTML 含 manifest 链接");
assert(/<link rel="apple-touch-icon" href="icon-192\.png">/.test(html), "HTML 含 apple-touch-icon（iOS 主屏图标）");
for (const f of ["manifest.json", "sw.js", "icon-192.png", "icon-512.png"]) {
  assert(fs.existsSync(path.join(here, "dist", f)), `PWA 伴生文件已产出：${f}`);
}
try {
  const mf = JSON.parse(fs.readFileSync(path.join(here, "dist", "manifest.json"), "utf8"));
  assert(mf.start_url === "./" && mf.scope === "./" && mf.display === "standalone",
    "manifest 相对路径 + standalone（仓库子路径 / 单文件目录均可用）");
  assert(Array.isArray(mf.icons) && mf.icons.some(i => i.sizes === "192x192") && mf.icons.some(i => i.sizes === "512x512"),
    "manifest 图标 192/512 齐备");
  assert(fs.readFileSync(path.join(here, "pwa", "manifest.json")).equals(fs.readFileSync(path.join(here, "dist", "manifest.json"))),
    "dist/manifest.json 与仓库源件逐字节一致");
} catch (e) {
  assert(false, "manifest.json 可解析：" + e);
}
try {
  const sw = fs.readFileSync(path.join(here, "dist", "sw.js"), "utf8");
  new Function(sw); /* 只编译不执行：语法兜底 */
  assert(true, "sw.js 语法可编译");
  assert(sw.includes("gi-shell-v1"), "sw.js 壳缓存名（gi-shell-v1）");
  assert(sw.includes('startsWith("gi-shell-")'), "激活清理按 gi-shell- 前缀过滤（不误伤 49-cache 的卡面缓存）");
  assert(sw.includes('"navigate"'), "SW 只拦文档导航请求（图片等其余请求不接管）");
} catch (e) {
  assert(false, "sw.js 可读可编译：" + e);
}
for (const f of ["icon-192.png", "icon-512.png"]) {
  const p = path.join(here, "dist", f);
  const ok = fs.existsSync(p) && fs.readFileSync(p).subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  assert(ok, `${f} 是有效 PNG（签名核对）`);
}

console.log(fails ? `\n${fails} 条断言失败` : "\n全部通过");
process.exit(fails ? 1 : 0);

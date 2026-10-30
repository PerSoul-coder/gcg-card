/* 界面信息架构回归（P3）。
 *
 * 这一组断言守的是「卡牌浏览器」的定位：打开就是卡库，分享码输入属于牌组视图。
 * 以前这些东西由 HTML 结构与 CSS 共同决定，改一处很容易在另一处失配
 * （比如把 tab 顺序调了，但默认 active 还留在旧位置），所以写成结构级断言。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(here, "deck-viewer.html"), "utf8");
const css = fs.readFileSync(path.join(here, "deck-viewer.css"), "utf8");
const mainSrc = fs.readFileSync(path.join(here, "src/99-main.ts"), "utf8");
const stateSrc = fs.readFileSync(path.join(here, "src/data/state.ts"), "utf8");

let fails = 0;
const assert = (cond, msg) => { if (cond) console.log("  ok:", msg); else { console.error("  FAIL:", msg); fails++; } };

/* 取某条选择器的规则体。last 用于判断最终生效值，first 用于判断默认声明 */
const lastRule = (sel) => {
  let hit = "";
  const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{[^}]*\\}", "g");
  let m; while ((m = re.exec(css))) hit = m[0];
  return hit;
};
/* 第一条同名规则 = 默认声明：后面那些以 body[data-view] 为前提的规则不算默认值 */
const firstRule = (sel) => {
  const re = new RegExp("^" + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{[^}]*\\}", "m");
  return (css.match(re) || [""])[0];
};
/* 截取某个 id 元素的标记块（按同名标签的开闭粗切，够用且不引入解析器） */
const blockOfId = (id) => {
  const i = html.indexOf(`id="${id}"`);
  if (i < 0) return "";
  const start = html.lastIndexOf("<", i);
  const tag = (html.slice(start + 1).match(/^[a-zA-Z]+/) || ["div"])[0];
  const end = html.indexOf(`</${tag}>`, i);
  if (end < 0) return html.slice(start);
  /* 自闭合的 input 等标签没有闭合标记 */
  return html.slice(start, end + tag.length + 3);
};

/* ===== 1. 一级入口：卡库在前且默认选中 ===== */
const tabsHtml = blockOfId("tabs");
const tabViews = [...tabsHtml.matchAll(/data-view="([a-z]+)"/g)].map(m => m[1]);
assert(tabViews[0] === "browse", "标签栏第一个是卡库浏览（" + tabViews.join(" / ") + "）");
assert(/class="tab active"\s+data-view="browse"/.test(tabsHtml), "默认选中的是卡库浏览");
assert(new Set(tabViews).size === tabViews.length, "标签栏无重复视图");
assert(/<div class="view active" id="view-browse"><\/div>/.test(html), "卡库视图初始即为可见（否则首屏空白）");
assert(!/<div class="view active" id="view-grid">/.test(html), "卡面视图不再默认可见");

/* ===== 2. 分享码输入属于牌组视图，不在页头 ===== */
const headerHtml = blockOfId("docs").length ? "" : (html.match(/<header>[\s\S]*?<\/header>/) || [""])[0];
const deckTools = blockOfId("deckTools");
assert(/id="codeInput"/.test(deckTools), "分享码输入在牌组操作条内");
assert(!/id="codeInput"/.test(headerHtml), "分享码输入不在页头（不再总是置顶）");
assert(/id="deckTools"/.test(deckTools) && /class="controls"/.test(deckTools), "牌组操作条复用 controls 样式类");

/* ===== 3. 全局动作与牌组动作分家 ===== */
assert(/class="hd-actions"/.test(headerHtml), "页头有独立动作区");
const moreMenu = blockOfId("moreMenu");
assert(/id="btnRefresh"/.test(moreMenu) && /id="btnDataInfo"/.test(moreMenu) && /id="btnHelp"/.test(moreMenu),
  "页头「更多」含全局动作：刷新数据 / 数据信息 / 说明");
const deckMenu = blockOfId("deckToolsMenu");
assert(/id="btnHistory"/.test(deckMenu) && /id="btnDeckDiff"/.test(deckMenu) && /id="btnOdds"/.test(deckMenu),
  "牌组工具菜单含历史 / 对比 / 概率");
assert(!/id="btnOdds"/.test(moreMenu) && !/id="btnHistory"/.test(moreMenu),
  "牌组专用动作不混进页头菜单");

/* ===== 4. 显隐由视图驱动（CSS），不靠每个入口记得调 ===== */
const controlsRule = firstRule(".controls");
assert(/display:\s*none/.test(controlsRule), "牌组操作条默认不显示");
for (const v of ["grid", "list"]) {
  assert(new RegExp(`body\\[data-view="${v}"\\] \\.controls`).test(css), `牌组视图（${v}）显示操作条`);
}
assert(!/body\[data-view="browse"\] \.controls/.test(css), "卡库视图不显示操作条");
assert(/document\.body\.dataset\.view = name/.test(mainSrc), "切视图时把视图名写到 body 上");

/* ===== 5. 默认落点 ===== */
assert(/currentView:\s*"browse"/.test(stateSrc), "应用状态默认视图是卡库");
assert(/if \(!VIEW_RENDER\[name\]\) name = "browse"/.test(mainSrc), "未知视图回落到卡库（不是空牌组卡面）");
assert(/switchView\(VIEW_RENDER\[v\] \? v : "browse\)/.test(mainSrc) || /VIEW_RENDER\[v\] \? v : "browse"/.test(mainSrc),
  "无历史记录时落到卡库");
/* 数字键与标签栏顺序一致：1 卡库 / 2 卡面 / 3 列表 */
assert(/ev\.key === "1"\) switchView\("browse"\)/.test(mainSrc), "快捷键 1 = 卡库");
assert(/ev\.key === "2"\) switchView\("grid"\)/.test(mainSrc), "快捷键 2 = 牌组卡面");
assert(/ev\.key === "3"\) switchView\("list"\)/.test(mainSrc), "快捷键 3 = 牌组列表");
assert(/bottom: 快捷键|快捷键：1 卡库/.test(html), "页脚快捷键说明与实际一致");

/* ===== 6. 首屏不替用户做决定 ===== */
const emptyHashBranch = (mainSrc.match(/空 hash[\s\S]{0,400}?\}\)\(\);/) || [""])[0];
assert(!!emptyHashBranch, "启动路由有「空 hash」分支");
assert(!/decodeAndRender\(SAMPLE/.test(emptyHashBranch), "首屏不自动解析示例牌组（不再写进历史）");
assert(/await ensureData\(\)/.test(emptyHashBranch), "首屏进卡库前先加载数据（否则空白）");
assert(/restoreView\(\)/.test(emptyHashBranch), "首屏按上次停留的视图落脚，无记录则为卡库");
/* 外部分享链接与示例按钮要走相反的路：直接展示牌组 */
assert(/decodeAndRender\(h\);\s*switchView\("grid"\)/.test(mainSrc), "分享码链接解析后直接进卡面视图");
assert(/decodeAndRender\(SAMPLE\)\.then\(\(\) => switchView\("grid"\)\)/.test(mainSrc), "「加载示例牌组」后直接进卡面视图");

console.log(fails ? "\n存在失败项" : "\n全部通过");
process.exit(fails ? 1 : 0);

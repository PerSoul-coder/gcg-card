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

/* ===== 3. 全局动作升页头图标钮；示例牌组归位牌组工具；图鉴是独立页签 ===== */
assert(/class="hd-actions"/.test(headerHtml), "页头有独立动作区");
assert(/id="btnTheme"/.test(headerHtml) && /id="btnRandom"/.test(headerHtml) && !/id="btnRefresh"/.test(headerHtml)
  && /id="btnCache"/.test(headerHtml) && /id="btnHelp"/.test(headerHtml) && !/id="btnDataInfo"/.test(headerHtml),
  "页头四图标钮：主题 / 随机一卡 / 资源缓存 / 帮助（数据信息与刷新钮已归档移除）");
assert(!/id="moreMenu"/.test(headerHtml) && !/id="btnMore"/.test(headerHtml), "「更多」菜单不复存在");
const deckMenu = blockOfId("deckToolsMenu");
assert(/id="btnHistory"/.test(deckMenu) && /id="btnDeckDiff"/.test(deckMenu),
  "牌组工具菜单含历史 / 对比（抽牌概率已归档移除）");
assert(/id="btnSample"/.test(deckMenu), "加载示例牌组在牌组工具菜单（牌组功能归位）");
assert(!/id="btnSkillIdx"/.test(deckMenu) && !/id="btnSkillIdx"/.test(headerHtml),
  "技能图鉴不在任何菜单（独立主页签）");
assert(/data-view="skills"/.test(html) && /id="view-skills"/.test(html), "技能图鉴是第 4 个页签/视图");

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
assert(/ev\.key === "4"\) switchView\("skills"\)/.test(mainSrc), "快捷键 4 = 技能图鉴");
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


/* ===== 7. 指针引擎 + 菜单系统：长按/右键/悬停统一交互 ===== */
const ctxSrc = fs.readFileSync(path.join(here, "src/93-contextmenu.ts"), "utf8");
const menuSrc = fs.readFileSync(path.join(here, "src/core/menu.ts"), "utf8");
const gestureSrc = fs.readFileSync(path.join(here, "src/core/gesture.ts"), "utf8");
assert(fs.readFileSync(path.join(here, "src/main.ts"), "utf8").includes(String.raw`import "./93-contextmenu";`), "上下文菜单模块已挂进应用依赖图");
assert(gestureSrc.includes("export function bindGestures"), "指针引擎提供 bindGestures 注册表");
assert(gestureSrc.includes("LONG_MS = 480") && gestureSrc.includes("pointerdown"), "触屏长按计时器（480ms）在引擎");
assert(gestureSrc.includes("MOVE_PX") && gestureSrc.includes("pointermove"), "长按移动即取消（防误触滚动）在引擎");
assert(gestureSrc.includes("contextmenu") && gestureSrc.includes("preventDefault"), "右键分发在引擎（托管目标拦截，其余保留原生）");
assert(gestureSrc.includes("swallowUntil"), "长按后的合成 click 被吞掉一次（引擎单点）");
assert(gestureSrc.includes("(hover: hover) and (pointer: fine)"), "悬停能力判定单点在引擎（isHoverCapable）");
assert(!fs.readFileSync(path.join(here, "src/90-detail.ts"), "utf8").includes("document.addEventListener(\"mousemove\""), "90-detail 不再自带 mousemove（hover 已并入引擎）");
assert(ctxSrc.includes("bindGestures") && !ctxSrc.includes("addEventListener"), "93 是纯策略层（菜单规格 + 注册意图，无自有监听）");
assert(ctxSrc.includes("showTipAt"), "概念链接长按/右键/悬停走悬浮预览（与 hover 同路）");
assert(menuSrc.includes("export function openMenuAt") && menuSrc.includes("export function closeMenu"), "菜单组件：openMenuAt/closeMenu 单实例收口");
assert(menuSrc.includes("openChild") && menuSrc.includes("trimTo"), "菜单子级：飞出式展开与逐层修剪");
assert(menuSrc.includes("pinned") && menuSrc.includes("existing.pinned = true"), "子级双状态：点击 auto 子级转钉住、再点已钉住的收起");
assert(menuSrc.includes("scheduleLeaveCollapse") && menuSrc.includes("mouseleave"), "离开菜单：auto 子级宽限后自动收起（pinned 不受影响）");
assert(menuSrc.includes("hideTip") === false && fs.readFileSync(path.join(here, "src/93-contextmenu.ts"), "utf8").includes("openSpec"), "开菜单统一走 openSpec（先收残留预览）");
assert(menuSrc.includes("ArrowRight") && menuSrc.includes("ArrowLeft") && menuSrc.includes("Escape"), "菜单键盘导航（↑↓←→/Esc 逐层）");
assert(menuSrc.includes("role=\"menuitem\"") && menuSrc.includes("aria-haspopup"), "菜单 ARIA（menuitem/haspopup）");
assert(menuSrc.includes("hashchange"), "路由变化收起菜单（组件统一收口）");
assert(css.includes(".cmenu") && css.includes("cmenu-check") && css.includes("cmenu-caret"), "菜单系统样式（层级面板/勾选列/子级箭头）已入库");
for (const label of ["查看详情", "加入对比", "设为核心牌", "取消收藏", "复制该卡链接", "单卡分享图（PNG）", "children"])
  assert(ctxSrc.includes(label), "卡池条目菜单含「" + label + "」（同族操作收子级）");
for (const label of ["设为当前牌组", "重命名", "创建副本", "删除"])
  assert(ctxSrc.includes(label), "牌组行菜单含「" + label + "」");
assert(css.includes("-webkit-touch-callout"), "iOS 长按呼出已被压掉");
assert(css.includes("--fscale") && css.includes(String.raw`html[data-fs="xl"]`), "字号缩放令牌与档位存在");
assert(html.includes("btnFs") && html.includes("viewport-fit=cover"), "字号按钮与安全区 viewport 已入库");
assert(css.includes("safe-area-inset-bottom"), "底部安全区补偿存在");

console.log(fails ? "\n存在失败项" : "\n全部通过");
process.exit(fails ? 1 : 0);

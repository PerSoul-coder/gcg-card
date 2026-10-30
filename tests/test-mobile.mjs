/* 移动端适配回归：把"曾经坏过"的几处写成静态断言。
   这些规则大多是纯 CSS，无法靠 DOM stub 验证，因此直接对源文件做结构性检查——
   重点不是"有没有写"，而是"写的顺序/选择器能不能真的生效"。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAppSource } from "./test-lib.mjs";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(here, "deck-viewer.css"), "utf8");
const js = readAppSource({ withAssets: false });
const html = fs.readFileSync(path.join(here, "deck-viewer.html"), "utf8");

let fails = 0;
const assert = (cond, msg) => { if (cond) console.log("  ok:", msg); else { console.error("  FAIL:", msg); fails++; } };

/* 取某条选择器的最后一条规则体——CSS 后写者胜，只有"最后一条"才真正生效 */
const lastRule = (sel) => {
  let hit = "";
  const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{[^}]*\\}", "g");
  let m; while ((m = re.exec(css))) hit = m[0];
  return hit;
};
/* 取某段 media 块内的文本 */
const blockOf = (keyword) => {
  const i = css.indexOf(keyword);
  if (i < 0) return "";
  let depth = 0, start = css.indexOf("{", i);
  for (let k = start; k < css.length; k++) {
    if (css[k] === "{") depth++;
    else if (css[k] === "}") { depth--; if (!depth) return css.slice(start, k + 1); }
  }
  return css.slice(start);
};
/* 同类 media 块可能有多段（后写的生效），取最后一段 */
const lastBlockOf = (keyword) => {
  let last = "", from = 0, i = -1;
  while ((i = css.indexOf(keyword, from)) >= 0) {
    let depth = 0, start = css.indexOf("{", i), end = css.length;
    for (let k = start; k < css.length; k++) {
      if (css[k] === "{") depth++;
      else if (css[k] === "}") { depth--; if (!depth) { end = k + 1; break; } }
    }
    last = css.slice(start, end);
    from = end;
  }
  return last;
};

/* ---------- 1. 视口声明 ---------- */
assert(/<meta name="viewport" content="width=device-width, initial-scale=1/.test(html),
  "页面声明 width=device-width（否则手机会按 980 缩放整页）");

/* ---------- 2. 触摸设备禁用悬浮预览（点按合成 mousemove 会留下幽灵浮层） ---------- */
assert(/@media \(hover: none\), \(pointer: coarse\)\s*\{[^}]*#tip\s*\{\s*display:\s*none\s*!important/.test(css),
  "CSS：粗指针/无悬停设备上禁用 #tip");
assert(/function canHover\(\)/.test(js), "JS：canHover() 判定悬停能力");
assert(/if \(!canHover\(\)\) \{ hideTip\(\); return; \}/.test(js),
  "JS：mousemove 在无悬停能力时不显示预览");
assert(!/if \(overlayOpen\(\) \|\| !canHover\(\)\)/.test(js),
  "JS：不在弹层内禁用预览（详情里的术语仍需悬浮解释）");

/* ---------- 3. 预览位置四边钳制 ---------- */
assert(/Math\.max\(pad, Math\.min\(x, innerWidth - r\.width - pad\)\)/.test(js)
  && /Math\.max\(pad, Math\.min\(y, innerHeight - r\.height - pad\)\)/.test(js),
  "预览位置在四边钳制（旧逻辑只挡右/下，左侧会算出负坐标）");

/* ---------- 4. 弹层打开时锁背景滚动 ---------- */
assert(/html\.ovl-lock, html\.ovl-lock body\s*\{\s*overflow:\s*hidden/.test(css),
  "CSS：ovl-lock 锁住文档滚动");
assert(/root\.classList\.toggle\("ovl-lock", open\)/.test(js), "JS：开关弹层时同步 ovl-lock");
assert(/#overlay[^{]*\{[^}]*overscroll-behavior:\s*contain/.test(css), "#overlay 阻断滚动链");
assert(/\.detail \{[^}]*overscroll-behavior:\s*contain/.test(css), ".detail 阻断滚动链");
assert(!'overlay").classList.add("show")'.includes("x") && !/\$\("overlay"\)\.classList\.add\("show"\)/.test(js),
  "弹层显示只有 setOverlayOpen 一条路径（避免漏掉滚动锁）");
assert(!/\$\("overlay"\)\.classList\.remove\("show"\)/.test(js),
  "弹层隐藏同样收敛到 setOverlayOpen");

/* ---------- 5. 横向溢出：标签栏 / 表格 ---------- */
assert(/\.tabs \{[^}]*flex-wrap:\s*wrap/.test(blockOf("@media (max-width: 700px)")),
  "窄屏标签栏允许换行（4 个标签曾撑出 16px 把整页缩小）");
assert(/\.tab \{[^}]*flex:\s*none/.test(blockOf("@media (max-width: 700px)")), "窄屏标签不被压缩");
assert(/\.table-wrap \{[^}]*overflow-x:\s*auto/.test(css), ".table-wrap 提供横向滚动容器");
assert(/return `<div class="sec-title">\$\{t\}<\/div><div class="table-wrap"><table>/.test(js)
  && /\$\{rows\(t\)\}<\/table><\/div>`/.test(js),
  "列表表格被 .table-wrap 包裹（7 列在手机下需要横向滑动而不是撑宽页面）");

/* ---------- 6. 顺序陷阱：覆盖规则必须写在基础规则之后 ---------- */
const curveLast = lastRule(".curve");
const ctitleLast = lastRule(".ctitle");
assert(/flex:\s*1 1 100%/.test(curveLast),
  "费用曲线的生效规则（最后一条）是窄屏独占一行 —— 实际生效：" + curveLast.slice(0, 60).replace(/\s+/g, " "));
assert(/position:\s*static/.test(ctitleLast),
  ".ctitle 的生效规则（最后一条）改为文档流，否则绝对定位会压在上一行文字上 —— 实际生效：" + ctitleLast.slice(0, 60).replace(/\s+/g, " "));

/* ---------- 7. 底部常驻栏与面板不互相遮挡 ---------- */
assert(/\.wrap \{ padding: 16px 10px 104px/.test(css), "窄屏底部留白 ≥ 牌组栏高度");
assert(/@media \(max-width: 420px\)\s*\{[^}]*#draftPanel \{ bottom: 104px/.test(css.replace(/\n/g, " ").replace(/\s+/g, " ")) ||
  /#draftPanel \{ bottom: 104px/.test(css), "窄屏牌组面板上移，避开两行高的牌组栏");
assert(/@media \(max-width: 420px\)[\s\S]*?#draftBar \.dbar-title \{[^}]*text-overflow: ellipsis/.test(css),
  "320 窄屏下牌组名可省略（原单行 348px 会撑出屏幕）");

/* ---------- 8. 概览/提示不越界 ---------- */
assert(/\.toast \{[^}]*max-width:\s*calc\(100vw - 28px\)/.test(css), "提示条宽度不超视口");

/* ---------- 9. 概念页不重复写概念名 ---------- */
assert(/termHtml\(entries, true, name\)/.test(js), "概念页传入页头名，正文同名条目不再重复");
assert(/const nameLine = hideName && info\.name === hideName \? "" :/.test(js),
  "仅同名时省略，异名条目仍显示名称");

/* ---------- 10. 对比 / 牌组差异 / 抽牌面板的窄屏细节 ---------- */
const narrow760 = lastBlockOf("@media (max-width: 760px)");
const coarse = lastBlockOf("@media (hover: none), (pointer: coarse)");
const small420 = lastBlockOf("@media (max-width: 420px)");
assert(/flex-wrap:\s*nowrap/.test(narrow760) && /overflow-x:\s*auto/.test(narrow760),
  "窄屏对比栏 chips 单行横向滑动（4 张卡不会把栏撑成三行）");
assert(/body\.cmp-on #draftPanel \{[^}]*bottom:\s*208px/.test(narrow760),
  "对比栏常驻时牌组面板抬高，两层浮层不互相遮挡");
assert(/\.dd-swap-t \{[^}]*display:\s*inline/.test(narrow760),
  "窄屏牌组对比的「⇅」补上可见的「交换」文字");
assert(/\.odds-pick select \{[^}]*flex:\s*1 1 100%/.test(narrow760),
  "窄屏关键牌下拉独占一行，便于点选");
assert(/\.dd-field input,\s*\.odds-pick select[^{]*\{[^}]*font-size:\s*16px/.test(coarse),
  "触屏输入控件 16px（iOS 聚焦时不会放大整页）");
assert(/\.tile:hover \{ transform:\s*none/.test(coarse),
  "触屏取消卡片悬停位移（点按后不会粘住抬起状态）");
assert(/#overlay \{ backdrop-filter:\s*none/.test(coarse),
  "触屏关闭弹层实时模糊（中低端机滚动更稳）");
assert(/\.detail \{[^}]*max-height:\s*88dvh/.test(css),
  "弹层高度使用 dvh（移动端地址栏收起时不被裁切）");
assert(/\.cmp-scroll \{[^}]*overflow-x:\s*auto[^}]*webkit-overflow-scrolling:\s*touch/.test(css),
  "对比表支持惯性横向滚动");
assert(/\.detail \{[^}]*padding:\s*14px/.test(small420) && /\.detail \.dimg \{[^}]*max-width:\s*168px/.test(small420),
  "≤420px 压缩弹层留白与卡图，正文获得更多可视空间");
assert(/autocapitalize="off" autocorrect="off" enterkeyhint="go"/.test(js),
  "分享码输入框关闭自动大写/纠错，并提供 Go 回车键");
assert(/⇅<span class="dd-swap-t">交换<\/span>/.test(js), "交换按钮带可读文字标签");
/* 卡库「显示不可构筑」开关：窄屏覆盖必须后写才生效，且点按面积够大 */
assert(/padding:\s*9px 12px/.test(lastRule(".bg-sw")), "触屏开关：窄屏加高到点按面积 ≥40px（覆盖最后生效）");
assert(/width:\s*30px[^}]*height:\s*16px/.test(lastRule(".bg-sw .sw")), "触屏开关：滑块尺寸随字号放大");
/* 滚动路径上不留实时背景模糊（sticky 工具栏与卡面徽标） */
/* 所有同名规则一起看：lastRule 会取到 @media print 里那条，单看最后一条会漏判 */
const rulesOf = sel => [...css.matchAll(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{[^}]*\\}", "g"))].map(m => m[0]);
const barRules = rulesOf(".browse-bar").filter(r => /position:\s*sticky/.test(r));
assert(barRules.length > 0 && barRules.every(r => !/backdrop-filter/.test(r)),
  "卡库工具栏不用 backdrop-filter（滚动时不逐帧采样）");
const badgeRules = [...rulesOf(".tile .qcnt"), ...rulesOf(".tile .cnt")];
assert(badgeRules.length > 0 && badgeRules.every(r => !/backdrop-filter/.test(r)),
  "卡面数量徽标不用 backdrop-filter（每张卡一个滤镜会让滚动成本随卡数增长）");

/* 无牌面卡壳：与真牌面同比例；类型可辨；状态图标叠在壳上、可被壳兜底 */
assert(/\.noart \{[^}]*aspect-ratio:\s*420 \/ 720/.test(css), "卡壳与真牌面同比例（420:720），网格不错位");
assert(/\.noart-rib \{[^}]*height:\s*4px/.test(css), "卡壳顶部类型色条标识类别");
assert(/\.noart-kind \{[^}]*letter-spacing/.test(css), "卡壳底部类型字");
assert(/\.noart-disc \{[^}]*position:\s*absolute/.test(css), "状态图标叠在卡壳之上（可覆盖壳的纹理）");
assert(/\.noart \.noart-disc > img \{[^}]*object-fit:\s*contain/.test(css), "图标 contain 缩放，不变形");
assert(/\.noart\.hasicon \.noart-mark \{[^}]*opacity:\s*0/.test(css), "图标就位后让出 ◈ 兜底");
assert(/\.tile \.imgbox > \.noart \{[^}]*height:\s*100%/.test(css), "卡壳顶满图区内容盒（否则底部露出 4px 底色条）");
assert(/\.cmp-hcell img \{[^}]*height:\s*auto/.test(css), "对比表缩略图 height:auto（否则被 img 的 720 属性拉长）");
assert(/\.detail \.dimg > img \{[^}]*border-radius/.test(css) && !/\.detail \.dimg img \{/.test(css),
  "详情页卡面样式只作用于直接子 img，不会套到状态图标上");
assert(/\.cmp-hcell \.noart-cmp img \{[^}]*border:\s*0/.test(css), "对比表里的状态图标不被套上边框");

console.log(fails ? `\n存在失败：${fails} 项` : "\n全部通过");
process.exit(fails ? 1 : 0);

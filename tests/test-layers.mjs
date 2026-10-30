/* 浮层层级与滚动锁回归。
 *
 * 这两件事原先散在两处：
 *   · Esc 的关闭顺序硬编码在入口的 if 链里 —— 新增一层要记得改，漏了就是「Esc 关不掉」
 *     （「更多」菜单确实一直漏着）；
 *   · 锁滚动靠 CSS 的 :has() 反推选择器 —— 谁算浮层、谁算常驻元素全靠人判断，
 *     一度把历史面板与对比栏也锁了，结果是「选中过对比卡之后整页再也滚不动」。
 *
 * 这里按行为断言：不看实现文本，直接驱动层栈看它关谁、锁不锁。 */
import { createTest } from "./_env.mjs";

const t = createTest({ window: { innerWidth: 1015 } });   /* 与 clientWidth 差 15px，用来验证 scrollbar 补偿 */
const { assert } = t;
t.dom.documentElement.clientWidth = 1000;

const harness = `
return (async () => {
  /* 层栈与数据无关：不拉起数据，避免把网络路径掺进这个测试 */
  const root = document.documentElement;
  const show = id => document.getElementById(id).classList.add("show");
  const hide = id => document.getElementById(id).classList.remove("show");

  /* ===== 1. 真实登记表：只有该锁的层在锁 ===== */
  assert(openLayers().length === 0, "启动后没有任何浮层处于打开状态");

  show("overlay"); syncScrollLock();
  assert(root.classList.contains("layer-lock"), "详情弹层打开 → 文档滚动锁定");
  hide("overlay"); syncScrollLock();
  assert(!root.classList.contains("layer-lock"), "详情弹层关闭 → 解除锁定");

  show("draftPanel"); syncScrollLock();
  assert(root.classList.contains("layer-lock"), "牌组面板打开 → 文档滚动锁定");
  assert(String(document.body.style.paddingRight) === "15px",
    "锁定时补偿 scrollbar 宽度（" + document.body.style.paddingRight + "）");
  hide("draftPanel"); syncScrollLock();
  assert(!root.classList.contains("layer-lock"), "牌组面板关闭 → 解除锁定");
  assert(!document.body.style.paddingRight, "解除后清除补偿，不留横向偏移");

  /* 历史面板在文档流内、对比栏是常驻浮条：它们开着也必须能滚页面。
     这是上一版的实际缺陷（:has(body.cmp-on) 直接把页面锁死） */
  show("histPanel"); syncScrollLock();
  assert(!root.classList.contains("layer-lock"), "历史面板打开不锁文档滚动（它在文档流内）");
  hide("histPanel");

  document.body.classList.add("cmp-on"); syncScrollLock();
  assert(!root.classList.contains("layer-lock"), "对比栏出现不锁文档滚动（常驻浮条）");
  document.body.classList.remove("cmp-on");

  /* ===== 2. Esc 顺序：按层序从顶到底 ===== */
  const closed = [];
  const flag = { a: true, b: true, c: true };
  registerLayer({ id: "test-low", isOpen: () => flag.a, close: () => { flag.a = false; closed.push("low"); }, order: 10 });
  registerLayer({ id: "test-top", isOpen: () => flag.b, close: () => { flag.b = false; closed.push("top"); }, order: 50, modal: true });
  registerLayer({ id: "test-mid", isOpen: () => flag.c, close: () => { flag.c = false; closed.push("mid"); }, order: 46 });

  assert(openLayers().map(l => l.id).join(",") === "test-top,test-mid,test-low",
    "打开的层按层序自顶向下排列（" + openLayers().map(l => l.id).join(",") + "）");

  assert(closeTopLayer() === true && closed.join() === "top", "第 1 次 Esc 关最上层（order 50）");
  assert(closeTopLayer() === true && closed.join() === "top,mid", "第 2 次 Esc 关次上层（order 46）");
  assert(closeTopLayer() === true && closed.join() === "top,mid,low", "第 3 次 Esc 关最下层（order 10）");
  assert(closeTopLayer() === false, "没有打开的层时 Esc 不消费事件");

  /* ===== 3. 锁同步幂等 ===== */
  flag.a = false; flag.b = true; flag.c = false;   /* 只留模态层 test-top */
  syncScrollLock(); syncScrollLock(); syncScrollLock();
  assert(String(document.body.style.paddingRight) === "15px", "重复同步不会重复记录补偿值");
  flag.b = false; syncScrollLock();
  assert(!document.body.style.paddingRight, "重复同步后仍能干净解除");
})();
`;

await t.run(harness);
t.finish();

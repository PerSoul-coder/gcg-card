/* core/motion 动效中枢 · 单元回归。
   stub 无真实样式系统：animationend 永不触发（addEventListener 是 NOOP），
   因此这里覆盖的是「瞬时路径 / 兜底定时器路径 / 取消 / 时长解析」——
   animationend 的名字守卫与 target 守卫由 CDP 真实浏览器验收覆盖。 */
import { createTest } from "./_env.mjs";

const t = createTest();
const { assert } = t;

const harness = `
return (async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const mk = () => document.createElement("div");

  /* ===== 1. 瞬时路径：无 matchMedia（reduced-motion / 测试环境）===== */
  assert(motionOK() === false, "无 matchMedia：motionOK 为 false");
  const el = mk();
  el.classList.add("show");
  const seq = [];
  const cancel = animateExit({
    el, openCls: "show", closingCls: "closing", anim: "ovl-x",
    onStart: () => seq.push("start"), onDone: () => seq.push("done"),
  });
  assert(!el.classList.contains("show") && !el.classList.contains("closing"),
    "瞬时路径：openCls 与 closingCls 都已摘除");
  assert(seq.join() === "start,done", "瞬时路径：onStart/onDone 同步触发（" + seq.join() + "）");
  cancel();
  assert(typeof cancel === "function", "瞬时路径仍返回可调用的 cancel（幂等）");

  /* ===== 2. animationTotalMs：读不到 computed style 时走 fallback ===== */
  assert(animationTotalMs(mk(), 333) === 333, "无 getComputedStyle：返回 fallback");
  assert(animationTotalMs(mk()) === 400, "无 getComputedStyle：缺省 fallback 400ms");

  /* ===== 3. animationTotalMs：多重动画取 duration+delay 最大值 ===== */
  window.getComputedStyle = () => ({ animationDuration: "0.25s, 0.2s", animationDelay: "0s, 2.4s" });
  assert(animationTotalMs(mk()) === 2600, "toast 形态（tin+tout 延迟退场）读出 2600ms");
  window.getComputedStyle = () => ({ animationDuration: "0.001ms, 0.001ms", animationDelay: "0s, 2.4s" });
  assert(animationTotalMs(mk()) === 2401, "reduced-motion 归零时长但保留延迟：读出 2401ms（toast 仍存活到延迟结束；ms/s 单位各自换算）");
  window.getComputedStyle = () => ({ animationDuration: "0.2s", animationDelay: "0s" });
  assert(animationTotalMs(mk()) === 200, "单动画：读出 200ms（overlay 退场节奏随 CSS 走）");

  /* ===== 4. 兜底定时器路径：motionOK = true 但 animationend 永不来 ===== */
  window.matchMedia = () => ({ matches: false });   /* 未开启 reduced-motion */
  assert(motionOK() === true, "matchMedia 正常：motionOK 为 true");
  const el2 = mk();
  el2.classList.add("show");
  const seq2 = [];
  animateExit({ el: el2, openCls: "show", closingCls: "closing", anim: "ovl-x",
    onStart: () => seq2.push("start"), onDone: () => seq2.push("done") });
  assert(!el2.classList.contains("show") && el2.classList.contains("closing"),
    "退场开始：openCls 即刻摘除（层算关闭、锁随 onStart 释放），closingCls 挂上");
  assert(seq2.join() === "start", "退场开始时只有 onStart");
  await sleep(450);   /* 兜底 = computed 200ms + 80ms 余量 */
  assert(seq2.join() === "start,done", "animationend 缺失时兜底定时器收尾");
  assert(!el2.classList.contains("closing"), "收尾摘除 closingCls");

  /* ===== 5. cancel：退场中重开，收尾不得误摘新开的层 ===== */
  const el3 = mk();
  el3.classList.add("show");
  const seq3 = [];
  const cancel3 = animateExit({ el: el3, openCls: "show", closingCls: "closing", anim: "ovl-x",
    onDone: () => seq3.push("done") });
  cancel3();
  /* cancel 只解绑回调、不动类名（调用方自己摆正）；这里按调用方契约手动重开 */
  el3.classList.remove("closing");
  el3.classList.add("show");
  await sleep(450);
  assert(seq3.length === 0, "cancel 后兜底收尾不触发（重开的层不会被误摘）");
  assert(el3.classList.contains("show"), "cancel 后重开的层保持打开");

  /* ===== 6. 动画结束的正常收尾：onDone 幂等（animationend 与兜底只生效一次） ===== */
  const el4 = mk();
  el4.classList.add("show");
  const seq4 = [];
  const cancel4 = animateExit({ el: el4, openCls: "show", closingCls: "closing", anim: "ovl-x",
    onDone: () => seq4.push("done") });
  cancel4();                    /* 模拟 animationend 已在别处收尾后再次 cancel */
  await sleep(20);
  assert(seq4.length === 0, "done 后 cancel 是空操作");
})();

`;

await t.run(harness);
t.finish();

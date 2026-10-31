/* src/ 弹层栈 ↔ 浏览器历史桥 · 后退关弹层 / 前进重开 / 深链不回归
   用可编程假 history（条目数组 + 游标 + popstate/hashchange 派发）驱动真实应用代码：
   99-main 的 popstate 接线 + 90-detail 的差量同步 + core/history 的记账。 */
import { createTest } from "./_env.mjs";

/* window：注册监听 + reduced-motion（缺省瞬时关闭，动效相关断言用 __setMotion 切换）。
   getComputedStyle 回放真实节奏（overlay 退场 .2s）：animateExit 的兜底定时器据此
   推导（200+80=280ms），与生产环境「时长从 CSS 现读」走同一条路径。 */
function fakeWindow() {
  const ls = {};
  let reduced = true;
  return {
    addEventListener: (t, fn) => { (ls[t] ??= []).push(fn); },
    removeEventListener: (t, fn) => { ls[t] = (ls[t] || []).filter(f => f !== fn); },
    __fire: (t, ev) => { for (const fn of [...(ls[t] || [])]) fn(ev); },
    matchMedia: () => ({ matches: reduced }),
    getComputedStyle: () => ({ animationDuration: "0.2s", animationDelay: "0s" }),
    __setMotion: on => { reduced = !on; },
  };
}
/* 可编程假 history：导航时同步 location.hash，并按浏览器次序派发 popstate → hashchange。
   __setAsync(true) 把 back/go 的派发推迟到 setTimeout(0)——真实浏览器里 popstate
   本就异步到达，守卫类竞态（快速 Esc×N）只有在这种模式下才复现得出来。
   __navs 计数真实发生的导航次数：在途守卫的意义就是「多余的 back/go 不再发出」。 */
function fakeHistory(loc, win) {
  const entries = [{ hash: "", state: null }];
  let idx = 0;
  let asyncFire = false;
  let navs = 0;
  const fire = () => {
    loc.hash = entries[idx].hash;
    win.__fire("popstate", { state: entries[idx].state });
    win.__fire("hashchange", {});
  };
  const settle = () => { asyncFire ? setTimeout(fire, 0) : fire(); };
  return {
    __idx: () => idx,
    __navs: () => navs,
    __setAsync: v => { asyncFire = v; },
    pushState(state, _t, url) { entries.splice(idx + 1); entries.push({ hash: url.replace(/^#/, "#"), state }); idx++; loc.hash = entries[idx].hash; },
    replaceState(state, _t, url) { entries[idx] = { hash: url.startsWith("#") ? url : entries[idx].hash, state }; loc.hash = entries[idx].hash; },
    back() { if (idx > 0) { idx--; navs++; settle(); } },
    forward() { if (idx < entries.length - 1) { idx++; navs++; settle(); } },
    go(n) { const j = Math.max(0, Math.min(entries.length - 1, idx + n)); if (j !== idx) { idx = j; navs++; } settle(); },
  };
}

const win = fakeWindow();
const t = createTest({ window: win });
const { assert } = t;
t.env.history = fakeHistory(t.env.location, win);

const harness = `
return (async () => {
  const flush = () => new Promise(r => setTimeout(r, 0));
  await ensureData();
  const idOf = r => Number(r.key.slice(r.key.indexOf(":") + 1));
  const shareables = cardRecords().filter(r => r.share != null);
  const cardA = shareables[0], cardB = shareables[1];

  /* ===== 1. 打开可回退层 → 写入历史 ===== */
  showDetail(idOf(cardA));
  assert(location.hash === "#card=" + idOf(cardA), "打开详情 → hash 写入 #card=：" + location.hash);
  assert(history.__idx() === 1, "追加了一条历史条目");
  showTermModal("跃升");
  assert(/^#t=/.test(location.hash), "下钻概念 → hash 写入 #t=");
  assert(topView().kind === "term", "栈顶是概念页");

  /* ===== 2. 后退 → 差量同步：概念页弹出，详情回到栈顶 ===== */
  history.back();
  assert(topView() && topView().kind === "detail", "后退：概念页被弹出，详情回到栈顶");
  assert(location.hash === "#card=" + idOf(cardA), "后退：hash 回到详情");

  /* ===== 3. 前进 → 按 hash 重开概念页（认领条目，不新增） ===== */
  history.forward();
  assert(topView().kind === "term", "前进：概念页被重开");
  assert(history.__idx() === 2, "前进停在原条目");

  /* ===== 4. 全部关闭（✕ / 遮罩）→ 一次吞掉整链 ===== */
  overlayClose();
  assert(!overlayOpen(), "全部关闭：弹层关闭");
  assert(location.hash === "" && history.__idx() === 0, "全部关闭：hash 清空、回到基条目");

  /* ===== 5. 深链 #card= → 打开但不重复推历史 ===== */
  location.hash = "#card=" + idOf(cardB);
  routeHash();
  await flush();
  assert(topView() && topView().kind === "detail" && topView().id === idOf(cardB), "深链：详情打开");
  assert(overlayPushDepth() === 0, "深链打开不推账（条目已存在）");

  /* ===== 6. 正常开两层后 Esc（overlayBack）逐层委托历史 ===== */
  showDetail(idOf(cardA));
  assert(location.hash === "#card=" + idOf(cardA), "再开详情：正常推历史");
  showTermModal("跃升");
  closeTopLayer();   /* Esc：登记层 close=overlayBack → 委托 history.back */
  assert(topView() && topView().kind === "detail" && topView().id === idOf(cardA), "Esc：退回详情");
  assert(location.hash === "#card=" + idOf(cardA), "Esc：hash 同步回详情");

  /* ===== 7. 整栈替换前清账（overlayHashClear）→ 后退不再重开旧弹层 ===== */
  overlayHashClear();
  assert(overlayPushDepth() === 0, "overlayHashClear：计数归零");
  history.back();
  assert(!overlayOpen(), "清账后后退：弹层不再出现");
  assert(location.hash === "", "清账后后退：hash 离开弹层");

  /* ===== 8. 无效深链不炸 ===== */
  location.hash = "#card=999999999";
  routeHash();
  await flush();
  assert(!overlayOpen(), "无效卡 id：不开弹层只报错");

  /* ===== 9. 概念深链 #t= ===== */
  location.hash = "#t=" + encodeURIComponent("跃升");
  routeHash();
  await flush();
  assert(topView() && topView().kind === "term", "概念深链：直接进概念页");
  overlayClose();
  location.hash = "#t=" + encodeURIComponent("不存在的概念XYZ");
  routeHash();
  await flush();
  assert(!overlayOpen(), "无效概念深链：不开弹层");

  /* ===== 10. 退场动画：.show 即刻摘除（锁随退场释放），.closing 只负责淡出 ===== */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const locked = () => document.documentElement.classList.contains("layer-lock");
  window.__setMotion(true);   /* 允许退场动画（motionOK = true） */
  showDetail(idOf(cardA));
  assert(locked(), "弹层打开：滚动锁上");
  closeTopLayer();            /* Esc → 退场：.show 即刻摘除，锁立即释放 */
  assert(!overlayOpen() && !locked(), "退场开始：层即刻算关闭，滚动锁立即释放");
  assert($("overlay").classList.contains("closing"), "退场中：淡出类挂在（display:flex 保持可见）");
  await sleep(340);
  assert(!$("overlay").classList.contains("closing"), "动画结束：退场类清除");
  /* 退场动画中立刻重开：挂起的关闭回调被取消，弹层保持打开 */
  showDetail(idOf(cardA));
  closeTopLayer();
  showDetail(idOf(cardB));    /* 280ms 兜底定时器触发前重开 */
  await sleep(340);
  assert(overlayOpen() && topView() && topView().id === idOf(cardB), "退场动画中重开：旧关闭回调被取消，弹层保持打开");
  window.__setMotion(false);  /* 恢复瞬时关闭 */
  closeTopLayer();
  await flush();
  assert(!overlayOpen() && !locked(), "恢复瞬时后正常关闭并解锁");

  /* ===== 11. 在途导航守卫：popstate 未到达时，重复的关闭请求不再委托历史 =====
     真实浏览器 popstate 异步到达、pushDepth 只在那时递减——快速 Esc×2-3 或
     双击遮罩会让多余的 back/go 越过应用最老条目，把用户弹出站外。 */
  history.__setAsync(true);
  showDetail(idOf(cardA));
  const navs0 = history.__navs();
  closeTopLayer();            /* Esc ①：委托 back，popstate 在途 */
  closeTopLayer();            /* Esc ②：被守卫消费 */
  closeTopLayer();            /* Esc ③：同上 */
  assert(history.__navs() === navs0 + 1, "Esc×3 在 popstate 到达前只发出 1 次 back（在途守卫）");
  await flush();
  assert(!overlayOpen() && topView() === null, "在途 popstate 到达：栈正常清空");
  assert(location.hash === "", "Esc×3：hash 停在基条目（没有越界后退）");

  /* 双击遮罩（overlayClose→go 两次）同理 */
  showDetail(idOf(cardA));
  showTermModal("跃升");       /* 深一层：全关要吞 2 条历史 */
  const navs1 = history.__navs();
  overlayClose();
  overlayClose();             /* 双击：第二次被守卫消费 */
  assert(history.__navs() === navs1 + 1, "双击遮罩只发出 1 次 go");
  await flush();
  assert(!overlayOpen() && location.hash === "", "双击全关：栈与 hash 正常（不超额后退）");
  history.__setAsync(false);

  /* ===== 12. 空 hash 后退不重建卡库（C5：滚动位置保持） =====
     routedHash 不随 pushState 更新时，popstate 看到的「无变化」让紧随的
     hashchange 泄漏执行 routeHash→restoreView，卡库整页重建、滚动丢失。
     探针钉在 #browseResults：stub 无 DOM 树，瓦片装在子元素里——
     结果区若被 renderBrowseResults 重挂，标记即被冲掉。 */
  switchView("browse");
  const br = $("browseResults");
  assert(String(br.innerHTML || "").includes("bgrid"), "卡库结果区已挂载（探针前提）");
  br.innerHTML = String(br.innerHTML || "").replace('class="card-grid', 'data-probe="1" class="card-grid');
  showDetail(idOf(cardA));
  assert(location.hash === "#card=" + idOf(cardA), "后退前：详情 hash 已写入");
  history.back();
  assert(!overlayOpen() && location.hash === "", "后退：弹层关闭、hash 回到空");
  assert(String($("browseResults").innerHTML || "").includes('data-probe="1"'),
    "空 hash 后退：结果区未被重挂（卡库未整页重建，滚动位置保持）");

  /* ===== 13. 弹层全关时灯箱连带关闭（C6：灯箱不走历史） ===== */
  showDetail(idOf(cardA));
  showLightbox(idOf(cardA));
  assert(lightboxOpen() && locked(), "灯箱打开且锁滚动");
  overlayClose();
  assert(!overlayOpen() && !lightboxOpen(), "全部关闭：灯箱被连带关闭");
  assert(!locked(), "弹层与灯箱都关：滚动锁释放");

  /* ===== 14. 畸形 b= hash 不炸路由（单次解码 + URIError 防护） ===== */
  location.hash = "#b=g=%zz,q=" + encodeURIComponent("火焰");
  routeHash();
  await flush();
  assert(state.currentView === "browse", "畸形 g= 值：路由照常进入卡库");
  assert(searchState.q === "火焰", "q= 参数单次解码正确（不再被双重解码破坏）");
  assert(browseState.tag === "%zz", "畸形转义按原样当值用，不抛 URIError");
  location.hash = "#b=q=50%off";
  routeHash();
  await flush();
  assert(searchState.q === "50%off", "字面 % 的检索词按原样保留（旧实现在此 URIError）");

})();

`;

await t.run(harness);
t.finish();

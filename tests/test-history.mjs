/* src/ 弹层栈 ↔ 浏览器历史桥 · 后退关弹层 / 前进重开 / 深链不回归
   用可编程假 history（条目数组 + 游标 + popstate/hashchange 派发）驱动真实应用代码：
   99-main 的 popstate 接线 + 90-detail 的差量同步 + core/history 的记账。 */
import { createTest } from "./_env.mjs";

/* window：注册监听 + reduced-motion（退场动画瞬时化，断言同步可判） */
function fakeWindow() {
  const ls = {};
  return {
    addEventListener: (t, fn) => { (ls[t] ??= []).push(fn); },
    removeEventListener: (t, fn) => { ls[t] = (ls[t] || []).filter(f => f !== fn); },
    __fire: (t, ev) => { for (const fn of [...(ls[t] || [])]) fn(ev); },
    matchMedia: () => ({ matches: true }),
  };
}
/* 可编程假 history：导航时同步 location.hash，并按浏览器次序派发 popstate → hashchange */
function fakeHistory(loc, win) {
  const entries = [{ hash: "", state: null }];
  let idx = 0;
  const fire = () => {
    loc.hash = entries[idx].hash;
    win.__fire("popstate", { state: entries[idx].state });
    win.__fire("hashchange", {});
  };
  return {
    __idx: () => idx,
    pushState(state, _t, url) { entries.splice(idx + 1); entries.push({ hash: url.replace(/^#/, "#"), state }); idx++; loc.hash = entries[idx].hash; },
    replaceState(state, _t, url) { entries[idx] = { hash: url.startsWith("#") ? url : entries[idx].hash, state }; loc.hash = entries[idx].hash; },
    back() { if (idx > 0) { idx--; fire(); } },
    forward() { if (idx < entries.length - 1) { idx++; fire(); } },
    go(n) { idx = Math.max(0, Math.min(entries.length - 1, idx + n)); fire(); },
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
})();

`;

await t.run(harness);
t.finish();

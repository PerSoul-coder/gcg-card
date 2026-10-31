/* 99-main.ts —— 入口装配：事件绑定、菜单与快捷键、数据信息行。 */
import { closeHistoryPanel, decodeAndRender, looksLikeCode, renderHistory, resolveInput, toggleHistoryPanel } from "./60-parse";
import { $ } from "./core/dom";
import { closeSuggest, moveSuggest, pushRecent, resetSuggestTimer, scheduleSuggest, searchState, selectSuggest, sugState } from "./70-search";
import { overlayHashParse } from "./core/history";
import { browseState, parseBrowseHash, renderBrowse, renderBrowseResults, renderGrid, renderList, setShowFavsOnly, setShowUnbuildable, syncBrowseHash } from "./85-views";
import { ORIGIN_ZH, dataOrigins, ensureData, onDataReady, resetDataState } from "./20-data";
import { pool, resetPool, loadFavs, pruneFavs } from "./45-pool";
import { resetConceptIndex, termEntries } from "./40-concepts";
import { dsStats } from "./07-dataset";
import { resetBacklinks } from "./50-backlinks";
import { SKILLS, resetSkillIndex, skillOf, showSkill } from "./47-skills";
import { beginRenameDeck, closeDraftPanel, deleteDeckById, draftClear, draftEncode, draftLoadCurrent, draftRemoveCard, draftRemoveChar, draftSetCount, duplicateDeck, loadDraft, newDeck, pruneDraft, renderDraft, renderDraftPanel, syncFromActive, toggleDraftPanel } from "./80-deck";
import { overlayOpen, showDetail, showTermModal, syncOverlayToHash } from "./90-detail";
import { resetViewState, state } from "./data/state";
import { recordOfId, charRecords, resetRecordIndex } from "./data/records";
import { SAMPLE, STORAGE_KEYS } from "./core/resources";
import { closeTopLayer } from "./core/layers";
import { setStatus, toast, copyText } from "./core/dom";
import { dataReady } from "./20-data";
import { backlinks } from "./50-backlinks";
import { refreshSuggest } from "./70-search";

/* ---------- 事件绑定 ---------- */
/* 顶部输入框只做牌组分享码解析；卡牌检索入口在「卡库浏览」内 */
$("btnDecode").addEventListener("click", () => resolveInput($<HTMLInputElement>("codeInput").value));
$("codeInput").addEventListener("keydown", ev => {
  if (ev.key === "Enter") { ev.preventDefault(); resolveInput($<HTMLInputElement>("codeInput").value); }
});
$("codeInput").addEventListener("paste", () => setTimeout(() => {
  const v = $<HTMLInputElement>("codeInput").value.trim();
  if (looksLikeCode(v)) resolveInput(v);
}, 0));
document.addEventListener("click", ev => {
  if (!sugState.open) return;
  if ((ev.target as HTMLElement).closest("#suggest") || (ev.target as HTMLElement).id === "browseSearch") return;
  closeSuggest();
});
/* 示例牌组：载入后直接跳到卡面视图——用户点它就是要看一副牌 */
$("btnSample").addEventListener("click", () => {
  $("moreMenu").classList.remove("show");
  $<HTMLInputElement>("codeInput").value = SAMPLE;
  decodeAndRender(SAMPLE).then(() => switchView("grid")).catch(() => {});
});
/* ---------- 主题：切换 / 持久化 / theme-color 同步 ----------
   初始值由 deck-viewer.html 头部的内联脚本在样式表之前落定（防 FOUC，跟随系统）；
   这里只负责按钮切换。深色是缺省（html 上不写 data-theme），浅色写 data-theme="light"。 */
const THEME_COLORS = { dark: "#12161d", light: "#f3eee2" };
function syncThemeUI(): void {
  const light = document.documentElement.dataset.theme === "light";
  $("btnTheme").textContent = light ? "☾ 深色" : "☀ 浅色";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && meta.setAttribute) meta.setAttribute("content", light ? THEME_COLORS.light : THEME_COLORS.dark);
}
$("btnTheme").addEventListener("click", () => {
  const light = document.documentElement.dataset.theme === "light";
  if (light) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = "light";
  try { localStorage.setItem(STORAGE_KEYS.theme, light ? "dark" : "light"); } catch (e) {}
  syncThemeUI();
});
syncThemeUI();
$("btnHistory").addEventListener("click", () => { renderHistory(); toggleHistoryPanel(); });
$("histPanel").addEventListener("click", ev => {
  const item = (ev.target as HTMLElement).closest("[data-code]");
  if (item) { closeHistoryPanel(); $<HTMLInputElement>("codeInput").value = item.dataset.code || ""; decodeAndRender(item.dataset.code || ""); }
});
document.addEventListener("click", ev => {
  if (!(ev.target as HTMLElement).closest("#histPanel") && !(ev.target as HTMLElement).closest("#btnHistory")) closeHistoryPanel();
});
/* ---------- 视图切换（含状态持久化与数据懒加载） ---------- */
const VIEW_KEY = STORAGE_KEYS.view;
const VIEW_RENDER = { grid: renderGrid, list: renderList, browse: renderBrowse };
function switchView(name) {
  /* 卡库是主入口：未知视图一律落到 browse，而不是「空牌组的卡面」 */
  if (!VIEW_RENDER[name]) name = "browse";
  state.currentView = name;
  document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x.dataset.view === name));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + name));
  /* 牌组操作条（分享码 / 导出 / 牌组工具）只属于牌组视图，由 CSS 按 body[data-view]
     决定显隐——样式跟着视图走，不靠每个入口记得调 */
  document.body.dataset.view = name;
  try { localStorage.setItem(VIEW_KEY, name); } catch (e) {}
  const render = VIEW_RENDER[name] || renderBrowse;
  /* 数据未就绪时卡库先挂骨架屏（尺寸与卡块一致，加载完成不跳动）；
     数据就绪后 renderBrowse 会整体覆盖这段内容 */
  if (name === "browse" && !dataReady && !$("view-browse").innerHTML) {
    $("view-browse").innerHTML = `<div class="card-grid">${Array.from({ length: 12 }, () =>
      `<div class="skel-tile"><div class="skel"></div><div class="skel-line"></div><div class="skel-line short"></div></div>`).join("")}</div>`;
  }
  /* 牌组摘要是「卡面视图」的头部信息，切到卡库/列表时收起：
     否则解析过牌组之后，整块摘要会一直压在标签栏上方（手机上约占半屏） */
  const sum = $("summary");
  if (sum) sum.style.display = (name === "grid" && typeof state.current !== "undefined" && state.current) ? "block" : "none";
  /* 卡库依赖全量数据：未加载则先拉取，就绪后再渲染 */
  if (!dataReady && name === "browse") {
    ensureData().then(render).catch(e => setStatus("数据加载失败：" + e.message, "err"));
    return;
  }
  render();
}
document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => switchView(t.dataset.view)));

/* ---------- 卡库检索框：输入即做第二阶段检索 ---------- */
$("view-browse").addEventListener("input", ev => {
  if ((ev.target as HTMLElement).id !== "browseSearch") return;
  searchState.q = (ev.target as HTMLInputElement).value;
  searchState.filter = "";
  renderBrowseResults();
  syncBrowseHash();
  resetSuggestTimer();
  if (!searchState.q.trim()) { closeSuggest(); return; }
  scheduleSuggest();
});
$("view-browse").addEventListener("focusin", ev => {
  if ((ev.target as HTMLElement).id === "browseSearch" && (ev.target as HTMLInputElement).value.trim()) refreshSuggest();
});
$("view-browse").addEventListener("keydown", ev => {
  if ((ev.target as HTMLElement).id !== "browseSearch") return;
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    if (sugState.open && sugState.items.length) {
      ev.preventDefault();
      moveSuggest(ev.key === "ArrowDown" ? 1 : -1);
    }
    return;
  }
  if (ev.key === "Escape" && sugState.open) {
    ev.preventDefault();
    ev.stopPropagation();   /* 只关下拉，不触发全局 Esc 的逐层返回 */
    closeSuggest();
    return;
  }
  if (ev.key === "Enter") {
    if (sugState.open && sugState.idx >= 0) { ev.preventDefault(); selectSuggest(sugState.idx); return; }
    closeSuggest();
    renderBrowseResults();
    syncBrowseHash();
    if (searchState.q.trim()) pushRecent(searchState.q.trim());
  }
});
/* mousedown 而非 click：在输入框失焦前完成选择 */
$("view-browse").addEventListener("mousedown", ev => {
  const it = (ev.target as HTMLElement).closest(".sug-item");
  if (!it) return;
  ev.preventDefault();
  selectSuggest(Number(it.dataset.i));
});
/* 快捷键 / 顶部按钮跳转到卡库检索 */
function focusBrowseSearch() {
  if (!dataReady) {
    ensureData().then(() => { switchView("browse"); const i = $("browseSearch"); if (i) i.focus(); }).catch(() => {});
    return;
  }
  if (state.currentView !== "browse") switchView("browse");
  const input = $("browseSearch");
  if (input) input.focus();
}

/* ---------- 数据信息行 + 刷新 ---------- */
function renderDataInfo() {
  const el = $("dataInfo"); if (!el) return;
  /* 面向访客的一行摘要：来源 / 规模 / 可用性。测试卡过滤、准备状态并入这类
     处理细节不上这行——访客关心的是「有什么、能不能离线」，不是内部怎么算 */
  const origin = [...dataOrigins].map(k => ORIGIN_ZH[k] || k).join(" + ") || "—";
  const imgNote = dataOrigins.has("builtin") && !dataOrigins.has("network") ? "　|　卡面图需联网" : "";
  const ds = dsStats();
  el.innerHTML = `数据源：piovium 官方静态数据　|　${charRecords().length} 角色 · ${pool.filter(x => x.kind === "card").length} 卡牌 · ${SKILLS.length} 技能 · ${ds ? ds.conceptNames : 0} 概念　|　${origin}${imgNote}`;
}
$("btnRefresh").addEventListener("click", async () => {
  /* file:// 下（单文件离线版）网络路径必然被浏览器拦截，而数据已经内置：
     刷新没有意义。提前说明并直接返回，不做下面那套索引重置——
     保住正在使用的卡池 / 概念 / 反链，也不用回退重建。 */
  if (location.protocol === "file:") {
    toast("单文件离线版数据已内置，无需刷新；要更新牌库请重新构建或使用在线版");
    return;
  }
  /* 不预先清缓存：网络不可用时旧缓存 / 内置快照还能兜住，不至于整页失去数据。
     拉取成功后 writeCache 会自然覆盖旧值。 */
  resetDataState();      /* 重置单 flight，强制 ensureData 真正重新拉取 */
  resetRecordIndex();    /* 记录表与 id/分享码索引 */
  resetViewState();      /* 详情 / 翻页上下文 */
  resetConceptIndex();   /* 概念索引与术语正则 */
  resetPool();           /* 卡池与统计 */
  resetBacklinks();      /* 反链 */
  resetSkillIndex();     /* 技能索引（含装备牌特技） */
  setStatus(`<span class="spin"></span>正在重新拉取数据…`);
  try {
    await ensureData(true);
    (VIEW_RENDER[state.currentView] || renderGrid)();
    renderDataInfo();
    toast("数据已刷新");
  } catch (e) {
    /* 刷新失败 → 回退到本地可用数据（内置快照或缓存），保证页面仍然可用 */
    try {
      await ensureData(false);
      (VIEW_RENDER[state.currentView] || renderGrid)();
      setStatus("刷新失败，已回退到本地数据：" + (e as Error).message, "err");
    } catch (e2) {
      setStatus("刷新失败：" + (e as Error).message + "；本地也没有可用数据", "err");
    }
  }
});

/* 草稿栏 / 牌组面板（innerHTML 重渲染 → 事件委托） */
document.addEventListener("click", ev => {
  const b = (ev.target as HTMLElement).closest("button");
  if (!b) return;
  if (b.id === "draftManage") { toggleDraftPanel(); renderDraftPanel(); }
  else if (b.id === "draftClose") closeDraftPanel();
  else if (b.id === "draftClear") draftClear();
  else if (b.id === "draftLoad") { draftLoadCurrent(); renderDraftPanel(); }
  else if (b.id === "draftNew") {
    newDeck(); syncFromActive(); renderDraft(); renderDraftPanel(); toast("已新建空牌组");
  }
  else if (b.dataset.dkren != null) {
    beginRenameDeck(Number(b.dataset.dkren));
  }
  else if (b.dataset.dkcpy != null) {
    if (duplicateDeck(Number(b.dataset.dkcpy))) toast("已复制为新牌组");
  }
  else if (b.dataset.dkdel != null) {
    deleteDeckById(Number(b.dataset.dkdel));
    toast("牌组已删除");
  }
  else if (b.id === "draftGen") {
    try {
      const code = draftEncode();
      copyText(code).then(
        () => toast("分享码已生成并复制到剪贴板"),
        () => toast("分享码已生成（自动复制失败，已填入顶部输入框）"));
      $<HTMLInputElement>("codeInput").value = code;
      closeDraftPanel();
      decodeAndRender(code);
    } catch (e) { toast((e as Error).message, true); }
  }
  else if (b.dataset.rmc != null) draftRemoveChar(Number(b.dataset.rmc));
  else if (b.dataset.rm != null) draftRemoveCard(Number(b.dataset.rm));
  else if (b.dataset.inc != null) draftSetCount(Number(b.dataset.inc), 1);
  else if (b.dataset.dec != null) draftSetCount(Number(b.dataset.dec), -1);
});

/* 全局快捷键：1/2/3 切视图，/ 聚焦卡库检索框，Esc 关闭最上层浮层（输入框聚焦时不触发）。
   Esc 的「哪一层先关」不再写在这里：各层在所属模块登记层序，由 core/layers 决定。
   这样新增浮层不必回来改这个函数，也不会漏——此前「更多」菜单就漏了。
   层内部的更细语义（如牌组重命名 Esc 只取消重命名）在层自己的处理里 stopPropagation，优先于此。 */
document.addEventListener("keydown", ev => {
  if (ev.key === "Escape") {
    closeTopLayer();
    return;
  }
  if (overlayOpen()) return;
  const tag = ((ev.target as HTMLElement).tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea") return;
  /* 数字键与标签栏顺序一致：1 卡库 / 2 牌组卡面 / 3 牌组列表 */
  if (ev.key === "1") switchView("browse");
  if (ev.key === "2") switchView("grid");
  if (ev.key === "3") switchView("list");
  if (ev.key === "/") { ev.preventDefault(); focusBrowseSearch(); }
});

/* ---------- 启动：hash 路由（#分享码 / #card=id / #q=关键词 / #b=卡库筛选） ---------- */
/* 数据装载完成后刷新依赖数据的界面块。回调在本模块初始化时注册，
   触发时机在 20-data 的 loadData 末尾（此时各索引已建好）。 */
onDataReady(() => { pruneDraft(); pruneFavs(); renderDraft(); renderDataInfo(); });
/* hash → 视图/动作。启动时执行一次；之后由 hashchange / popstate 驱动。 */
function routeHash() {
  routedHash = location.hash;
  const h = decodeURIComponent(location.hash.replace(/^#/, "")).trim();
  if (h.startsWith("card=")) {
    const id = Number(h.slice(5));
    return (async () => {
      try {
        await ensureData();
        /* fromHistory：这条 hash 已经在历史里，打开时不再重复推一条 */
        if (recordOfId(id)) showDetail(id, undefined, true);
        else setStatus("链接中的卡牌 id 不存在或已失效", "err");
      } catch (e) { setStatus("加载失败：" + (e as Error).message, "err"); }
    })();
  }
  if (h.startsWith("t=")) {
    const name = h.slice(2);
    return (async () => {
      try {
        await ensureData();
        if (termEntries(name).length) showTermModal(name, true);
        else setStatus("链接中的概念不存在或已失效", "err");
      } catch (e) { setStatus("加载失败：" + (e as Error).message, "err"); }
    })();
  }
  if (h.startsWith("s=")) {
    const key = h.slice(2);
    return (async () => {
      try {
        await ensureData();
        if (skillOf(key)) showSkill(key, true);
        else setStatus("链接中的技能不存在或已失效", "err");
      } catch (e) { setStatus("加载失败：" + (e as Error).message, "err"); }
    })();
  }
  if (h.startsWith("q=")) {
    const q = h.slice(2);
    searchState.q = q;
    return (async () => {
      try { await ensureData(); switchView("browse"); }
      catch (e) { setStatus("加载失败：" + (e as Error).message, "err"); }
    })();
  }
  if (h.startsWith("b=")) {
    const st = parseBrowseHash(h);
    if (st) {
      /* 开关与检索词跟着链接走（链接就是这一屏的快照），但不覆盖本机默认偏好（persist=false） */
      const { u: uFlag, f: fFlag, q: qHash, ...rest } = st;
      setShowUnbuildable(!!uFlag, false);
      setShowFavsOnly(!!fFlag);
      searchState.q = qHash || "";
      Object.assign(browseState, rest);
    }
    return (async () => {
      try { await ensureData(); switchView("browse"); }
      catch (e) { setStatus("加载失败：" + (e as Error).message, "err"); }
    })();
  }
  if (h) {   /* 分享码 */
    $<HTMLInputElement>("codeInput").value = h;
    return (async () => {
      /* 外部分享链接：解析成功后直接进卡面视图，用户要的就是这副牌 */
      try { await decodeAndRender(h); switchView("grid"); }
      catch (e) { setStatus("加载失败：" + (e as Error).message, "err"); }
    })();
  }
  /* 空 hash：直接进卡库——这是浏览器的主用途。
     示例牌组改为按需（页头「更多 → 加载示例牌组」），不再每次打开都解析一遍并写进历史。 */
  return (async () => {
    try { await ensureData(); restoreView(); }
    catch (e) { setStatus("加载失败：" + (e as Error).message, "err"); }
  })();
}
/* 恢复上次停留的视图（hash 指定具体视图时不恢复） */
function restoreView() {
  let v = "";
  try { v = localStorage.getItem(VIEW_KEY) || ""; } catch (e) {}
  /* 没有记录时落到卡库：这是浏览器的主用途，不该一上来就是「空牌组的卡面」 */
  switchView(VIEW_RENDER[v] ? v : "browse");
}
/* ---------- hash 路由与历史导航 ----------
   三类来源，各走各的路：
   1) 应用内 pushState/replaceState —— 不触发任何事件，调用方自己渲染；
   2) history 导航（后退 / 前进 / 手动改地址栏）—— popstate 先做弹层差量同步
      （后退关弹层、前进重开），再对「非弹层 hash」重放 routeHash；
      随后补发的 hashchange 跳过（已处理，避免重复路由）；
   3) 其余 hashchange —— 原样 routeHash。 */
let routedHash = location.hash;
let skipHashRoute = false;
if (window.addEventListener) window.addEventListener("popstate", ev => {
  const changed = location.hash !== routedHash;
  routedHash = location.hash;
  if (changed) skipHashRoute = true;
  let h = "";
  try { h = decodeURIComponent(location.hash.replace(/^#/, "")).trim(); }
  catch (e) { h = location.hash.replace(/^#/, "").trim(); }
  syncOverlayToHash(ev && ev.state && typeof ev.state.gi === "number" ? ev.state.gi : 0, overlayHashParse(h));
  /* 非弹层 hash（#b= / #q= / 分享码）交回原路由；空 hash 只关弹层，不重放
     （否则 restoreView 会把视图重置成本机上次视图） */
  if (!overlayHashParse(h) && h) routeHash();
});
if (window.addEventListener) window.addEventListener("hashchange", () => {
  if (skipHashRoute) { skipHashRoute = false; return; }
  routeHash();
});
/* 启动兜底：初始化阶段的未捕获错误给出可操作提示，而非白屏无下文 */
if (window.addEventListener) window.addEventListener("error", ev => {
  if (window.__giBooted) return;
  setStatus("初始化失败：" + (ev.message || "未知错误") + "。请刷新页面重试；若反复出现，可用「更多 → 刷新数据」重新拉取数据", "err");
});
/* 启动入口：由 main.ts 在所有模块体求值完毕后调用。
   不能放在模块顶层执行——20-data ⇄ 99-main 的循环导入下，打包次序不受控，
   本模块可能先于 20-data 求值，routeHash → ensureData → loadData
   会踩到尚未初始化的模块级绑定（P4 的 boot 即崩正是这个原因）。 */
export function boot(): void {
  loadDraft();
  loadFavs();
  renderDraft();
  try {
    routeHash();
    window.__giBooted = true;
  } catch (e) {
    setStatus("初始化失败：" + (e as Error).message + "。请刷新重试", "err");
  }
}

export { VIEW_KEY, VIEW_RENDER, switchView, focusBrowseSearch, renderDataInfo, routeHash, restoreView };

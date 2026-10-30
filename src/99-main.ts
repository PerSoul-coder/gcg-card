/* src/99-main.js —— 由 scripts/_convert.mjs 从旧脚本转换（迁移中间态）。 */
import { decodeAndRender, looksLikeCode, renderHistory, resolveInput } from "./60-parse";
import { $ } from "./core/dom";
import { closeSuggest, moveSuggest, pushRecent, resetSuggestTimer, scheduleSuggest, searchState, selectSuggest, sugState } from "./70-search";
import { browseState, parseBrowseHash, renderBrowse, renderBrowseResults, renderGrid, renderList, setShowUnbuildable, syncBrowseHash } from "./85-views";
import { ORIGIN_ZH, dataOrigins, ensureData, resetDataState } from "./20-data";
import { pool, poolStats, resetPool } from "./45-pool";
import { resetConceptIndex } from "./40-concepts";
import { resetBacklinks } from "./50-backlinks";
import { SKILLS, resetSkillIndex } from "./47-skills";
import { beginRenameDeck, deleteDeckById, draftClear, draftEncode, draftLoadCurrent, draftRemoveCard, draftRemoveChar, draftSetCount, duplicateDeck, loadDraft, newDeck, renderDraft, renderDraftPanel, syncFromActive } from "./80-deck";
import { overlayBack, overlayOpen, showDetail } from "./90-detail";
import { resetEntityState, state } from "./data/state";
import { SAMPLE, STORAGE_KEYS } from "./core/resources";
import { setStatus, toast, copyText } from "./core/dom";
import { shadowStateIds, shadowStateBySkill } from "./data/model";
import { dataReady, writeCache } from "./20-data";
import { EXTRA_CONCEPTS } from "./40-concepts";
import { backlinks } from "./50-backlinks";
import { refreshSuggest } from "./70-search";

/* ---------- 事件绑定 ---------- */
/* 顶部输入框只做牌组分享码解析；卡牌检索入口在「卡库浏览」内 */
function updateBtnLabel() {
  $("btnDecode").textContent = "解析牌组";
}
$("btnDecode").addEventListener("click", () => resolveInput($("codeInput").value));
$("codeInput").addEventListener("keydown", ev => {
  if (ev.key === "Enter") { ev.preventDefault(); resolveInput($("codeInput").value); }
});
$("codeInput").addEventListener("input", updateBtnLabel);
$("codeInput").addEventListener("paste", () => setTimeout(() => {
  const v = $("codeInput").value.trim();
  if (looksLikeCode(v)) resolveInput(v);
}, 0));
document.addEventListener("click", ev => {
  if (!sugState.open) return;
  if (ev.target.closest("#suggest") || ev.target.id === "browseSearch") return;
  closeSuggest();
});
$("btnSample").addEventListener("click", () => { $("codeInput").value = SAMPLE; updateBtnLabel(); decodeAndRender(SAMPLE); });
$("btnHistory").addEventListener("click", () => { renderHistory(); $("histPanel").classList.toggle("show"); });
$("histPanel").addEventListener("click", ev => {
  const item = ev.target.closest("[data-code]");
  if (item) { $("histPanel").classList.remove("show"); $("codeInput").value = item.dataset.code; updateBtnLabel(); decodeAndRender(item.dataset.code); }
});
document.addEventListener("click", ev => {
  if (!ev.target.closest("#histPanel") && !ev.target.closest("#btnHistory")) $("histPanel").classList.remove("show");
});
/* ---------- 视图切换（含状态持久化与数据懒加载） ---------- */
const VIEW_KEY = STORAGE_KEYS.view;
const VIEW_RENDER = { grid: renderGrid, list: renderList, browse: renderBrowse };
function switchView(name) {
  if (!VIEW_RENDER[name]) name = "grid";
  state.currentView = name;
  document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x.dataset.view === name));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + name));
  try { localStorage.setItem(VIEW_KEY, name); } catch (e) {}
  const render = VIEW_RENDER[name] || renderGrid;
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
  if (ev.target.id !== "browseSearch") return;
  searchState.q = ev.target.value;
  searchState.filter = "";
  renderBrowseResults();
  syncBrowseHash();
  resetSuggestTimer();
  if (!searchState.q.trim()) { closeSuggest(); return; }
  scheduleSuggest();
});
$("view-browse").addEventListener("focusin", ev => {
  if (ev.target.id === "browseSearch" && ev.target.value.trim()) refreshSuggest();
});
$("view-browse").addEventListener("keydown", ev => {
  if (ev.target.id !== "browseSearch") return;
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
  const it = ev.target.closest(".sug-item");
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
  const testNote = poolStats.testFiltered ? `　|　已隐藏 ${poolStats.testFiltered} 张测试卡（不进卡库/检索）` : "";
  /* 准备状态影子不是独立卡牌，界面上并进技能页；这里如实说明数量，免得"卡库总数"对不上 */
  const shadowNote = poolStats.shadowFiltered ? `　|　${poolStats.shadowFiltered} 个准备状态并入技能页` : "";
  /* 来源如实展示：内置快照 / 本地缓存 / 现网，混合来源按实际出现的组合列出 */
  const origin = [...dataOrigins].map(k => ORIGIN_ZH[k] || k).join(" + ") || "—";
  const imgNote = dataOrigins.has("builtin") && !dataOrigins.has("network") ? "　|　卡面图需联网" : "";
  el.innerHTML = `数据源：piovium 官方静态数据 v5 · CHS　|　${state.CHAR.length} 角色 · ${pool.filter(x => x.kind === "card").length} 卡牌 · ${SKILLS.length} 技能 · ${state.KW.length} 术语 + ${Object.keys(EXTRA_CONCEPTS).length} 规则概念${testNote}${shadowNote}　|　${origin}${imgNote}`;
}
$("btnRefresh").addEventListener("click", async () => {
  /* 不预先清缓存：网络不可用时旧缓存 / 内置快照还能兜住，不至于整页失去数据。
     拉取成功后 writeCache 会自然覆盖旧值。 */
  resetDataState();      /* 重置单 flight，强制 ensureData 真正重新拉取 */
  resetEntityState();    /* 实体集合与 id/分享码索引 */
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
      setStatus("刷新失败，已回退到本地数据：" + e.message, "err");
    } catch (e2) {
      setStatus("刷新失败：" + e.message + "；本地也没有可用数据", "err");
    }
  }
});

/* 草稿栏 / 牌组面板（innerHTML 重渲染 → 事件委托） */
document.addEventListener("click", ev => {
  const b = ev.target.closest("button");
  if (!b) return;
  if (b.id === "draftManage") { $("draftPanel").classList.toggle("show"); renderDraftPanel(); }
  else if (b.id === "draftClose") $("draftPanel").classList.remove("show");
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
      copyText(code).then(() => toast("分享码已生成并复制到剪贴板"), () => {});
      $("codeInput").value = code; updateBtnLabel();
      $("draftPanel").classList.remove("show");
      decodeAndRender(code);
      toast("分享码已生成（已通过解码自校验），牌组已加载");
    } catch (e) { toast(e.message, true); }
  }
  else if (b.dataset.rmc != null) draftRemoveChar(Number(b.dataset.rmc));
  else if (b.dataset.rm != null) draftRemoveCard(Number(b.dataset.rm));
  else if (b.dataset.inc != null) draftSetCount(Number(b.dataset.inc), 1);
  else if (b.dataset.dec != null) draftSetCount(Number(b.dataset.dec), -1);
});

/* 全局快捷键：1/2/3 切视图，/ 聚焦卡库检索框，Esc 逐层关闭浮层（输入框聚焦时不触发）。
   Esc 层级（自内向外）：弹层视图栈（概念下钻 → 上一视图，每次退一层）→
   关闭弹层 → 牌组管理面板 → 历史面板 → 导出菜单 */
document.addEventListener("keydown", ev => {
  if (ev.key === "Escape") {
    if (overlayOpen()) { overlayBack(); return; }   /* 弹层内：逐层退回，栈空即关闭 */
    if ($("draftPanel").classList.contains("show")) { $("draftPanel").classList.remove("show"); return; }
    if ($("histPanel").classList.contains("show")) { $("histPanel").classList.remove("show"); return; }
    $("exportMenu").classList.remove("show");
    return;
  }
  if (overlayOpen()) return;
  const tag = (ev.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea") return;
  if (ev.key === "1") switchView("grid");
  if (ev.key === "2") switchView("list");
  if (ev.key === "3") switchView("browse");
  if (ev.key === "/") { ev.preventDefault(); focusBrowseSearch(); }
});

/* ---------- 启动：hash 路由（#分享码 / #card=id / #q=关键词 / #b=卡库筛选） ---------- */
loadDraft(); renderDraft();
/* hash → 视图/动作。启动时执行一次；之后由 hashchange 驱动（页面不刷新也响应）。 */
function routeHash() {
  const h = decodeURIComponent(location.hash.replace(/^#/, "")).trim();
  if (h.startsWith("card=")) {
    const id = Number(h.slice(5));
    return (async () => {
      try {
        await ensureData();
        if (state.charById.has(id) || state.entById.has(id)) showDetail(id);
        else setStatus("链接中的卡牌 id 不存在或已失效", "err");
      } catch (e) { setStatus("加载失败：" + e.message, "err"); }
    })();
  }
  if (h.startsWith("q=")) {
    const q = h.slice(2);
    searchState.q = q;
    return (async () => {
      try { await ensureData(); switchView("browse"); }
      catch (e) { setStatus("加载失败：" + e.message, "err"); }
    })();
  }
  if (h.startsWith("b=")) {
    const st = parseBrowseHash(h);
    if (st) {
      if (st.q != null) { searchState.q = st.q; delete st.q; }
      /* 开关状态跟着链接走，但不覆盖本机默认偏好（persist=false） */
      const u = !!st.u; delete st.u;
      setShowUnbuildable(u, false);
      Object.assign(browseState, st);
    }
    return (async () => {
      try { await ensureData(); switchView("browse"); }
      catch (e) { setStatus("加载失败：" + e.message, "err"); }
    })();
  }
  if (h) {   /* 分享码 */
    $("codeInput").value = h; updateBtnLabel();
    return (async () => {
      try { await decodeAndRender(h); restoreView(); }
      catch (e) { setStatus("加载失败：" + e.message, "err"); }
    })();
  }
  /* 空 hash：加载示例牌组，并恢复上次停留的视图 */
  $("codeInput").value = SAMPLE; updateBtnLabel();
  return (async () => {
    try { await decodeAndRender(SAMPLE, { noHash: true }); restoreView(); }
    catch (e) { setStatus("加载失败：" + e.message, "err"); }
  })();
}
/* 恢复上次停留的视图（hash 指定具体视图时不恢复） */
function restoreView() {
  let v = "";
  try { v = localStorage.getItem(VIEW_KEY) || ""; } catch (e) {}
  if (v && VIEW_RENDER[v]) switchView(v);
}
/* hash 变化重新路由。history.replaceState 不触发 hashchange，因此筛选/检索内部
   改 hash 不会自触发；只有用户改地址栏、前进后退、外部链接才会进来。 */
if (window.addEventListener) window.addEventListener("hashchange", () => routeHash());
/* 启动兜底：初始化阶段的未捕获错误给出可操作提示，而非白屏无下文 */
if (window.addEventListener) window.addEventListener("error", ev => {
  if (window.__giBooted) return;
  setStatus("初始化失败：" + (ev.message || "未知错误") + "。请刷新页面重试；若反复出现，可用「更多 → 刷新数据」重新拉取数据", "err");
});
try {
  routeHash();
  window.__giBooted = true;
} catch (e) {
  setStatus("初始化失败：" + e.message + "。请刷新重试", "err");
}

export { updateBtnLabel, VIEW_KEY, VIEW_RENDER, switchView, focusBrowseSearch, renderDataInfo, routeHash, restoreView };

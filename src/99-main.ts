/* 99-main.ts —— 入口装配：事件绑定、菜单与快捷键。 */
import { closeHistoryPanel, decodeAndRender, looksLikeCode, renderHistory, resolveInput, toggleHistoryPanel } from "./60-parse";
import { $ } from "./core/dom";
import { closeSuggest, moveSuggest, pushRecent, resetSuggestTimer, scheduleSuggest, searchState, selectSuggest, sugState } from "./70-search";
import { overlayHashParse } from "./core/history";
import { browseState, parseBrowseHash, renderBrowse, renderBrowseResults, renderGrid, renderList, setShowFavsOnly, setShowUnbuildable, syncBrowseHash } from "./85-views";
import { ensureData, onDataReady } from "./20-data";
import { loadFavs, pool, pruneFavs } from "./45-pool";
import { loadRecentCards, pruneRecentCards, refreshRecentStrip } from "./46-recent";
import { termEntries } from "./40-concepts";
import { skillOf, showSkill, renderSkillsView } from "./47-skills";
import { beginRenameDeck, closeDraftPanel, deleteDeckById, draftClear, draftEncode, draftLoadCurrent, draftRemoveCard, draftRemoveChar, draftSetCount, duplicateDeck, loadDraft, newDeck, pruneDraft, renderDraft, renderDraftPanel, syncFromActive, toggleDraftPanel } from "./80-deck";
import { overlayOpen, showDetail, showHelp, showTermModal, syncOverlayToHash, lightboxOpen, lightboxStep, closeLightbox, renderOverlay } from "./90-detail";
import { state } from "./data/state";
import { recordOfId } from "./data/records";
import { ICON_AUTO, ICON_HELP, ICON_MOON, ICON_RANDOM, ICON_SUN, SAMPLE, STORAGE_KEYS } from "./core/resources";
import { closeTopLayer } from "./core/layers";
import { closeMenus } from "./95-export";
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
/* 示例牌组：载入后直接跳到卡面视图——用户点它就是要看一副牌（入口在牌组工具菜单） */
$("btnSample").addEventListener("click", () => {
  closeMenus();
  $<HTMLInputElement>("codeInput").value = SAMPLE;
  decodeAndRender(SAMPLE).then(() => switchView("grid")).catch(() => {});
});
/* ---------- 主题：auto / light / dark 三态 ----------
   初始解析由 deck-viewer.html 头部内联脚本在样式表之前完成（防 FOUC）。
   auto = 跟随系统（matchMedia 实时监听，系统切换即时生效）；按钮循环三态，
   data-theme 始终写「解析结果」（CSS 只认 light 属性），模式本身持久化。 */
const THEME_COLORS = { dark: "#12161d", light: "#f3eee2" };
const THEME_MODES = ["auto", "light", "dark"] as const;
type ThemeMode = (typeof THEME_MODES)[number];
const THEME_ZH: Record<ThemeMode, string> = { auto: "跟随系统", light: "浅色", dark: "深色" };
const THEME_ICON: Record<ThemeMode, string> = { auto: ICON_AUTO, light: ICON_SUN, dark: ICON_MOON };
const themeMq: { matches: boolean } | null = (() => {
  try { return typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)") : null; } catch (e) { return null; }
})();
let themeMode: ThemeMode = (() => {
  try {
    const v = localStorage.getItem(STORAGE_KEYS.theme) as ThemeMode | null;
    return v === "light" || v === "dark" ? v : "auto";
  } catch (e) { return "auto"; }
})();
const resolvedTheme = (): "light" | "dark" =>
  themeMode === "auto" ? (themeMq && themeMq.matches ? "light" : "dark") : themeMode;
function syncThemeUI(): void {
  const light = resolvedTheme() === "light";
  if (light) document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && meta.setAttribute) meta.setAttribute("content", light ? THEME_COLORS.light : THEME_COLORS.dark);
  $("btnTheme").innerHTML = THEME_ICON[themeMode];
  $("btnTheme").title = `主题：${THEME_ZH[themeMode]}（当前${light ? "浅色" : "深色"}）· 点击切换`;
}
$("btnTheme").addEventListener("click", () => {
  themeMode = THEME_MODES[(THEME_MODES.indexOf(themeMode) + 1) % THEME_MODES.length];
  try { localStorage.setItem(STORAGE_KEYS.theme, themeMode); } catch (e) {}
  syncThemeUI();
});
/* auto 模式下系统主题切换实时跟随；guarded：测试 stub 可能没有 addEventListener */
if (themeMq && typeof (themeMq as unknown as { addEventListener?: unknown }).addEventListener === "function") {
  (themeMq as unknown as MediaQueryList).addEventListener("change", () => { if (themeMode === "auto") syncThemeUI(); });
}
/* 页头图标按钮：HTML 里是空钮，图标单点来自 resources（悬浮 title 在 HTML 上） */
$("btnRandom").innerHTML = ICON_RANDOM;
$("btnHelp").innerHTML = ICON_HELP;
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
const VIEW_RENDER = { grid: renderGrid, list: renderList, browse: renderBrowse, skills: renderSkillsView };
/* 依赖全量数据的视图：未就绪时先挂骨架屏，拉取完成由各自渲染函数整体覆盖 */
const DATA_VIEWS: Record<string, string> = { browse: "view-browse", skills: "view-skills" };
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
  /* 数据未就绪时先挂骨架屏（尺寸与真实内容一致，加载完成不跳动）；
     数据就绪后渲染函数会整体覆盖这段内容 */
  const skelBox = DATA_VIEWS[name];
  if (skelBox && !dataReady && !$(skelBox).innerHTML) {
    $(skelBox).innerHTML = name === "browse"
      ? `<div class="card-grid">${Array.from({ length: 12 }, () =>
          `<div class="skel-tile"><div class="skel"></div><div class="skel-line"></div><div class="skel-line short"></div></div>`).join("")}</div>`
      : `<div class="skillidx-view">${Array.from({ length: 8 }, () => `<div class="skel-line"></div>`).join("")}</div>`;
  }
  /* 牌组摘要是「卡面视图」的头部信息，切到卡库/列表时收起：
     否则解析过牌组之后，整块摘要会一直压在标签栏上方（手机上约占半屏） */
  const sum = $("summary");
  if (sum) sum.style.display = (name === "grid" && typeof state.current !== "undefined" && state.current) ? "block" : "none";
  /* 卡库与图鉴依赖全量数据：未加载则先拉取，就绪后再渲染 */
  if (skelBox && !dataReady) {
    ensureData().then(render).catch(e => { clearSkeleton(skelBox); setStatus("数据加载失败：" + e.message, "err"); });
    return;
  }
  render();
}
/* 骨架屏的失败出口：shimmer 占位只有成功路径（渲染函数整体覆盖 innerHTML）
   会摘掉——数据拉不起来时它们会无限闪下去。失败即清空，交给状态条报错。 */
function clearSkeleton(id: string): void {
  const box = $(id);
  if (box && box.querySelector && box.querySelector("[class*=skel]")) box.innerHTML = "";
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

/* ---------- 随便看看（原「刷新数据」位） ----------
   数据随构建产物走，运行期刷新没有意义；按钮位改为随机一卡——
   浏览器的发现式用法：没目标时掷一把，落在哪张看哪张。只从可构筑池里挑。 */
function showRandomCard(): void {
  const pick = () => {
    const buildable = pool.filter(x => x.share != null);
    const x = buildable[Math.floor(Math.random() * buildable.length)];
    showDetail(x.id);
  };
  if (!dataReady) { ensureData().then(pick).catch((e: Error) => setStatus("加载失败：" + e.message, "err")); return; }
  pick();
}
$("btnRandom").addEventListener("click", () => { closeTopLayer(); showRandomCard(); });

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
  /* 校验违规可定位：违规条目（80-deck 给出关联卡 ids）点击打开首张关联卡详情 */
  else if (b.dataset.vgoto != null) {
    const id = Number(b.dataset.vgoto.split(",")[0]);
    if (Number.isFinite(id) && id > 0) showDetail(id);
  }
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
  /* 灯箱打开时 ←/→ 翻页（与详情翻页同键位，且优先于网格导航） */
  if (lightboxOpen() && (ev.key === "ArrowLeft" || ev.key === "ArrowRight")) {
    ev.preventDefault();
    lightboxStep(ev.key === "ArrowRight" ? 1 : -1);
    return;
  }
  if (overlayOpen()) return;
  const tag = ((ev.target as HTMLElement).tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return;
  /* ？打开帮助：只在无弹层时生效，避免误按把正在看的详情清掉 */
  if (ev.key === "?") { showHelp(); return; }
  /* 数字键与标签栏顺序一致：1 卡库 / 2 牌组卡面 / 3 牌组列表 */
  if (ev.key === "1") switchView("browse");
  if (ev.key === "2") switchView("grid");
  if (ev.key === "3") switchView("list");
  if (ev.key === "4") switchView("skills");
  if (ev.key === "/") { ev.preventDefault(); focusBrowseSearch(); }
  /* 卡库网格方向键：焦点已在瓦片上时接管（否则方向键保持页面滚动） */
  if (ev.key.startsWith("Arrow")) {
    const active = document.activeElement as HTMLElement | null;
    const onTile = active && active.classList && active.classList.contains("tile");
    if (onTile) {
      const moved = tileStep(active, ev.key);
      if (moved) ev.preventDefault();
      return;
    }
  }
  if (ev.key === "Enter") {
    const active = document.activeElement as HTMLElement | null;
    if (active && active.classList && active.classList.contains("tile")) {
      ev.preventDefault();
      active.click();   /* 复用瓦片的点击链路（data-id → 详情） */
    }
  }
});
/* 卡库网格焦点导航：←→ 在同行内移动，↑↓ 找相邻行里水平位置最近的瓦片 */
function tileStep(cur: HTMLElement, key: string): boolean {
  const tiles = [...document.querySelectorAll("#bgrid .tile")] as HTMLElement[];
  const i = tiles.indexOf(cur);
  if (i < 0) return false;
  const col = (t: HTMLElement) => Math.round(t.offsetLeft);
  const row = (t: HTMLElement) => Math.round(t.offsetTop);
  const r = row(cur), c = col(cur);
  if (key === "ArrowRight" || key === "ArrowLeft") {
    /* DOM 序即行内序：相邻一个不同行就说明已到行首/行尾 */
    const j = i + (key === "ArrowRight" ? 1 : -1);
    if (j >= 0 && j < tiles.length && row(tiles[j]) === r) { tiles[j].focus(); return true; }
    return false;
  }
  const dir = key === "ArrowDown" ? 1 : -1;
  let targetRow: number | null = null;
  for (let j = i + dir; j >= 0 && j < tiles.length; j += dir) {
    if (row(tiles[j]) !== r) { targetRow = row(tiles[j]); break; }
  }
  if (targetRow == null) return false;
  let best: HTMLElement | null = null, bd = Infinity;
  for (const t of tiles) {
    if (row(t) !== targetRow) continue;
    const d = Math.abs(col(t) - c);
    if (d < bd) { bd = d; best = t; }
  }
  if (best) { best.focus(); return true; }
  return false;
}

/* ---------- 启动：hash 路由（#分享码 / #card=id / #q=关键词 / #b=卡库筛选） ---------- */
/* 数据装载完成后刷新依赖数据的界面块。回调在本模块初始化时注册，
   触发时机在 20-data 的 loadData 末尾（此时各索引已建好）。 */
onDataReady(() => { pruneDraft(); pruneFavs(); pruneRecentCards(); refreshRecentStrip(); renderDraft(); });
/* hash → 视图/动作。启动时执行一次；之后由 hashchange / popstate 驱动。 */
function routeHash() {
  routedHash = location.hash;
  const raw = location.hash.replace(/^#/, "").trim();
  /* 畸形转义（如 #b=g=%zz）按原样路由：URIError 不该炸断路由（popstate 内同样防） */
  let h = raw;
  try { h = decodeURIComponent(raw); } catch (e) { /* 原样 */ }
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
        /* 深链落在图鉴视图之上：技能页的「来源」就是图鉴，Esc/返回回图鉴 */
        if (skillOf(key)) { switchView("skills"); showSkill(key, true); }
        else setStatus("链接中的技能不存在或已失效", "err");
      } catch (e) { clearSkeleton("view-skills"); setStatus("加载失败：" + (e as Error).message, "err"); }
    })();
  }
  if (h.startsWith("q=")) {
    const q = h.slice(2);
    searchState.q = q;
    return (async () => {
      try { await ensureData(); switchView("browse"); }
      catch (e) { clearSkeleton("view-browse"); setStatus("加载失败：" + (e as Error).message, "err"); }
    })();
  }
  if (raw.startsWith("b=")) {
    /* b= 的参数各自在 parseBrowseHash 里解码一次：传原始 hash，不再整体预解码
       （双重解码让检索词里的字面 % 变成 URIError） */
    const st = parseBrowseHash(raw);
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
      catch (e) { clearSkeleton("view-browse"); setStatus("加载失败：" + (e as Error).message, "err"); }
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
    catch (e) { clearSkeleton("view-browse"); setStatus("加载失败：" + (e as Error).message, "err"); }
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
   3) 其余 hashchange —— 原样 routeHash。
   2 与 3 的分界只认一条真源：routedHash（最后一次被路由过的 hash）。
   popstate 无条件更新它；routeHash 入口也会更新。hashchange 里 hash 与它相等
   就说明这次变化已经被 popstate 处理过——直接跳过。旧实现用独立的 skipHashRoute
   标志位，但 routedHash 不随 pushState 更新，空 hash 启动 → 开卡 → 后退时
   比较基准错位、标志位不置位，紧随的 hashchange 照旧 routeHash → restoreView
   把卡库整页重建、滚动位置丢失。 */
let routedHash = location.hash;
if (window.addEventListener) window.addEventListener("popstate", ev => {
  routedHash = location.hash;
  let h = "";
  try { h = decodeURIComponent(location.hash.replace(/^#/, "")).trim(); }
  catch (e) { h = location.hash.replace(/^#/, "").trim(); }
  syncOverlayToHash(ev && ev.state && typeof ev.state.gi === "number" ? ev.state.gi : 0, overlayHashParse(h));
  /* 非弹层 hash（#b= / #q= / 分享码）交回原路由；空 hash 只关弹层，不重放
     （否则 restoreView 会把视图重置成本机上次视图） */
  if (!overlayHashParse(h) && h) routeHashSafe();
  /* 弹层全关时灯箱一并收掉：它是详情弹层的子面，不走历史——
     否则弹层关了灯箱还开着，滚动锁还挂在已经不可见的界面上 */
  if (!overlayOpen() && lightboxOpen()) closeLightbox();
});
if (window.addEventListener) window.addEventListener("hashchange", () => {
  if (location.hash === routedHash) return;   /* popstate 已处理（含空 hash 回退） */
  routeHashSafe();
});
/* ---------- 运行期全局兜底 ----------
   此前 error 监听在 boot 后直接 return、unhandledrejection 无人监听：
   post-boot 的任何未捕获异常只进控制台，普通用户看不见——
   「点了没反应」「界面卡住」没有任何可操作信息，这也是各类隐患被放大的根因。
   现在统一上报：console 带固定前缀（与应用错误区分于扩展注入脚本的噪音）、
   同一错误去重后 toast 提示。启动期的友好提示保留。 */
let lastReportedErr: { msg: string } | null = null;
function reportRuntimeError(reason: unknown): void {
  const msg = reason instanceof Error ? (reason.message || String(reason)) : String(reason ?? "未知错误");
  console.error("[gi-viewer] 运行期异常：", reason);
  if (lastReportedErr && lastReportedErr.msg === msg) return;   /* 同一错误刷屏时只报一次 */
  lastReportedErr = { msg };
  toast("页面发生异常（详情见控制台）：" + msg.slice(0, 80), true);
}
if (window.addEventListener) {
  window.addEventListener("error", ev => {
    if (!window.__giBooted) {
      setStatus("初始化失败：" + (ev.message || "未知错误") + "。请刷新页面重试；若反复出现，可点页头的刷新按钮重新拉取数据", "err");
      return;
    }
    reportRuntimeError(ev.error || ev.message || "未知错误");
  });
  window.addEventListener("unhandledrejection", ev => {
    reportRuntimeError((ev as PromiseRejectionEvent).reason);
  });
}
/* routeHash 返回异步 IIFE 的 Promise：内部各有 try/catch，这里兜住未来
   落在 try 之外的路径，不让路由失败变成静默 unhandled rejection */
function routeHashSafe(): void {
  try {
    const p = routeHash() as unknown as Promise<void> | undefined;
    if (p && typeof p.catch === "function") p.catch(e => setStatus("路由失败：" + (e as Error).message, "err"));
  } catch (e) { setStatus("路由失败：" + (e as Error).message, "err"); }
}
/* 启动入口：由 main.ts 在所有模块体求值完毕后调用。
   不能放在模块顶层执行——20-data ⇄ 99-main 的循环导入下，打包次序不受控，
   本模块可能先于 20-data 求值，routeHash → ensureData → loadData
   会踩到尚未初始化的模块级绑定（P4 的 boot 即崩正是这个原因）。 */
export function boot(): void {
  loadDraft();
  loadFavs();
  loadRecentCards();
  renderDraft();
  try {
    routeHash();
    window.__giBooted = true;
  } catch (e) {
    setStatus("初始化失败：" + (e as Error).message + "。请刷新重试", "err");
  }
}

export { VIEW_KEY, VIEW_RENDER, switchView, focusBrowseSearch, routeHash, restoreView };

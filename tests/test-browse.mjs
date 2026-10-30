/* src/ 应用源码 · 卡库浏览 / 反链索引 / 多牌组存储逻辑验证（DOM stub + 缓存数据） */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAppSource } from "./test-lib.mjs";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = {};
for (const cat of ["characters", "entities", "keywords"])
  DATA[cat] = JSON.parse(fs.readFileSync(path.join(here, `gi-data/${cat}.json`), "utf8")).data;

let fails = 0;
const assert = (cond, msg) => { if (cond) console.log("  ok:", msg); else { console.error("  FAIL:", msg); fails++; } };

function makeEl(reg, id) {
  const store = id ? { _id: id, children: [] } : { children: [] };
  return new Proxy(store, {
    get(t, k) {
      if (k === "classList") return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (k === "style") return (t._style || (t._style = {}));
      if (k === "dataset") return {};
      if (k in t) return t[k];
      if (k === "addEventListener" || k === "removeEventListener") return () => {};
      if (k === "appendChild" || k === "remove" || k === "click" || k === "focus" || k === "setAttribute" || k === "scrollIntoView" || k === "insertAdjacentHTML" || k === "select" || k === "blur") return () => {};
      if (k === "closest" || k === "querySelector") return () => null;
      if (k === "querySelectorAll") return () => [];
      if (k === "value") return "";
      return undefined;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
const elCache = new Map();
const documentStub = {
  getElementById: id => { if (!elCache.has(id)) elCache.set(id, makeEl(true, id)); return elCache.get(id); },
  createElement: () => makeEl(false),
  addEventListener: () => {},
  querySelector: () => makeEl(false),
  querySelectorAll: () => [],
  body: { appendChild: () => {} },
};
const fetchStub = async url => {
  const cat = Object.keys(DATA).find(c => url.endsWith("/" + c));
  return { ok: true, json: async () => ({ data: cat ? DATA[cat] : [] }) };
};

const lsStore = new Map();
const localStorageStub = {
  getItem: k => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => lsStore.set(k, String(v)),
  removeItem: k => lsStore.delete(k),
};
const logic = readAppSource();
const conceptsExtra = JSON.parse(
  fs.readFileSync(path.join(here, "gi-data/concepts-extra.js"), "utf8")
    .replace(/^export const CONCEPTS_EXTRA = /, "").replace(/;\s*$/, "")
);

const harness = `
;(async () => {
  /* ===== 0. 牌组存储：首次启动自动建空牌组 ===== */
  loadDraft();
  assert(decks.length === 1 && activeDeckId === decks[0].id, "首次启动自动创建一个空牌组");
  assert(draft.chars.length === 0 && draft.cards.size === 0, "draft 门面与活动牌组同步");

  /* ===== 1. 旧版单草稿自动迁移 ===== */
  localStorage.setItem("gi-viewer-draft", JSON.stringify({ chars: [1711], cards: { "212111": 2 } }));
  loadDraft();
  assert(decks.length === 1 && draft.chars.includes(1711) && (draft.cards.get(212111) || 0) === 2, "旧版单草稿（gi-viewer-draft）迁移为命名牌组");

  /* ===== 2. 数据就绪：卡池与反链 ===== */
  await ensureData();
  /* 卡池 = 角色 + 实体卡 − 测试卡 − 准备状态影子（影子与技能同名，内容只是「将使用技能X」，
     单列成牌只会和技能抢名字；技能页里以「准备中状态」入口保留） */
  const buildEnts = state.ENT.filter(e => !isTestCard(e) && !isShadowState(e));
  assert(pool.length === state.CHAR.length + buildEnts.length, "卡池收录全部角色牌与实体卡（" + pool.length + " 条，已排除测试卡与准备状态）");
  assert(poolStats.shadowFiltered === state.ENT.filter(e => !isTestCard(e) && isShadowState(e)).length && poolStats.shadowFiltered > 0,
    "准备状态并入技能页计数（" + poolStats.shadowFiltered + " 个不进卡池）");
  assert(poolStats.testFiltered === state.ENT.filter(e => isTestCard(e)).length && poolStats.testFiltered === 5, "测试卡过滤计数（" + poolStats.testFiltered + " 张不进卡池）");
  assert(poolStats.buildable === state.ENT.filter(e => e.shareId != null).length + state.CHAR.filter(c => c.shareId != null).length,
    "可构筑计数 = 有 shareId 的角色 + 实体卡（" + poolStats.buildable + "）");
  const ganyu = pool.find(x => x.id === 1101);
  assert(ganyu && ganyu.kind === "char" && ganyu.element === "CRYO" && ganyu.hp === 12, "卡池派生字段：甘雨（角色/冰/生命12）");
  const furina = pool.find(x => x.id === 212111);
  assert(furina && furina.element === "HYDRO" && furina.related === "芙宁娜" && furina.tags.includes("天赋"), "天赋牌继承关联角色元素与关联名");
  const zhans = state.ENT.find(e => e.name === "战欲涌现");
  const zhansP = pool.find(x => x.id === zhans.id);
  assert(zhansP.energyCost === 2 && zhansP.dice === 3, "费用拆分：骰子 3 + 充能 2 分别派生");
  assert(poolStats.versions.length > 5 && verCmp(poolStats.versions[0], poolStats.versions[poolStats.versions.length - 1]) < 0, "版本列表有序（" + poolStats.versions.length + " 个）");
  assert(poolStats.byType.GCG_CARD_STATE === buildEnts.filter(e => e.type === "GCG_CARD_STATE").length, "类型统计与原始数据一致（测试卡已排除）");

  /* 反链：卡文互引 + 技能文本引用召唤物 */
  assert(backlinks.get("拯救世界的计划")?.has(100) === true, "反链：抵抗之躯(id=100) 卡文引用 拯救世界的计划");
  assert(backlinks.get("冰灵珠")?.has(1101) === true, "反链：甘雨技能 降众天华 引用 冰灵珠");
  assert(backlinks.get("白曜护盾")?.has(111143) === true, "反链：伊兹帕帕 引用 白曜护盾");
  assert((backlinks.get("芙宁娜")?.size || 0) >= 3, "反链：芙宁娜被多张卡引用（" + (backlinks.get("芙宁娜")?.size || 0) + " 条）");
  assert(!backlinks.get("不存在的概念xyz"), "反链：未收录概念无条目");

  /* ===== 3. 浏览筛选：各维度 ===== */
  const only = (arr, f) => arr.length > 0 && arr.every(f);
  browseState.type = "GCG_CARD_CHARACTER";
  assert(only(browseFilter(), x => x.kind === "char"), "类别筛选：仅角色牌");
  browseState.type = "GCG_CARD_EVENT";
  assert(only(browseFilter(), x => x.typeRaw === "GCG_CARD_EVENT"), "类别筛选：仅事件牌");
  browseState.type = ""; browseState.el = "PYRO";
  assert(only(browseFilter(), x => x.element === "PYRO"), "元素筛选：仅火元素角色及其天赋");
  assert(browseFilter().length === pool.filter(x => x.element === "PYRO").length, "元素筛选计数与全库一致");
  browseState.el = ""; browseState.cost = "0";
  assert(only(browseFilter(), x => x.kind === "card" && x.dice === 0), "骰子费用 0：仅 0 费卡且不含角色");
  browseState.cost = "5";
  assert(only(browseFilter(), x => x.kind === "card" && x.dice >= 5), "骰子费用 5+：>=5 归并为一档");
  browseState.cost = ""; browseState.energy = "2";
  assert(only(browseFilter(), x => x.kind === "card" && x.energyCost === 2), "充能筛选：恰好 2 点充能");
  assert(browseFilter().some(x => x.id === zhans.id), "充能筛选：含战欲涌现");
  browseState.energy = "0";
  assert(only(browseFilter(), x => x.kind === "card" && x.energyCost === 0), "充能筛选：无充能");
  browseState.energy = ""; browseState.tag = "秘传";
  assert(only(browseFilter(), x => x.tags.includes("秘传")), "标签筛选：秘传");
  browseState.tag = ""; browseState.ver = "v3.3.0";
  assert(only(browseFilter(), x => x.ver === "v3.3.0"), "版本筛选：v3.3.0");
  browseState.ver = ""; browseState.type = "GCG_CARD_CHARACTER"; browseState.el = "HYDRO";
  assert(only(browseFilter(), x => x.kind === "char" && x.element === "HYDRO"), "组合筛选：水元素角色牌");
  Object.assign(browseState, { type: "", el: "", cost: "", energy: "", tag: "", ver: "" });

  /* ===== 4. facet 计数 ===== */
  const f0 = facetCounts();
  assert(fcn(f0.type, "GCG_CARD_CHARACTER") === state.CHAR.length, "facet：角色牌计数 = 角色总数");
  assert(fcn(f0.type, "GCG_CARD_EVENT") === buildEnts.filter(e => e.type === "GCG_CARD_EVENT").length, "facet：事件牌计数正确（测试卡已排除）");
  assert(fcn(f0.el, "PYRO") === pool.filter(x => x.element === "PYRO").length, "facet：火元素计数 = 全库火元素条目");
  assert(Object.values(f0.cost).reduce((a, c) => a + c.n, 0) === pool.filter(x => x.kind === "card").length, "facet：费用各档总计 = 卡牌总数（角色不计费）");
  /* 双计数：每格拆成可构筑 / 不可构筑，两数相加必须等于该格总数 */
  const typeCells = Object.values(f0.type);
  assert(typeCells.every(c => c.b + c.o === c.n), "facet：每格 b + o = 总数（双计数自洽）");
  assert(typeCells.reduce((a, c) => a + c.b, 0) === poolStats.buildable
    && typeCells.reduce((a, c) => a + c.o, 0) === poolStats.total - poolStats.buildable,
    "facet：全库可构筑 / 不可构筑两类之和与 poolStats 一致");
  const onstageCell = f0.type.GCG_CARD_ONSTAGE;
  assert(onstageCell && onstageCell.b === 0 && onstageCell.o > 200,
    "facet：队伍状态整类不可构筑（" + (onstageCell && onstageCell.b) + "/" + (onstageCell && onstageCell.o) + "）");
  /* 各类型都混着历史版本变体（装备 269/19、事件 125/71…），所以双计数不是可选项 */
  assert(Object.values(f0.type).every(c => c.o > 0), "facet：每个类型都含不可构筑变体（双计数对所有类型都有意义）");
  /* chip 渲染：只有存在不可构筑项时才出现「/o」；整类不可构筑时加 zb 压暗 */
  const chipOn = browseChip("type", "GCG_CARD_ONSTAGE", "队伍状态", f0.type.GCG_CARD_ONSTAGE, false);
  assert(chipOn.indexOf("<b>0</b>") >= 0 && chipOn.indexOf("/" + onstageCell.o) >= 0 && chipOn.indexOf("zb") >= 0,
    "chip：队伍状态显示「0 / " + onstageCell.o + "」并压暗可构筑数");
  const chipNormal = browseChip("type", "GCG_CARD_MODIFY", "装备牌", { b: 12, o: 0, n: 12 }, false);
  assert(!chipNormal.includes("fco") && !chipNormal.includes("zb") && chipNormal.includes("<b>12</b>"),
    "chip：没有不可构筑项时只显示一个数字");
  const chipZero = browseChip("type", "GCG_CARD_STATE", "状态牌", { b: 0, o: 367, n: 367 }, false);
  assert(chipZero.includes("<b>0</b>") && chipZero.includes("/367"), "chip：整类不可构筑时显示「0 / 367」");
  browseState.type = "GCG_CARD_CHARACTER";
  const f1 = facetCounts();
  assert(fcn(f1.type, "GCG_CARD_CHARACTER") === state.CHAR.length, "facet：类型维度不受自身筛选影响（仍为全量计数）");
  assert(fcn(f1.el, "PYRO") === state.CHAR.filter(c => (c.tags || []).includes("GCG_TAG_ELEMENT_PYRO")).length, "facet：类型=角色时元素维度只统计角色");
  Object.assign(browseState, { type: "", el: "", cost: "", energy: "", tag: "", ver: "" });

  /* ===== 5. 排序 ===== */
  browseState.sort = "name"; browseState.dir = 1;
  const byName = browseFilter();
  let nameOk = true;
  for (let i = 1; i < byName.length; i++) if (byName[i - 1].name.localeCompare(byName[i].name, "zh") > 0) nameOk = false;
  assert(nameOk, "排序：名称升序");
  browseState.dir = -1;
  assert(browseFilter()[0].name === byName[byName.length - 1].name, "排序：方向取反");
  browseState.sort = "cost"; browseState.dir = 1;
  const byCost = browseFilter();
  assert(byCost.slice(0, state.CHAR.length).every(x => x.kind === "char"), "排序：按费用时角色沉到一端");
  browseState.sort = "ver"; browseState.dir = 1;
  const byVer = browseFilter();
  let verOk = true;
  for (let i = 1; i < byVer.length; i++) if (verCmp(byVer[i - 1].ver, byVer[i].ver) > 0) verOk = false;
  assert(verOk, "排序：版本升序（v3.3 → 最新）");
  browseState.sort = "id"; browseState.dir = 1;
  const byId = browseFilter();
  let idOk = true;
  for (let i = 1; i < byId.length; i++) if (byId[i - 1].id > byId[i].id) idOk = false;
  assert(idOk, "排序：编号升序");
  Object.assign(browseState, { sort: "name", dir: 1 });

  /* ===== 5b. 卡库分组：可构筑 / 对局实体与历史变体（默认折叠） ===== */
  const split = browseSplit();
  assert(split.all.length === pool.length && split.build.length + split.other.length === split.all.length,
    "分组：可构筑 + 不可构筑 = 全库（" + split.build.length + " + " + split.other.length + "）");
  assert(split.build.length === poolStats.buildable && split.build.length > 0,
    "分组：可构筑数 = 有分享 id 的条目（" + split.build.length + "）");
  assert(split.build.every(x => x.share != null) && split.other.every(x => x.share == null),
    "分组：两侧判据互斥（只看 share，不按类型再猜）");
  /* 不可构筑组里既有对局实体，也有不可构筑的角色形态（如「焚尽的炽炎魔女」） */
  assert(split.other.some(x => x.domain === "field") && split.other.some(x => x.domain !== "field"),
    "分组：不可构筑组同时收了「对局实体」与「历史变体/形态」");
  /* 折叠态：翻页上下文只含可构筑的；展开后回到全库 */
  const idsCollapsed = browseVisibleIds();
  assert(idsCollapsed.length === split.build.length, "折叠态：可见列表只含可构筑条目");
  nbOpen.browse = true;
  const idsExpanded = browseVisibleIds();
  assert(idsExpanded.length === split.all.length, "展开态：可见列表回到全库（" + idsExpanded.length + "）");
  nbOpen.browse = false;
  /* 折叠分组不渲染瓦片，只渲染标题与数量 */
  const nbClosed = otherGroupHtml(split.other, false);
  assert(nbClosed.includes("对局实体与历史变体") && nbClosed.includes(String(split.other.length)),
    "折叠分组：标题带数量（" + split.other.length + "）");
  assert(!nbClosed.includes('data-id="') && nbClosed.includes('data-nb="browse"'),
    "折叠分组：默认不渲染瓦片，只给展开按钮");
  const nbOpened = otherGroupHtml(split.other, true);
  assert(nbOpened.includes('id="nbg"'), "展开分组：生成独立网格容器（不与可构筑列表混排）");
  assert(otherGroupHtml([], false) === "", "无不可构筑条目时不显示分组");

  /* ===== 5c. 显示不可构筑：全局开关 ===== */
  assert(showUnbuildable === false, "开关：默认关闭（不可构筑收进折叠分组）");
  const idsBefore = browseVisibleIds();
  setShowUnbuildable(true);
  assert(showUnbuildable === true && localStorage.getItem(STORAGE_KEYS.browseUnbuildable) === "1", "开关：打开后写进本地存储");
  assert(browseVisibleIds().length === split.all.length, "开关打开：翻页上下文 = 全库（" + browseVisibleIds().length + " 条）");
  renderBrowseResults();
  const flatHtml = String($("browseResults").innerHTML);
  assert(flatHtml.indexOf("card-grid paged") >= 0, "开关打开：结果区换成平铺（分页网格）");
  assert(flatHtml.indexOf("nbhead") < 0, "开关打开：不再渲染折叠分组标题");
  assert(!!bPager && bPager.pages.length >= 1, "开关打开：首屏已挂载分页容器（" + (bPager ? bPager.pages.length : 0) + " 页）");
  setShowUnbuildable(false);
  renderBrowseResults();
  const backHtml = String($("browseResults").innerHTML);
  assert(backHtml.indexOf("nbhead") >= 0, "开关关闭：折叠分组标题回来");
  assert(browseVisibleIds().length === idsBefore.length, "开关关闭：翻页上下文回到可构筑");

  /* ===== 5d. 分页网格：按页挂载 / 卸载 / 记忆 ===== */
  const gridStub = document.createElement("div");
  const sentStub = document.createElement("div");
  const pageItems = pool.slice(0, 100);
  const pg = makePager(gridStub, sentStub, pageItems, browseTile, "build");
  assert(pg.pages.length === 0, "分页：初始不挂载任何页");
  assert(pagerGrow(pg) === true && pg.pages.length === 1 && pg.pages[0].filled, "分页：第一次追加挂载 1 页");
  pagerGrow(pg); pagerGrow(pg);
  assert(pg.pages.length === 3, "分页：100 条按每页 " + BROWSE_PAGE + " 张分成 3 页");
  assert(pagerGrow(pg) === false, "分页：没有更多时不再追加");
  assert(String(sentStub.textContent).indexOf("全部") >= 0, "分页：末页哨兵提示「已展示全部」");
  pagerSweep(pg);   /* 无布局信息（测试环境）不应抛错 */
  assert(true, "分页：无布局信息时窗口计算安全跳过");
  /* 卸载 / 重挂：高度占位保留、内容清空 */
  pg.pages[0].h = 800;
  pg.pages[1].h = 800;
  pg.pages[2].h = 800;
  pg.gridTop = 0;
  pg.offsets = null;
  pg.pages[0].el.innerHTML = "x";
  pg.pages[1].el.innerHTML = "x";
  pg.pages[2].el.innerHTML = "x";
  pagerSweep(pg);
  assert(pg.pages.length === 3, "分页：窗口计算不改变页数");
  /* memo：同一状态只算一次 */
  Object.assign(browseState, { type: "", el: "", cost: "", energy: "", tag: "", ver: "", sort: "name", dir: 1 });
  const m1 = browseFilter();
  assert(browseFilter() === m1, "memo：同状态反复取筛选结果返回同一份（滚动路径零重算）");
  assert(facetCounts() === facetCounts(), "memo：分面计数同样记忆");
  assert(browseSplit() === browseSplit(), "memo：分组拆分同样记忆");
  browseState.type = "GCG_CARD_EVENT";
  assert(browseFilter() !== m1 && browseFilter().every(x => x.typeRaw === "GCG_CARD_EVENT"), "memo：筛选变化后重算");
  Object.assign(browseState, { type: "" });
  const m2 = browseFilter();
  invalidatePoolMemo();
  assert(browseFilter() !== m2, "memo：卡池版本变化后缓存失效");

  /* ===== 6. 筛选状态 ↔ hash ===== */
  Object.assign(browseState, { type: "GCG_CARD_EVENT", el: "HYDRO", cost: "2", energy: "", tag: "天赋", ver: "", sort: "cost", dir: -1 });
  const h = browseHash();
  assert(h === "#b=t=GCG_CARD_EVENT,e=HYDRO,c=2,g=" + encodeURIComponent("天赋") + ",s=cost,d=-1", "hash 编码：" + h);
  const st2 = parseBrowseHash(h);
  assert(st2 && st2.type === "GCG_CARD_EVENT" && st2.el === "HYDRO" && st2.cost === "2" && st2.tag === "天赋" && st2.sort === "cost" && st2.dir === -1, "hash 解码往返一致");
  assert(parseBrowseHash("#q=test") === null, "非 b= hash 返回 null");
  assert(browseHash({ type: "", el: "", cost: "", energy: "", tag: "", ver: "", sort: "name", dir: 1 }) === "", "默认状态不产生 hash");
  Object.assign(browseState, { type: "", el: "", cost: "", energy: "", tag: "", ver: "", sort: "name", dir: 1 });

  /* 开关状态编进链接：u=1 只在打开时出现，缺省视为关闭（链接就是视图快照） */
  setShowUnbuildable(true);
  assert(browseHash() === "#b=u=1", "hash：开关打开也产出链接：" + browseHash());
  browseState.type = "GCG_CARD_EVENT";
  const hu = browseHash(), stu = parseBrowseHash(hu);
  assert(stu.type === "GCG_CARD_EVENT" && stu.u === true, "hash：开关与筛选一起编码：" + hu);
  assert(parseBrowseHash("#b=t=GCG_CARD_EVENT").u === false, "hash：无 u 时按关闭处理");
  assert(parseBrowseHash("#b=u=0,t=X").u === false && parseBrowseHash("#b=u=1").u === true, "hash：u=0 / u=1 都认");
  /* 应用链接只改当前视图，不覆盖本机默认偏好 */
  setShowUnbuildable(true);
  setShowUnbuildable(true, false);
  assert(localStorage.getItem(STORAGE_KEYS.browseUnbuildable) === "1", "开关：常规切换写入本机偏好");
  setShowUnbuildable(false, false);
  assert(showUnbuildable === false && localStorage.getItem(STORAGE_KEYS.browseUnbuildable) === "1", "hash 应用：只改视图不改本机偏好");
  setShowUnbuildable(false);
  browseState.type = "";

  /* ===== 7. 多牌组管理 ===== */
  draftClear();
  const dA = newDeck("牌组A");
  const cA = state.CHAR.find(c => c.shareId != null);
  draftAdd(cA.id);
  const cardA = state.ENT.find(e => e.shareId != null && ["GCG_CARD_MODIFY", "GCG_CARD_EVENT", "GCG_CARD_ASSIST", "GCG_CARD_SUPPORT"].includes(e.type));
  draftAdd(cardA.id); draftAdd(cardA.id);
  assert(dA.name === "牌组A" && dA.chars.length === 1 && dA.cards.length === 1 && dA.cards[0][1] === 2, "牌组A：角色与行动牌写入存储结构");
  assert(draftTotal() === 2 && draftHas(cA.id), "draft 门面读数正确");
  const dCopy = newDeck("牌组A 副本");
  dCopy.chars = [...dA.chars];
  dCopy.cards = dA.cards.map(([id, c]) => [id, c]);
  syncFromActive();
  assert(draft.chars.length === 1 && (draft.cards.get(cardA.id) || 0) === 2, "复制牌组：内容完整切换");
  selectDeck(dA.id);
  assert(draftTotal() === 2, "切回牌组A：draft 跟随活动牌组");
  saveDecks(); loadDecks();
  assert(decks.length === 3, "loadDecks：恢复 3 个牌组（迁移的我的牌组 + A + 副本）");
  selectDeck(decks.find(d => d.name === "牌组A").id);
  assert(draftTotal() === 2 && draft.chars.includes(cA.id), "持久化 roundtrip：内容不丢失");
  const before = decks.length;
  deleteDeckById(activeDeckId);
  assert(decks.length === before - 1, "删除活动牌组后自动切换到其余牌组");
  const dR = activeDeck();
  dR.name = "临时名";
  commitDeckRename({ dataset: { dkrenInput: String(dR.id) }, value: "改名后" });
  assert(activeDeck().name === "改名后", "commitDeckRename：提交重命名");
  /* 重名校验副本名不冲突：复制后的牌组是独立 id */
  const ids = new Set(decks.map(d => d.id));
  assert(ids.size === decks.length, "牌组 id 互不冲突");

  /* ===== 8. 构筑校验 ===== */
  draftClear();
  const probs = deckProblems();
  assert(probs.length === 2 && probs[0].includes("3 名角色") && probs[1].includes("30 张行动牌"), "空牌组校验：角色 + 行动牌两条问题");
  let errMsg = "";
  try { draftEncode(); } catch (e) { errMsg = e.message; }
  assert(errMsg.includes("3 名角色"), "draftEncode 复用校验信息（空牌组拒绝生成）");
  /* 装满 3 角色 + 30 张后校验通过。选卡须无构筑门槛（天赋/共鸣/地区牌
     依赖特定角色），且避开秘传（整套限 1） */
  draftClear();
  for (const c of state.CHAR.filter(c => c.shareId != null).slice(0, 3)) draftAdd(c.id);
  const pool2 = state.ENT.filter(e => e.shareId != null && ["GCG_CARD_MODIFY", "GCG_CARD_EVENT", "GCG_CARD_ASSIST", "GCG_CARD_SUPPORT"].includes(e.type)
    && deckReqsOf(e).length === 0 && !(e.tags || []).includes("GCG_TAG_LEGEND")).slice(0, 16);
  for (const e of pool2) { draftAdd(e.id); draftAdd(e.id); }
  assert(deckProblems().length === 0, "3 角色 + 30 张（无门槛卡）：校验全清");
  assert(typeof draftEncode() === "string" && draftEncode().length > 0, "合法牌组可生成分享码");

  /* ===== 9. 渲染防护 ===== */
  /* 筛选栏默认折叠：顶行只有「筛选」开关；展开后才出现六维各行 */
  renderBrowse();
  assert(String($("view-browse").innerHTML).includes("筛选"), "卡库视图：折叠态渲染筛选开关");
  assert(!String($("view-browse").innerHTML).includes("骰子费用"), "卡库视图：折叠态不含维度行");
  setBrowseExpanded(true);
  renderBrowse();
  assert(String($("view-browse").innerHTML).includes("类别"), "卡库视图：展开态含类别行");
  assert(String($("view-browse").innerHTML).includes("全部"), "卡库视图：展开态含全部chip");
  assert(String($("view-browse").innerHTML).includes("骰子费用"), "卡库视图：展开态含骰子费用行");
  /* 充能图标：闪电是雷元素符号、火焰是火元素符号，充能必须用不属于七元素的实心四芒星 */
  assert(!String($("view-browse").innerHTML).includes("⚡"), "卡库视图：充能不再使用闪电 emoji");
  assert(String($("view-browse").innerHTML).includes("i-en"), "卡库视图：充能渲染内联 SVG 图标");
  assert(/class="ico i-en"[^>]*fill="currentColor"/.test(ENERGY_ICON), "充能图标：实心填充（元素图标为描边，形态可区分）");
  assert(/<circle class="core"/.test(ENERGY_ICON), "充能图标：带中心光点的四芒星，不复用火元素火焰造型");
  /* 七元素图标：官方矢量注册表，填充色已归一为 currentColor，由外层按元素色着色 */
  assert(Object.keys(ELE_ICONS).length === 7, "元素图标：官方矢量 7 个全部注册");
  for (const el of Object.keys(ELE_ZH)) {
    const ico = eleIcon(el);
    assert(/<svg[^>]*viewBox=/.test(ico) && ico.includes("currentColor"), "元素图标：" + el + " 渲染为矢量 SVG");
  }
  assert(eleIcon("PYRO").includes("--ec:var(--pyro)"), "元素图标：按元素色着色（火 → --pyro）");
  assert(String($("view-browse").innerHTML).includes("ele-svg"), "卡库视图：元素 chip 使用官方矢量图标");
  setBrowseExpanded(false);
  renderDataInfo();
  assert(String($("dataInfo").innerHTML).includes("个概念"), "数据信息行：动态计数渲染");
  assert(scopeRow().includes(String(searchCorpus().length)), "检索范围行：牌库规模动态化");
  assert(scopeRow().includes('data-scope="desc"'), "检索范围行：含描述开关（可关闭提速）");

  /* ===== 8. 详情「加入牌组」：同名卡可放 2 张（秘传 1 张） ===== */
  const plain = state.ENT.find(e => e.shareId != null && e.type === "GCG_CARD_EVENT"
    && !((e.tags || []).includes("GCG_TAG_LEGEND")) && deckReqsOf(e).length === 0);
  assert(!!plain && copyLimit(plain.id) === 2, "上限判定：普通同名卡 2 张");
  draftClear();
  assert(deckActionHtml(plain.id, true, null).includes("加入牌组"), "详情主按钮：未加入时是「加入牌组」");
  draftAdd(plain.id);
  const b1 = deckActionHtml(plain.id, true, null);
  assert(b1.includes("再加一张") && b1.includes("1/2"), "详情主按钮：已加入 1 张时提示「再加一张 1/2」");
  draftAdd(plain.id);
  assert((draft.cards.get(plain.id) || 0) === 2, "同名卡确实可以加入第 2 张");
  const b2 = deckActionHtml(plain.id, true, null);
  assert(b2.includes("已满") && b2.includes("disabled"), "详情主按钮：加满后禁用并显示「已满 2/2」");
  assert(b2.includes("移出"), "详情：加满后仍保留「移出」入口");
  draftAdd(plain.id);
  assert((draft.cards.get(plain.id) || 0) === 2, "第 3 张被同名上限拦下");
  const legend = state.ENT.find(e => e.shareId != null && (e.tags || []).includes("GCG_TAG_LEGEND") && deckReqsOf(e).length === 0);
  if (legend) {
    draftClear();
    draftAdd(legend.id); draftAdd(legend.id);
    assert(copyLimit(legend.id) === 1 && (draft.cards.get(legend.id) || 0) === 1, "秘传牌整套限 1 张");
  }
  /* 卡库瓦片上的数量徽标：显示当前已加入的份数，加满时高亮 */
  draftClear();
  draftAdd(plain.id);
  const tile1 = browseTile(pool.find(x => x.id === plain.id));
  assert(tile1.includes("qcnt") && tile1.includes("×1"), "卡库瓦片：已加入 1 张时显示 ×1");
  draftAdd(plain.id);
  const tile2 = browseTile(pool.find(x => x.id === plain.id));
  assert(tile2.includes("qcnt max") && tile2.includes("×2"), "卡库瓦片：加满时徽标高亮显示 ×2");
  draftClear();
  assert(!browseTile(pool.find(x => x.id === plain.id)).includes("qcnt"), "卡库瓦片：未加入时不显示数量徽标");

  /* ===== 9. 视图切换：牌组摘要只属于卡面视图 ===== */
  state.current = { chars: [], charIds: [], order: [], groups: {} };
  switchView("browse");
  assert($("summary").style.display === "none", "视图切换：卡库视图收起牌组摘要（不再压在标签栏上方）");
  state.current = null;

  console.log(getFails() ? "\\\\n存在失败项" : "\\\\n全部通过");
  process.exit(getFails() ? 1 : 0);
})().catch(e => { console.error("执行异常:", e); process.exit(1); });
`;

await new Function(
  "document", "window", "localStorage", "location", "history", "fetch", "navigator", "assert", "getFails", "CONCEPTS_EXTRA",
  logic + harness,
)(
  documentStub, {}, localStorageStub,
  { hash: "" }, { replaceState() {} },
  fetchStub, { clipboard: {} }, assert, () => fails, conceptsExtra,
);

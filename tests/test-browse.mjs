/* src/ 应用源码 · 卡库浏览 / 反链索引 / 多牌组存储逻辑验证（DOM stub + 缓存数据） */
import { createTest } from "./_env.mjs";

const t = createTest();
const { assert } = t;

const harness = `
return (async () => {
  /* 记录视图：卡池与索引都从这里取，测试断言的是同一份数据 */
  const chars = () => charRecords();
  const cards = () => cardRecords();
  const idOf = r => Number(r.key.slice(r.key.indexOf(":") + 1));
  const recByName = n => cards().find(r => r.name === n) || chars().find(r => r.name === n);

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
  const buildEnts = cards().filter(r => r.flags.poolable && !r.flags.test && !r.flags.shadow);
  assert(pool.length === chars().length + buildEnts.length, "卡池收录全部角色牌与实体卡（" + pool.length + " 条，已排除测试卡与准备状态）");
  assert(poolStats.shadowFiltered === cards().filter(r => r.flags.shadow && !r.flags.test).length && poolStats.shadowFiltered > 0,
    "准备状态并入技能页计数（" + poolStats.shadowFiltered + " 个不进卡池）");
  assert(poolStats.testFiltered === cards().filter(r => r.flags.test).length && poolStats.testFiltered === 5, "测试卡过滤计数（" + poolStats.testFiltered + " 张不进卡池）");
  assert(poolStats.buildable === cards().filter(r => r.share != null).length + chars().filter(r => r.share != null).length,
    "可构筑计数 = 有 shareId 的角色 + 实体卡（" + poolStats.buildable + "）");
  const ganyu = pool.find(x => x.id === 1101);
  assert(ganyu && ganyu.kind === "char" && ganyu.element === "CRYO" && ganyu.hp === 12, "卡池派生字段：甘雨（角色/冰/生命12）");
  const furina = pool.find(x => x.id === 212111);
  assert(furina && furina.element === "HYDRO" && furina.related === "芙宁娜" && furina.tags.includes("天赋"), "天赋牌继承关联角色元素与关联名");
  const zhans = recByName("战欲涌现");
  const zhansP = pool.find(x => x.id === idOf(zhans));
  assert(zhansP.energyCost === 2 && zhansP.dice === 3, "费用拆分：骰子 3 + 充能 2 分别派生");
  assert(poolStats.versions.length > 5 && verCmp(poolStats.versions[0], poolStats.versions[poolStats.versions.length - 1]) < 0, "版本列表有序（" + poolStats.versions.length + " 个）");
  assert(poolStats.byType.GCG_CARD_STATE === buildEnts.filter(e => e.typeRaw === "GCG_CARD_STATE").length, "类型统计与原始数据一致（测试卡已排除）");

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
  assert(browseFilter().some(x => x.id === idOf(zhans)), "充能筛选：含战欲涌现");
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
  assert(fcn(f0.type, "GCG_CARD_CHARACTER") === chars().length, "facet：角色牌计数 = 角色总数");
  assert(fcn(f0.type, "GCG_CARD_EVENT") === buildEnts.filter(e => e.typeRaw === "GCG_CARD_EVENT").length, "facet：事件牌计数正确（测试卡已排除）");
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
  assert(fcn(f1.type, "GCG_CARD_CHARACTER") === chars().length, "facet：类型维度不受自身筛选影响（仍为全量计数）");
  assert(fcn(f1.el, "PYRO") === chars().filter(c => c.stats.tagsRaw.includes("GCG_TAG_ELEMENT_PYRO")).length, "facet：类型=角色时元素维度只统计角色");
  Object.assign(browseState, { type: "", el: "", cost: "", energy: "", tag: "", ver: "" });

  /* ===== 5. 排序 ===== */
  browseState.sort = "name"; browseState.dir = 1;
  const byName = browseFilter();
  let nameOk = true;
  /* 字典序走数据层单点比较器（nameCmp）：引号牌名按引号内正文参与排序——
     旧实现的裸 localeCompare 把前引号当主权重字符，所有「」牌名整堆排在库首 */
  for (let i = 1; i < byName.length; i++) if (nameCmp(byName[i - 1].name, byName[i].name) > 0) nameOk = false;
  assert(nameOk, "排序：名称升序（nameCmp 字典序）");
  assert(nameCmp("「女士」", "阿贝多") > 0, "引号牌名按正文排序：「女士」排在阿贝多之后（N 区，不再堆库首）");
  assert(nameCmp("「曾如磐石抵挡黑水奔流…」", "迪卢克") < 0, "引号牌名按正文排序：曾（C 区）在迪卢克之前");
  const firstPlain = byName.findIndex(x => !x.name.startsWith("「"));
  const lastQuoted = byName.map(x => x.name.startsWith("「")).lastIndexOf(true);
  assert(firstPlain >= 0 && lastQuoted > firstPlain,
    "「」牌名按正文交错在库里（不全堆在库首之前；字典序下阿贝多本就是第一张）");
  browseState.dir = -1;
  assert(browseFilter()[0].name === byName[byName.length - 1].name, "排序：方向取反");
  browseState.sort = "cost"; browseState.dir = 1;
  const byCost = browseFilter();
  assert(byCost.slice(0, chars().length).every(x => x.kind === "char"), "排序：按费用时角色沉到一端");
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
  /* 检索词编进链接：分享出去的是完整一屏（含第二阶段关键词），解析端不得丢弃 */
  setShowUnbuildable(false);
  Object.assign(browseState, { type: "", el: "", cost: "", energy: "", tag: "", ver: "", sort: "name", dir: 1 });
  searchState.q = "芙宁娜";
  const hq = browseHash();
  assert(hq === "#b=q=" + encodeURIComponent("芙宁娜"), "hash：检索词编入：" + hq);
  assert(parseBrowseHash(hq).q === "芙宁娜", "hash 解码：检索词往返一致");
  assert(parseBrowseHash("#b=t=X").q === undefined, "hash：无 q 时该字段缺省（应用方按清空处理）");
  searchState.q = "";
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
  const cA = chars().find(c => c.share != null);
  const cAId = idOf(cA);
  draftAdd(cAId);
  const cardA = cards().find(e => e.share != null && ["GCG_CARD_MODIFY", "GCG_CARD_EVENT", "GCG_CARD_ASSIST", "GCG_CARD_SUPPORT"].includes(e.typeRaw));
  const cardAId = idOf(cardA);
  draftAdd(cardAId); draftAdd(cardAId);
  assert(dA.name === "牌组A" && dA.chars.length === 1 && dA.cards.length === 1 && dA.cards[0][1] === 2, "牌组A：角色与行动牌写入存储结构");
  assert(draftTotal() === 2 && draftHas(cAId), "draft 门面读数正确");
  const dCopy = newDeck("牌组A 副本");
  dCopy.chars = [...dA.chars];
  dCopy.cards = dA.cards.map(([id, c]) => [id, c]);
  syncFromActive();
  assert(draft.chars.length === 1 && (draft.cards.get(cardAId) || 0) === 2, "复制牌组：内容完整切换");
  selectDeck(dA.id);
  assert(draftTotal() === 2, "切回牌组A：draft 跟随活动牌组");
  saveDecks(); loadDecks();
  assert(decks.length === 3, "loadDecks：恢复 3 个牌组（迁移的我的牌组 + A + 副本）");
  selectDeck(decks.find(d => d.name === "牌组A").id);
  assert(draftTotal() === 2 && draft.chars.includes(cAId), "持久化 roundtrip：内容不丢失");
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
  assert(probs.length === 2 && probs[0].text.includes("3 名角色") && probs[1].text.includes("30 张行动牌"), "空牌组校验：角色 + 行动牌两条问题");
  let errMsg = "";
  try { draftEncode(); } catch (e) { errMsg = e.message; }
  assert(errMsg.includes("3 名角色"), "draftEncode 复用校验信息（空牌组拒绝生成）");
  /* 装满 3 角色 + 30 张后校验通过。选卡须无构筑门槛（天赋/共鸣/地区牌
     依赖特定角色），且避开秘传（整套限 1） */
  draftClear();
  for (const c of chars().filter(c => c.share != null).slice(0, 3)) draftAdd(idOf(c));
  const pool2 = cards().filter(e => e.share != null && ["GCG_CARD_MODIFY", "GCG_CARD_EVENT", "GCG_CARD_ASSIST", "GCG_CARD_SUPPORT"].includes(e.typeRaw)
    && e.reqs.deck.length === 0 && !e.stats.tagsRaw.includes("GCG_TAG_LEGEND")).slice(0, 16);
  for (const e of pool2) { const eid = idOf(e); draftAdd(eid); draftAdd(eid); }
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
  assert(scopeRow().includes(String(searchCorpus().length)), "检索范围行：牌库规模动态化");
  assert(scopeRow().includes('data-scope="desc"'), "检索范围行：含描述开关（可关闭提速）");

  /* ===== 8. 详情「加入牌组」：同名卡可放 2 张（秘传 1 张） ===== */
  const plain = cards().find(e => e.share != null && e.typeRaw === "GCG_CARD_EVENT"
    && !e.stats.tagsRaw.includes("GCG_TAG_LEGEND") && e.reqs.deck.length === 0);
  const plainId = idOf(plain);
  assert(!!plain && copyLimit(plainId) === 2, "上限判定：普通同名卡 2 张");
  draftClear();
  assert(deckActionHtml(plainId, true, null).includes("加入牌组"), "详情主按钮：未加入时是「加入牌组」");
  draftAdd(plainId);
  const b1 = deckActionHtml(plainId, true, null);
  assert(b1.includes("再加一张") && b1.includes("1/2"), "详情主按钮：已加入 1 张时提示「再加一张 1/2」");
  draftAdd(plainId);
  assert((draft.cards.get(plainId) || 0) === 2, "同名卡确实可以加入第 2 张");
  const b2 = deckActionHtml(plainId, true, null);
  assert(b2.includes("已满") && b2.includes("disabled"), "详情主按钮：加满后禁用并显示「已满 2/2」");
  assert(b2.includes("移出"), "详情：加满后仍保留「移出」入口");
  draftAdd(plainId);
  assert((draft.cards.get(plainId) || 0) === 2, "第 3 张被同名上限拦下");
  const legend = cards().find(e => e.share != null && e.stats.tagsRaw.includes("GCG_TAG_LEGEND") && e.reqs.deck.length === 0);
  if (legend) {
    draftClear();
    const legendId = idOf(legend);
    draftAdd(legendId); draftAdd(legendId);
    assert(copyLimit(legendId) === 1 && (draft.cards.get(legendId) || 0) === 1, "秘传牌整套限 1 张");
  }
  /* 卡库瓦片上的数量徽标：显示当前已加入的份数，加满时高亮 */
  draftClear();
  draftAdd(plainId);
  const tile1 = browseTile(pool.find(x => x.id === plainId));
  assert(tile1.includes("qcnt") && tile1.includes("×1"), "卡库瓦片：已加入 1 张时显示 ×1");
  draftAdd(plainId);
  const tile2 = browseTile(pool.find(x => x.id === plainId));
  assert(tile2.includes("qcnt max") && tile2.includes("×2"), "卡库瓦片：加满时徽标高亮显示 ×2");
  draftClear();
  assert(!browseTile(pool.find(x => x.id === plainId)).includes("qcnt"), "卡库瓦片：未加入时不显示数量徽标");

  /* ===== 9. 视图切换：牌组摘要只属于卡面视图 ===== */
  state.current = { chars: [], charIds: [], order: [], groups: {} };
  switchView("browse");
  assert($("summary").style.display === "none", "视图切换：卡库视图收起牌组摘要（不再压在标签栏上方）");
  state.current = null;

  /* ===== 10. 收藏：星标 / 过滤 / 分享链接 / 清账 ===== */
  Object.assign(browseState, { type: "", el: "", cost: "", energy: "", tag: "", ver: "", sort: "name", dir: 1 });
  const favTarget = browseFilter()[0];
  assert(!!favTarget, "收藏测试前提：卡池非空");
  if (isFav(favTarget.id)) toggleFav(favTarget.id);   /* 确保干净起点 */
  assert(!isFav(favTarget.id), "起点干净：未收藏");
  assert(toggleFav(favTarget.id) === true, "toggleFav：收藏");
  assert(localStorage.getItem(STORAGE_KEYS.favs).includes(String(favTarget.id)), "收藏持久化到 localStorage");
  setShowFavsOnly(true);
  assert(browseFilter().length > 0 && browseFilter().every(x => favs.has(x.id)), "收藏过滤：只剩星标卡");
  assert(browseHash().includes("f=1"), "收藏过滤编进链接（f=1）");
  assert(parseBrowseHash(browseHash()).f === true, "链接解析：f=1");
  setShowFavsOnly(false);
  assert(browseFilter().some(x => x.id === favTarget.id), "关闭过滤：全量恢复");
  toggleFav(favTarget.id);
  assert(!isFav(favTarget.id), "toggleFav：取消收藏");
  favs.add(999999999);
  pruneFavs();
  assert(!favs.has(999999999), "pruneFavs：失效 id 被清除");

  /* ===== 14. 机制筛选（44-mechs：curated 正则 → 位掩码 → 注册表维度） ===== */
  /* 覆盖数区间：防退化（措辞变化导致 0 命中或全命中都要立刻暴露） */
  const effCards = cards().filter(r => r.desc && r.desc.effect);
  for (const m of MECHS) {
    const n = effCards.filter(r => m.re.test(r.desc.effect)).length;
    assert(n > 0 && n < 800, "机制覆盖区间：" + m.label + " 命中 " + n + " 张");
  }
  /* 位掩码管道与直接正则一致：任取一张效果命中「抽牌」的卡，mask 必有 draw 位 */
  const drawCard = effCards.find(r => MECHS[0].re.test(r.desc.effect));
  assert(drawCard && mechHas(mechMaskOf(Number(drawCard.key.split(":")[1])), "draw"),
    "机制掩码：效果文本命中抽牌的卡（" + drawCard.name + "）在掩码里有 draw 位");
  /* 注册表维度：筛选结果全是行动牌且都命中机制；facet 有计数；hash 往返 */
  browseState.mech = "draw";
  const mechList = browseFilter();
  assert(mechList.length > 0 && mechList.every(x => x.kind !== "char" && mechHas(mechMaskOf(x.id), "draw")), "机制筛选：结果全为命中抽牌的行动牌");
  assert(facetCounts().mech.draw.n > 0, "机制分面：draw 有计数");
  const hm = browseHash();
  assert(hm.includes("m=draw"), "机制维度编进链接（m=draw）：" + hm);
  assert(parseBrowseHash(hm).mech === "draw", "机制维度 hash 往返");
  browseState.mech = "";
  assert(browseHash() === "", "机制清空后 hash 复位");

  /* ===== 15. 分享图布局（96-share 纯函数：网格数学 / 边界 / 不重叠） ===== */
  /* 前面的用例可能清掉了解析状态：确保有一副牌组再算布局 */
  if (!state.current) await decodeAndRender(SAMPLE, { noHash: true });
  const L = shareImageLayout(state.current, { name: "测试牌组", note: null });
  assert(L.width === 1080 && L.height > 400, "分享图布局：画布尺寸合理（" + L.width + "×" + L.height + "）");
  assert(L.charCells.length === state.current.chars.length && L.charCells.length <= 3, "分享图布局：角色格数与角色数一致");
  const nCards = state.current.order.reduce((a, t) => a + state.current.groups[t].length, 0);
  assert(L.cardCells.length === nCards, "分享图布局：行动牌格数 = 去重卡种数");
  /* 网格内不越界、彼此不重叠（同尺寸格子：检查左上角不重复即可） */
  const inB = c => c.x >= 0 && c.y >= 0 && c.x + c.w <= L.width && c.y + c.h <= L.height;
  assert(L.cardCells.every(inB) && L.charCells.every(inB), "分享图布局：所有格子都在画布内");
  const keys = new Set(L.cardCells.map(c => c.x + "," + c.y));
  assert(keys.size === L.cardCells.length, "分享图布局：格子不重叠");
  /* 8 列网格：同一行的格子 y 相同，最多 8 个不同 x */
  const ys = [...new Set(L.cardCells.map(c => c.y))];
  assert(Math.max(...ys.map(y => L.cardCells.filter(c => c.y === y).length)) <= 8, "分享图布局：每行不超过 8 张");
  /* 计数徽标的数据源：多张卡带 count>1 */
  assert(L.cardCells.some(c => c.count > 1) === state.current.order.some(t => state.current.groups[t].some(x => x.count > 1)), "分享图布局：count 透传");
  /* 备注并入页头第二行（右置），不再单独占行抬高画布 */
  const L2 = shareImageLayout(state.current, { note: "起手要素：先找 X" });
  assert(L2.height === L.height && L2.note === "起手要素：先找 X", "分享图布局：备注并入页头行，画布不再抬高");
  /* 费用分布块与角色行同带：右缘不越界 */
  assert(L.curveBox.w > 0 && L.curveBox.x + L.curveBox.w <= L.width, "分享图布局：费用分布块右缘不越界");
  /* 核心牌标记：落在对应格上，其余格不带 */
  const cid = state.current.cardIds[0];
  const L3 = shareImageLayout(state.current, { core: [cid] });
  assert(L3.cardCells.some(c => c.core) && L3.cardCells.filter(c => c.core).every(c => c.id === cid),
    "分享图布局：核心牌描边标记落在对应格");

  /* ===== 16. 牌组备注与核心牌（Deck v2 字段 + 活动牌组匹配导出） ===== */
  /* normalizeDeck：note/core 透传、损坏字段清洗 */
  const nd = normalizeDeck({ id: 5, name: "N", chars: [1], cards: [[2, 2]], updatedAt: 7, note: " 先找 X ", core: ["9", 3, "x"] });
  assert(nd && nd.v === 2 && nd.note === " 先找 X " && nd.core.length === 2 && nd.core.includes(9) && nd.core.includes(3), "normalizeDeck：v2 + note/core 透传与清洗");
  const nd2 = normalizeDeck({ id: 6, chars: [], cards: [] });
  assert(nd2 && nd2.note === undefined && nd2.core === undefined, "normalizeDeck：旧数据无 note/core 也可缺省");
  /* toggleCore / isCore：活动牌组内切换并持久化 */
  if (!state.current) await decodeAndRender(SAMPLE, { noHash: true });
  draftLoadCurrent();
  const someCard = state.current.cardIds[0];
  const on0 = toggleCore(someCard);
  assert(on0 === true && isCore(someCard), "核心牌：标记后 isCore 为真");
  assert((activeDeck().core || []).includes(someCard), "核心牌：写入活动牌组");
  assert(toggleCore(someCard) === false && !isCore(someCard), "核心牌：再点取消");
  /* 导出匹配：备注/核心只在活动牌组与当前解析一致时携带 */
  activeDeck().note = "起手先找解牌";
  toggleCore(state.current.cardIds[0]);
  const ex2 = buildExport();
  assert(ex2.note === "起手先找解牌" && Array.isArray(ex2.coreCardIds) && ex2.coreCardIds.length === 1, "导出：note 与 coreCardIds 携带");
  assert(deckText().includes("【备注】起手先找解牌"), "文本牌表：含备注行");
  delete activeDeck().note;
  activeDeck().core = [];
  saveDecks();

  /* ===== 17. 分享码二维码（97-qr：SVG 生成确定性 / 静区 / 深链内容） ===== */
  const svg1 = qrSvg("HELLO-WORLD-123");
  const svg2 = qrSvg("HELLO-WORLD-123");
  assert(svg1 === svg2 && svg1.includes("<svg") && svg1.includes("path"), "qrSvg：同文本两次生成逐位一致");
  assert(svg1.includes('fill="#ffffff"') && svg1.includes('fill="#12161d"'), "qrSvg：白底深模块（扫码对比度）");
  assert(!qrSvg("").includes("NaN"), "qrSvg：空串不产生 NaN 坐标");
  /* 内容恒为本页深链（与复制单卡链接同原理）：单文件版托管后同一份 HTML 自然线上化 */
  assert(qrContent("file:///D:/x/gcg.html", "ABC") === "file:///D:/x/gcg.html#ABC", "qrContent：file:// 也编成本页深链");
  assert(qrContent("https://example.com/p/a.html#old", "ABC") === "https://example.com/p/a.html#ABC", "qrContent：去旧 hash 换分享码");

  /* ===== 18. 最近查看的卡（46-recent：去重前插 / 上限 / 失效清除） ===== */
  resetRecent();
  pushRecentCard(1101); pushRecentCard(1101); pushRecentCard(1102);
  assert(recentCards().length === 2 && recentCards()[0] === 1102 && recentCards()[1] === 1101, "最近查看：去重前插");
  pushRecentCard(999999999);
  assert(recentCards().length === 2, "最近查看：无效 id 不入列");
  const rcIds = cards().filter(r => r.kind === "card").map(r => keyIdOf(r.key));
  for (let i = 0; i < 20; i++) pushRecentCard(rcIds[i]);
  assert(recentCards().length === 12 && recentCards()[0] === rcIds[19], "最近查看：上限 12、最新在前");
  localStorage.setItem("gi-viewer-recent-cards", JSON.stringify([1101, 999999999]));
  loadRecentCards(); pruneRecentCards();
  assert(recentCards().length === 1 && recentCards()[0] === 1101, "最近查看：prune 清掉失效 id");
  const strip = rcStripHtml();
  assert(strip.includes("rc-strip") && strip.includes('data-goto="1101"'), "最近查看：横带 HTML 含缩略入口");
  resetRecent();

  /* ===== 19. 描述命中片段（descSnippet：切片 / 高亮 / 大小写不敏感） ===== */
  const snip = descSnippet("战斗行动：我方出战角色为甘雨时，装备此牌。", "甘雨");
  assert(snip && snip.includes("<mark>甘雨</mark>") && snip.includes("出战角色为"), "描述片段：命中段高亮且带上下文");
  assert(descSnippet(" abc DEF ", "dEf") && descSnippet(" abc DEF ", "dEf").includes("<mark>DEF</mark>"), "描述片段：大小写不敏感且保留原文");
  assert(descSnippet("短文本", "长") === null, "描述片段：未命中返回 null");
  const long = "前".repeat(40) + "关键词" + "后".repeat(40);
  const snip2 = descSnippet(long, "关键词", 10);
  assert(snip2.startsWith("…") && snip2.endsWith("…") && snip2.includes("<mark>关键词</mark>"), "描述片段：长文本两侧省略号");

  /* ===== 20. 牌组备份与恢复（自描述格式 + 非破坏性合并） ===== */
  const bak = exportDecksBackup();
  assert(bak.format === "gi-decks-backup" && bak.version === 1 && Array.isArray(bak.decks) && Array.isArray(bak.favs),
    "备份：自描述格式（format/version/decks/favs）");
  const modified = JSON.parse(JSON.stringify(bak));
  modified.decks[0].note = "恢复过来的备注";
  modified.decks[0].updatedAt = (modified.decks[0].updatedAt || 0) + 9999;
  modified.decks.push({ id: 987654321, name: "恢复新增", chars: [1101, 1102, 1103], cards: [[1104, 2]] }, "junk");
  modified.favs = [1101];
  const stat = mergeDecksBackup(modified);
  assert(stat.updated === 1 && stat.added === 1 && stat.invalid === 1, "恢复：新者胜更新 + 新增 + 无效跳过");
  assert(decks.some(d => d.id === 987654321) && activeDeck()?.note === "恢复过来的备注", "恢复：新牌组入库、活动牌组按 updatedAt 更新");
  assert(isFav(1101), "恢复：收藏并入（只收池内 id）");
  assert(mergeDecksBackup(bak).kept >= 1, "恢复：旧备份回放时保留现状（不回滚新数据）");
  let threw = false;
  try { mergeDecksBackup({}); } catch { threw = true; }
  assert(threw, "恢复：格式不对时抛错（toast 回音）");
  deleteDeckById(987654321);

  /* ===== 21. 文本牌表回流导入（98-textimport：解析 / 匹配 / 检查 / 载入截断） ===== */
  if (!state.current) await decodeAndRender(SAMPLE, { noHash: true });
  const tiRes = parseTextDeck(deckText());
  assert(tiRes.chars.length === 3 && tiRes.chars.every(l => l.resolved != null), "文本导入：3 名角色全部识别");
  assert(tiRes.cards.reduce((a, l) => a + l.count, 0) === 30 && tiRes.cards.every(l => l.resolved != null), "文本导入：行动牌 30 张全部识别");
  assert(tiRes.code === state.current.code, "文本导入：分享码行透传");
  assert(!textImportChecks(tiRes).some(c => c.level === "err"), "文本导入：完整牌表无 err 级检查");
  resetTextImportIndex();
  const tiSrc2 = ["【角色】", "  甘雨", "【装备牌】", "  2× 明珠固化〔牌组·千年珍珠骏麟〕（千年珍珠骏麟·天赋）", "×2 湮远", "1、某张不存在的牌", "七圣召唤 · 卡牌与牌组浏览器"].join(String.fromCharCode(10));
  const tiRes2 = parseTextDeck(tiSrc2);
  assert(tiRes2.chars.length === 1 && tiRes2.chars[0].resolved != null, "文本导入：一行一名的角色段");
  const mz = tiRes2.cards.find(l => l.name.includes("明珠固化"));
  assert(mz && mz.count === 2 && mz.resolved != null && mz.raw.includes("〔牌组"), "文本导入：数量前缀 + 修饰剥离（〔依赖〕（关联））");
  const ty = tiRes2.cards.find(l => l.name.includes("湮远"));
  assert(ty && ty.count === 2, "文本导入：×2 前缀");
  assert(tiRes2.cards.some(l => l.resolved == null), "文本导入：不存在的卡名标记未识别");
  const checks2 = textImportChecks(tiRes2);
  assert(checks2.some(c => c.level === "err" && c.text.includes("角色")), "文本导入：角色不足报 err");
  /* 载入：创建新牌组；同名超限截断到 copyLimit、秘传只留 1 */
  const beforeN = decks.length;
  const tiSrc3 = ["【角色】甘雨 / 迪奥娜 / 凯亚", "【事件牌】", "5× " + recordOfId(tiRes.cards[0].resolved).name, "5× " + recordOfId(tiRes.cards[0].resolved).name].join(String.fromCharCode(10));
  const overRes = parseTextDeck(tiSrc3);
  const tiStat = loadTextDeck(overRes);
  const tiDeck = decks.find(d => d.id === tiStat.id);
  assert(decks.length === beforeN + 1 && tiDeck && tiDeck.name === "导入牌组", "文本导入：载入创建新牌组（不动现有）");
  const loadedId = tiRes.cards[0].resolved;
  assert(tiDeck.cards.every(([id, c]) => c <= copyLimit(id)) && tiDeck.cards.some(([id, c]) => id === loadedId), "文本导入：超限截断到 copyLimit");
  assert(tiStat.total <= 30, "文本导入：截断后总张数不超 30");
  deleteDeckById(tiStat.id);
  resetTextImportIndex();

  /* ===== 22. 资源缓存（49-cache：可用性探测 / URL 全集去重 / 无 Cache API 降级） ===== */
  assert(cacheAvailable() === false, "资源缓存：stub 无 Cache API 时不可用（直连降级）");
  const arts = artUrls();
  assert(arts.length > 100 && new Set(arts).size === arts.length, "资源缓存：卡面 URL 全集去重（" + arts.length + " 张）");
  assert(await cacheGet(arts[0]) === null, "资源缓存：不可用时读取返回 null（回落直连）");
  await cacheArt(arts[0]);   /* 不可用时应静默 no-op，不抛错 */
  assert(typeof cachedArtCount === "function" && typeof clearArtCache === "function" && typeof showCacheManager === "function" && typeof renderCacheView === "function" && typeof cacheAllArt === "function", "资源缓存：管理面 API 齐备");

})();
`;

await t.run(harness);
t.finish();

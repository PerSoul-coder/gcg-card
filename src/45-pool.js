/* 七圣召唤浏览器 · 全量卡池与版本索引（卡库/检索的数据基础）。
   源码按领域拆分，由 src/sources.mjs 统一声明加载顺序；单文件版构建时按同一顺序内联。 */
"use strict";

/* ---------- 全量卡池（卡库浏览的数据基础） ----------
   收录角色牌 + 全部实体卡（装备/事件/援助/场地/状态/召唤物/附加状态）。
   与卡库检索的分工：检索面向"找构筑组件"（可加入牌组的卡 + 概念），
   卡库浏览面向"查全部数据"（含对局中生成的场地/状态/召唤物，不可入构筑）。
   统一派生字段一次算好，之后的筛选、排序、渲染都只读这份索引。 */
/* 类型顺序来自 12-model.js 的 TYPE_ORDER（唯一定义）；这里保留旧名以便既有调用处不变 */
const POOL_TYPE_ORDER = TYPE_ORDER;
const verTuple = v => { const m = String(v || "").match(/^v(\d+)\.(\d+)/); return m ? [+m[1], +m[2]] : [0, 0]; };
function verCmp(a, b) { const [a1, a2] = verTuple(a), [b1, b2] = verTuple(b); return a1 - b1 || a2 - b2; }
let pool = [];
/* 卡池版本：每次重建 +1。卡库的筛选结果 / 分面计数按「筛选状态 + 版本」记忆，
   数据刷新后旧缓存自动失效，不用逐个调用处手工清。 */
let poolVersion = 0;
let poolStats = { total: 0, buildable: 0, testFiltered: 0, byType: {}, byEl: {}, byTag: {}, versions: [] };
const charElement = c => (c.tags.find(t => t.startsWith("GCG_TAG_ELEMENT")) || "").replace("GCG_TAG_ELEMENT_", "");
/* 卡牌所属元素：天赋牌随关联角色；元素共鸣等牌取牌组限制里的元素门槛 */
function cardElement(e, rel, dreqs) {
  const c = rel || (e && e.relatedCharacterId != null ? charById.get(e.relatedCharacterId) : null);
  if (c) return charElement(c);
  return reqElement((dreqs || deckReqsOf(e)).find(r => r.code === "deckEl"));
}
function buildPool() {
  pool = [];
  for (const c of CHAR) pool.push({
    kind: "char", id: c.id, name: c.name, englishName: c.englishName,
    element: charElement(c), type: "角色牌", typeRaw: "GCG_CARD_CHARACTER",
    domain: "char", deckable: true, art: true,
    tags: c.tags.map(tagZh).filter(Boolean), tagsRaw: c.tags,
    hp: c.hp, energy: c.maxEnergy, ver: c.sinceVersion,
    share: c.shareId, restrictions: [], deckReqs: [], related: null, relatedId: null,
    playCost: [], dice: -1, energyCost: 0, desc: (c.storyText || "").trim(),
    descAll: [c.storyText || "", ...(c.skills || []).map(s => `${s.name || ""}${s.description || ""}`)].join("\n").toLowerCase(),
  });
  let testFiltered = 0, shadowFiltered = 0;
  for (const e of ENT) {
    if (!POOL_TYPE_ORDER.includes(e.type)) continue;
    /* 明显测试卡不进牌库（判据见 isTestCard；详情深链仍可查） */
    if (isTestCard(e)) { testFiltered++; continue; }
    /* 准备状态影子不进牌库：它与技能同名、内容只是「本角色将使用技能 X」，
       单列成一张状态牌只会和技能抢名字（技能页里以「准备中状态」入口保留） */
    if (isShadowState(e)) { shadowFiltered++; continue; }
    const rel = e.relatedCharacterId != null ? charById.get(e.relatedCharacterId) : null;
    const dreqs = deckReqsOf(e);
    pool.push({
      kind: "card", id: e.id, name: e.name, englishName: e.englishName,
      element: cardElement(e, rel, dreqs), type: typeZhOf(e), typeRaw: e.type,
      domain: domainOfEntity(e), deckable: isDeckable(e),
      art: hasCardFace(e),
      tags: e.tags.map(tagZh).filter(Boolean), tagsRaw: e.tags,
      hp: null, energy: null, ver: e.sinceVersion,
      share: e.shareId, restrictions: restrictionsOf(e), deckReqs: dreqs,
      related: rel?.name || null, relatedId: e.relatedCharacterId ?? null,
      playCost: e.playCost, dice: diceCost(e.playCost), energyCost: energyCost(e.playCost),
      desc: (e.description || "").trim(), descAll: (e.description || "").toLowerCase(),
    });
  }
  /* 统计：筛选 chips 计数与全局数据信息行都读这里 */
  const byType = {}, byEl = {}, byTag = {};
  for (const x of pool) {
    byType[x.typeRaw] = (byType[x.typeRaw] || 0) + 1;
    if (x.element) byEl[x.element] = (byEl[x.element] || 0) + 1;
    for (const t of x.tags) byTag[t] = (byTag[t] || 0) + 1;
  }
  poolStats = {
    total: pool.length,
    buildable: pool.filter(x => x.share != null).length,
    testFiltered,
    shadowFiltered,
    byType, byEl, byTag,
    versions: [...new Set(pool.map(x => x.ver).filter(Boolean))].sort(verCmp),
  };
  poolVersion++;
}

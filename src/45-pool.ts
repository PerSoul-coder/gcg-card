/* 45-pool.ts —— 卡池：统一记录的投影。
 *
 * 卡池回答"卡库要展示哪些条目"，它与统一数据集不是两份数据，而是同一份数据的
 * 一个视图：构建期已经判定好 poolable / test / shadow / deckable，算好了元素、
 * 费用、限制与检索语料，这里只做投影 + 计数，不再推导任何东西。
 *
 * 收录范围：全部角色牌 + 全部可入卡库的实体卡（含对局中生成的场地/状态/召唤物，
 * 它们不可入构筑但可以查）。测试卡与准备状态影子在构建期就标好了，这里按标记排除
 * 并计数——排除理由是数据事实，不是运行时猜测。 */

import { charRecords, cardRecords, nameOfId, recordOfId, keyIdOf } from "./data/records";
import type { GcgRecord, PoolEntry, PoolStats } from "./types";
import { TYPE_ORDER } from "./data/model";
import { STORAGE_KEYS } from "./core/resources";

/* 类型顺序来自 model.ts 的 TYPE_ORDER（唯一定义）；这里保留旧名以便既有调用处不变 */
const POOL_TYPE_ORDER = TYPE_ORDER;

const verTuple = (v: string | undefined): [number, number] => {
  const m = /^v(\d+)\.(\d+)/.exec(String(v || ""));
  return m ? [+m[1], +m[2]] : [0, 0];
};
function verCmp(a: string, b: string): number {
  const [a1, a2] = verTuple(a), [b1, b2] = verTuple(b);
  return a1 - b1 || a2 - b2;
}

let pool: PoolEntry[] = [];
/* 卡池版本：每次重建 +1。卡库的筛选结果 / 分面计数按「筛选状态 + 版本」记忆，
   数据刷新后旧缓存自动失效，不用逐个调用处手工清。 */
let poolVersion = 0;
let poolStats: PoolStats = { total: 0, buildable: 0, testFiltered: 0, shadowFiltered: 0, byType: {}, byEl: {}, byTag: {}, versions: [] };

/** 使卡池派生的记忆缓存失效。重建卡池时自增；
 *  对外暴露成函数，避免外部直接改计数（测试验证失效路径也走这里）。 */
export function invalidatePoolMemo(): void {
  poolVersion += 1;
}

/** 清空卡池与统计（供「刷新数据」使用）。 */
export function resetPool(): void {
  pool = [];
  poolVersion = 0;
  poolStats = { total: 0, buildable: 0, testFiltered: 0, shadowFiltered: 0, byType: {}, byEl: {}, byTag: {}, versions: [] };
}

const idOf = (r: GcgRecord): number => keyIdOf(r.key);   /* 解析习语收敛到 data/records.keyIdOf */

/** 记录 → 卡库条目。字段一一对应，不做任何推导。 */
function poolEntryOf(r: GcgRecord): PoolEntry {
  const relatedId = r.rel.relatedCharacterId;
  return {
    kind: r.kind === "char" ? "char" : "card",
    id: idOf(r),
    name: r.name,
    englishName: r.englishName,
    element: r.stats.element,
    type: r.typeZh,
    typeRaw: r.typeRaw,
    domain: r.domain,
    deckable: r.flags.deckable,
    art: r.art.hasFace,
    tags: r.stats.tags,
    tagsRaw: r.stats.tagsRaw,
    hp: r.stats.hp,
    energy: r.stats.maxEnergy,
    ver: r.version,
    share: r.share,
    restrictions: r.reqs.play,
    deckReqs: r.reqs.deck,
    related: relatedId == null ? null : nameOfId(relatedId),
    relatedId: relatedId ?? null,
    playCost: r.stats.cost,
    dice: r.stats.dice,
    energyCost: r.stats.energy,
    /* 检索语料在构建期拼好：角色含简介与技能，卡牌含效果与特技。
       不设 desc 字段（见 types.ts PoolEntry）：语义按 kind 暗示的压平字段就是哑弹。 */
    descAll: r.searchText,
  };
}

function buildPool() {
  pool = [];
  for (const r of charRecords()) pool.push(poolEntryOf(r));

  let testFiltered = 0, shadowFiltered = 0;
  for (const r of cardRecords()) {
    if (!r.flags.poolable) continue;
    /* 明显测试卡不进牌库（详情深链仍可查） */
    if (r.flags.test) { testFiltered++; continue; }
    /* 准备状态影子不进牌库：它与技能同名、内容只是「本角色将使用技能 X」，
       单列成一张状态牌只会和技能抢名字（技能页里以「准备中状态」入口保留） */
    if (r.flags.shadow) { shadowFiltered++; continue; }
    pool.push(poolEntryOf(r));
  }

  /* 统计：筛选 chips 计数等界面读数都从这里走 */
  const byType: Record<string, number> = {}, byEl: Record<string, number> = {}, byTag: Record<string, number> = {};
  for (const x of pool) {
    byType[x.typeRaw] = (byType[x.typeRaw] || 0) + 1;
    if (x.element) byEl[x.element] = (byEl[x.element] || 0) + 1;
    for (const t of x.tags) if (t) byTag[t] = (byTag[t] || 0) + 1;
  }
  poolStats = {
    total: pool.length,
    buildable: pool.filter(x => x.share != null).length,
    testFiltered,
    shadowFiltered,
    byType, byEl, byTag,
    versions: [...new Set(pool.map(x => x.ver).filter((v): v is string => !!v))].sort(verCmp),
  };
  poolVersion++;
}

/* ---------- 收藏 ----------
   星标是跨视图的记忆：卡库筛选、详情页（后续牌组构筑也会用）读同一份。
   只存池内 id；数据集更新后 prune 掉失效 id，避免收藏里堆死链。 */
export const favs = new Set<number>();
export function loadFavs(): void {
  favs.clear();
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.favs) || "[]");
    if (Array.isArray(raw)) for (const id of raw) if (Number.isFinite(id)) favs.add(Number(id));
  } catch (e) {}
}
function saveFavs(): void {
  try { localStorage.setItem(STORAGE_KEYS.favs, JSON.stringify([...favs])); } catch (e) {}
}
export const isFav = (id: number): boolean => favs.has(Number(id));
/** 切换收藏，返回切换后的状态。 */
export function toggleFav(id: number): boolean {
  id = Number(id);
  if (favs.has(id)) favs.delete(id); else favs.add(id);
  saveFavs();
  return favs.has(id);
}
/** 批量加入收藏（恢复备份用）：只收池内 id，返回实际新增数，一次性落盘。 */
export function addFavs(ids: unknown[]): number {
  let n = 0;
  for (const id of ids) {
    const num = Number(id);
    if (Number.isFinite(num) && num > 0 && recordOfId(num) && !favs.has(num)) { favs.add(num); n++; }
  }
  if (n) saveFavs();
  return n;
}
/** 数据就绪后清掉失效 id（池里已不存在的卡）。 */
export function pruneFavs(): void {
  let dirty = false;
  for (const id of favs) {
    if (!recordOfId(id)) { favs.delete(id); dirty = true; }
  }
  if (dirty) saveFavs();
}

export { POOL_TYPE_ORDER, verTuple, verCmp, pool, poolVersion, poolStats, buildPool };

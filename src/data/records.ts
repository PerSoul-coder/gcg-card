/* data/records.ts —— 统一记录的运行时索引。
 *
 * ========== 为什么还需要这一层 ==========
 * 数据集本身是一个扁平数组，而界面要按三种方式取用：
 *   · 按数字 id 取一张牌（详情、翻页、牌组里的每个 id、深链）；
 *   · 按分享码 id 双向映射（解析分享码 / 生成分享码）；
 *   · 按名字取一条身份（检索、概念条目跳转、关联角色名）。
 * 这三种查表以前分别建立在 CHAR / ENT 快照上，于是"数据从哪里来"有了两套答案：
 * 概念索引与反链读数据集，卡池与详情读快照。两份数据各自演化，就出现了
 * "同一张牌在卡库有牌面、在详情没有""特技在数据集里有、在卡池里查不到"这类漂移。
 *
 * 现在只有一份来源：数据集。索引只是它的查表投影，不持有第二份事实。
 *
 * 约定：
 *   · 只有 char / card 有数字 id（技能用 key，术语用名字），因此 id 表不收录它们；
 *   · 记录是只读的，索引里放的是引用，调用方不得就地修改。 */

import type { GcgRecord } from "../types";
import { DATASET, dsReady } from "../07-dataset";

const byId = new Map<number, GcgRecord>();
const byKey = new Map<string, GcgRecord>();
const chars: GcgRecord[] = [];
const cards: GcgRecord[] = [];
const shareToId: Record<number, number> = {};
const idToShareId: Record<number, number> = {};

/**
 * "kind:id" 形 key 的数字段（card:11301 → 11301）。
 * 仓库里曾有三种手写解析习语（slice(indexOf)/slice(5)/split(":")[1]），对
 * "char:"、"card:" 恰好等价，但新增 key 前缀（如 skill:/term:）时表现各异
 * （有的 NaN、有的死链）——现在收敛到这一个点：新前缀只改这里。
 */
export function keyIdOf(key: string): number {
  return Number(String(key).slice(String(key).indexOf(":") + 1));
}

/** 重建索引。数据集变化（首次加载 / 刷新）后调用。 */
export function buildRecordIndex(): void {
  byId.clear();
  byKey.clear();
  chars.length = 0;
  cards.length = 0;
  for (const k of Object.keys(shareToId)) delete shareToId[+k];
  for (const k of Object.keys(idToShareId)) delete idToShareId[+k];
  if (!dsReady() || !DATASET) return;

  for (const r of DATASET.records) {
    byKey.set(r.key, r);
    if (r.kind !== "char" && r.kind !== "card") continue;
    const id = keyIdOf(r.key);
    if (!Number.isFinite(id)) continue;
    byId.set(id, r);
    (r.kind === "char" ? chars : cards).push(r);
    /* 分享码 id → 定义 id。同一 shareId 只认第一次出现的定义（历史上偶有重复） */
    if (r.share != null) {
      shareToId[r.share] = id;
      if (!(id in idToShareId)) idToShareId[id] = r.share;
    }
  }
  buildNameOrder();
}

export function resetRecordIndex(): void {
  byId.clear();
  byKey.clear();
  chars.length = 0;
  cards.length = 0;
  nameRank.clear();
  for (const k of Object.keys(shareToId)) delete shareToId[+k];
  for (const k of Object.keys(idToShareId)) delete idToShareId[+k];
}

/* ---------- 名称字典序索引 ----------
   牌库「分类内按字典序展示」、搜索同分稳定排序、相似卡候选排序都要它。
   运行时建一次：localeCompare 每个名字只跑一次，调用方全部走 O(1) 序号比较。
   引号牌名按引号内正文参与排序——ICU zh 排序把前引号当主权重字符（码点小于
   汉字），不剥离的话所有「」牌名会整堆排在库首，看起来就不是字典序
   （「花羽会」应排 H 区、「女士」应排 N 区，而不是全部挤在最前面）。 */
const nameRank = new Map<string, number>();
const LEADING_QUOTE_RE = /^[「『"'“‘]+/;
const nameBody = (n: string): string => n.replace(LEADING_QUOTE_RE, "");
let collator: { compare: (a: string, b: string) => number } | null = null;
try { collator = typeof Intl !== "undefined" && Intl.Collator ? new Intl.Collator("zh") : null; } catch (e) { collator = null; }
const bodyCmp = (a: string, b: string): number =>
  collator ? collator.compare(nameBody(a), nameBody(b)) || collator.compare(a, b)
           : a.localeCompare(b, "zh");

function buildNameOrder(): void {
  nameRank.clear();
  if (!dsReady() || !DATASET) return;
  const names = new Set<string>();
  for (const r of DATASET.records) if (r.name) names.add(r.name);
  const ordered = [...names].sort(bodyCmp);
  ordered.forEach((n, i) => nameRank.set(n, i));
}

/**
 * 字典序比较器：全应用名称排序的唯一入口（牌库排序 / 视图 tie-break /
 * 搜索同分排序 / 相似卡候选）。不在索引里的名字（任意输入）按同一规则现算，
 * 与索引序保持一致。
 */
export function nameCmp(a: string, b: string): number {
  const ra = nameRank.get(a);
  const rb = nameRank.get(b);
  if (ra != null && rb != null) return ra - rb;
  return bodyCmp(a, b);
}

/** 按数字 id 取记录（角色或卡牌）；不存在返回 null。 */
export const recordOfId = (id: number | null | undefined): GcgRecord | null =>
  id == null ? null : byId.get(Number(id)) || null;
export const isCharId = (id: number | null | undefined): boolean =>
  id != null && byId.get(Number(id))?.kind === "char";
/** 显示名：id 无效时退回 "#id"，调用方不必各自判空。 */
export const nameOfId = (id: number | null | undefined): string =>
  recordOfId(id)?.name || (id == null ? "" : "#" + id);
/** 分享码 id；null 表示不可构筑。 */
export const shareOfId = (id: number | null | undefined): number | null =>
  recordOfId(id)?.share ?? null;
/** 分享码 id → 定义 id（分享码解析用）。 */
export const idOfShare = (shareId: number): number | null => shareToId[shareId] ?? null;

export const charRecords = (): GcgRecord[] => chars;
export const cardRecords = (): GcgRecord[] => cards;
export const shareMap = shareToId;
export const idToShare = idToShareId;

/** 是否准备状态影子：名字归技能所有，不单独占概念名。 */
export const isShadowId = (id: number | null | undefined): boolean =>
  !!recordOfId(id)?.flags.shadow;

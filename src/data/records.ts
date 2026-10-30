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
    const id = Number(r.key.slice(r.key.indexOf(":") + 1));
    if (!Number.isFinite(id)) continue;
    byId.set(id, r);
    (r.kind === "char" ? chars : cards).push(r);
    /* 分享码 id → 定义 id。同一 shareId 只认第一次出现的定义（历史上偶有重复） */
    if (r.share != null) {
      shareToId[r.share] = id;
      if (!(id in idToShareId)) idToShareId[id] = r.share;
    }
  }
}

export function resetRecordIndex(): void {
  byId.clear();
  byKey.clear();
  chars.length = 0;
  cards.length = 0;
  for (const k of Object.keys(shareToId)) delete shareToId[+k];
  for (const k of Object.keys(idToShareId)) delete idToShareId[+k];
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

/* 应用级可变状态：当前牌组、视图栈、翻页基准。
 *
 * 数据不再放在这里。以前 state 里挂着 CHAR / ENT / KW 三份原始快照与四个派生索引
 * （charById / charByName / entById / shareMap），于是"数据在哪里"有两个答案：
 * 概念索引读统一数据集，卡池与详情读快照。两份来源各自演化，就出现了同一张牌
 * 在两处结论不同的漂移。现在数据只有一份（数据集），查表走 data/records.ts，
 * 这里只留真正会变的界面状态。 */

import type { ParsedDeck, OverlayEntry } from "../types";

export type ViewName = "grid" | "list" | "browse";

export interface AppState {
  /** 当前详情对象（卡牌 / 角色 / 技能）。 */
  current: ParsedDeck | null;
  currentView: ViewName;
  /** 牌组内有序 id（卡面/列表视图 → 详情翻页的顺序基准）。 */
  deckOrder: number[];
  /** 弹层视图栈：detail（卡片详情，自带同级翻页上下文）/ term（概念页，可继续下钻）。
   *  取代了早期"单一 modalList + 术语栈"的双轨状态——两者混用会导致
   *  从卡库/检索打开详情后 modalList 被压成单张，此后的翻页永远禁用。 */
  overlayStack: OverlayEntry[];
}

export const state: AppState = {
  current: null,
  currentView: "browse",
  deckOrder: [],
  overlayStack: [],
};

/** 清空视图状态（供「刷新数据」使用）。数据索引由 records.ts 自己重置。 */
export function resetViewState(): void {
  state.current = null;
  state.deckOrder = [];
  state.overlayStack = [];
}

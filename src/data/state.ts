/* 应用级可变状态：数据集合、当前牌组、视图栈。
 *
 * 集中成一个可替换的对象，而不是散落的 20 个 `let`——跨文件赋值是旧架构最难排查的
 * 一类故障（谁在什么时候改了 CHAR，只能靠全局搜索）。收敛到 state 之后，
 * 迁移期由 bridge 暴露为访问器，迁移完成后改为显式读写函数。 */

/** 数据源的原始记录（piovium characters / entities / keywords）。
 *  这是"喂给界面的原始形状"，不是统一数据集的 GcgRecord——两者并存且用途不同。 */
export interface RawSkill {
  id?: number;
  name?: string;
  description?: string;
  rawDescription?: string;
  tag?: string;
  type?: string;
  [k: string]: unknown;
}

export interface RawEntity {
  id: number;
  name: string;
  type?: string;
  description?: string;
  rawDescription?: string;
  shareId?: number | null;
  cardFace?: string | null;
  storyText?: string;
  englishName?: string;
  hp?: number;
  maxEnergy?: number;
  energy?: number;
  playCost?: unknown;
  costs?: unknown[];
  tags?: string[];
  skills?: RawSkill[];
  version?: string;
  [k: string]: unknown;
}

export type ViewName = "grid" | "list" | "browse";

export interface AppState {
  CHAR: RawEntity[];
  ENT: RawEntity[];
  KW: RawEntity[];
  /** 分享码 id → 实体 id。 */
  shareMap: Record<number, number>;
  /** 实体 id → 分享码 id（反向索引，只保留首次出现的映射）。 */
  idToShare: Record<number, number>;
  charById: Map<number, RawEntity>;
  charByName: Map<string, RawEntity>;
  entById: Map<number, RawEntity>;
  /** 当前详情对象（卡牌 / 角色 / 技能）。 */
  current: unknown;
  currentView: ViewName;
  /** 牌组内有序 id（卡面/列表视图 → 详情翻页的顺序基准）。 */
  deckOrder: number[];
  /** 弹层视图栈：detail（卡片详情，自带同级翻页上下文）/ term（概念页，可继续下钻）。
   *  取代了早期"单一 modalList + 术语栈"的双轨状态——两者混用会导致
   *  从卡库/检索打开详情后 modalList 被压成单张，此后的翻页永远禁用。 */
  overlayStack: unknown[];
}

export const state: AppState = {
  CHAR: [],
  ENT: [],
  KW: [],
  shareMap: {},
  idToShare: {},
  charById: new Map(),
  charByName: new Map(),
  entById: new Map(),
  current: null,
  currentView: "grid",
  deckOrder: [],
  overlayStack: [],
};

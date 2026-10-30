/* 统一数据集的类型契约。
 *
 * 这份文件是四份异构来源归一后的唯一形状定义：scripts/build-dataset.mjs 按它产出，
 * src/data/*.ts 按它消费，tests/ 按它断言。任何字段增删都必须先改这里，
 * 否则构建产物与运行时会出现"字段写了但没人读"或"读了但不存在"的静默漂移
 * ——装备牌特技被整类忽略，就是这种漂移的后果。
 *
 * 与 12-model.js 的分工：这里只描述"数据长什么样"，不描述"数据意味着什么"。
 * 语义判定（可构筑 / 影子 / 镜像 / 可链接）在构建期完成并写入 flags，
 * 运行时不做二次推断。 */

/** 记录种类。与 domain 不同：skill 是独立种类但域仍是 skill，term 同理。 */
export type RecordKind = "char" | "card" | "skill" | "term";

/** 语义域，决定一条记录在界面上属于哪一类入口。 */
export type Domain = "char" | "card" | "field" | "term" | "skill";

/** 一条骰子/充能费用。type 是原始枚举（GCG_COST_DICE_*），count 是数量。 */
export interface CostEntry {
  type: string;
  count: number;
}

/** 别名索引：norm 用于宽匹配（抹平引号/感叹号/空白），cosmetic 只抹平引号与空白。 */
export interface Aliases {
  norm: string;
  cosmetic: string;
  pinyin: string;
  initials: string;
}

/** 文本按用途分流。三者不可混用：story 是叙事，永远不参与链接与反链。 */
export interface Desc {
  /** 规则效果文本：参与概念链接、反链、检索。 */
  effect: string;
  /** 角色背景故事：仅展示，不链接、不计入反链。 */
  story: string;
  /** 规则术语释义：参与链接与检索，但不与 effect 重复计入。 */
  rules: string;
}

/** 牌面资源引用。只存引用，不存 URL——URL 拼接属于资源层职责。 */
export interface Art {
  hasFace: boolean;
  /** 卡面接口用的 id（角色/卡牌/技能所属角色）；null 表示无牌面。 */
  ref: number | null;
  kind: "char" | "card" | "none";
}

export interface Stats {
  cost: CostEntry[];
  /** 骰子费用合计；-1 表示不适用（角色、术语）。 */
  dice: number;
  energy: number;
  hp: number | null;
  maxEnergy: number | null;
  /** 中文标签（元素/武器/地区/牌类）。 */
  tags: string[];
  /** 原始标签码，用于反查与筛选。 */
  tagsRaw: string[];
  element: string;
}

/** 归属关系。owner 指"这条技能/实体挂在哪张牌或哪个角色上"。 */
export interface Rel {
  ownerKey: string | null;
  ownerName: string | null;
  ownerKind: "char" | "card" | null;
  relatedCharacterId: number | null;
  relatedCharacterKey: string | null;
}

/** 构建期算好的一次性判定。运行时只读，不再做启发式推断。 */
export interface Flags {
  /** 能否进入牌组。 */
  deckable: boolean;
  /** 能否出现在卡库。 */
  poolable: boolean;
  /** 准备状态影子：名字归技能所有，不独占概念。 */
  shadow: boolean;
  /** 牌面文本镜像：关键词表里原样复存的牌面文本，不是独立概念。 */
  mirror: boolean;
  /** 测试牌（数据源标记 GCG_TAG_TEST）。 */
  test: boolean;
  /** 对局实体（永不进牌组）。 */
  entity: boolean;
}

/** 技能独有字段。 */
export interface SkillExtras {
  prepared: boolean;
  prepareTurns: number;
  stateId: number | null;
  altCount: number;
  hidden: boolean;
}

/** 一条归一化记录。 */
export interface GcgRecord {
  key: string;
  kind: RecordKind;
  domain: Domain;
  name: string;
  englishName: string;
  aliases: Aliases;
  typeRaw: string;
  typeZh: string;
  desc: Desc;
  /** 是否允许被检索命中与文本链接。false 的记录仍可通过直接 key 访问。 */
  linkable: boolean;
  art: Art;
  stats: Stats;
  rel: Rel;
  flags: Flags;
  version: string;
  /** 出边：本记录文本中引用到的其他记录 key。 */
  refs: string[];
  source: "piovium" | "genshin-db";
  prepared?: boolean;
  prepareTurns?: number;
  stateId?: number | null;
  altCount?: number;
  hidden?: boolean;
}

export interface DatasetStats {
  total: number;
  chars: number;
  cards: number;
  skills: number;
  skillChar: number;
  skillCard: number;
  terms: number;
  linkable: number;
  withFace: number;
  shadow: number;
  mirror: number;
  test: number;
  refs: number;
}

export interface Dataset {
  /** 数据格式版本，用于运行时判断是否需要丢弃旧缓存。 */
  v: number;
  builtAt: string;
  stats: DatasetStats;
  records: GcgRecord[];
}

/** 构建期与运行时共同接受的最小记录形状校验。 */
export function isDataset(x: unknown): x is Dataset {
  if (!x || typeof x !== "object") return false;
  const d = x as Partial<Dataset>;
  return Array.isArray(d.records) && d.records.length > 0;
}

/* ---------- 牌组解析产物 ----------
   分享码解码后的内存视图：chars 是角色明细，groups 按牌类型分组，order 是分组顺序。
   以前这几个字段散在 state.current 的隐式结构里，读写双方都靠"记得有哪些字段"。 */
export interface ParsedChar {
  id: number;
  name: string;
  hp?: number;
  energy?: number;
  since?: string;
  element: string;
}

export interface ParsedCard {
  id: number;
  count: number;
  name: string;
  type: string;
  typeRaw: string;
  element: string;
  tags: Array<string | null>;
  tagsRaw: string[];
  playCost: unknown;
  dice: number;
  energy: number;
  related?: string | null;
  relatedId: number | null;
  restrictions: unknown;
  deckReqs: unknown;
  desc: string;
  since?: string;
}

export interface ParsedDeck {
  code: string;
  charIds: number[];
  cardIds: number[];
  chars: ParsedChar[];
  groups: Record<string, ParsedCard[]>;
  order: string[];
}

/** 弹层栈的一层。detail / term 可继续下钻，odds 与 deckdiff 是互斥的整屏弹层。 */
export interface OverlayEntry {
  kind: "detail" | "term" | "odds" | "deckdiff";
  id?: number;
  key?: string;
  pick?: unknown;
  [k: string]: unknown;
}

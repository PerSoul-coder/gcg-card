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

/** 别名索引：norm 用于宽匹配（抹平引号/感叹号/空白），cosmetic 只抹平引号与空白。
 *  pinyin 是「空格分隔音节」的无声调全拼（如 "cheng ming zhi ke"）——全拼与首字母
 *  都能从它派生，只存这一份；检索的拼音匹配全部读这里，不再有独立的拼音索引文件。 */
export interface Aliases {
  norm: string;
  cosmetic: string;
  pinyin: string;
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
  /** 名字属于某个身份（角色 / 卡牌），释义却不同（如角色的形态说明）。
      概念页保留该条目，检索不再单列——否则同一张牌会在两个栏目各出现一次。 */
  dupIdentity?: boolean;
  /** 补充库条目与接回的身份同名同写法（概念索引种类归并的判据之一）。 */
  sameIdentity?: boolean;
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

/** 牌间依赖：构筑门槛与打出限制。
 *  以前在运行时按 tags + 描述正则现算，同一张牌在卡库、详情、导出里可能算出不同结果；
 *  现在构建期算一次写进记录，运行期只读。 */
export interface Reqs {
  deck: DeckReq[];
  play: PlayRestriction[];
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
  /** 分享码 id：牌组分享码里出现的就是它。null 表示不可加入牌组。 */
  share: number | null;
  /** 牌间依赖（构筑门槛 + 打出限制），构建期算好。 */
  reqs: Reqs;
  /** 检索语料（名称 + 全文，小写）。空串表示不参与描述检索（技能 / 术语）。 */
  searchText: string;
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
  /** 概念索引的名字数与条目数（一个名字可对应多条：既是卡牌又是关键词）。 */
  conceptNames: number;
  conceptEntries: number;
}

/** 概念索引的一组条目：同一个名字可能属于多种概念，按展示顺序排列。 */
export interface TermGroup {
  name: string;
  entries: Array<{ key: string; kind: string }>;
}

export interface Dataset {
  /** 数据格式版本，用于运行时判断是否需要丢弃旧缓存。 */
  v: number;
  builtAt: string;
  stats: DatasetStats;
  records: GcgRecord[];
  /** 概念索引：名字 → 条目。收录、去重、排序全部在构建期算好。 */
  terms: TermGroup[];
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
  tags: string[];
  tagsRaw: string[];
  playCost: CostEntry[];
  dice: number;
  energy: number;
  related?: string | null;
  relatedId: number | null;
  /** 打出限制与牌组构筑限制：解析阶段就按领域类型收好，视图只负责渲染。 */
  restrictions: ReqBadge[];
  deckReqs: ReqBadge[];
  /** 可链接效果正文（命名即语义：effect 不会被误当叙事文本兜底成 story）。 */
  effect: string;
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

/** 弹层栈的一层。detail / term 可继续下钻，deckdiff 是互斥的整屏弹层。 */
/** 牌组差异视图：两段分享码 + 解析结果 + 两个显示开关。 */
export interface DeckDiffEntry {
  kind: "deckdiff";
  a: string;
  b: string;
  res: unknown;
  err: string;
  showSame: boolean;
  dirty: boolean;
}

interface OverlayBase {
  /** 弹层滚动位置：视图切换时保存/恢复，避免 innerHTML 重建后回到顶部。 */
  scrollTop?: number;
  /** 对比视图的横向滚动位置。 */
  cmpLeft?: number;
  /** 这层有没有自己的历史条目（#card= / #t= / #s=）。深链/前进重开的层没有——
      后退同步时按「有条目的层数」对齐目标深度，而不是数全部可回退层。 */
  hpushed?: boolean;
}

/* 弹层视图栈的一层。
   做成判别联合而不是「一堆可选字段」：栈是异质的，上一层的 id 与下一层无关。
   可选项堆在一起时，读 top.ids 只能靠非空断言「此刻一定是 detail」——
   而这件事本该由 kind 收窄来保证。 */
export type OverlayEntry =
  | (OverlayBase & { kind: "detail"; id: number; ids: number[]; idx: number })
  | (OverlayBase & { kind: "term"; name: string })
  | (OverlayBase & { kind: "skill"; key: string })
  | (OverlayBase & { kind: "compare"; ids: number[]; onlyDiff: boolean; showSim: boolean })
  | (OverlayBase & DeckDiffEntry);

/* ---------- 卡池条目 ----------
   把角色与实体卡摊平成同一种形状，供卡库、检索、对比、导出共用。
   与统一数据集（GcgRecord）不同：这里带的是"界面要展示的字段"（元素、费用、限制），
   已经算好，视图不再自己推导。 */
export interface PoolEntry {
  kind: "char" | "card";
  id: number;
  name: string;
  englishName?: string;
  element: string;
  type: string;
  typeRaw: string;
  domain: Domain;
  deckable: boolean;
  art: boolean;
  tags: Array<string | null>;
  tagsRaw: string[];
  hp?: number | null;
  energy?: number | null;
  ver?: string;
  share?: number | null;
  restrictions: PlayRestriction[];
  deckReqs: DeckReq[];
  related?: string | null;
  relatedId: number | null;
  playCost: CostEntry[];
  dice: number;
  energyCost: number;
  /* 注意：PoolEntry 不设 desc 字段——角色/卡牌的文本语义不同（叙事 vs 可链接），
     压平成一个 string 就重新打开「误链简介」的事故面；检索走 descAll。 */
  /** 名称 + 描述的小写全文，供描述检索直接 includes，避免每次重新拼接。 */
  descAll: string;
}

/* ---------- 技能条目 ----------
   角色技能与装备牌特技共用一种形状：装备牌特技的 ownerKind 是 "card"。 */
export interface SkillEntry {
  kind: "skill";
  key: string;
  /** 数据源里的技能 id（键末段）。 */
  id: number;
  name: string;
  englishName: string;
  /** 原始技能类型码与中文名：普攻 / 战技 / 爆发 / 被动 / 特殊。 */
  tag: string;
  tagZh: string;
  cost: CostEntry[];
  /** 效果正文（唯一字段；旧实现与 desc 同值双字段，鼓励「只改一个」的漂移）。 */
  effect: string;
  hidden: boolean;
  prepared: boolean;
  prepareTurns: number;
  stateId: number | null;
  altCount: number;
  /* 归属：角色技能 ownerKind="char"；装备牌特技 ownerKind="card"。
     两条构建路径的字段略有差异——数据集路径额外给 ownerKey / ownerCardId / art / linkable，
     旧数据源路径只给 ownerId。因此后四个都是可选的。 */
  ownerId: number | null;
  ownerName: string;
  ownerKind: "char" | "card";
  ownerKey?: string;
  ownerCardId?: number | null;
  art?: Art | null;
  linkable?: boolean;
}

/* ---------- 牌组存储 ----------
   两套形状是刻意分开的：持久化用元组数组（JSON 直存），内存操作用 Map（按 id 定位）。
   以前两者都是裸的 `[]` / `new Map()`，推断成 never，下游几十处属性访问全靠运气。 */
export interface Deck {
  /** 存储结构版本（normalizeDeck 落盘时写；旧数据缺失按 v1 处理后升级）。 */
  v?: 2;
  id: number;
  name: string;
  /** 角色 id，最多 3 个。 */
  chars: number[];
  /** [卡牌 id, 份数]，顺序即牌组内展示顺序。 */
  cards: Array<[number, number]>;
  /** 牌组备注（对局思路 / 起手要素），管理面板可编辑；可缺省（旧数据无此字段）。 */
  note?: string;
  /** 核心牌 id 清单（构筑依赖的少张数卡），概览条列出「仅 1 张」提醒；可缺省。 */
  core?: number[];
  updatedAt: number;
}

export interface Draft {
  chars: number[];
  cards: Map<number, number>;
}

/* ---------- 牌组限制与打出限制 ----------
   两者在界面上并列成徽标（allReqs），但来源不同：
     · DeckReq —— 构筑门槛，加入牌组前就要满足（角色 / 元素 / 地区阵营）
     · PlayRestriction —— 对局中生效（秘传限 1 / 天赋须在场 / 武器限定 / 限打张数）
   以前都是裸 `[]`，推断成 never，导致 allReqs 的下游全部失类型。 */
export interface DeckReq {
  code: "deckChar" | "deckEl" | "deckTag";
  short: string;
  label: string;
  name?: string;
  charId?: number | null;
  tag?: string;
  n?: number;
}

export interface PlayRestriction {
  code: "legend" | "talent" | "weapon" | "once";
  short: string;
  label: string;
}

export type ReqBadge = DeckReq | PlayRestriction;

/* ---------- 检索命中 ----------
   kind 除了角色/卡牌，还可能是概念（术语没有独立 id，靠 name 定位）。 */
export interface SearchHit {
  kind: "char" | "card" | "concept";
  id: number | null;
  name: string;
  score: number;
  match: string;
  note?: string;
  buildable?: boolean;
  ver?: string;
  noShare?: boolean;
  /** 概念命中时记录它实际对应的类别（术语 / 技能 / 卡牌…），用于结果分组。 */
  ckind?: string;
}

/** 检索建议（输入框下拉）的一条：gap 越小越靠前。 */
export interface SuggestHit {
  name: string;
  kind: string;
  gap: number;
}

/** 卡池统计：筛选 chips 的计数、版本列表等界面读数都从这里走。 */
export interface PoolStats {
  total: number;
  buildable: number;
  testFiltered: number;
  shadowFiltered: number;
  byType: Record<string, number>;
  byEl: Record<string, number>;
  byTag: Record<string, number>;
  versions: string[];
}

/* ---------- 导出格式 ----------
   导出物是给外部消费的契约（复制的 JSON / 下载的 CSV），字段一旦发出就不该随意改名。 */
export interface ExportSkill {
  name: string;
  type: string | null;
  typeZh: string;
  cost: Array<{ type: string; count: number }>;
  prepared: boolean;
  prepareTurns: number;
  description: string;
}

export interface ExportCard {
  id: number;
  shareId: number | null;
  name: string;
  typeRaw: string;
  type: string;
  tagsRaw: string[];
  tags: Array<string | null>;
  playCostRaw: unknown;
  diceCost: number;
  energyCost: number;
  relatedCharacterId: number | null;
  relatedCharacter: string | null;
  restrictions: ReqBadge[];
  deckRequirements: Array<{ code: string; short: string; label: string; tag: string | null; characterId: number | null; minCount: number | null }>;
  count: number;
  sinceVersion?: string;
  description: string;
  image: string;
  category: string;
}

export interface ExportChar {
  id: number;
  shareId: number | null;
  name: string;
  englishName: string | null;
  element: string;
  tagsRaw: string[];
  tags: Array<string | null>;
  hp?: number | null;
  maxEnergy?: number | null;
  sinceVersion?: string;
  skills: ExportSkill[];
  image: string;
}

/* ---------- 概念索引条目 ----------
   概念来自六类来源（角色 / 卡牌 / 技能 / 关键词 / 补充概念 / 术语），
   形状是并集而非统一：术语页只展示命中的那几个字段，因此都可选。
   mirrorCard 表示「名字与某张卡同名、但本身是叙事词」，检索时不再单列。 */
export interface TermEntry {
  src: number;
  kind: string;
  name: string;
  /** 可链接释义（效果 / 规则）。角色简介永远不进这里——它在 story 字段，
      数据形状保证「把简介 linkify」这类事故无法发生。 */
  desc: string;
  /** 角色简介（叙事文本）：展示只转义、检索可命中、永不参与链接。 */
  story?: string;
  mirrorCard?: boolean;
  type?: string;
  cost?: unknown;
  owner?: string;
  ownerId?: number | null;
  prepared?: boolean;
  prepareTurns?: number;
  artId?: number | null;
  shareId?: number | null;
  hp?: number | null;
  energy?: number | null;
  id?: number | null;
  key?: string;
  playCost?: unknown;
  /** 卡面地址（概念页缩略图）；空串表示无牌面。 */
  image?: string;
  ownerKind?: string;
  ckind?: string;
}

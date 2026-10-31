/* 资源管理：数据源、图片地址、元素元数据与图标、本地存储键。所有外部资源只在这里声明。
 *
 * 业务模块只 import 常量，不写死字符串。这是整个应用唯一允许出现外部 URL 的地方。 */

/* ---------- 数据源与资源地址 ---------- */
export const API = "https://static-data.piovium.org/api/v5";
export const LANG = "CHS";
export const SAMPLE = "JDCS4mwOFiLBRXUkJlLiRkwkEmCx8YAPGxFxaLcWFYGBilgYI6Ey2zMdDLEyaVIWJJAA";

/** localStorage 键：统一 gi-viewer 前缀便于整体清理，值保持历史版本不变（老用户缓存可直接沿用）。 */
export const STORAGE_KEYS = {
  history: "gi-viewer-history",
  searchScope: "gi-viewer-search-scope",
  recent: "gi-viewer-recent",
  draft: "gi-viewer-draft",
  decks: "gi-viewer-decks",
  browseExpanded: "gi-viewer-browse-exp",
  browseOther: "gi-viewer-browse-other",
  browseUnbuildable: "gi-viewer-browse-ub",
  view: "gi-viewer-view",
  theme: "gi-viewer-theme",
  favs: "gi-viewer-favs",
  recentCards: "gi-viewer-recent-cards",
} as const;

export const imgFull = (id: number): string => `${API}/image/${id}`;

/* 统一数据集：gzip 为浏览器原生主路径（DecompressionStream 不支持 brotli），
   br 为 Brotli 归档包，json 为最终回退（构建产物见 scripts/build-dataset.mjs）。 */
export const DATASET_GZ_URL = "gi-data/dataset.gz";
export const DATASET_BR_URL = "gi-data/dataset.br";
export const DATASET_JSON_URL = "gi-data/dataset.json";

/* ---------- 翻译表 ---------- */
export const ELE_ZH: Record<string, string> = {
  CRYO: "冰", HYDRO: "水", PYRO: "火", ELECTRO: "雷", ANEMO: "风", GEO: "岩", DENDRO: "草",
};
export const ELE_COLOR: Record<string, string> = {
  CRYO: "var(--cryo)", HYDRO: "var(--hydro)", PYRO: "var(--pyro)", ELECTRO: "var(--electro)",
  ANEMO: "var(--anemo)", GEO: "var(--geo)", DENDRO: "var(--dendro)",
};
export const WEAPON_ZH: Record<string, string> = {
  BOW: "弓", CATALYST: "法器", CLAYMORE: "双手剑", SWORD: "单手剑", POLE: "长柄武器", NONE: "其他武器",
};
export const TAG_ZH: Record<string, string | null> = {
  GCG_TAG_TALENT: "天赋", GCG_TAG_WEAPON: "武器", GCG_TAG_ARTIFACT: "圣遗物", GCG_TAG_PLACE: "场地",
  GCG_TAG_ALLY: "伙伴", GCG_TAG_ITEM: "道具", GCG_TAG_FOOD: "料理", GCG_TAG_RESONANCE: "元素共鸣",
  GCG_TAG_LEGEND: "秘传", GCG_TAG_SLOWLY: "战斗行动", GCG_TAG_CARD_BLESSING: "元素幻变",
  GCG_TAG_VEHICLE: "载具", GCG_TAG_HEXENZIRKEL: "魔女会", GCG_TAG_ADVENTURE_PLACE: "冒险场地",
  GCG_TAG_SUB_HURT: "减伤", GCG_TAG_NON_DISCOVERABLE: null,
};
export const COST_ZH: Record<string, string> = {
  CRYO: "冰", HYDRO: "水", PYRO: "火", ELECTRO: "雷", ANEMO: "风", GEO: "岩", DENDRO: "草",
  VOID: "万能", ENERGY: "充能", LEGEND: "秘传",
};

const NATION_ZH: Record<string, string> = {
  MONDSTADT: "蒙德", LIYUE: "璃月", INAZUMA: "稻妻", SUMERU: "须弥", FONTAINE: "枫丹",
  NATLAN: "纳塔", SNEZHNAYA: "至冬", FATUI: "愚人众", NODKRAI: "挪德卡莱",
};
const ARKHE_ZH: Record<string, string> = { PNEUMA: "芒", OUSIA: "虚" };

export function tagZh(t: string): string | null {
  if (t in TAG_ZH) return TAG_ZH[t] ?? null;
  const m = /^GCG_TAG_(ELEMENT|WEAPON|NATION|CAMP|ARKHE)_(.+)$/.exec(t);
  if (m) {
    const ns = m[1] as string;
    const code = m[2] as string;
    if (ns === "ELEMENT") return ELE_ZH[code] || code;
    if (ns === "WEAPON") return WEAPON_ZH[code] || code;
    if (ns === "NATION") return NATION_ZH[code] || code;
    if (ns === "ARKHE") return ARKHE_ZH[code] || code;
    return code;
  }
  return t.replace(/^GCG_TAG_/, "");
}

/* 牌类型译名不在这里定义：唯一来源是 data/model.ts 的 TYPE_SPEC（含域与可构筑判定），
   由它派生 TYPE_ZH。此处保留注释以免后来者又加一份平行表。 */

/* 中文名 → 标签码反查（描述兜底解析牌组限制时还原结构化标签） */
export const NATION_CODE: Record<string, string> = {
  蒙德: "GCG_TAG_NATION_MONDSTADT", 璃月: "GCG_TAG_NATION_LIYUE", 稻妻: "GCG_TAG_NATION_INAZUMA",
  须弥: "GCG_TAG_NATION_SUMERU", 枫丹: "GCG_TAG_NATION_FONTAINE", 纳塔: "GCG_TAG_NATION_NATLAN",
  至冬: "GCG_TAG_NATION_SNEZHNAYA", 挪德卡莱: "GCG_TAG_NATION_NODKRAI",
};
export const CAMP_CODE: Record<string, string> = {
  愚人众: "GCG_TAG_CAMP_FATUI", 魔物: "GCG_TAG_CAMP_MONSTER", 镀金旅团: "GCG_TAG_CAMP_EREMITE",
};
export const ELE_CODE: Record<string, string> = {};
for (const [k, v] of Object.entries(ELE_ZH)) ELE_CODE[v] = "GCG_TAG_ELEMENT_" + k;

/* ---------- 图标系统（内联 SVG） ----------
   充能用「金色实心四芒星」而非闪电：闪电是雷元素的符号，火焰又是火元素的符号，
   二者放在充能费用上都会被误读成元素骰。四芒星不属于七元素，且用实心填充，
   与元素图标的形态形成区分——色觉差异之外还有形状差异。
   七元素图标来自 gi-data/element-icons.js（由 build-icons.mjs 从官方矢量 SVG 生成），
   生成时已把填充色归一为 currentColor，因此这里只按元素色着色即可。 */
export const ENERGY_ICON =
  '<svg class="ico i-en" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 1.5C13.4 7.2 16.8 10.6 22.5 12 16.8 13.4 13.4 16.8 12 22.5 10.6 16.8 7.2 13.4 1.5 12 7.2 10.6 10.6 7.2 12 1.5Z"/><circle class="core" cx="12" cy="12" r="1.5"/></svg>';

/* ---------- 动作图标（行内 SVG，currentColor 随上下文着色） ----------
   只覆盖最高频的动作语义：关闭 / 对比换位 / 加牌 / 收藏星标，以及页头图标按钮
   （主题三态 / 随机一卡 / 帮助 / 链接）；
   其余文字符号（▾ ‹ › −）与中文文案混排，保持原样不做全面替换。 */
const actionSvg = (d: string): string =>
  `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
export const ICON_X = actionSvg("M4.5 4.5l7 7M11.5 4.5l-7 7");
export const ICON_PLUS = actionSvg("M8 3.5v9M3.5 8h9");
export const ICON_SWAP = actionSvg("M3.5 5h9m0 0L10 2.5M12.5 5 10 7.5M12.5 11h-9m0 0L6 8.5M3.5 11 6 13.5");
export const ICON_STAR =
  `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1.6l2 4.05 4.47.65-3.24 3.15.77 4.45L8 11.78l-4 2.1.77-4.45L1.53 6.3 6 5.65z"/></svg>`;
/* 页头图标按钮与详情动作行的语义图标 */
export const ICON_REFRESH = actionSvg("M13 8a5 5 0 1 1-1.46-3.54M13 2.5V5h-2.5");
/* 骰子：圆角方块内五点（随机一卡） */
export const ICON_RANDOM =
  `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="5.6" cy="5.6" r="1.05" fill="currentColor"/><circle cx="10.4" cy="5.6" r="1.05" fill="currentColor"/><circle cx="8" cy="8" r="1.05" fill="currentColor"/><circle cx="5.6" cy="10.4" r="1.05" fill="currentColor"/><circle cx="10.4" cy="10.4" r="1.05" fill="currentColor"/></svg>`;
export const ICON_HELP = actionSvg("M6 6a2 2 0 1 1 2.6 1.9c-.6.2-.6.8-.6 1.3v.3M8 12.2v.2M2.5 8a5.5 5.5 0 1 0 11 0 5.5 5.5 0 0 0-11 0Z");
export const ICON_LINK = actionSvg("M6.5 9.5l3-3M7 5.5 8.6 3.9a2.4 2.4 0 0 1 3.4 3.4L10.4 8.9M9 10.5 7.4 12.1a2.4 2.4 0 0 1-3.4-3.4L5.6 7.1");
export const ICON_SUN =
  `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.2v1.8M8 13v1.8M1.2 8H3M13 8h1.8M3.2 3.2l1.3 1.3M11.5 11.5l1.3 1.3M12.8 3.2l-1.3 1.3M4.5 11.5l-1.3 1.3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
export const ICON_MOON =
  `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.2 9.8A5.5 5.5 0 0 1 6.2 2.8a5.5 5.5 0 1 0 7 7Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
export const ICON_AUTO =
  `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 2.5v11A5.5 5.5 0 0 0 8 2.5Z" fill="currentColor" stroke="none"/></svg>`;

/* 七元素图标由 build-icons.mjs 从官方矢量 SVG 生成，以 ESM 常量导出。 */
import { ELEMENT_ICONS_SVG } from "../../gi-data/element-icons.js";

const ELE_ICON_SVG: Record<string, string> = ELEMENT_ICONS_SVG || {};

export const ELE_ICONS: Record<string, string> = {};
for (const k of Object.keys(ELE_ZH)) {
  const svg = ELE_ICON_SVG[k];
  if (svg) ELE_ICONS[k] = svg;
}

export const eleIcon = (el: string, cls = ""): string =>
  ELE_ICONS[el]
    ? `<span class="eico ${cls}" style="--ec:${ELE_COLOR[el] || "var(--gold)"}">${ELE_ICONS[el]}</span>`
    : "";

export const enPips = (n: number): string =>
  n > 0
    ? `<span class="enpips" title="充能 ${n}" aria-label="充能 ${n}">${ENERGY_ICON.repeat(n)}</span>`
    : "";

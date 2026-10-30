/* 数据模型：分类与身份的唯一定义处。
 *
 * ========== 为什么单独抽一层 ==========
 * 数据源里一条记录的「类型」是一个原始枚举（GCG_CARD_*），而界面要回答的是三个
 * 不同问题：它是什么牌？能不能进牌组？它是一个独立身份还是别的东西的影子？
 * 以前这三个问题分散在 TYPE_ZH 表、各视图的 if 判断、以及概念索引里的
 * mirrorCard / descMirrors / entityByKey 等多处启发式里，同一张牌在卡库、检索、
 * 概念页可能得到不同结论——这是数轮"打补丁"的共同根源。
 *
 * 现在把判断收敛成一条链（每个消费者都只读这一层）：
 *   原始 type + tags ──► typeSpecOf() ──► { zh, domain, deckable, scope }
 * 并且明确两个"影子"关系（由数据形态判定一次，不做逐处猜测）：
 *   · 准备状态影子：GCG_CARD_STATE 且描述为「本角色将在下次行动时，直接使用技能：同名」
 *     ——它只是"某技能正在准备中"的标记，名字与技能重名。它不该独占这个名字，
 *     否则卡文里的「准备技能：踏潮」会跳到状态牌而不是技能本身（此前的实际故障）。
 *   · 牌面文本镜像：关键词表里把某张牌的牌面文本原样再存一份（descMirrors 判定），
 *     它不是独立概念，只是同一张牌的另一种存放位置。
 *
 * ========== 三个域 ==========
 *   card  —— 可进入牌组的牌（装备 / 支援（含场地、伙伴、道具）/ 事件）
 *   char  —— 角色牌
 *   field —— 对局中生成或附着的实体（角色状态 / 队伍状态 / 召唤物 / 附加状态），
 *            永远不可加入牌组，卡库里标注为「实体」
 *   term  —— 规则术语（关键词表）
 *   skill —— 角色与装备牌的技能（见 data/skills.ts） */

import type { Domain } from "../types";
import type { RawEntity } from "./state";
import { state } from "./state";
import { esc } from "../core/dom";
import { imgFull } from "../core/resources";

export interface TypeSpec {
  zh: string;
  domain: Domain;
  deckable: boolean;
  scope: string;
}

/* 原始类型 → 语义。zh 是基础译名；带子类型的（支援牌的场地）由 typeZhOf 叠加。 */
export const TYPE_SPEC: Record<string, TypeSpec> = {
  GCG_CARD_CHARACTER: { zh: "角色牌", domain: "char", deckable: true, scope: "char" },
  GCG_CARD_MODIFY: { zh: "装备牌", domain: "card", deckable: true, scope: "deck" },
  GCG_CARD_ASSIST: { zh: "支援牌", domain: "card", deckable: true, scope: "deck" },
  GCG_CARD_SUPPORT: { zh: "支援牌", domain: "card", deckable: true, scope: "deck" },
  GCG_CARD_EVENT: { zh: "事件牌", domain: "card", deckable: true, scope: "deck" },
  /* 对局实体：ONSTAGE 是作用于整支队伍的状态（结晶、激化领域、护盾…），
     以前译成「场地牌」——既与支援牌里的场地子类撞名，也让玩家以为它能进牌组。 */
  GCG_CARD_ONSTAGE: { zh: "队伍状态", domain: "field", deckable: false, scope: "team" },
  GCG_CARD_STATE: { zh: "状态牌", domain: "field", deckable: false, scope: "char" },
  GCG_CARD_SUMMON: { zh: "召唤物", domain: "field", deckable: false, scope: "field" },
  GCG_CARD_ATTACHMENT: { zh: "附加状态", domain: "field", deckable: false, scope: "char" },
};

export const DOMAIN_ZH: Record<string, string> = {
  char: "角色", card: "卡牌", field: "对局实体", term: "术语", skill: "技能",
};

/* 原始类型 → 基础译名（兼容老代码里的 TYPE_ZH[e.type] 查表；值由 TYPE_SPEC 派生，
   不再有第二份字面量，避免两处标签各改一半） */
export const TYPE_ZH: Record<string, string> = Object.fromEntries(
  Object.entries(TYPE_SPEC).map(([k, v]) => [k, v.zh]),
);

/* 卡库的固定顺序：先可构筑的牌，再对局实体 */
export const TYPE_ORDER = [
  "GCG_CARD_CHARACTER", "GCG_CARD_MODIFY", "GCG_CARD_ASSIST", "GCG_CARD_EVENT",
  "GCG_CARD_ONSTAGE", "GCG_CARD_STATE", "GCG_CARD_SUMMON", "GCG_CARD_ATTACHMENT",
];

export const typeSpecOf = (e: { type?: string } | null | undefined): TypeSpec =>
  TYPE_SPEC[(e && e.type) || ""] ||
  { zh: (e && e.type) || "未知", domain: "field", deckable: false, scope: "field" };

/* 展示用译名：支援牌里的「场地」是子类（场地/伙伴/道具同属支援牌），
   类型标签只写基础类型，子类由 tag 胶囊单独标出，避免两个筛选维度都说"场地"。 */
export const typeZhOf = (e: { type?: string } | null | undefined): string =>
  e ? typeSpecOf(e).zh : "";

/* 能否加入牌组：以 shareId 为准（有分享码 id 才是可构筑的实体）。
   历史版本变体没有 shareId，但对局实体也没有——两者靠 domain 区分。 */
export const isDeckable = (e: { shareId?: number | null } | null | undefined): boolean =>
  !!e && e.shareId != null;
export const isFieldEntity = (e: { type?: string } | null | undefined): boolean =>
  typeSpecOf(e).domain === "field";
export const domainOfEntity = (e: { type?: string } | null | undefined): Domain =>
  typeSpecOf(e).domain;

/* ---------- 名字归一化（全应用唯一实现） ----------
   宽（nameKey）：抹平引号、感叹号、加号与空白，用于"同一张牌的另一种写法"；
   严（cosmeticKey）：只抹平引号与空白，用于"只差一对书名号"的身份对接。
   注意不合并「元素附魔：冰 / 火」这类实质不同的变种。 */
export const nameKey = (s: unknown): string =>
  String(s || "").normalize("NFKC").toLowerCase().replace(/[「」『』“”"'！!＋+\s]/g, "");
export const cosmeticKey = (s: unknown): string =>
  String(s || "").normalize("NFKC").toLowerCase().replace(/[「」『』“”"'\s]/g, "");

/* ---------- 准备状态影子 ----------
   数据里每个"需准备"的技能都有一个同名的 GCG_CARD_STATE，描述固定为
   「本角色将在下次行动时，直接使用技能：X」。它是技能的运行时标记，不是一张
   可以独立解释的牌。把它排除在概念索引之外，名字归技能所有；
   技能页里仍以「准备中状态」chip 保留通往该实体的入口。 */
export const shadowStateIds = new Set<number>();
export const shadowStateBySkill = new Map<string, { stateId: number; stateName: string }>();
export const PREPARED_STATE_RE = /直接使用技能[：:]\s*([^\s，。；、）)」]+)/;

export function buildShadowStates(): void {
  shadowStateIds.clear();
  shadowStateBySkill.clear();
  for (const e of state.ENT) {
    if (e.type !== "GCG_CARD_STATE") continue;
    const m = PREPARED_STATE_RE.exec(e.description || "");
    if (!m) continue;
    const skillName = m[1] as string;
    if (nameKey(skillName) !== nameKey(e.name)) continue;
    shadowStateIds.add(e.id);
    const k = nameKey(e.name);
    if (!shadowStateBySkill.has(k)) {
      shadowStateBySkill.set(k, { stateId: e.id, stateName: e.name });
    }
  }
}

export const isShadowState = (e: { id?: number } | null | undefined): boolean =>
  !!e && e.id != null && shadowStateIds.has(e.id);

/* ---------- 卡面图 ----------
   卡面图接口 /image/<id> 对任何存在的实体都返回图片，但"无牌面"的实体（状态牌、
   队伍状态、召唤物、附加状态在数据源里 cardFace 为 null）拿到的是 100×100 /
   128×128 的对局状态图标，不是能当卡牌看的牌面。

   所以这里分三层：
   1) 有 cardFace：真牌面，420×720；
   2) 无 cardFace 但有状态图标：输出同比例（420×720）的「卡壳」，图标叠在壳中央、
      盖住壳的纹理；壳自己用类型色、顶部色条、内嵌虚线框与底部类型字标明这属于对局
      实体、不是卡牌，因此不会和真牌面混淆；
   3) 连图标都没有（数据源缺图）：只剩卡壳 + ◈。
   比例与真牌面完全一致，网格列宽与行高都不会因为这格没有图而错位。 */
export const hasCardFace = (e: { cardFace?: string | null } | null | undefined): boolean =>
  !!(e && e.cardFace);

export const NO_ART_TYPE_ZH: Record<string, string> = { field: "对局实体" };

/* 卡面统一 420×720（实测数据源全部如此）：把宽高写进属性，浏览器据此在图片
   到达前就预留出正确高度——否则每张图加载完成都会把下方内容顶下去，滚动时页面
   一直在跳，长列表尤其明显。 */
export const CARD_ART_W = 420;
export const CARD_ART_H = 720;

/* 已知数据源缺图（实测 /image/<id> 返回 404，2026-10 按 v4.7 数据全量核对）：
   113135 纵阵武力统筹、116074 飞云旗阵、303215 愚人众伏兵、303246 破碎之海。
   名单只是"省掉一次必然失败的请求"，不是正确性依赖：漏掉的 id 走 onerror，
   同样会退化成只剩卡壳。补图后删掉对应 id 即可。 */
export const NO_ICON_IDS = new Set([113135, 116074, 303215, 303246]);

/* 对局实体的卡壳配色：按类型给一个色相，让"这不是卡牌"一眼可辨。 */
export const NO_ART_KIND: Record<string, string> = {
  GCG_CARD_STATE: "state",
  GCG_CARD_SUMMON: "summon",
  GCG_CARD_ONSTAGE: "team",
  GCG_CARD_ATTACHMENT: "attach",
};

export interface NoArtOptions {
  kind?: string;
  zh?: string;
  name?: string;
  type?: string;
  iconId?: number;
}

/* 无牌面卡壳。iconId 传 0 表示不尝试图标（数据缺失等）。 */
export function noArtHtml({ kind = "tile", zh = "", name = "", type = "", iconId = 0 }: NoArtOptions = {}): string {
  const k = NO_ART_KIND[type] || "other";
  const icon = iconId && !NO_ICON_IDS.has(iconId)
    ? `<span class="noart-disc"><img class="noart-icon" src="${imgFull(iconId)}" width="128" height="128" loading="lazy" decoding="async" alt="" onload="artIconReady(this)" onerror="artIconFail(this)"></span>`
    : "";
  return `<div class="noart noart-${kind}" data-kind="${k}" role="img" aria-label="${esc(name)}（${esc(zh)}，对局实体，无牌面）">
      <i class="noart-rib" aria-hidden="true"></i><span class="noart-mark" aria-hidden="true">◈</span>${icon}<span class="noart-kind">${esc(zh)}</span></div>`;
}

export interface CardArtOptions {
  kind?: string;
  alt?: string;
  cls?: string;
}

export function cardArtHtml(id: number, { kind = "tile", alt = "", cls = "" }: CardArtOptions = {}): string {
  const e = state.entById.get(id) || state.charById.get(id);
  if (e && hasCardFace(e)) {
    return `<img${cls ? ` class="${cls}"` : ""} src="${imgFull(id)}" width="${CARD_ART_W}" height="${CARD_ART_H}" loading="lazy" decoding="async" alt="${esc(alt)}" onerror="artFallback(this)">`;
  }
  return noArtHtml({
    kind,
    zh: e ? typeZhOf(e) : "数据缺失",
    name: e ? e.name : "#" + id,
    type: e ? e.type : "",
    iconId: e ? id : 0,
  });
}

/* 状态图标就位：淡入图标、让出 ◈。图片在 innerHTML 插入后才开始加载，
   所以这里的 this 一定已经在树上。 */
export function artIconReady(img: HTMLImageElement | null): void {
  const box = img && img.closest ? img.closest(".noart") : null;
  if (!box) return;
  box.classList.add("hasicon");
}

/* 状态图标缺失（404 / 离线）：撤掉图片，回到只有卡壳 + ◈ 的形态，不留破图。 */
export function artIconFail(img: HTMLImageElement | null): void {
  const box = img && img.closest ? img.closest(".noart") : null;
  if (box) box.classList.remove("hasicon");
  if (img && img.parentNode) img.parentNode.removeChild(img);
}

/* 图片 404 兜底（离线或缺图）：就地换成卡壳，不留破图。
   注意与"本来就无牌面"区分：这里的文案是"未加载"，不是"没有"。 */
export function artFallback(img: HTMLImageElement | null): void {
  if (!img || !img.parentNode) return;
  const box = img.closest ? (img.closest(".imgbox") || img.closest(".dimg")) : img.parentNode;
  if (!box || box.querySelector(".noart")) return;
  const div = document.createElement("div");
  div.className = "noart noart-fallback";
  div.setAttribute("data-kind", "other");
  div.title = "卡面需要联网加载";
  div.innerHTML = `<i class="noart-rib" aria-hidden="true"></i><span class="noart-mark" aria-hidden="true">◈</span><span class="noart-kind">卡面未加载</span>`;
  if (img.replaceWith) img.replaceWith(div);
  else if (img.parentNode) { img.parentNode.removeChild(img); (box as HTMLElement).appendChild(div); }
}

/** 原始记录是否属于卡池类型（供 pool 判定复用）。 */
export const isKnownType = (e: { type?: string } | null | undefined): boolean =>
  !!e && !!e.type && e.type in TYPE_SPEC;

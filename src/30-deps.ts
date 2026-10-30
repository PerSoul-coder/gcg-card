/* 30-deps.ts —— 牌间依赖的渲染与校验。
 *
 * 依赖分两类，判定在构建期完成（scripts/build-dataset.mjs 的 5.5，结果写在 record.reqs）：
 *   · 牌组限制 deckChar / deckEl / deckTag —— 加入牌组前必须满足；
 *   · 打出限制 legend / talent / weapon / once —— 对局中生效。
 * 这里只剩三件事：把结构化数据渲染成费用图标与徽标、按当前牌组校验门槛、说明缺口。
 * 判定规则本身不在这里——它只有一份，在构建期。 */

import { recordOfId, charRecords } from "./data/records";
import type { CostEntry, DeckReq, ReqBadge } from "./types";
import { ELE_COLOR, COST_ZH, ELE_CODE, ENERGY_ICON } from "./core/resources";
import { esc } from "./core/dom";

/* ---------- 费用渲染 ---------- */
function costHtml(playCost: CostEntry[] | undefined): string {
  if (!playCost || !playCost.length) return "";
  return `<span class="cost">` + playCost.map(pc => {
    const t = (pc.type || "").replace("GCG_COST_DICE_", "").replace("GCG_COST_", "");
    const zh = COST_ZH[t] || t;
    const col = ELE_COLOR[t] || (t === "VOID" ? "#8b93a1" : t === "ENERGY" ? "#d3bc8e" : t === "LEGEND" ? "#c8a24b" : "#8b93a1");
    const bg = t === "ENERGY" ? "linear-gradient(180deg,#f2ddb0,#b99a5f)" : col;
    const label = t === "ENERGY" ? `${ENERGY_ICON}<b>${pc.count}</b>` : pc.count;
    return `<span class="die${t === "ENERGY" ? " en" : ""}" style="background:${bg}" title="${esc(zh)}×${pc.count}">${label}</span>`;
  }).join("") + `</span>`;
}
function costText(pc: CostEntry[] | undefined): string {
  if (!pc || !pc.length) return "";
  return pc.map(p => {
    const t = (p.type || "").replace("GCG_COST_DICE_", "").replace("GCG_COST_", "");
    const zh = COST_ZH[t] || t;
    return t === "ENERGY" ? `充能×${p.count}` : `${zh}×${p.count}`;
  }).join(" ");
}
/** 元素骰点数（不含充能、也不含秘传费用——秘传占的是牌组的秘传位，不是骰子）。 */
const diceCost = (pc: CostEntry[] | undefined): number =>
  (pc || []).filter(p => p.type !== "GCG_COST_ENERGY" && p.type !== "GCG_COST_LEGEND")
    .reduce((a, p) => a + (Number(p.count) || 0), 0);
const energyCost = (pc: CostEntry[] | undefined): number =>
  (pc || []).filter(p => p.type === "GCG_COST_ENERGY").reduce((a, p) => a + (Number(p.count) || 0), 0);

/* 限制条目对应的元素键（仅 deckEl 有效），供列表 / 详情 / 面板统一渲染图标 */
function reqElement(r: ReqBadge | null | undefined): string {
  if (!r || r.code !== "deckEl") return "";
  const d = r as DeckReq;
  if (d.tag) return d.tag.replace("GCG_TAG_ELEMENT_", "");
  return (ELE_CODE[d.name || ""] || "").replace("GCG_TAG_ELEMENT_", "");
}

/* 校验：给定牌组的角色 id 列表，是否满足该条牌组限制。
   deckChar 按角色名匹配（同名多版本——可构筑版与 66xx 变体——视为同一角色）；
   角色不在角色库中（新卡暂无数据）时无法校验，放行——避免误拦。 */
function deckReqMet(req: DeckReq, chars: number[]): boolean {
  if (req.code === "deckChar") {
    const want = req.name || recordOfId(req.charId)?.name || "";
    /* 角色不在角色库里（新卡暂无角色数据）→ 无法校验，放行，避免误拦 */
    if (!want || !charRecords().some(c => c.name === want)) return true;
    return chars.some(id => id === req.charId || recordOfId(id)?.name === want);
  }
  if (req.code === "deckEl" || req.code === "deckTag") {
    const n = req.n || 2;
    let hit = 0;
    for (const id of chars) {
      const r = recordOfId(id);
      if (r && r.stats.tagsRaw.includes(req.tag || "")) hit++;
    }
    return hit >= n;
  }
  return true;
}
/* 缺口说明：为什么这条限制当前不满足（toast / 校验面板共用） */
function reqGapText(req: DeckReq, chars: number[]): string {
  if (req.code === "deckChar")
    return `需要牌组中包含角色「${req.name}」（当前未包含）`;
  if (req.code === "deckEl" || req.code === "deckTag") {
    let hit = 0;
    for (const id of chars) {
      const r = recordOfId(id);
      if (r && r.stats.tagsRaw.includes(req.tag || "")) hit++;
    }
    const what = req.code === "deckEl" ? `${req.name}元素` : `「${req.name}」`;
    return `需要牌组中包含至少 ${req.n || 2} 名${what}角色（当前 ${hit}）`;
  }
  return "";
}

/* 全部依赖（牌组限制在前，打出限制在后）——徽标 / 列表 / 导出统一渲染入口 */
const allReqs = (x: { deckReqs?: ReqBadge[]; restrictions?: ReqBadge[] }): ReqBadge[] =>
  [...(x.deckReqs || []), ...(x.restrictions || [])];

/* 徽标取色：牌组限制金/紫（构筑门槛），打出限制沿用既有色；
   deckEl 按元素取色（2×冰 徽标即冰蓝），一眼对上共鸣牌元素 */
const R_STYLE: Record<string, string> = {
  legend: "var(--gold)", talent: "var(--electro)", weapon: "var(--hydro)", once: "#e07a7a",
  deckChar: "#e0c068", deckTag: "#b48ce0",
};
const R_ZH: Record<string, string> = {
  legend: "秘传", talent: "天赋·须在场", weapon: "武器限定", once: "限打张数",
  deckChar: "牌组·角色", deckEl: "牌组·元素", deckTag: "牌组·地区",
};
const depBadge = (r: ReqBadge): string => {
  const color = r.code === "deckEl" ? (ELE_COLOR[(r as DeckReq).name || ""] || "var(--gold)") : R_STYLE[r.code];
  return `<span class="rbadge" style="border-color:${color};color:${color}" title="${esc(r.label)}">${esc(r.short)}</span>`;
};
const depBadges = (reqs: ReqBadge[]): string => reqs.map(depBadge).join("");

export { diceCost, energyCost, costHtml, costText, reqElement, deckReqMet, reqGapText, allReqs, R_STYLE, R_ZH, depBadge, depBadges };

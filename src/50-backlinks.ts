/* src/50-backlinks.ts —— 反链索引与概念条目渲染。 */
import { DATASET, dsByKey, dsReady } from "./07-dataset";
import { costText } from "./30-deps";
import { esc } from "./core/dom";
import { cardArtHtml } from "./data/model";
import { linkifyExcept } from "./40-concepts";
import type { GcgRecord, TermEntry } from "./types";

/* ---------- 反链索引：概念名 → 引用它的卡牌/角色 ----------
 * 出边（refs）在构建期算好，只来自可链接文本（卡牌效果 / 技能效果 / 规则说明），
 * 角色简介这类叙事文本不参与。运行时只把它翻转成「谁引用了我」。
 *
 * 以前是拿 termRe 重新扫一遍卡文：同一份文本要扫两次（一次建链接、一次建反链），
 * 而且扫描范围要跟链接范围手工保持一致，很容易漂移。 */
let backlinks = new Map<string, Set<number>>();

/** 清空反链索引（供「刷新数据」使用）。 */
export function resetBacklinks(): void {
  backlinks = new Map();
}

function buildBacklinks(): void {
  backlinks.clear();
  if (!dsReady() || !DATASET) return;
  /* 引用者归到卡牌 / 角色 id（技能归其所属），反链面板按 id 跳详情 */
  const srcIdOf = (r: GcgRecord): number | null => {
    if (r.kind === "char" || r.kind === "card") {
      const n = Number(String(r.key).split(":")[1]);
      return Number.isFinite(n) ? n : null;
    }
    if (r.kind === "skill" && r.rel.ownerKey) {
      const n = Number(String(r.rel.ownerKey).split(":")[1]);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };
  for (const r of DATASET.records) {
    if (!r.refs || !r.refs.length) continue;
    const srcId = srcIdOf(r);
    if (srcId == null) continue;
    for (const tk of r.refs) {
      const t = dsByKey(tk);
      if (!t || !t.name) continue;
      let b = backlinks.get(t.name);
      if (!b) backlinks.set(t.name, b = new Set());
      b.add(srcId);
    }
  }
}
const KIND_ZH: Record<string, string> = { card: "卡牌", char: "角色", skill: "技能", keyword: "术语", rule: "规则", "rule-term": "规则术语", status: "状态效果", summon: "召唤物", enemy: "敌方牌", attachment: "附加状态", cardref: "卡牌", charref: "角色" };
function termBodyHtml(info: TermEntry, big: boolean, showKind: boolean, hideName?: string | null): string {
  const kindLabel = KIND_ZH[info.kind] || info.kind;
  /* 统一牌面：卡牌/角色/技能都用同一个组件（同比例、同占位、同降级），
     不再各界面自己拼 <img> 或只显示 78px 小图。 */
  const artId = info.artId != null ? info.artId
    : (info.id != null && (info.kind === "card" || info.kind === "char") ? info.id : null);
  const art = artId != null
    ? `<div class="term-art" style="width:${big ? 110 : 78}px">${cardArtHtml(artId, { kind: "thumb", alt: info.name || "" })}</div>`
    : "";
  const skillMeta = info.kind === "skill"
    ? [info.owner ? `所属：${info.owner}` : "", info.type || "", info.prepared ? `需准备 ${info.prepareTurns || 1} 轮` : ""].filter(Boolean).join(" · ")
    : "";
  const meta = skillMeta ? skillMeta
    : info.kind === "card" ? `${info.type || ""}${Array.isArray(info.playCost) && info.playCost.length ? " · " + costText(info.playCost) : ""}`
    : info.kind === "char" ? `角色 · 生命 ${info.hp} · 充能 ${info.energy}`
    : info.kind === "cardref" ? (info.type || kindLabel)
    : kindLabel;
  /* meta 与种类徽标相同就不再重复一行：调用方（悬浮预览的 tip-kind、概念页的
     .tagpill）一定已经标了种类，正文再写一遍是纯噪音 */
  const metaLine = meta && meta !== kindLabel ? `<small>${esc(meta)}</small>` : "";
  /* 概念页的页头已经写了概念名，正文里再写一遍就是纯重复（尤其单条目时）；
     只在该条目名称与页头一致时省略，避免误删不同名的条目 */
  const nameLine = hideName && info.name === hideName ? "" : `<b>${esc(info.name)}</b>`;
  /* 概念页（big）里，带身份的条目给出直达入口：卡牌/角色 → 详情，技能 → 技能页 */
  const jump = big && info.kind === "skill" && info.key
    ? `<button class="blchip term-jump" data-skill="${esc(info.key)}" title="打开「${esc(info.name)}」技能页">查看技能</button>`
    : big && info.id != null && (info.kind === "card" || info.kind === "char")
    ? `<button class="blchip term-jump" data-goto="${info.id}" title="打开「${esc(info.name)}」详情">查看详情</button>` : "";
  return `<div class="term-body${showKind ? " term-body-multi" : ""}">${art}<div>
    ${showKind ? `<small class="term-kind">${kindLabel}</small>` : ""}
    ${nameLine}${metaLine}
    <p>${linkifyExcept(esc(info.desc || "（暂无描述）"), info.name)}</p>${jump}</div></div>`;
}
/* 一个概念名可能匹配多个不同种类的条目（如"护盾"：状态牌 + 关键词）——
   悬浮提示与概念页中从上到下并列展示，每个条目带种类标识 */
function termHtml(entries: TermEntry | TermEntry[], big = false, hideName: string | null = null): string {
  const list = Array.isArray(entries) ? entries : [entries];
  return list.map(info => termBodyHtml(info, big, list.length > 1, hideName)).join("");
}

export { backlinks, buildBacklinks, KIND_ZH, termBodyHtml, termHtml };

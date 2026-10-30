/* src/50-backlinks.js —— 由 scripts/_convert.mjs 从旧脚本转换（迁移中间态）。 */
import { DATASET, dsByKey, dsReady } from "./07-dataset";
import { termRe } from "./40-concepts";
import { POOL_TYPE_ORDER } from "./45-pool";
import { state } from "./data/state";
import { esc } from "./core/dom";
import { cardArtHtml } from "./data/model";
import { costText } from "./30-deps";
import { linkifyExcept } from "./40-concepts";
import { pool } from "./45-pool";
import { tip } from "./90-detail";

/* ---------- 反链索引：概念名 → 引用它的卡牌/角色 ----------
   卡文与技能文本里出现的其他卡牌、术语，反向收集为"被引用"清单，
   详情页可顺藤摸瓜。扫描复用 termRe（与链接高亮同一套词表，不重复造轮子）。 */
let backlinks = new Map();

/** 清空反链索引（供「刷新数据」使用）。 */
export function resetBacklinks(): void {
  backlinks = new Map();
}
function buildBacklinks() {
  backlinks.clear();
  /* 统一数据集：出边在构建期算好，只来自可链接文本（卡牌效果 / 技能效果 / 规则），
     角色简介不参与；引用者归到卡牌 / 角色 id（技能归其所属）。 */
  if (typeof dsReady === "function" && dsReady() && DATASET && DATASET.records) {
    for (const r of DATASET.records) {
      if (!r.refs || !r.refs.length) continue;
      let srcId = null;
      if (r.kind === "char" || r.kind === "card") srcId = Number(String(r.key).split(":")[1]);
      else if (r.kind === "skill" && r.rel && r.rel.ownerKind === "char")
        srcId = Number(String(r.rel.ownerKey).slice(5));
      else if (r.kind === "skill" && r.rel && r.rel.ownerKind === "card")
        srcId = Number(String(r.rel.ownerKey).slice(5));
      if (srcId == null) continue;
      for (const tk of r.refs) {
        const t = dsByKey(tk);
        if (!t || !t.name) continue;
        let b = backlinks.get(t.name);
        if (!b) backlinks.set(t.name, b = new Set());
        b.add(srcId);
      }
    }
    return;
  }
  if (!termRe) return;
  const scan = (text, id) => {
    if (!text) return;
    text.replace(termRe, m => {
      let b = backlinks.get(m);
      if (!b) backlinks.set(m, b = new Set());
      b.add(id);
      return m;
    });
  };
  for (const e of state.ENT) if (POOL_TYPE_ORDER.includes(e.type)) scan(e.description, e.id);
  /* 角色简介是叙事文本，不作为概念引用来源（只在技能效果里收集） */
  for (const c of state.CHAR) for (const s of c.skills || []) scan(s.description || s.rawDescription, c.id);
}
const KIND_ZH = { card: "卡牌", char: "角色", skill: "技能", keyword: "术语", rule: "规则", "rule-term": "规则术语", status: "状态效果", summon: "召唤物", enemy: "敌方牌", cardref: "卡牌", charref: "角色" };
function termBodyHtml(info, big, showKind, hideName) {
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
    : info.kind === "card" ? `${info.type || ""}${info.playCost?.length ? " · " + costText(info.playCost) : ""}`
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
function termHtml(entries, big = false, hideName = false) {
  const list = Array.isArray(entries) ? entries : [entries];
  return list.map(info => termBodyHtml(info, big, list.length > 1, hideName)).join("");
}

export { backlinks, buildBacklinks, KIND_ZH, termBodyHtml, termHtml };

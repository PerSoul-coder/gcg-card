/* src/47-skills.js —— 由 scripts/_convert.mjs 从旧脚本转换（迁移中间态）。 */
import { dsReady, dsSkills } from "./07-dataset";
import { $ } from "./core/dom";
import { costHtml, costText } from "./30-deps";
import { overlayBack, overlayOpen, renderOverlay, topView } from "./90-detail";
import { state } from "./data/state";
import type { SkillEntry } from "./types";
import { tagZh } from "./core/resources";
import { esc } from "./core/dom";
import { nameKey, shadowStateBySkill, cardArtHtml } from "./data/model";
import { linkify } from "./40-concepts";
import { backlinkHtml, navBar } from "./90-detail";

const SKILL_TAG_ZH = {
  GCG_SKILL_TAG_A: "普通攻击",
  GCG_SKILL_TAG_E: "元素战技",
  GCG_SKILL_TAG_Q: "元素爆发",
  GCG_SKILL_TAG_PASSIVE: "被动技能",
  GCG_SKILL_TAG_NONE: "特殊技能",
};
const SKILL_TAG_ORDER = ["GCG_SKILL_TAG_A", "GCG_SKILL_TAG_E", "GCG_SKILL_TAG_Q", "GCG_SKILL_TAG_PASSIVE", "GCG_SKILL_TAG_NONE"];

let SKILLS: SkillEntry[] = [];
const skillByKey = new Map<string, SkillEntry>();   /* "角色id:技能id" → 技能 */
const skillByName = new Map<string, SkillEntry[]>(); /* 归一化名 → 技能[] */
const skillsOfOwner = new Map<string, SkillEntry[]>(); /* "char:id" / "card:id" → 技能[]（已排序、已去重） */

/** 清空技能索引（供「刷新数据」使用）。索引的全部内部结构留在本模块。 */
export function resetSkillIndex(): void {
  SKILLS = [];
  skillByKey.clear();
  skillByName.clear();
  skillsOfOwner.clear();
}

const PREPARE_TURNS_RE = /（需准备(\d+)个行动轮）/;
function skillDescOf(s) {
  return String((s.description || s.rawDescription || "")).trim();
}
/* 效果文本里去掉「（需准备 n 个行动轮）」这行——它是节奏说明，不是效果，
   提到徽标上更清楚，正文只留技能实际做了什么。 */
function skillEffectText(desc) {
  return String(desc || "").split("\n").filter(l => !PREPARE_TURNS_RE.test(l)).join("\n").trim();
}
/* 统一数据集路径：技能来源 = 角色技能 + 装备牌特技（构建期已归一、已去重）。
   装备牌的「特技：X」过去完全不在索引里，导致卡文里的 X 既搜不到也点不动。 */
function buildSkillIndexFromDataset() {
  const rows: SkillEntry[] = dsSkills().map(r => {
    const rel = r.rel || {};
    const ownerKey = rel.ownerKey || "";
    const ownerKind = rel.ownerKind || "char";
    return {
      kind: "skill", key: r.key,
      id: Number(String(r.key).split(":").pop()),
      ownerKey, ownerKind,
      ownerId: ownerKind === "char" ? Number(ownerKey.slice(5)) : null,
      ownerCardId: ownerKind === "card" ? Number(ownerKey.slice(5)) : null,
      ownerName: rel.ownerName || "",
      name: r.name, englishName: r.englishName || "",
      tag: r.typeRaw || "", tagZh: r.typeZh || "技能",
      cost: (r.stats && r.stats.cost) || [],
      desc: (r.desc && r.desc.effect) || "",
      effect: (r.desc && r.desc.effect) || "",
      hidden: !!r.hidden,
      prepared: !!r.prepared,
      prepareTurns: r.prepareTurns || 0,
      stateId: r.stateId == null ? null : r.stateId,
      altCount: r.altCount || 0,
      art: r.art || null,
      linkable: !!r.linkable,
    };
  });
  rows.sort((a, b) =>
    String(a.ownerKey).localeCompare(String(b.ownerKey)) ||
    SKILL_TAG_ORDER.indexOf(a.tag) - SKILL_TAG_ORDER.indexOf(b.tag));
  const byOwner = new Map();
  for (const s of rows) {
    SKILLS.push(s);
    skillByKey.set(s.key, s);
    const k = nameKey(s.name);
    if (!skillByName.has(k)) skillByName.set(k, []);
    skillByName.get(k)!.push(s);
    const list = byOwner.get(s.ownerKey) || [];
    list.push(s);
    byOwner.set(s.ownerKey, list);
  }
  for (const [k, list] of byOwner) skillsOfOwner.set(k, list);
}

function buildSkillIndex() {
  SKILLS = [];
  skillByKey.clear();
  skillByName.clear();
  skillsOfOwner.clear();
  if (typeof dsReady === "function" && dsReady()) { buildSkillIndexFromDataset(); return; }
  const seen = new Set();
  for (const c of state.CHAR) {
    const list: SkillEntry[] = [];
    for (const s of c.skills || []) {
      /* 没有 id 的技能无法构成稳定键（也无法与数据集路径对齐），直接跳过 */
      if (!s || typeof s.name !== "string" || !s.name || s.id == null) continue;
      const dedupeId = c.id + ":" + s.id;
      if (seen.has(dedupeId)) continue;      /* 数据里偶有完全重复的一条 */
      seen.add(dedupeId);
      const desc = skillDescOf(s);
      const altOf = list.find(x => x.name === s.name);
      if (altOf) {                            /* 同名阶段记录：只留描述更完整的一条 */
        altOf.altCount++;
        if (desc.length > altOf.desc.length) { altOf.desc = desc; altOf.id = s.id; altOf.key = c.id + ":" + s.id; }
        continue;
      }
      const shadow = shadowStateBySkill.get(nameKey(s.name));
      const turns = (PREPARE_TURNS_RE.exec(desc) || [])[1];
      list.push({
        kind: "skill",
        ownerKind: "char",   /* 旧数据源路径只处理角色技能；装备牌特技走数据集路径 */
        key: c.id + ":" + s.id,
        id: s.id,
        ownerId: c.id,
        ownerName: c.name,
        name: s.name,
        englishName: s.englishName || "",
        tag: s.type || "",
        tagZh: SKILL_TAG_ZH[s.type || ""] || "技能",
        cost: Array.isArray(s.playCost) ? s.playCost : [],
        desc,
        effect: skillEffectText(desc),
        hidden: !!s.hidden,
        prepared: !!turns || !!shadow,
        prepareTurns: turns ? Number(turns) : (shadow ? 1 : 0),
        stateId: shadow ? shadow.stateId : null,
        altCount: 0,
      });
    }
    /* 排序：普攻 → 战技 → 爆发 → 被动 → 特殊；同类型保持数据原顺序 */
    list.sort((a, b) => SKILL_TAG_ORDER.indexOf(a.tag) - SKILL_TAG_ORDER.indexOf(b.tag));
    if (list.length) skillsOfOwner.set("char:" + c.id, list);
    for (const s of list) {
      SKILLS.push(s);
      skillByKey.set(s.key, s);
      const k = nameKey(s.name);
      if (!skillByName.has(k)) skillByName.set(k, []);
      skillByName.get(k)!.push(s);
    }
  }
}
const skillsOf = charId => skillsOfOwner.get("char:" + charId) || [];
const skillsOfCard = cardId => skillsOfOwner.get("card:" + cardId) || [];
const skillOf = key => skillByKey.get(key) || null;
/* 技能名检索：同一名字可能属于多个角色（同名不同角色），按角色名建索引，全部返回 */
const skillsNamed = name => skillByName.get(nameKey(name)) || [];

/* 技能费用：元素骰 + 充能。数据里两者都在 playCost 里（GCG_COST_DICE_* / GCG_COST_ENERGY），
   所以直接复用卡牌的 costHtml，保证同一套骰子/充能图标语义。 */
function skillCostText(s) {
  const t = costText(s.cost);
  return t || "无费用";
}
/* 技能行（角色详情里的一行）：名字 + 类型徽标 + 准备徽标 + 费用 + 效果 */
function skillRowHtml(s) {
  const prep = s.prepared ? `<span class="sk-tag prep" title="需准备 ${s.prepareTurns || 1} 个行动轮后才能自动使用">准备 ${s.prepareTurns || 1} 轮</span>` : "";
  const passive = s.tag === "GCG_SKILL_TAG_PASSIVE" ? `<span class="sk-tag passive">被动</span>` : "";
  const hidden = s.hidden && !s.prepared && s.tag !== "GCG_SKILL_TAG_PASSIVE" ? `<span class="sk-tag muted" title="游戏内不显示为按钮，但效果真实存在">隐藏</span>` : "";
  const cost = costHtml(s.cost);
  return `<div class="skill" data-skill="${s.key}" title="查看技能详情">
      <div class="skhead"><b>${esc(s.name)}</b>${prep}${passive}${hidden}${cost ? `<span class="skcost">${cost}</span>` : ""}</div>
      <div class="skdesc">${linkify(esc(s.effect || "（该技能没有文字说明）"))}</div>
    </div>`;
}
function skillsHtml(charId) {
  const list = skillsOf(charId);
  if (!list.length) return "";
  return `<div class="skills">${list.map(skillRowHtml).join("")}</div>`;
}
/* 装备牌 / 载具赋予的特技：与角色技能同一套行渲染，卡牌详情里单独成段 */
function skillsHtmlCard(cardId) {
  const list = skillsOfCard(cardId);
  if (!list.length) return "";
  return `<div class="sk-sec">特技</div><div class="skills">${list.map(skillRowHtml).join("")}</div>`;
}

/* 技能页：与概念页同一套弹层外壳，但信息更全（费用 / 充能 / 准备 / 所属角色） */
function renderSkillView(v) {
  const s = skillOf(v.key);
  if (!s) { overlayBack(); return; }
  const cost = costHtml(s.cost);
  const prep = s.prepared
    ? `<span class="tagpill prep">需准备 ${s.prepareTurns || 1} 个行动轮</span>` : "";
  const ownerId = s.ownerId != null ? s.ownerId : s.ownerCardId;
  const ownerLabel = s.ownerKind === "card" ? "所属卡牌" : "所属角色";
  const owner = ownerId != null
    ? `<div class="drel"><b>${ownerLabel}</b><span class="blchips"><button class="blchip" data-goto="${ownerId}">${esc(s.ownerName)}</button></span></div>` : "";
  const state = s.stateId != null
    ? `<div class="drel"><b>准备中状态</b><span class="blchips"><button class="blchip" data-goto="${s.stateId}" title="查看该技能准备期间挂载的状态牌">准备中 · 状态牌</button></span></div>` : "";
  const alt = s.altCount ? `<div class="dnote">该技能在数据里有 ${s.altCount} 条同名阶段记录，此处显示描述最完整的一条。</div>` : "";
  /* 技能本身没有牌面，用所属角色/卡牌的牌面作为视觉锚点，保证与卡库/详情同一套呈现 */
  const art = s.art && s.art.ref != null
    ? `<div class="dimg">${cardArtHtml(s.art.ref, { kind: "detail", alt: s.name })}</div>` : "";
  $("detail").innerHTML = `${navBar()}
    ${art}<div class="dinfo"><h2>${esc(s.name)}</h2>
    <div class="meta"><span class="tagpill">${esc(s.tagZh)}</span>${prep}${cost ? `<span class="tagpill costpill">${cost}</span>` : ""}${s.hidden && !s.prepared && s.tag !== "GCG_SKILL_TAG_PASSIVE" ? `<span class="tagpill">隐藏技能</span>` : ""}</div>
    <div class="dtext">${linkify(esc(s.effect || "（该技能没有文字说明）"))}</div>
    ${alt}${owner}${state}${backlinkHtml(s.name)}</div>`;
}
function showSkill(key) {
  if (!skillOf(key)) return;
  if (!overlayOpen()) state.overlayStack = [];
  const top = topView();
  if (top && top.kind === "skill" && top.key === key) return;
  state.overlayStack.push({ kind: "skill", key });
  renderOverlay();
}

export { SKILL_TAG_ZH, SKILL_TAG_ORDER, SKILLS, skillByKey, skillByName, skillsOfOwner, PREPARE_TURNS_RE, skillDescOf, skillEffectText, buildSkillIndexFromDataset, buildSkillIndex, skillsOf, skillsOfCard, skillOf, skillsNamed, skillCostText, skillRowHtml, skillsHtml, skillsHtmlCard, renderSkillView, showSkill };

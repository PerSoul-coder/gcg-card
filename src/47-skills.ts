/* 47-skills.ts —— 技能索引：角色技能与装备牌特技的统一形状。 */
import { dsReady, dsSkills } from "./07-dataset";
import { cardRecords, keyIdOf } from "./data/records";
import { $ } from "./core/dom";
import { costHtml, costText } from "./30-deps";
import { overlayBack, overlayOpen, renderOverlay, topView } from "./90-detail";
import { overlayHashOf, overlayHashPush } from "./core/history";
import { pinyinOf } from "./70-search";
import { state } from "./data/state";
import type { SkillEntry } from "./types";
import { esc } from "./core/dom";
import { nameKey, cardArtHtml, SKILL_TAG_ZH, SKILL_TAG_ORDER } from "./data/model";
import { linkify } from "./40-concepts";
import { backlinkHtml, navBar } from "./90-detail";

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

/* 技能来源 = 角色技能 + 装备牌特技（构建期已归一、已去重、已剥离「需准备 n 个行动轮」这行）。
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
      ownerId: ownerKind === "char" ? keyIdOf(ownerKey) : null,
      ownerCardId: ownerKind === "card" ? keyIdOf(ownerKey) : null,
      ownerName: rel.ownerName || "",
      name: r.name, englishName: r.englishName || "",
      tag: r.typeRaw || "", tagZh: r.typeZh || "技能",
      cost: (r.stats && r.stats.cost) || [],
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
  resetSkillIndex();
  buildSkillIndexFromDataset();
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
/* 装备牌赋予的特技：与角色技能同一套行渲染，卡牌详情里单独成段 */
function skillsHtmlCard(cardId) {
  const list = skillsOfCard(cardId);
  if (!list.length) return "";
  return `<div class="sk-sec">特技</div><div class="skills">${list.map(skillRowHtml).join("")}</div>`;
}
/* 角色详情的「特技」段：该角色的装备牌所附特技，按所属卡分组。
   数据来源是构建期推导的 rel.relatedCharacterId（与天赋牌同一条关联链路）——
   玛拉妮的鲨鲨冲浪板、玛薇卡的驰轮车三件套因此与角色自带的隐藏技能呈现统一：
   角色详情永远同时看得到「角色技能」与「装备牌特技」两半。 */
function equipSkillsHtml(charId: number): string {
  const cards = (cardRecords().filter(r =>
    r.rel.relatedCharacterId === charId && skillsOfCard(keyIdOf(r.key)).length));
  if (!cards.length) return "";
  return cards.map(c => {
    const cid = keyIdOf(c.key);
    return `<div class="sk-sec">特技 · <button class="blchip" data-goto="${cid}" title="查看「${esc(c.name)}」详情">${esc(c.name)}</button></div>
      <div class="skills">${skillsOfCard(cid).map(skillRowHtml).join("")}</div>`;
  }).join("");
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
function showSkill(key, fromHistory = false) {
  if (!skillOf(key)) return;
  if (!overlayOpen()) state.overlayStack = [];
  const top = topView();
  if (top && top.kind === "skill" && top.key === key) return;
  state.overlayStack.push({ kind: "skill", key });
  const nt = topView();
  const h = overlayHashOf(nt);
  if (!fromHistory && h) { overlayHashPush(h); nt!.hpushed = true; }   /* 写入历史：后退键逐层回退 */
  renderOverlay();
}

/* ---------- 技能图鉴：全部技能（角色技能 + 装备牌特技）的检索式总览 ----------
   独立主页签（switchView("skills")），不再是弹层。按所属分组，类型 chips
   数据驱动（出现什么类型就列什么），检索覆盖 名字 / 拼音 / 所属 / 英文。
   数据只有一份（SKILLS），这里只做投影；行点击复用 data-skill 的既有委托
   （从图鉴点进技能页 = 弹层压空栈打开，照常写 #s= 历史，可分享）。 */
export const skillIdxState: { tag: string; q: string } = { tag: "", q: "" };

export function skillIdxMatches(): SkillEntry[] {
  const q = skillIdxState.q.trim();
  const lq = q.toLowerCase().replace(/\s+/g, "");
  const nq = nameKey(q);
  const tag = skillIdxState.tag;
  const latin = /^[a-z]+$/.test(lq);
  const hitPy = (name: string): boolean => {
    const py = pinyinOf(name);
    return !!py && !!lq && latin && (py.full.includes(lq) || py.initials.includes(lq));
  };
  return SKILLS.filter(s => {
    if (tag === "hidden" ? !s.hidden : !!tag && s.tag !== tag) return false;
    if (!q) return true;
    if (nameKey(s.name).includes(nq) || s.ownerName.includes(q)) return true;
    if (String(s.englishName || "").toLowerCase().includes(lq)) return true;
    return hitPy(s.name) || hitPy(s.ownerName);
  });
}
/* 检索结果按所属分组（SKILLS 本就按 ownerKey 排序，分组保持数据序） */
function skillIdxGroups(): Array<{ key: string; name: string; id: number; rows: SkillEntry[] }> {
  const byOwner = new Map<string, SkillEntry[]>();
  for (const s of skillIdxMatches()) {
    const k = s.ownerKey || "";
    if (!byOwner.has(k)) byOwner.set(k, []);
    byOwner.get(k)!.push(s);
  }
  return [...byOwner.entries()].map(([key, rows]) => ({
    key,
    name: rows[0].ownerName || "未知",
    id: (rows[0].ownerId != null ? rows[0].ownerId : rows[0].ownerCardId) as number,
    rows,
  }));
}
function skillIdxGroupHtml(g: { key: string; name: string; id: number; rows: SkillEntry[] }): string {
  /* 组头用所属牌面做视觉锚点（与技能页同一语义），行复用 skillRowHtml */
  const art = g.id != null ? cardArtHtml(g.id, { kind: "tile", alt: g.name }) : "";
  return `<div class="skidx-group">
    <div class="skidx-head"><span class="skidx-art">${art}</span>
      <button class="blchip" data-goto="${g.id}" title="查看「${esc(g.name)}」详情">${esc(g.name)}</button>
      <small>${g.rows.length} 项</small></div>
    <div class="skills">${g.rows.map(skillRowHtml).join("")}</div></div>`;
}
/* 分块挂载：600+ 行不能一次进 DOM。每批 8 个分组，滚动接近底部再长。 */
const SKIDX_CHUNK = 8;
let skidxGroups: ReturnType<typeof skillIdxGroups> = [];
let skidxMounted = 0;
let skidxIO: { disconnect?: () => void } | null = null;
function skidxGrow(): void {
  const list = $("skillIdxList");
  if (!list || !list.insertAdjacentHTML) return;
  const to = Math.min(skidxMounted + SKIDX_CHUNK, skidxGroups.length);
  let html = "";
  for (let i = skidxMounted; i < to; i++) html += skillIdxGroupHtml(skidxGroups[i]);
  skidxMounted = to;
  if (html) list.insertAdjacentHTML("beforeend", html);
}
/* 分块挂载的哨兵观察器。图鉴是静态视图：滚动根是视口本身（root=null +
   rootMargin 600px，哨兵接近视口即增长）。检索重挂会整体重建结果区，IO 必须
   跟着重挂重建——收敛成「确保存在」：需要分块而 IO 不在就重建。 */
function ensureSkidxIO(): void {
  if (typeof IntersectionObserver !== "function" || skidxIO) return;
  const io = new IntersectionObserver(() => {
    if (skidxMounted >= skidxGroups.length) {
      io.disconnect();
      if (skidxIO === io) skidxIO = null;   /* 自断后清引用，下次重挂才能重建 */
      return;
    }
    skidxGrow();
  }, { rootMargin: "600px" });
  io.observe($("skillIdxSentinel"));
  skidxIO = io;
}
function skidxRefresh(): void {
  /* 检索输入时只重挂结果区（不整视图重建——输入框焦点会丢） */
  skidxGroups = skillIdxGroups();
  skidxMounted = 0;
  const list = $("skillIdxList");
  if (list) list.innerHTML = "";
  skidxGrow();
  if (skidxMounted < skidxGroups.length) {
    if (typeof IntersectionObserver === "function") ensureSkidxIO();
    else while (skidxMounted < skidxGroups.length) skidxGrow();   /* 无 IO 环境：一次挂完，不留死列表 */
  } else {
    skidxIO?.disconnect?.();
    skidxIO = null;
  }
  const cnt = $("skillIdxCount");
  if (cnt) cnt.textContent = String(skidxGroups.reduce((s, g) => s + g.rows.length, 0));
}
function renderSkillsView(): void {
  const matches = skillIdxMatches();
  /* 类型 chips 数据驱动：技能里出现什么类型就列什么（特技/被动/隐藏…） */
  const tags: Array<{ tag: string; zh: string; n: number }> = [];
  const seen = new Map<string, number>();
  for (const s of SKILLS) {
    seen.set(s.tag, (seen.get(s.tag) || 0) + 1);
  }
  for (const t of SKILL_TAG_ORDER) if (seen.has(t)) tags.push({ tag: t, zh: SKILL_TAG_ZH[t] || t, n: seen.get(t)! });
  for (const [t, n] of seen) if (!SKILL_TAG_ORDER.includes(t)) tags.push({ tag: t, zh: SKILL_TAG_ZH[t] || t, n });
  const chip = (tag: string, label: string, n: number) =>
    `<button class="fchip${skillIdxState.tag === tag ? " on" : ""}" data-skidxtag="${tag}">${esc(label)} <b>${n}</b></button>`;
  const chips = [chip("", "全部", SKILLS.length), ...tags.map(t => chip(t.tag, t.zh, t.n)),
    chip("hidden", "隐藏", SKILLS.filter(s => s.hidden).length)];
  /* 静态视图（主页签）：无 navBar——没有返回/关闭语义，切页签即离开 */
  $("view-skills").innerHTML = `<div class="skillidx-view">
    <h2 class="cmp-title">技能图鉴 <small id="skillIdxCount">${matches.length}</small></h2>
    <div class="skillidx-bar"><input id="skillIdxQ" placeholder="检索：技能名 / 拼音全拼或首字母 / 所属角色 / 英文…" value="${esc(skillIdxState.q)}" spellcheck="false" autocomplete="off"></div>
    <div class="skillidx-chips">${chips.join("")}</div>
    <div class="skillidx-list" id="skillIdxList"></div>
    <div id="skillIdxSentinel"></div></div>`;
  /* 整视图重建：哨兵是新节点，旧 IO 全部失效——
     先断旧 IO，分块与否交给 skidxRefresh 里的 ensureSkidxIO 统一决定 */
  skidxIO?.disconnect?.();
  skidxIO = null;
  skidxRefresh();
}
/* 图鉴内的检索与 chips：输入即时过滤（只重挂结果区），chips 重渲染整视图 */
$("view-skills").addEventListener("input", ev => {
  if ((ev.target as HTMLElement).id !== "skillIdxQ") return;
  skillIdxState.q = (ev.target as HTMLInputElement).value;
  skidxRefresh();
});
$("view-skills").addEventListener("click", ev => {
  const c = (ev.target as HTMLElement).closest("[data-skidxtag]") as HTMLElement | null;
  if (!c) return;
  skillIdxState.tag = c.dataset.skidxtag || "";
  renderSkillsView();
});

export { SKILL_TAG_ZH, SKILL_TAG_ORDER, SKILLS, skillByKey, skillByName, skillsOfOwner, buildSkillIndex, skillsOf, skillsOfCard, skillOf, skillsNamed, skillCostText, skillRowHtml, skillsHtml, skillsHtmlCard, equipSkillsHtml, renderSkillView, showSkill, renderSkillsView };

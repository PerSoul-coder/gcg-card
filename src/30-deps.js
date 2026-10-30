/* 七圣召唤浏览器 · 依赖模型：牌组限制 / 打出限制、费用拆分。
   源码按领域拆分，由 src/sources.mjs 统一声明加载顺序；单文件版构建时按同一顺序内联。 */
"use strict";

/* ---------- 测试卡过滤 ----------
   明显是测试用途的实体不进卡库/检索（详情深链 #card=id 仍可按 id 访问）。
   判据（对全库 1347 张实体零误报）：名称括号片段含 ASCII 字母——命中
   （Test）隐藏-费用不变 / （test）绿皮隐藏 / （test）PVEbuff / （test）测试用 /
   火与战争（test）共 5 张，全部 shareId=null（本就不可构筑），或名称含「测试」。 */
const TEST_CARD_RE = /(?:[（(][^）)]*[A-Za-z][^）)]*[）)])|测试/;
const isTestCard = e => TEST_CARD_RE.test(e.name || "");

/* 费用拆分：元素骰 vs 充能 */
const diceCost = pc => (pc || []).filter(x => x.type !== "GCG_COST_ENERGY").reduce((a, x) => a + x.count, 0);
const energyCost = pc => (pc || []).filter(x => x.type === "GCG_COST_ENERGY").reduce((a, x) => a + x.count, 0);
function costHtml(playCost) {
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
function costText(pc) {
  if (!pc || !pc.length) return "";
  return pc.map(p => {
    const t = (p.type || "").replace("GCG_COST_DICE_", "").replace("GCG_COST_", "");
    const zh = COST_ZH[t] || t;
    return t === "ENERGY" ? `充能×${p.count}` : `${zh}×${p.count}`;
  }).join(" ");
}

/* ---------- 牌间依赖（统一模型：牌组限制 + 打出限制） ----------
   牌组限制（构筑门槛，加入牌组前就要满足）——deckReqsOf：
   · deckChar：牌组需包含指定角色。来源 relatedCharacterId（权威；描述含
     #{REALNAME[..]} 占位的卡——如梦迹一风——只有它能给出正确角色名），
     描述正则「牌组中包含X，才能加入牌组」仅作兜底，且拒绝含 #/{/[ 的捕获；
   · deckEl  ：牌组需包含至少 N 名指定元素角色（元素共鸣牌）；
   · deckTag ：牌组需包含至少 N 名指定地区/阵营角色（风与自由 / 愚人众的阴谋…）。
     N 与元素/地区/阵营均取 relatedCharacterTags（结构化）+ 描述文本双重确认。
   打出限制（对局中生效）——restrictionsOf：秘传限1 / 天赋须在场 / 武器限定 / 限打张数。 */
function deckReqsOf(e) {
  const R = [];
  /* 具体角色：结构化 id 优先；id 缺失（新卡暂无角色数据）时退回描述正则 */
  if (e.relatedCharacterId != null) {
    const n = charById.get(e.relatedCharacterId)?.name || "";
    if (n) R.push({ code: "deckChar", name: n, charId: e.relatedCharacterId,
      short: `牌组·${n}`, label: `牌组限制：牌组中需包含角色「${n}」才能加入` });
  } else {
    const m = (e.description || "").match(/牌组中包含([^，。]{2,12}?)，才能加入牌组/);
    if (m && !/[#{\[]/.test(m[1])) {
      const n = m[1].trim();
      R.push({ code: "deckChar", name: n, charId: charByName.get(n)?.id ?? null,
        short: `牌组·${n}`, label: `牌组限制：牌组中需包含角色「${n}」才能加入` });
    }
  }
  /* 元素 / 地区 / 阵营：结构化 tags 按基名归并（同一 tag 重复出现只收一次）；
     tags 缺失时用描述兜底解析，标签码从反查表还原 */
  const seen = new Set();
  const push = (tag, zh, n) => {
    if (seen.has(tag)) return;
    seen.add(tag);
    if (tag.startsWith("GCG_TAG_ELEMENT_"))
      R.push({ code: "deckEl", tag, name: zh, n, short: `牌组·${n}×${zh}`,
        label: `牌组限制：牌组需包含至少 ${n} 名${zh}元素角色才能加入` });
    else
      R.push({ code: "deckTag", tag, name: zh, n, short: `牌组·${n}×${zh}`,
        label: `牌组限制：牌组需包含至少 ${n} 名「${zh}」角色才能加入` });
  };
  for (const t of e.relatedCharacterTags || []) {
    const m = t.match(/^GCG_TAG_(ELEMENT|NATION|CAMP)_(.+)$/);
    if (!m) continue;
    const mn = (e.description || "").match(/牌组包含至少(\d+)个[^，]*?角色，才能加入牌组/);
    push(t, tagZh(t), mn ? +mn[1] : 2);
  }
  if (!seen.size) {
    const m = (e.description || "").match(/牌组包含至少(\d+)个([^，]*?)(元素|)角色，才能加入牌组/);
    if (m) {
      const n = +m[1], txt = m[2].replace(/^「|」$/g, "");
      const tag = ELE_CODE[txt] || NATION_CODE[txt] || CAMP_CODE[txt];
      if (tag) push(tag, txt, n);
    }
  }
  return R;
}
/* 限制条目对应的元素键（仅 deckEl 有效），供列表 / 详情 / 面板统一渲染图标 */
function reqElement(r) {
  if (!r || r.code !== "deckEl") return "";
  if (r.tag) return r.tag.replace("GCG_TAG_ELEMENT_", "");
  return (ELE_CODE[r.name] || "").replace("GCG_TAG_ELEMENT_", "");
}
/* 校验：给定牌组的角色 id 列表，是否满足该条牌组限制。
   deckChar 按角色名匹配（同名多版本——可构筑版与 66xx 变体——视为同一角色）；
   角色不在角色库中（新卡暂无数据）时无法校验，放行——避免误拦。 */
function deckReqMet(req, chars) {
  if (req.code === "deckChar") {
    const want = req.name || charById.get(req.charId)?.name || "";
    if (!want || !charByName.has(want)) return true;
    return chars.some(id => id === req.charId || charById.get(id)?.name === want);
  }
  if (req.code === "deckEl" || req.code === "deckTag") {
    const n = req.n || 2;
    let hit = 0;
    for (const id of chars) {
      const c = charById.get(id);
      if (!c) continue;
      if (req.code === "deckEl") { if ((c.tags || []).includes(req.tag)) hit++; }
      else if ((c.tags || []).includes(req.tag)) hit++;
    }
    return hit >= n;
  }
  return true;
}
/* 缺口说明：为什么这条限制当前不满足（toast / 校验面板共用） */
function reqGapText(req, chars) {
  if (req.code === "deckChar")
    return `需要牌组中包含角色「${req.name}」（当前未包含）`;
  if (req.code === "deckEl" || req.code === "deckTag") {
    let hit = 0;
    for (const id of chars) { const c = charById.get(id); if (c && (c.tags || []).includes(req.tag)) hit++; }
    const what = req.code === "deckEl" ? `${req.name}元素` : `「${req.name}」`;
    return `需要牌组中包含至少 ${req.n || 2} 名${what}角色（当前 ${hit}）`;
  }
  return "";
}
/* 打出限制（结构化推导）：秘传 tag / 天赋关联角色 / 武器类型 tag / 描述文本规则 */
function restrictionsOf(e) {
  const R = [];
  const tags = e.tags || [];
  if (tags.includes("GCG_TAG_LEGEND"))
    R.push({ code: "legend", short: "秘传·限1", label: "秘传牌：整套牌组只能放入 1 张（含同名卡）" });
  if (tags.includes("GCG_TAG_TALENT") && e.relatedCharacterId != null) {
    const n = charById.get(e.relatedCharacterId)?.name || e.relatedCharacterId;
    R.push({ code: "talent", short: "须在场", label: `天赋牌：仅当 ${n} 在场时才能打出` });
  }
  if (tags.includes("GCG_TAG_WEAPON")) {
    const w = tags.find(t => /^GCG_TAG_WEAPON_(?!.*NONE$).+$/.test(t) && t !== "GCG_TAG_WEAPON");
    if (w) {
      const zh = WEAPON_ZH[w.replace("GCG_TAG_WEAPON_", "")] || w;
      R.push({ code: "weapon", short: zh, label: `装备限制：仅可装备给${zh}角色` });
    }
  }
  const m = (e.description || "").match(/最多打出(\d+|一|两|二|三)张/);
  if (m) R.push({ code: "once", short: `限${m[1]}张`, label: `打出限制：本场对局最多打出 ${m[1]} 张` });
  return R;
}
/* 全部依赖（牌组限制在前，打出限制在后）——徽标 / 列表 / 导出统一渲染入口 */
const allReqs = x => [...(x.deckReqs || []), ...(x.restrictions || [])];
/* 徽标取色：牌组限制金/紫（构筑门槛），打出限制沿用既有色；
   deckEl 按元素取色（2×冰 徽标即冰蓝），一眼对上共鸣牌元素 */
const R_STYLE = {
  legend: "var(--gold)", talent: "var(--electro)", weapon: "var(--hydro)", once: "#e07a7a",
  deckChar: "#e0c068", deckTag: "#b48ce0",
};
const R_ZH = { legend: "秘传", talent: "天赋·须在场", weapon: "武器限定", once: "限打张数",
  deckChar: "牌组·角色", deckEl: "牌组·元素", deckTag: "牌组·地区" };
const depBadge = r => `<span class="rbadge" style="border-color:${r.code === "deckEl" ? (ELE_COLOR[r.name] || "var(--gold)") : R_STYLE[r.code]};color:${r.code === "deckEl" ? (ELE_COLOR[r.name] || "var(--gold)") : R_STYLE[r.code]}" title="${esc(r.label)}">${esc(r.short)}</span>`;
const depBadges = reqs => reqs.map(depBadge).join("");


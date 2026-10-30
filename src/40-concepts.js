/* 七圣召唤浏览器 · 概念索引：补充库合并、术语匹配与链接化。
   源码按领域拆分，由 src/sources.mjs 统一声明加载顺序；单文件版构建时按同一顺序内联。 */
"use strict";

/* ---------- 补充概念库 & 文本补丁（genshin-db 静态快照） ----------
   来源：theBowja/genshin-db（解析自游戏官方配置），由 build-concepts.mjs 生成。
   与 piovium 现网数据的分工配合：
   · piovium = 身份层（live 数据）：卡牌/角色 id、卡面图片、技能、分享码编解码、详情跳转都以它为准；
   · genshin-db = 释义层（静态快照）：官方规则、术语、状态效果、召唤物、历史版本卡牌。
   合并先到先得：piovium 已有的名字永远优先，补充库只填空——piovium 日后新增的卡
   会自动接管对应概念，此处无需改动。 */
const EXTRA_CONCEPTS = (typeof CONCEPTS_EXTRA !== "undefined" && CONCEPTS_EXTRA) || {};
/* 补充库中的卡牌/角色没有 piovium id → 降级为只读引用（cardref/charref）：
   点击走概念弹层展示名称与描述，绝不跳转到不存在的详情 */
const EXTRA_KIND_MAP = { card: "cardref", character: "charref" };
/* 对局实体类概念（状态/召唤物/敌方牌/附加状态）：与牌库实体同名时就是同一张牌，
   只是补充库按另一种分类又存了一份，检索不应再单列成「概念」 */
const ENTITY_KINDS = new Set(["status", "summon", "enemy", "attachment"]);
/* ---------- 关于卡文占位符 ----------
   游戏文本以 D__KEY__DAMAGE / D__KEY__ELEMENT 等占位符书写技能数值，数据服务对可见
   文本均已预解析。全库扫描确认仅 4 处技能残留占位符，且全部是 hidden:true 的引擎
   保留技能（嘉明·踏云献瑞、瓦雷莎·夜虹逐跃、水形幻人·汛波/洪啸）——渲染与导出
   路径均已过滤 hidden 技能，故查看器侧不做任何文本替换（其数值亦不在可引用数据中，
   按同名合并会错配火/物理等不同版本，不做猜测）。 */

/* ---------- 概念索引（卡牌 / 角色 / 术语） ----------
   描述文本中出现的其他卡牌、行动等概念 → 悬浮提示 + 点击展开。
   一个名字可能同时属于多个不同种类的概念（如"护盾"既是状态牌也是关键词）：
   termIndex: Map<name, entry[]>，按种类并列收录，展示时从上到下依次呈现。
   去重规则：同一种类只保留一个条目——card 与 cardref、char 与 charref 各视为同种
   （补充库降级引用不与 piovium 身份重复）；竞争时"源优先级（piovium 现网先）>
   可入构筑（有 shareId，即能出现在牌组里的版本）> 有描述 > 先到先得"。
   后者让同名版本变体自动收敛到正确版本：芙宁娜→1211（牌组中的版本）、
   元素附魔：冰→有描述的 v5.6 版本、暗流涌动→有 shareId 的版本。 */
const KIND_GROUP = { card: "card", cardref: "card", char: "char", charref: "char" };
/* 并列顺序：身份（卡/角色）→ 规则术语 → 技能。
   规则术语排在技能前：同名时「幻戏」这类机制词义更常用（技能只是某角色的
   内部命名），先看机制解释更符合直觉；真正需要的技能页可由条目自带入口进入。 */
const KIND_ORDER = ["card", "char", "keyword", "rule", "rule-term", "skill", "status", "summon", "enemy", "cardref", "charref"];
const kindGroup = k => KIND_GROUP[k] || k;
function entryBetter(a, b) {
  if (a.src !== b.src) return a.src < b.src;
  const sa = a.shareId != null ? 1 : 0, sb = b.shareId != null ? 1 : 0;
  if (sa !== sb) return sa > sb;
  const da = a.desc ? 1 : 0, db = b.desc ? 1 : 0;
  if (da !== db) return da > db;
  return false;
}
/* 牌面文本副本 ≠ 概念：piovium 的 keywords 里有大量负数 id 条目，只是把某张
   卡牌 / 角色的牌面文本原样再存一份（如「月笼协奏」「诸武相授」）。名字相同且
   释义等价时跳过，否则检索里同一张行动牌会同时出现在「行动牌」和「概念」两栏。
   释义确实不同的（护盾、下落攻击、额外行动等机制说明）仍保留为独立概念。 */
const normTermDesc = s => String(s || "").replace(/^费用：\d+\s*/, "").replace(/[\s\p{P}\p{S}]/gu, "");
const descMirrors = (a, b) => {
  const x = normTermDesc(a), y = normTermDesc(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x) || levRatio(x, y) >= 0.9;
};
/* 牌面副本常只差一处措辞（如多一个「当前」），包含判断会漏；用编辑距离兜底 */
function levRatio(x, y) {
  const m = x.length, n = y.length;
  if (Math.abs(m - n) > Math.max(m, n) * 0.2) return 0;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}
function kwMirrorsEntity(k, entityDesc, entityByKey) {
  if (!(k.id < 0)) return false;
  const ed = entityDesc.get(k.name) ?? entityByKey.get(nameKey(k.name))?.obj?.description;
  if (ed == null) return false;
  return descMirrors(k.description, ed);
}
let termIndex = new Map(), termRe = null;
function addTerm(name, entry) {
  if (!name || name.length < 2) return;
  const list = termIndex.get(name);
  if (!list) { termIndex.set(name, [entry]); return; }
  const i = list.findIndex(e => kindGroup(e.kind) === kindGroup(entry.kind));
  if (i < 0) list.push(entry);
  else if (entryBetter(entry, list[i])) list[i] = entry;
}
function buildTermIndex() {
  termIndex.clear();
  /* 实体名 → 牌面文本：用于识别 keywords 里的牌面文本副本 */
  const entityDesc = new Map();
  /* 归一化实体索引：补充库与现网卡名常只差一对书名号，用它把条目接回真实身份 */
  const entityByKey = new Map();
  const betterEntity = (a, b) => {
    const sa = a.shareId != null ? 1 : 0, sb = b.shareId != null ? 1 : 0;
    if (sa !== sb) return sa > sb;
    return ((a.description || a.storyText || "") ? 1 : 0) > ((b.description || b.storyText || "") ? 1 : 0);
  };
  /* 准备状态影子不进身份表：它的名字属于技能本身（否则「技能：踏潮」会先命中
     同名状态牌，技能效果永远看不到） */
  for (const e of ENT) if (e.name && !isShadowState(e)) {
    if (!entityDesc.has(e.name)) entityDesc.set(e.name, e.description || "");
    const k = nameKey(e.name), cur = entityByKey.get(k);
    if (!cur || betterEntity(e, cur.obj)) entityByKey.set(k, { kind: "card", obj: e });
  }
  for (const c of CHAR) if (c.name) {
    if (!entityDesc.has(c.name)) entityDesc.set(c.name, c.storyText || "");
    const k = nameKey(c.name), cur = entityByKey.get(k);
    if (!cur || betterEntity(c, cur.obj)) entityByKey.set(k, { kind: "char", obj: c });
  }
  for (const e of ENT) if (e.name && e.name.length >= 2 && !isShadowState(e))
    addTerm(e.name, { src: 0, kind: "card", id: e.id, name: e.name, shareId: e.shareId,
      type: typeZhOf(e), playCost: e.playCost,
      desc: (e.description || "").trim(), image: hasCardFace(e) ? imgFull(e.id) : "",
      artId: hasCardFace(e) ? e.id : null });
  for (const c of CHAR) if (c.name && c.name.length >= 2)
    addTerm(c.name, { src: 0, kind: "char", id: c.id, name: c.name, shareId: c.shareId,
      hp: c.hp, energy: c.maxEnergy, desc: (c.storyText || "").trim(), image: imgFull(c.id), artId: c.id });
  /* 角色技能：卡牌/角色的身份优先于技能名（同名时以牌面为准），
     没有身份竞争时注册为 skill 条目——正文里的「准备技能：踏潮」「技能：霆电迸发」
     由此指向技能效果，而不是同名的准备中状态。 */
  for (const s of SKILLS) {
    if (!s.name || s.name.length < 2 || !s.desc) continue;
    const owner = entityByKey.get(nameKey(s.name));
    if (owner && (owner.kind === "card" || owner.kind === "char")) continue;
    addTerm(s.name, { src: 0, kind: "skill", key: s.key, name: s.name,
      type: s.tagZh, cost: s.cost, owner: s.ownerName,
      ownerId: s.ownerId != null ? s.ownerId : s.ownerCardId,
      ownerKind: s.ownerKind,
      artId: s.art && s.art.ref != null ? s.art.ref : null,
      prepared: s.prepared, prepareTurns: s.prepareTurns, desc: s.effect || s.desc });
  }
  for (const k of KW) {
    if (!(k.name && k.name.length >= 2)) continue;
    if (kwMirrorsEntity(k, entityDesc, entityByKey)) continue;
    const entry = { src: 0, kind: "keyword", name: k.name, desc: (k.description || "").trim() };
    /* 词条名就是某个角色的卡名时（如「焚尽的炽炎魔女」的形态说明），本质仍是该角色：
       检索不再单列概念；术语页与正文链接照常保留 */
    const ch = entityByKey.get(nameKey(k.name));
    if (ch && ch.kind === "char") entry.mirrorCard = true;
    addTerm(k.name, entry);
  }
  buildReactionTerms();
  /* 补充概念（genshin-db 静态快照）：与 piovium 现网按种类互补，不挤占已有种类 */
  for (const [name, info] of Object.entries(EXTRA_CONCEPTS)) {
    const kind = EXTRA_KIND_MAP[info.kind] || info.kind || "keyword";
    const desc = info.desc || "";
    const hit = entityByKey.get(nameKey(name));
    /* 只差书名号/空白的同名条目 = 同一张牌/同一个角色：挂真实身份，
       点术语可直接跳详情，也不会在检索里多出一行「概念」 */
    if (hit && cosmeticKey(name) === cosmeticKey(hit.obj.name)) {
      if (hit.kind === "card" && (kind === "card" || kind === "cardref")) {
        addTerm(name, { src: 1, kind: "card", id: hit.obj.id, name: hit.obj.name, shareId: hit.obj.shareId,
          type: typeZhOf(hit.obj), playCost: hit.obj.playCost,
          desc: desc.trim() || (hit.obj.description || "").trim(), image: hasCardFace(hit.obj) ? imgFull(hit.obj.id) : "",
          artId: hasCardFace(hit.obj) ? hit.obj.id : null });
        continue;
      }
      if (hit.kind === "char" && (kind === "char" || kind === "charref")) {
        addTerm(name, { src: 1, kind: "char", id: hit.obj.id, name: hit.obj.name, shareId: hit.obj.shareId,
          hp: hit.obj.hp, energy: hit.obj.maxEnergy,
          desc: desc.trim() || (hit.obj.storyText || "").trim(), image: imgFull(hit.obj.id), artId: hit.obj.id });
        continue;
      }
    }
    const entry = { src: 1, kind, name, desc: desc.trim(), type: info.type || "" };
    /* 补充库把某张牌的「状态/召唤物/术语」释义按卡名收录时，本质仍是这张牌：
       标记为牌面镜像，检索不再单列概念；术语页与正文链接仍保留该条目 */
    if (hit && ENTITY_KINDS.has(kind) && nameKey(name) === nameKey(hit.obj.name)) entry.mirrorCard = true;
    else if (hit && hit.kind === "card" && descMirrors(desc, hit.obj.description)) entry.mirrorCard = true;
    addTerm(name, entry);
  }
  /* 展示顺序：身份类（有图片、可跳详情）在前，其余按 KIND_ORDER */
  for (const list of termIndex.values())
    list.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  const names = [...termIndex.keys()].sort((a, b) => b.length - a.length)
    .map(esc).map(escapeRe);
  termRe = names.length ? new RegExp("(" + names.join("|") + ")", "g") : null;
}
/* 取某名字的全部匹配概念（多个时悬浮/展开并列展示） */
function termEntries(name) { return termIndex.get(name) || []; }
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/* 反应术语派生：来自 piovium "X元素相关反应" 分组关键词，其描述是官方逐反应清单
   （感电：… / 绽放：… / 扩散（水）：… / 结晶（冰）：…）。
   · 每行注册全名（含元素后缀）；
   · 同基名的多行归并出基名词条（结晶 / 扩散）——卡文写作"结晶反应""扩散反应"，
     基名缺失时长名匹配不中，只会命中同名卡牌条目（结晶→场地牌），术语释义丢失。
     归并按元素后缀去重：KW 顺序保证玩家版（-211~-217）在前，敌方版同后缀行不重复收录。 */
const REACTION_LINE_RE = /^([^：\n]{2,12})：([\s\S]+)$/;
function buildReactionTerms() {
  const byBase = new Map();   /* base → Map<元素后缀, 文本> */
  for (const k of KW) {
    if (!/元素相关反应$/.test(k.name) || !k.description) continue;
    for (const line of k.description.split("\n")) {
      const m = line.match(REACTION_LINE_RE);
      if (!m) continue;
      const name = m[1].trim(), text = m[2].trim();
      addTerm(name, { src: 0, kind: "keyword", name, desc: text });
      const base = name.replace(/（[^（）]*）$/, "");
      if (base === name || base.length < 2) continue;
      if (!byBase.has(base)) byBase.set(base, new Map());
      const variants = byBase.get(base);
      const suffix = name.slice(base.length + 1, -1);
      if (!variants.has(suffix)) variants.set(suffix, text);
    }
  }
  for (const [base, variants] of byBase)
    addTerm(base, { src: 0, kind: "keyword", name: base,
      desc: [...variants].map(([sfx, text]) => sfx ? `（${sfx}）${text}` : text).join("\n") });
}
/* 输入已转义的文本，把术语标记为 .term 链接（单趟替换，无嵌套）。
   「」引号内为完整指称：若引号内容比命中的术语更长（如「幻戏倒计时」命中前缀"幻戏"），
   视为部分命中，不标记——避免把卡族名称误识别为机制关键词。 */
function linkify(escaped) {
  if (!termRe) return escaped;
  return escaped.replace(termRe, (m, _p1, offset, str) => {
    if (str[offset - 1] === "「") {
      const close = str.indexOf("」", offset);
      if (close > offset && str.slice(offset, close) !== m) return m;
    }
    return `<span class="term" data-term="${m}">${m}</span>`;
  });
}
/* 同 linkify，但摘除 except 术语自身的链接——防止展开面板里点击自己导致面板被收起。
   注意必须"先链接化、后摘除"：若在链接化前做文本掩码，会把长名中的自身子串一并掩掉
   （如屏蔽"幻戏"会拆坏"幻戏倒计时：3"），导致长名概念丢失链接。 */
function linkifyExcept(escaped, except) {
  if (!termRe || !except) return linkify(escaped);
  const target = esc(except);
  const span = `<span class="term" data-term="${target}">${target}</span>`;
  return linkify(escaped).split(span).join(target);
}

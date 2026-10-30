#!/usr/bin/env node
/* 统一数据集构建 —— 把四份异构来源归一为同一种记录，判定前移到构建期。
 *
 *   node scripts/build-dataset.mjs
 *
 * 输入：
 *   gi-data/characters.json        piovium 角色（含 skills）
 *   gi-data/entities.json          piovium 卡牌 / 状态 / 召唤物 / 附加状态（部分装备牌含 skills）
 *   gi-data/keywords.json          piovium 规则术语
 *   gi-data/concepts-extra.json    genshin-db 补充概念
 *   gi-data/pinyin.js              构建期拼音索引（复用，不重复生成）
 *   src/core/resources.ts          译名表与标签翻译（TS，用 esbuild 打包后注入 vm）
 *   src/12-model.js                类型语义与身份判定（用 vm 取常量，避免第二份真源）
 *
 * 输出：
 *   gi-data/dataset.json           归一化记录（调试 / 单文件内联 / Node 测试兜底）
 *   gi-data/dataset.br             Brotli 压缩的同一份 JSON（多文件版与发布版主路径）
 *   gi-data/dataset.meta.json      计数与构建时间（不含记录，便于快速核对）
 *
 * 设计依据见 docs/DESIGN.md。
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");
const readJson = p => JSON.parse(read(p));
const dataOf = j => (Array.isArray(j) ? j : (j && j.data) || []);

/* ---------- 1. 取唯一分类定义（不复制 TYPE_SPEC / TAG_ZH） ----------
 * resources.ts 与 model.ts 已迁到 TypeScript，不能在 vm 里直接跑 .ts：
 * 先用 esbuild 各自打包成 IIFE（globalName 暴露为 __RES / __MODEL），
 * 再拼进同一个 vm 上下文求值。分类定义始终只有一份。 */
async function bundleModule(entry, globalName) {
  const r = await esbuild.build({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true, format: "iife", globalName, target: ["es2022"],
    write: false, logLevel: "silent",
  });
  if (!r.outputFiles || !r.outputFiles[0]) throw new Error(`${entry} 打包失败`);
  return r.outputFiles[0].text;
}

const RESOURCES_BUNDLE = await bundleModule("src/core/resources.ts", "__RES");
const MODEL_BUNDLE = await bundleModule("src/data/model.ts", "__MODEL");

function loadTaxonomy() {
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  const code = RESOURCES_BUNDLE + "\n" + MODEL_BUNDLE;
  const expr = `;({
    TYPE_SPEC: __MODEL.TYPE_SPEC, TYPE_ZH: __MODEL.TYPE_ZH, TYPE_ORDER: __MODEL.TYPE_ORDER,
    DOMAIN_ZH: __MODEL.DOMAIN_ZH, NO_ART_KIND: __MODEL.NO_ART_KIND,
    typeZhOf: __MODEL.typeZhOf, typeSpecOf: __MODEL.typeSpecOf,
    nameKey: __MODEL.nameKey, cosmeticKey: __MODEL.cosmeticKey,
    PREPARED_STATE_RE: __MODEL.PREPARED_STATE_RE,
    TAG_ZH: __RES.TAG_ZH, ELE_ZH: __RES.ELE_ZH, WEAPON_ZH: __RES.WEAPON_ZH, tagZh: __RES.tagZh
  })`;
  return vm.runInContext(code + expr, ctx);
}
const T = loadTaxonomy();

const SKILL_TAG_ZH = {
  GCG_SKILL_TAG_A: "普通攻击",
  GCG_SKILL_TAG_E: "元素战技",
  GCG_SKILL_TAG_Q: "元素爆发",
  GCG_SKILL_TAG_PASSIVE: "被动技能",
  GCG_SKILL_TAG_NONE: "特殊技能",
};
const POOL_TYPES = new Set(T.TYPE_ORDER);

/* ---------- 2. 拼音（复用 gi-data/pinyin.js） ---------- */
function loadPinyin() {
  const txt = read("gi-data/pinyin.js");
  const eq = txt.indexOf("=");
  const body = txt.slice(eq + 1).trim().replace(/;\s*$/, "");
  return JSON.parse(body);
}
const PY = loadPinyin();
function pinyinOf(name) {
  const hit = PY.names && PY.names[name];
  if (hit) {
    const [full, initials] = hit.split("|");
    return { full, initials };
  }
  const chars = [...String(name || "")];
  if (!chars.length) return null;
  const syl = chars.map(ch => (PY.chars || {})[ch]);
  if (syl.some(x => !x)) return null;
  return { full: syl.join(""), initials: syl.map(s => s[0]).join("") };
}

/* ---------- 3. 工具 ---------- */
const diceCostOf = cost => (cost || []).filter(c => /^GCG_COST_DICE/.test(c) && !/ENERGY/.test(c)).length;
const energyCostOf = cost => (cost || []).filter(c => c === "GCG_COST_ENERGY").length;
const elemOfTags = tags => (tags || []).find(t => t.startsWith("GCG_TAG_ELEMENT"))?.replace("GCG_TAG_ELEMENT_", "") || "";
const normDesc = s => String(s || "").replace(/^费用：\d+\s*/, "").replace(/[\s\p{P}\p{S}]/gu, "");
/* 编辑距离相似度。只比长度比例是不够的：两条描述长度相同但内容完全不同
   （「角色不会因为额外行动而获得充能」vs「自身行动后获得1次额外行动可叠加」）
   会被判成同一个，于是把本该独立的概念当成副本丢掉。长度只用来剪枝。 */
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
function descSimilar(a, b) {
  const x = normDesc(a), y = normDesc(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  return levRatio(x, y) >= 0.9;
}
const PREPARE_TURNS_RE = /（需准备(\d+)个行动轮）/;
const skillEffectText = d => String(d || "").split("\n").filter(l => !PREPARE_TURNS_RE.test(l)).join("\n").trim();

/* ---------- 4. 读源 ---------- */
const CHAR = dataOf(readJson("gi-data/characters.json"));
const ENT = dataOf(readJson("gi-data/entities.json"));
const KW = dataOf(readJson("gi-data/keywords.json"));
const EXTRA = readJson("gi-data/concepts-extra.json");

/* ---------- 5. 准备状态影子（构建期判定一次） ---------- */
const shadowIds = new Set();
const shadowBySkill = new Map();
for (const e of ENT) {
  if (e.type !== "GCG_CARD_STATE") continue;
  const m = T.PREPARED_STATE_RE.exec(e.description || "");
  if (!m) continue;
  if (T.nameKey(m[1]) !== T.nameKey(e.name)) continue;
  shadowIds.add(e.id);
  const k = T.nameKey(e.name);
  if (!shadowBySkill.has(k)) shadowBySkill.set(k, { stateId: e.id, stateName: e.name });
}

/* ---------- 6. 实体身份表（用于补充库接回真实身份） ---------- */
const entByNorm = new Map();
const betterEntity = (a, b) => {
  const sa = a.shareId != null ? 1 : 0, sb = b.shareId != null ? 1 : 0;
  if (sa !== sb) return sa > sb;
  return ((a.description || a.storyText || "") ? 1 : 0) > ((b.description || b.storyText || "") ? 1 : 0);
};
for (const e of ENT) {
  if (!e.name || shadowIds.has(e.id)) continue;
  const k = T.nameKey(e.name), cur = entByNorm.get(k);
  if (!cur || betterEntity(e, cur.obj)) entByNorm.set(k, { kind: "card", obj: e });
}
for (const c of CHAR) {
  if (!c.name) continue;
  const k = T.nameKey(c.name), cur = entByNorm.get(k);
  if (!cur || betterEntity(c, cur.obj)) entByNorm.set(k, { kind: "char", obj: c });
}

/* ---------- 7. 记录工厂 ---------- */
const records = [];
const byKey = new Map();
function push(rec) {
  if (byKey.has(rec.key)) throw new Error(`重复 key: ${rec.key}`);
  byKey.set(rec.key, rec);
  records.push(rec);
}
function aliasOf(name) {
  const py = pinyinOf(name);
  return {
    norm: T.nameKey(name),
    cosmetic: T.cosmeticKey(name),
    pinyin: py ? py.full : "",
    initials: py ? py.initials : "",
  };
}

/* 7.1 角色 + 角色技能 */
for (const c of CHAR) {
  const key = "char:" + c.id;
  push({
    key, kind: "char", domain: "char",
    name: c.name || "", englishName: c.englishName || "",
    aliases: aliasOf(c.name),
    typeRaw: "GCG_CARD_CHARACTER", typeZh: "角色牌",
    desc: { effect: "", story: (c.storyText || "").trim(), rules: "" },
    linkable: !!(c.name && c.name.length >= 2),
    art: { hasFace: !!c.cardFace, ref: c.cardFace ? c.id : null, kind: "char" },
    stats: {
      cost: [], dice: -1, energy: 0,
      hp: c.hp ?? null, maxEnergy: c.maxEnergy ?? null,
      tags: (c.tags || []).map(T.tagZh).filter(Boolean), tagsRaw: c.tags || [],
      element: elemOfTags(c.tags),
    },
    rel: { ownerKey: null, ownerName: null, ownerKind: null, relatedCharacterId: null, relatedCharacterKey: null },
    flags: { deckable: c.shareId != null, poolable: true, shadow: false, mirror: false, test: false, entity: false },
    version: c.sinceVersion || "",
    refs: [], source: "piovium",
  });

  for (const s of c.skills || []) {
    if (!s || !s.name) continue;
    const sk = "skill:char:" + c.id + ":" + s.id;
    if (byKey.has(sk)) continue;
    const desc = String(s.description || s.rawDescription || "").trim();
    const effect = skillEffectText(desc);
    const shadow = shadowBySkill.get(T.nameKey(s.name));
    const turns = (PREPARE_TURNS_RE.exec(desc) || [])[1];
    push({
      key: sk, kind: "skill", domain: "skill",
      name: s.name, englishName: s.englishName || "",
      aliases: aliasOf(s.name),
      typeRaw: s.type || "", typeZh: SKILL_TAG_ZH[s.type] || "技能",
      desc: { effect, story: "", rules: "" },
      linkable: s.name.length >= 2 && !!effect,
      art: { hasFace: !!c.cardFace, ref: c.cardFace ? c.id : null, kind: "char" },
      stats: {
        cost: Array.isArray(s.playCost) ? s.playCost : [],
        dice: diceCostOf(s.playCost), energy: energyCostOf(s.playCost),
        hp: null, maxEnergy: null, tags: [], tagsRaw: [], element: elemOfTags(c.tags),
      },
      rel: {
        ownerKey: key, ownerName: c.name, ownerKind: "char",
        relatedCharacterId: c.id, relatedCharacterKey: key,
      },
      flags: {
        deckable: false, poolable: false, shadow: false, mirror: false, test: false, entity: false,
      },
      version: c.sinceVersion || "",
      refs: [], source: "piovium",
      prepared: !!turns || !!shadow, prepareTurns: turns ? Number(turns) : (shadow ? 1 : 0),
      stateId: shadow ? shadow.stateId : null,
      altCount: 0, hidden: !!s.hidden,
    });
  }
}

/* 7.2 实体（卡牌 / 对局实体）+ 装备牌特技 */
for (const e of ENT) {
  if (!e.name) continue;
  const key = "card:" + e.id;
  const spec = T.typeSpecOf(e);
  const tags = e.tags || [];
  push({
    key, kind: "card", domain: spec.domain,
    name: e.name, englishName: e.englishName || "",
    aliases: aliasOf(e.name),
    typeRaw: e.type || "", typeZh: T.typeZhOf(e),
    desc: { effect: (e.description || "").trim(), story: (e.storyText || "").trim(), rules: "" },
    linkable: e.name.length >= 2 && !shadowIds.has(e.id),
    art: {
      hasFace: !!e.cardFace, ref: e.cardFace ? e.id : null,
      kind: e.cardFace ? "card" : (spec.domain === "field" ? (T.NO_ART_KIND?.[e.type] || "state") : "none"),
    },
    stats: {
      cost: e.playCost || [], dice: diceCostOf(e.playCost), energy: energyCostOf(e.playCost),
      hp: null, maxEnergy: null,
      tags: tags.map(T.tagZh).filter(Boolean), tagsRaw: tags,
      element: elemOfTags(tags),
    },
    rel: {
      ownerKey: null, ownerName: null, ownerKind: null,
      relatedCharacterId: e.relatedCharacterId ?? null,
      relatedCharacterKey: e.relatedCharacterId != null ? "char:" + e.relatedCharacterId : null,
    },
    flags: {
      deckable: e.shareId != null,
      poolable: POOL_TYPES.has(e.type),
      shadow: shadowIds.has(e.id),
      mirror: false,
      test: isTestCard(e),
      entity: spec.domain === "field",
    },
    version: e.sinceVersion || "",
    refs: [], source: "piovium",
  });

  for (const s of e.skills || []) {
    if (!s || !s.name) continue;
    const sk = "skill:card:" + e.id + ":" + s.id;
    if (byKey.has(sk)) continue;
    const desc = String(s.description || s.rawDescription || "").trim();
    const effect = skillEffectText(desc);
    push({
      key: sk, kind: "skill", domain: "skill",
      name: s.name, englishName: s.englishName || "",
      aliases: aliasOf(s.name),
      typeRaw: s.type || "", typeZh: SKILL_TAG_ZH[s.type] || "技能",
      desc: { effect, story: "", rules: "" },
      linkable: s.name.length >= 2 && !!effect,
      art: { hasFace: !!e.cardFace, ref: e.cardFace ? e.id : null, kind: e.cardFace ? "card" : "none" },
      stats: {
        cost: Array.isArray(s.playCost) ? s.playCost : [],
        dice: diceCostOf(s.playCost), energy: energyCostOf(s.playCost),
        hp: null, maxEnergy: null, tags: [], tagsRaw: [], element: elemOfTags(tags),
      },
      rel: {
        ownerKey: key, ownerName: e.name, ownerKind: "card",
        relatedCharacterId: e.relatedCharacterId ?? null,
        relatedCharacterKey: e.relatedCharacterId != null ? "char:" + e.relatedCharacterId : null,
      },
      flags: {
        deckable: false, poolable: false, shadow: false, mirror: false, test: isTestCard(e), entity: false,
      },
      version: e.sinceVersion || "",
      refs: [], source: "piovium",
      prepared: false, prepareTurns: 0, stateId: null,
      altCount: 0, hidden: !!s.hidden,
    });
  }
}

/* 7.3 关键词术语（牌面文本镜像不进概念）
 *
 * 这里要区分**两种**「重复」，它们过去都被塞进一个 mirror 标志，语义混了：
 *   · flags.mirror       —— 描述就是某张牌的牌面文本副本（释义等价）。
 *                           收录它只会让概念页并列两条一样的内容 → 不进概念索引。
 *   · flags.dupIdentity  —— 名字属于某个身份（角色/卡牌），但释义不同
 *                           （「焚尽的炽炎魔女」是角色的形态说明）。概念页要保留，
 *                           只是检索不单列，避免同一张牌在「角色」和「概念」两栏各出现一次。
 * 词表（linkTargets）与这两者无关：正文里出现这个名字就该能点开。
 * 同时 linkable 不再受 mirror 影响——「因为是副本所以点不开」不成立。 */
function termRecord({ key, name, desc, typeRaw, typeZh, source, art, rel, mirror, dupIdentity, extra }) {
  return {
    key, kind: "term", domain: "term",
    name, englishName: "", aliases: aliasOf(name),
    typeRaw, typeZh,
    desc: { effect: desc, story: "", rules: desc },
    linkable: !!desc,
    art: art || { hasFace: false, ref: null, kind: "none" },
    stats: { cost: [], dice: -1, energy: 0, hp: null, maxEnergy: null, tags: [], tagsRaw: [], element: "" },
    rel: rel || { ownerKey: null, ownerName: null, ownerKind: null, relatedCharacterId: null, relatedCharacterKey: null },
    flags: { deckable: false, poolable: false, shadow: false, mirror: !!mirror, dupIdentity: !!dupIdentity, test: false, entity: false },
    version: "", refs: [], source,
    ...(extra || {}),
  };
}

for (const k of KW) {
  if (!k.name || k.name.length < 2) continue;
  const desc = (k.description || "").trim();
  const hit = entByNorm.get(T.nameKey(k.name));
  push(termRecord({
    key: "term:" + k.id, name: k.name, desc,
    typeRaw: k.category || "keywords", typeZh: "术语", source: "piovium",
    mirror: !!hit && descSimilar(k.description, hit.obj.description),
    dupIdentity: !!hit && hit.kind === "char",
  }));
}

/* 7.3b 反应术语派生
 *
 * piovium 把元素反应统一写成一条「X元素相关反应」的关键词，描述是逐反应的清单
 * （感电：… / 绽放：… / 扩散（水）：…）。这些反应名是正文里最常出现的一类术语，
 * 必须各自成条，否则「触发感电」里的「感电」点不开。
 * 同基名的多行还要归并出基名词条（结晶 / 扩散）：卡文写作「结晶反应」，
 * 长名匹配不中，只会命中同名的场地牌，机制解释就丢了。
 *
 * 以前这一步在运行时用正则解析描述文本；现在放到构建期，运行时不再从文本里派生数据。 */
const REACTION_LINE_RE = /^([^：\n]{2,12})：([\s\S]+)$/;
{
  const byBase = new Map();   /* base → Map<元素后缀, 文本> */
  /* 同一个反应名可能出现在多条「X元素相关反应」里（如冻结同时属冰与水）：
     先到先得，与旧实现的 addTerm 语义一致 */
  const seenLine = new Map();
  for (const k of KW) {
    if (!/元素相关反应$/.test(k.name || "") || !k.description) continue;
    for (const line of k.description.split("\n")) {
      const m = line.match(REACTION_LINE_RE);
      if (!m) continue;
      const name = m[1].trim(), text = m[2].trim();
      if (name.length < 2 || !text) continue;
      if (!seenLine.has(name)) seenLine.set(name, text);
      const base = name.replace(/（[^（）]*）$/, "");
      if (base === name || base.length < 2) continue;
      if (!byBase.has(base)) byBase.set(base, new Map());
      const variants = byBase.get(base);
      const suffix = name.slice(base.length + 1, -1);
      if (!variants.has(suffix)) variants.set(suffix, text);
    }
  }
  for (const [name, text] of seenLine)
    push(termRecord({
      key: "term:rx:" + encodeURIComponent(name), name, desc: text,
      typeRaw: "keyword", typeZh: "概念", source: "piovium",
    }));
  for (const [base, variants] of byBase) {
    if (seenLine.has(base)) continue;   /* 基名本身已作为反应行收录，不再用归并结果覆盖 */
    push(termRecord({
      key: "term:rx:" + encodeURIComponent(base), name: base,
      desc: [...variants].map(([sfx, text]) => sfx ? `（${sfx}）${text}` : text).join("\n"),
      typeRaw: "keyword", typeZh: "概念", source: "piovium",
    }));
  }
}

/* 7.4 补充概念：能接回真实身份就挂身份，否则作为独立术语 */
const ENTITY_KINDS = new Set(["status", "summon", "enemy", "attachment"]);
for (const [name, info] of Object.entries(EXTRA)) {
  if (!name || name.length < 2) continue;
  const kind = info.kind || "keyword";
  const desc = (info.desc || "").trim();
  const hit = entByNorm.get(T.nameKey(name));
  const sameIdentity = !!hit && T.cosmeticKey(name) === T.cosmeticKey(hit.obj.name);
  /* 补充库把某张牌的「状态 / 召唤物 / 术语」释义按卡名收录时，本质仍是这张牌：
     概念页保留该条目（释义可能更完整），检索不再单列。 */
  const dupIdentity = !!hit && (ENTITY_KINDS.has(kind) || descSimilar(desc, hit.obj.description));
  push(termRecord({
    key: "term:x:" + encodeURIComponent(name), name, desc,
    typeRaw: kind, typeZh: info.type || "概念", source: "genshin-db",
    dupIdentity,
    art: {
      hasFace: !!hit && !!hit.obj.cardFace,
      ref: hit && hit.obj.cardFace ? hit.obj.id : null,
      kind: hit && hit.kind === "char" ? "char" : "card",
    },
    rel: {
      ownerKey: null, ownerName: null, ownerKind: null,
      relatedCharacterId: hit && hit.kind === "char" ? hit.obj.id : null,
      relatedCharacterKey: hit ? (hit.kind === "char" ? "char:" : "card:") + hit.obj.id : null,
    },
    extra: { sameIdentity },
  }));
}

/* 7.5 技能同名阶段记录去重：同一 owner + 同名只留描述最全的一条 */
{
  const seen = new Map();
  for (const r of records) {
    if (r.kind !== "skill") continue;
    const k = r.rel.ownerKey + "|" + r.aliases.norm;
    const prev = seen.get(k);
    if (!prev) { seen.set(k, r); continue; }
    prev.altCount = (prev.altCount || 0) + 1;
    if ((r.desc.effect || "").length > (prev.desc.effect || "").length) {
      prev.desc.effect = r.desc.effect;
      prev.name = r.name;
      prev.key = r.key;
      prev.aliases = r.aliases;
      prev.typeRaw = r.typeRaw;
      prev.typeZh = r.typeZh;
      prev.stats = r.stats;
      prev.hidden = r.hidden;
      prev.linkable = r.linkable;
    }
    prev.altCount = prev.altCount || 0;
    r.drop = true;
  }
}
const kept = records.filter(r => !r.drop);
records.length = 0;
for (const r of kept) { delete r.drop; byKey.set(r.key, r); records.push(r); }

/* 7.6 key 重建后修正映射（去重时 key 可能被替换） */
byKey.clear();
for (const r of records) if (!byKey.has(r.key)) byKey.set(r.key, r);

/* ---------- 8. 链接目标与出边 ---------- */
const kindRank = { char: 0, card: 1, skill: 2, term: 3 };
const linkTargets = new Map();
for (const r of records) {
  /* mirror 排除在「出边来源」之外（它的描述是身份的副本，扫一遍只会得到重复引用），
     但它仍可作为链接目标：正文里出现「眩晕」时要能点开解释。 */
  if (!r.linkable) continue;
  const prev = linkTargets.get(r.name);
  if (!prev || kindRank[r.kind] < kindRank[prev.kind]) linkTargets.set(r.name, r);
}
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const names = [...linkTargets.keys()].sort((a, b) => b.length - a.length);
const chunks = [];
for (let i = 0; i < names.length; i += 400) chunks.push(names.slice(i, i + 400));
const res = chunks.map(c => new RegExp(c.map(escRe).join("|"), "g"));

for (const r of records) {
  if (!r.linkable || r.flags.mirror) continue;
  const text = [r.desc.effect, r.desc.rules].filter(Boolean).join("\n");
  if (!text) continue;
  const set = new Set();
  for (const re of res) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const target = linkTargets.get(m[0]);
      if (target && target.key !== r.key) set.add(target.key);
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  r.refs = [...set];
}

/* ---------- 8.5 概念索引（名字 → 条目列表） ----------
 *
 * 一个名字可能同时属于多种概念：「护盾」既是状态牌也是关键词，「幻戏」既是机制术语
 * 也是某角色的技能名。概念页与悬浮提示按列表顺序并列展示，所以这里输出的是
 * 「名字 → 有序条目」而不是「记录 → 名字」。
 *
 * 以前这些判定分散在运行时：收录条件、身份是否压过同名技能、同种类怎么取舍、
 * 展示顺序，各有各的启发式。现在全部在此一次算完，运行时只做投影。
 * 好处不是性能，而是「同一张牌在不同界面得出不同结论」这件事不再可能发生。 */
const TERM_ENTRY_KIND = {
  keywords: "keyword", keyword: "keyword", rule: "rule", "rule-term": "rule-term",
  status: "status", summon: "summon", enemy: "enemy", attachment: "attachment",
  card: "cardref", character: "charref",
};
/* 并列顺序：身份（卡/角色）→ 规则术语 → 技能 → 对局实体。
   规则术语排在技能前：同名时「幻戏」这类机制词义更常用（技能只是某角色的内部命名），
   先看机制解释更符合直觉；技能页有独立入口，不会被埋掉。 */
const CONCEPT_KIND_ORDER = ["card", "char", "keyword", "rule", "rule-term", "skill",
  "status", "summon", "enemy", "attachment", "cardref", "charref"];
const KIND_GROUP_OF = { card: "card", cardref: "card", char: "char", charref: "char" };

/* 补充库条目能否接回真实身份：只有当它的种类与 piovium 身份种类相符时才挂，
   否则保留 cardref/charref 的降级语义（点击走概念弹层，不跳到不存在的详情） */
function conceptKindOf(r) {
  if (r.kind !== "term") return r.kind;
  const raw = r.typeRaw;
  const identityKind = String(r.rel.relatedCharacterKey || "").split(":")[0];
  if (r.sameIdentity && (raw === "card" || raw === "cardref") && identityKind === "card") return "card";
  if (r.sameIdentity && (raw === "char" || raw === "charref") && identityKind === "char") return "char";
  return TERM_ENTRY_KIND[raw] || "keyword";
}
/* 同种类内的取舍：现网优先 → 可入构筑 → 有描述。
   有牌面不能算加分项：同名版本里「有图但无描述」的那条恰恰是最该被跳过的
   （如「元素附魔：冰」的两条记录），用图优先会把它推上来。 */
const conceptScore = r =>
  (r.source === "piovium" ? 4 : 0) + (r.flags.deckable ? 2 : 0) + (r.desc.effect ? 1 : 0);

const identityNorms = new Set();
for (const r of records) if ((r.kind === "card" || r.kind === "char") && r.linkable) identityNorms.add(r.aliases.norm);

const conceptGroups = new Map();   /* name → Map<种类组, {key, kind, score}> */
for (const r of records) {
  /* terms 是「概念页/悬浮提示要展示什么」，mirror 的含义就是「与身份重复」，
     收进来只会让概念页并列两条同样的内容。词表（linkTargets）不受影响，
     正文里出现这个名字照样能点。 */
  if (!r.linkable || r.flags.mirror || !r.name || r.name.length < 2) continue;
  const kind = conceptKindOf(r);
  /* 身份优先于同名技能：卡文里的「神里流·霰步」指的首先是那张牌 */
  if (kind === "skill" && identityNorms.has(r.aliases.norm)) continue;
  const group = KIND_GROUP_OF[kind] || kind;
  let groups = conceptGroups.get(r.name);
  if (!groups) conceptGroups.set(r.name, groups = new Map());
  const score = conceptScore(r);
  const cur = groups.get(group);
  if (!cur) groups.set(group, { key: r.key, kind, score });
  else if (score > cur.score) { cur.key = r.key; cur.kind = kind; cur.score = score; }
  /* 平手保留先到的：piovium 原始关键词先于派生的反应术语注册 */
}
const terms = [...conceptGroups]
  .map(([name, groups]) => ({
    name,
    entries: [...groups.values()]
      .sort((a, b) => {
        const ia = CONCEPT_KIND_ORDER.indexOf(a.kind), ib = CONCEPT_KIND_ORDER.indexOf(b.kind);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      })
      .map(e => ({ key: e.key, kind: e.kind })),
  }))
  .sort((a, b) => a.name.length - b.name.length || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

/* ---------- 9. 测试卡判定（与运行时一致：名称含 test 标记） ---------- */
function isTestCard(e) {
  return /[（(]\s*test\s*[）)]/i.test(e.name || "");
}
/* 注意：isTestCard 在 7.2 已被调用；函数声明的提升保证其可用。 */

/* ---------- 10. 校验与统计 ---------- */
const stats = {
  total: records.length,
  chars: records.filter(r => r.kind === "char").length,
  cards: records.filter(r => r.kind === "card").length,
  skills: records.filter(r => r.kind === "skill").length,
  skillChar: records.filter(r => r.kind === "skill" && r.rel.ownerKind === "char").length,
  skillCard: records.filter(r => r.kind === "skill" && r.rel.ownerKind === "card").length,
  terms: records.filter(r => r.kind === "term").length,
  linkable: records.filter(r => r.linkable).length,
  withFace: records.filter(r => r.art.hasFace).length,
  shadow: records.filter(r => r.flags.shadow).length,
  mirror: records.filter(r => r.flags.mirror).length,
  test: records.filter(r => r.flags.test).length,
  refs: records.reduce((n, r) => n + r.refs.length, 0),
  conceptNames: terms.length,
  conceptEntries: terms.reduce((n, t) => n + t.entries.length, 0),
};
const problems = [];
if (stats.chars !== CHAR.length) problems.push(`角色数不一致：记录 ${stats.chars} / 源 ${CHAR.length}`);
if (stats.cards !== ENT.filter(e => e.name).length) problems.push(`卡牌记录数不一致：记录 ${stats.cards} / 源 ${ENT.filter(e => e.name).length}`);
for (const r of records) {
  if (r.kind === "skill" && !r.rel.ownerKey) problems.push(`技能缺少所属：${r.key}`);
  if (r.kind === "skill" && r.linkable && !r.desc.effect) problems.push(`可链接技能无描述：${r.key}`);
}
const dup = new Set(), dups = [];
for (const r of records) { if (dup.has(r.key)) dups.push(r.key); dup.add(r.key); }
if (dups.length) problems.push(`重复 key：${dups.slice(0, 5).join(", ")}`);

/* 概念索引必须是记录的纯投影：出现的每个 key 都要能取到记录，
   否则运行时投影会拿到 undefined，概念页只剩空壳。 */
const missingConcept = [];
for (const t of terms) for (const e of t.entries) if (!byKey.has(e.key)) missingConcept.push(`${t.name} → ${e.key}`);
if (missingConcept.length) problems.push(`概念索引指向不存在的记录：${missingConcept.slice(0, 5).join(" / ")}`);

if (problems.length) {
  console.error("数据集校验失败：");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}

/* ---------- 11. 输出 ---------- */
const payload = { v: 1, builtAt: new Date().toISOString(), stats, records, terms };
const json = JSON.stringify(payload);
fs.writeFileSync(path.join(ROOT, "gi-data/dataset.json"), json, "utf8");
const br = zlib.brotliCompressSync(Buffer.from(json, "utf8"), {
  params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
});
fs.writeFileSync(path.join(ROOT, "gi-data/dataset.br"), br);
/* 浏览器原生 DecompressionStream 只支持 gzip/deflate（不支持 brotli），
   所以同一份 JSON 再压一份 gzip 作为运行时主路径；br 保留给 Node / 归档 / 未来解码器。 */
const gz = zlib.gzipSync(Buffer.from(json, "utf8"), { level: 9 });
fs.writeFileSync(path.join(ROOT, "gi-data/dataset.gz"), gz);
fs.writeFileSync(
  path.join(ROOT, "gi-data/dataset.meta.json"),
  JSON.stringify({ v: 1, builtAt: payload.builtAt, stats }, null, 2) + "\n",
  "utf8",
);

const kb = n => (n / 1024).toFixed(1) + " KB";
console.log("数据集已生成");
console.log(`  记录 ${stats.total}（角色 ${stats.chars} / 卡牌 ${stats.cards} / 技能 ${stats.skills} / 术语 ${stats.terms}）`);
console.log(`  技能来源：角色 ${stats.skillChar} · 装备牌特技 ${stats.skillCard}`);
console.log(`  可链接 ${stats.linkable} · 有牌面 ${stats.withFace} · 影子 ${stats.shadow} · 镜像 ${stats.mirror} · 测试 ${stats.test}`);
console.log(`  出边引用 ${stats.refs} · 概念 ${stats.conceptNames} 名 / ${stats.conceptEntries} 条`);
console.log(`  dataset.json ${kb(Buffer.byteLength(json))} → br ${kb(br.length)} / gz ${kb(gz.length)}`);

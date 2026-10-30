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
function descSimilar(a, b) {
  const x = normDesc(a), y = normDesc(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  return Math.abs(x.length - y.length) <= 2 && Math.min(x.length, y.length) / Math.max(x.length, y.length) > 0.92;
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

/* 7.3 关键词术语（牌面文本镜像不进概念） */
for (const k of KW) {
  if (!k.name || k.name.length < 2) continue;
  const key = "term:" + k.id;
  const desc = (k.description || "").trim();
  const hit = entByNorm.get(T.nameKey(k.name));
  const mirror = !!hit && descSimilar(k.description, hit.obj.description);
  push({
    key, kind: "term", domain: "term",
    name: k.name, englishName: "", aliases: aliasOf(k.name),
    typeRaw: k.category || "keywords", typeZh: "术语",
    desc: { effect: desc, story: "", rules: desc },
    linkable: !!desc && !mirror,
    art: { hasFace: false, ref: null, kind: "none" },
    stats: { cost: [], dice: -1, energy: 0, hp: null, maxEnergy: null, tags: [], tagsRaw: [], element: "" },
    rel: { ownerKey: null, ownerName: null, ownerKind: null, relatedCharacterId: null, relatedCharacterKey: null },
    flags: { deckable: false, poolable: false, shadow: false, mirror, test: false, entity: false },
    version: "", refs: [], source: "piovium",
  });
}

/* 7.4 补充概念：能接回真实身份就挂身份，否则作为独立术语 */
const ENTITY_KINDS = new Set(["status", "summon", "enemy", "attachment"]);
for (const [name, info] of Object.entries(EXTRA)) {
  if (!name || name.length < 2) continue;
  const kind = info.kind || "keyword";
  const desc = (info.desc || "").trim();
  const hit = entByNorm.get(T.nameKey(name));
  const sameIdentity = !!hit && T.cosmeticKey(name) === T.cosmeticKey(hit.obj.name);
  const mirror = !!hit && (ENTITY_KINDS.has(kind) || descSimilar(desc, hit.obj.description));
  const key = "term:x:" + encodeURIComponent(name);
  push({
    key, kind: "term", domain: "term",
    name, englishName: "", aliases: aliasOf(name),
    typeRaw: kind, typeZh: info.type || "概念",
    desc: { effect: desc, story: "", rules: desc },
    linkable: !!desc && !mirror,
    art: {
      hasFace: !!hit && !!hit.obj.cardFace,
      ref: hit && hit.obj.cardFace ? hit.obj.id : null,
      kind: hit && hit.kind === "char" ? "char" : "card",
    },
    stats: { cost: [], dice: -1, energy: 0, hp: null, maxEnergy: null, tags: [], tagsRaw: [], element: "" },
    rel: {
      ownerKey: null, ownerName: null, ownerKind: null,
      relatedCharacterId: hit && hit.kind === "char" ? hit.obj.id : null,
      relatedCharacterKey: hit ? (hit.kind === "char" ? "char:" : "card:") + hit.obj.id : null,
    },
    flags: { deckable: false, poolable: false, shadow: false, mirror, test: false, entity: false },
    version: "", refs: [], source: "genshin-db", sameIdentity,
  });
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
  if (!r.linkable || r.flags.mirror) continue;
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

if (problems.length) {
  console.error("数据集校验失败：");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}

/* ---------- 11. 输出 ---------- */
const payload = { v: 1, builtAt: new Date().toISOString(), stats, records };
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
console.log(`  出边引用 ${stats.refs}`);
console.log(`  dataset.json ${kb(Buffer.byteLength(json))} → br ${kb(br.length)} / gz ${kb(gz.length)}`);

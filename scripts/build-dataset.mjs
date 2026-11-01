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
 *   src/core/resources.ts          译名表与标签翻译（TS，用 esbuild 打包后注入 vm）
 *   src/12-model.js                类型语义与身份判定（用 vm 取常量，避免第二份真源）
 *   pinyin-pro（devDependencies）  拼音在构建期写进每条记录的别名，无独立索引文件
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
import { pinyin as pyLib } from "pinyin-pro";
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
    NO_ART_KIND: __MODEL.NO_ART_KIND,
    SKILL_TAG_ZH: __MODEL.SKILL_TAG_ZH, SKILL_TAG_ORDER: __MODEL.SKILL_TAG_ORDER,
    typeZhOf: __MODEL.typeZhOf, typeSpecOf: __MODEL.typeSpecOf,
    nameKey: __MODEL.nameKey, cosmeticKey: __MODEL.cosmeticKey,
    PREPARED_STATE_RE: __MODEL.PREPARED_STATE_RE,
    TAG_ZH: __RES.TAG_ZH, ELE_ZH: __RES.ELE_ZH, WEAPON_ZH: __RES.WEAPON_ZH, tagZh: __RES.tagZh,
    ELE_CODE: __RES.ELE_CODE, NATION_CODE: __RES.NATION_CODE, CAMP_CODE: __RES.CAMP_CODE
  })`;
  return vm.runInContext(code + expr, ctx);
}
const T = loadTaxonomy();
/* 技能类型表的唯一来源是 src/data/model.ts（含 GCG_SKILL_TAG_VEHICLE → 「特技」），
   与运行时 47-skills 共用，不再各抄一份 */
const SKILL_TAG_ZH = T.SKILL_TAG_ZH;
const POOL_TYPES = new Set(T.TYPE_ORDER);

/* ---------- 2. 拼音（pinyin-pro 构建期直算，只有一份：长在记录的别名上） ----------
 * 曾经由 build-pinyin.mjs 生成独立的 pinyin.js（names + 逐字兜底表，126KB）打进
 * 每个产物；现在拼音在数据集构建时直接算好写进 aliases.pinyin（空格分隔音节、
 * 无声调），全拼与首字母在运行时从音节派生。数据集本体已经 gzip/br 压缩存储，
 * 拼音随之压缩；来源覆盖也天然完整——包括构建期派生的反应术语这类
 * 「不在任何源数据名字清单里」的记录。 */
const PY_OVERRIDES = { 重云: ["zhong", "yun"] };   /* 专名按常用义读音人工校订 */
const cleanPyName = s => String(s || "").normalize("NFKC").replace(/[^\p{Script=Han}A-Za-z0-9]/gu, "");
function pinyinOf(name) {
  const n = cleanPyName(name);
  if (!n) return "";
  const syl = (PY_OVERRIDES[name] || pyLib(n, { toneType: "none", type: "array", v: true, nonZh: "consecutive" })
    .map(s => String(s).toLowerCase()))
    .filter(s => /^[a-z0-9]+$/.test(s));
  return syl.join(" ");
}

/* ---------- 3. 工具 ---------- */
/* 费用是按「条目 × 数量」计的：{type:"GCG_COST_DICE_GEO", count:2} 是 2 点岩骰，
   不是 1 点。早先这里按条目数（length）算，于是所有卡的费用都算成了 0/1，
   直到卡池要从记录里取费用才暴露——所以判据必须落在 count 上。 */
const costTypeOf = c => (c && typeof c === "object" ? String(c.type || "") : String(c || ""));
const costCountOf = c => (c && typeof c === "object" ? Number(c.count) || 0 : 1);
const isEnergyCost = c => costTypeOf(c) === "GCG_COST_ENERGY";
const isDiceCost = c => /^GCG_COST_DICE/.test(costTypeOf(c)) && !isEnergyCost(c);
const diceCostOf = cost => (cost || []).filter(isDiceCost).reduce((a, c) => a + costCountOf(c), 0);
const energyCostOf = cost => (cost || []).filter(isEnergyCost).reduce((a, c) => a + costCountOf(c), 0);
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

/* ---------- 5.5 牌间依赖（构筑门槛 + 打出限制） ----------
 * 这两类判定过去在运行时的 30-deps 里按 tags + 描述正则现算：
 *   · 牌组限制 deckChar / deckEl / deckTag —— 加入牌组前必须满足；
 *   · 打出限制 legend / talent / weapon / once —— 对局中生效。
 * 现算的问题是同一张牌在卡库、详情、导出三处各算一遍，规则改一处就漏两处；
 * 而且 deckChar 需要角色名，运行时要靠 charById 反查，index 没建好就静默失配。
 * 这里一次算完写进记录，运行期只读。 */
const charNameById = new Map(CHAR.map(c => [c.id, c.name]));
const charIdByName = new Map(CHAR.map(c => [c.name, c.id]));
const REQ_CHAR_RE = /牌组中包含([^，。]{2,12}?)，才能加入牌组/;
const REQ_MIN_RE = /牌组包含至少(\d+)个[^，]*?角色，才能加入牌组/;
const REQ_MIN_PARTS_RE = /牌组包含至少(\d+)个([^，]*?)(元素|)角色，才能加入牌组/;

function deckReqsOf(e) {
  const R = [];
  /* 具体角色：结构化 id 优先；id 缺失（新卡暂无角色数据）时退回描述正则 */
  if (e.relatedCharacterId != null) {
    const n = charNameById.get(e.relatedCharacterId) || "";
    if (n) R.push({ code: "deckChar", name: n, charId: e.relatedCharacterId,
      short: `牌组·${n}`, label: `牌组限制：牌组中需包含角色「${n}」才能加入` });
  } else {
    const m = REQ_CHAR_RE.exec(e.description || "");
    /* 描述里含 #{REALNAME[..]} 占位的卡（如梦迹一风）取不到真名，宁可不判也不写错名字 */
    if (m && !/[#{\[]/.test(m[1])) {
      const n = m[1].trim();
      R.push({ code: "deckChar", name: n, charId: charIdByName.get(n) ?? null,
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
    if (!/^GCG_TAG_(ELEMENT|NATION|CAMP)_(.+)$/.test(t)) continue;
    const mn = REQ_MIN_RE.exec(e.description || "");
    push(t, T.tagZh(t), mn ? +mn[1] : 2);
  }
  if (!seen.size) {
    const m = REQ_MIN_PARTS_RE.exec(e.description || "");
    if (m) {
      const n = +m[1], txt = m[2].replace(/^「|」$/g, "");
      const tag = T.ELE_CODE[txt] || T.NATION_CODE[txt] || T.CAMP_CODE[txt];
      if (tag) push(tag, txt, n);
    }
  }
  return R;
}

function playRestrictionsOf(e) {
  const R = [];
  const tags = e.tags || [];
  if (tags.includes("GCG_TAG_LEGEND"))
    R.push({ code: "legend", short: "秘传·限1", label: "秘传牌：整套牌组只能放入 1 张（含同名卡）" });
  if (tags.includes("GCG_TAG_TALENT") && e.relatedCharacterId != null) {
    const n = charNameById.get(e.relatedCharacterId) || e.relatedCharacterId;
    R.push({ code: "talent", short: "须在场", label: `天赋牌：仅当 ${n} 在场时才能打出` });
  }
  if (tags.includes("GCG_TAG_WEAPON")) {
    const w = tags.find(t => /^GCG_TAG_WEAPON_(?!.*NONE$).+$/.test(t) && t !== "GCG_TAG_WEAPON");
    if (w) {
      const zh = T.WEAPON_ZH[w.replace("GCG_TAG_WEAPON_", "")] || w;
      R.push({ code: "weapon", short: zh, label: `装备限制：仅可装备给${zh}角色` });
    }
  }
  const m = /最多打出(\d+|一|两|二|三)张/.exec(e.description || "");
  if (m) R.push({ code: "once", short: `限${m[1]}张`, label: `打出限制：本场对局最多打出 ${m[1]} 张` });
  return R;
}
const NO_REQS = { deck: [], play: [] };

/* 卡牌元素：自身 tag → 关联角色 → 牌组限制里的元素门槛（元素共鸣牌）。
   天赋牌自身不带元素 tag，过去只能靠运行时的 cardElement 现推，
   于是卡池（运行时）能筛元素、记录（构建期）却查不到。 */
const charTagsById = new Map(CHAR.map(c => [c.id, c.tags || []]));
function cardElementOf(e, tags) {
  const own = elemOfTags(tags);
  if (own) return own;
  const relTags = e.relatedCharacterId != null ? charTagsById.get(e.relatedCharacterId) : null;
  if (relTags) return elemOfTags(relTags);
  const req = deckReqsOf(e).find(r => r.code === "deckEl");
  return req && req.tag ? String(req.tag).replace("GCG_TAG_ELEMENT_", "") : "";
}
/* 检索语料：名称之外的全文（角色含简介与技能，卡牌含效果与特技），小写。
   过去由卡池在运行时拼接，只服务卡库；检索若从记录取名字就永远匹配不到描述。 */
const corpusOf = (name, english, texts) =>
  [name, english, ...texts.filter(Boolean)].join("\n").toLowerCase();

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
  return {
    norm: T.nameKey(name),
    cosmetic: T.cosmeticKey(name),
    pinyin: pinyinOf(name),
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
    share: c.shareId ?? null,
    reqs: NO_REQS,
    searchText: corpusOf(c.name, c.englishName, [
      (c.storyText || "").trim(),
      ...(c.skills || []).map(x => `${x.name || ""}${x.description || ""}`),
    ]),
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
      share: null, reqs: NO_REQS, searchText: "",
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
      element: cardElementOf(e, tags),
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
    share: e.shareId ?? null,
    reqs: { deck: deckReqsOf(e), play: playRestrictionsOf(e) },
    searchText: corpusOf(e.name, e.englishName, [
      (e.description || "").trim(),
      ...(e.skills || []).map(x => `${x.name || ""}${x.description || ""}`),
    ]),
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
      /* 装备牌赋予的技能在游戏原文里就叫「特技」（卡面：「特技：X」「角色最多装备1个「特技」」），
         不看 typeRaw 的技能码——那是数据源的内部分类（VEHICLE 等），游戏里并没有这个概念 */
      typeRaw: s.type || "", typeZh: "特技",
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
      share: null, reqs: NO_REQS, searchText: "",
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
    share: null, reqs: NO_REQS, searchText: "",
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
const kept = records.filter(r => !r.drop && !r.flags.test);   /* 测试牌不入数据（flags.test 由 7.2 的 isTestCard 标定） */
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

/* 静态断言：叙事文本永不产生出边。refs 只扫 [desc.effect, desc.rules]（上面 8.5 的
   text join），角色记录只有 story——一旦有人把 story 加进扫描范围，反链面板就会被
   「简介提到术语的角色」污染。这里把约定钉死成构建失败。 */
for (const r of records) {
  if (r.kind === "char" && (r.refs || []).length) {
    throw new Error(`角色记录「${r.name}」的 refs 非空（${r.refs.length} 条）：叙事文本被误扫进出边`);
  }
}

/* ---------- 8.6 特技牌的关联角色 ----------
 * piovium 只给天赋牌标注所属角色（relatedCharacterId），特技牌（带技能的装备牌）留空。
 * 两级推导，都只在源数据缺省时生效：
 *   1) 出边：refs 引用的角色唯一（正文点名，如「（仅玛薇卡可用）」、咬咬鲨鱼点名词拉妮）；
 *   2) id 结构：角色专属卡的 id = 1 + 角色id(4位) + 序号（112142→1214、122051→2205、
 *      313001→1300 不存在即通用）——这是数据源自身的编码规律，比正文更结构化；
 * 两者冲突时信出边并告警。通用装备（浪船等）两路都落空，保持 null——
 * 「关联角色」的语义是「只属于谁」，不是「提到过谁」。
 * 推导后重算元素：与天赋牌同一条 cardElementOf 回退链（自身 tag → 关联角色 → 门槛），
 * 否则关联写上了、元素还停在推导前的空串。 */
{
  const skillOwners = new Set(
    records.filter(r => r.kind === "skill" && r.rel.ownerKind === "card").map(r => r.rel.ownerKey),
  );
  let byRefs = 0, byId = 0;
  for (const r of records) {
    if (r.kind !== "card" || r.typeRaw !== "GCG_CARD_MODIFY") continue;
    if (!skillOwners.has(r.key)) continue;      /* 只补特技牌：关联角色在此有明确消费方 */
    if (r.rel.relatedCharacterId != null) continue;
    const chars = [...new Set(r.refs.filter(k => /^char:\d+$/.test(k)))];
    const refChar = chars.length === 1 ? Number(chars[0].slice(5)) : null;
    let id = Number.isFinite(refChar) ? refChar : null;
    let how = "refs";
    if (id == null && /^1\d{5}$/.test(r.key.slice(5))) {
      const cand = Number(r.key.slice(6, 10));
      if (charTagsById.has(cand)) { id = cand; how = "id"; }
    }
    if (id == null) continue;
    if (refChar != null && refChar !== id) {
      console.log(`  ⚠ 关联冲突：${r.name} 出边=${refChar} vs id推导=${id}（取出边）`);
      id = refChar;
    }
    r.rel.relatedCharacterId = id;
    r.rel.relatedCharacterKey = "char:" + id;
    const own = elemOfTags(r.stats.tagsRaw);
    if (!own) {
      const relTags = charTagsById.get(id);
      if (relTags) r.stats.element = elemOfTags(relTags);
    }
    if (how === "refs") byRefs++; else byId++;
  }
  console.log(`  特技牌关联角色推导：补齐 ${byRefs + byId} 张（出边 ${byRefs} · id 结构 ${byId}）`);
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
if (stats.cards !== ENT.filter(e => e.name && !isTestCard(e)).length) problems.push(`卡牌记录数不一致：记录 ${stats.cards} / 源（扣除测试牌） ${ENT.filter(e => e.name && !isTestCard(e)).length}`);
for (const r of records) {
  if (r.kind === "skill" && !r.rel.ownerKey) problems.push(`技能缺少所属：${r.key}`);
  /* 特技 = 装备牌赋予的技能（游戏概念），与技能码无关：这条一旦破，
     检索标签、技能页、角色详情特技段会各自退回「技能」 */
  if (r.kind === "skill" && r.rel.ownerKind === "card" && r.typeZh !== "特技") {
    problems.push(`装备牌技能未标特技：${r.key}（${r.name}）`);
  }
  /* 拼音完善是硬约束：任何有名记录缺拼音，拼音检索就对它整条失效 */
  if (r.name && !r.aliases.pinyin) problems.push(`记录缺拼音：${r.key}（${r.name}）`);
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
console.log(`  拼音抽样：称名之刻 → ${pinyinOf("称名之刻")} ｜ 重云 → ${pinyinOf("重云")}`);
console.log(`  dataset.json ${kb(Buffer.byteLength(json))} → br ${kb(br.length)} / gz ${kb(gz.length)}`);

// 七圣召唤牌组码解码器（已归档）
// 逻辑移植自 piovium/genius-invokation packages/assets-manager/src/sharing.ts
// 数据源：官方静态数据服务 static-data.piovium.org (api/v5)
// 用法: node archive/gi-deck-decode.mjs <牌组分享码>
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const API = "https://static-data.piovium.org/api/v5";
const CACHE_DIR = path.join(ROOT, "gi-data");
const CODE = (process.argv[2] || "").trim();

if (!CODE) {
  console.error("用法: node archive/gi-deck-decode.mjs <牌组分享码>");
  process.exit(1);
}

// ---------- 数据获取(带本地缓存) ----------
async function fetchCategory(cat) {
  const file = path.join(CACHE_DIR, `${cat}.json`);
  if (existsSync(file)) {
    return JSON.parse(readFileSync(file, "utf8")).data;
  }
  const url = `${API}/data/latest/CHS/${cat}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`获取 ${cat} 失败: HTTP ${r.status}`);
  const j = await r.json();
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(j));
  return j.data;
}

// ---------- 分享码解码 (移植 decodeRaw) ----------
function decodeRaw(src) {
  const bin = Buffer.from(src, "base64");
  const arr = Array.from(bin);
  if (arr.length !== 51) {
    throw new Error(`Invalid input: 期望 51 字节, 实际 ${arr.length}`);
  }
  const last = arr.pop();
  const reordered = [
    ...Array.from({ length: 25 }, (_, i) => (arr[2 * i] - last) & 0xff),
    ...Array.from({ length: 25 }, (_, i) => (arr[2 * i + 1] - last) & 0xff),
    0,
  ];
  const result = Array.from({ length: 17 }).flatMap((_, i) => [
    (reordered[i * 3] << 4) + (reordered[i * 3 + 1] >> 4),
    ((reordered[i * 3 + 1] & 0xf) << 8) + reordered[i * 3 + 2],
  ]);
  result.pop();
  return result; // 33 个分享 id
}

// ---------- 分享码编码 (移植 encodeRaw, 仅用于回环自校验, 不做屏蔽词规避) ----------
function encodeRaw(arr) {
  if (arr.length !== 33) throw new Error("encodeRaw: 需要 33 个数");
  const padded = [...arr, 0];
  const reordered = Array.from({ length: 17 }).flatMap((_, i) => [
    padded[i * 2] >> 4,
    ((padded[i * 2] & 0xf) << 4) + (padded[i * 2 + 1] >> 8),
    arr[i * 2 + 1] & 0xff,
  ]);
  const last = 0;
  const original = Array.from({ length: 25 }).flatMap((_, i) => [
    (reordered[i] + last) & 0xff,
    (reordered[i + 25] + last) & 0xff,
  ]);
  return Buffer.from([...original, last]).toString("base64");
}

// ---------- 标签/类型翻译 ----------
const TYPE_MAP = {
  GCG_CARD_CHARACTER: "角色牌",
  GCG_CARD_MODIFY: "装备牌",
  GCG_CARD_SUPPORT: "支援牌",
  GCG_CARD_EVENT: "事件牌",
  GCG_CARD_ASSIST: "援助牌",
};
const TAG_MAP = {
  GCG_TAG_ELEMENT_CRYO: "冰", GCG_TAG_ELEMENT_HYDRO: "水", GCG_TAG_ELEMENT_PYRO: "火",
  GCG_TAG_ELEMENT_ELECTRO: "雷", GCG_TAG_ELEMENT_ANEMO: "风", GCG_TAG_ELEMENT_GEO: "岩",
  GCG_TAG_ELEMENT_DENDRO: "草",
  GCG_TAG_WEAPON_BOW: "弓", GCG_TAG_WEAPON_CATALYST: "法器", GCG_TAG_WEAPON_CLAYMORE: "双手剑",
  GCG_TAG_WEAPON_SWORD: "单手剑", GCG_TAG_WEAPON_POLE: "长柄武器", GCG_TAG_WEAPON_NONE: "其他武器",
  GCG_TAG_NATION_MONDSTADT: "蒙德", GCG_TAG_NATION_LIYUE: "璃月", GCG_TAG_NATION_INAZUMA: "稻妻",
  GCG_TAG_NATION_SUMERU: "须弥", GCG_TAG_NATION_FONTAINE: "枫丹", GCG_TAG_NATION_NATLAN: "纳塔",
  GCG_TAG_NATION_SNEZHNAYA: "至冬", GCG_TAG_NATION_FATUI: "愚人众",
  GCG_TAG_CAMP_MONSTER: "魔物", GCG_TAG_CAMP_HILICHURL: "丘丘人",
};
const tagZh = (t) => TAG_MAP[t] ?? t;
// 角色标签后缀翻译 (元素/武器/势力)
const SUFFIX_ZH = {
  CRYO: "冰", HYDRO: "水", PYRO: "火", ELECTRO: "雷", ANEMO: "风", GEO: "岩", DENDRO: "草",
  CATALYST: "法器", SWORD: "单手剑", CLAYMORE: "双手剑", BOW: "弓", POLE: "长柄武器", NONE: "其他武器",
  MONDSTADT: "蒙德", LIYUE: "璃月", INAZUMA: "稻妻", SUMERU: "须弥", FONTAINE: "枫丹",
  NATLAN: "纳塔", SNEZHNAYA: "至冬", FATUI: "愚人众", NODKRAI: "挪德卡莱",
};
const suffixZh = (t) => SUFFIX_ZH[t] ?? t;

// ---------- 主流程 ----------
const [characters, entities] = await Promise.all([
  fetchCategory("characters"),
  fetchCategory("entities"),
]);

// shareId -> 定义 id 映射 (与 fetch.ts 相同逻辑)
const shareMap = {};
for (const c of [...characters, ...entities]) {
  if (c.shareId !== null && c.shareId !== undefined) shareMap[c.shareId] = c.id;
}
const charById = new Map(characters.map((c) => [c.id, c]));
const entById = new Map(entities.map((e) => [e.id, e]));

// 1) 解码
const shareIds = decodeRaw(CODE);
// 2) 回环自校验: encode(decode(code)) 解码回来应等于自身
const roundTrip = decodeRaw(encodeRaw(shareIds));
const rtOk = JSON.stringify(roundTrip) === JSON.stringify(shareIds);

// 3) 分享 id -> 定义 id
const ids = shareIds.map((s) => {
  const id = shareMap[s];
  if (!id) throw new Error(`未知的分享 id: ${s}`);
  return id;
});
const deck = { characters: ids.slice(0, 3), cards: ids.slice(3) };

// 4) 反查信息
const charInfos = deck.characters.map((id) => {
  const c = charById.get(id);
  if (!c) throw new Error(`未知角色 id: ${id}`);
  return {
    id, name: c.name, hp: c.hp, maxEnergy: c.maxEnergy,
    element: suffixZh((c.tags.find((t) => t.startsWith("GCG_TAG_ELEMENT")) || "").replace("GCG_TAG_ELEMENT_", "")),
    weapon: suffixZh((c.tags.find((t) => t.startsWith("GCG_TAG_WEAPON")) || "").replace("GCG_TAG_WEAPON_", "")),
    nation: suffixZh((c.tags.find((t) => t.startsWith("GCG_TAG_NATION")) || "").replace("GCG_TAG_NATION_", "")),
    skills: c.skills.map((s) => s.name),
    sinceVersion: c.sinceVersion,
  };
});
const cardInfos = deck.cards.map((id) => {
  const e = entById.get(id);
  if (!e) throw new Error(`未知卡牌 id: ${id}`);
  const related = e.relatedCharacterId ? charById.get(e.relatedCharacterId) : null;
  return {
    id, name: e.name,
    type: TYPE_MAP[e.type] ?? e.type,
    tags: e.tags.map(tagZh),
    playCost: e.playCost,
    relatedCharacter: related ? related.name : null,
    description: (e.description || "").trim(),
    sinceVersion: e.sinceVersion,
  };
});

const result = {
  code: CODE,
  roundTripVerified: rtOk,
  characters: charInfos,
  cards: cardInfos,
};
writeFileSync(path.join(__dirname, "deck_result.json"), JSON.stringify(result, null, 2));

// ---------- 控制台输出 ----------
console.log(`回环自校验: ${rtOk ? "通过" : "失败!"}`);
console.log("=".repeat(60));
console.log("【角色牌 ×3】");
for (const c of charInfos) {
  console.log(`  ${c.name} | 元素:${c.element} 武器:${c.weapon} 势力:${c.nation} | 生命:${c.hp} 充能:${c.maxEnergy} | ${c.sinceVersion}`);
  console.log(`    技能: ${c.skills.join(" / ")}`);
}
console.log("-".repeat(60));
const byType = {};
for (const cd of cardInfos) (byType[cd.type] ??= []).push(cd);
for (const [type, list] of Object.entries(byType)) {
  console.log(`【${type} ×${list.length}】`);
  for (const cd of list) {
    const rel = cd.relatedCharacter ? ` (关联:${cd.relatedCharacter})` : "";
    const desc = cd.description.replace(/\s+/g, " ").slice(0, 60);
    console.log(`  ${cd.name}${rel} [${cd.tags.join(",")}] ${cd.sinceVersion}`);
    if (desc) console.log(`    ${desc}${cd.description.length > 60 ? "…" : ""}`);
  }
}
console.log("=".repeat(60));
console.log(`完整结果已写入 deck_result.json`);

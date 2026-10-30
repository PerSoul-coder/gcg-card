/* src/ 统一数据集 · 装备牌特技、叙事文本不链接、牌面统一
   覆盖用户报告：
   1) 某些特技（装备牌赋予的技能）不在牌库中，搜不到也点不动；
   2) 角色简介里的关键词被当成概念；
   3) 概念深钻里有牌面的牌不渲染牌面。
   反向验证：数据集统计与 Brotli 产物一致，避免"只测运行时、数据包坏了没人发现"。 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { readAppSource } from "./test-lib.mjs";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = {};
for (const cat of ["characters", "entities", "keywords"])
  DATA[cat] = JSON.parse(fs.readFileSync(path.join(here, `gi-data/${cat}.json`), "utf8")).data;
const conceptsExtra = JSON.parse(
  fs.readFileSync(path.join(here, "gi-data/concepts-extra.js"), "utf8")
    .replace(/^export const CONCEPTS_EXTRA = /, "").replace(/;\s*$/, ""),
);

let fails = 0;
const assert = (cond, msg) => { if (cond) console.log("  ok:", msg); else { console.error("  FAIL:", msg); fails++; } };

/* ---- 数据包自身一致性（不依赖运行时） ---- */
const dsJson = JSON.parse(fs.readFileSync(path.join(here, "gi-data/dataset.json"), "utf8"));
const dsBr = JSON.parse(zlib.brotliDecompressSync(fs.readFileSync(path.join(here, "gi-data/dataset.br"))).toString("utf8"));
const dsGz = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(here, "gi-data/dataset.gz"))).toString("utf8"));
assert(dsJson.records.length === dsBr.records.length, "Brotli 包与 JSON 记录数一致（" + dsJson.records.length + "）");
assert(dsJson.records.length === dsGz.records.length, "gzip 包与 JSON 记录数一致（浏览器原生主路径）");
assert(dsJson.stats.skillCard > 0, "数据集记录了装备牌特技：" + dsJson.stats.skillCard);
assert(dsJson.records.filter(r => r.kind === "char").every(r => r.refs.length === 0), "角色记录无出边（简介不参与链接）");

/* ---- 概念索引：收录 / 去重 / 排序都在构建期算好，运行时只投影 ---- */
const recKeys = new Set(dsJson.records.map(r => r.key));
assert(Array.isArray(dsJson.terms) && dsJson.terms.length > 0, "数据集输出概念索引：" + dsJson.terms.length + " 名");
assert(dsJson.terms.length === dsJson.stats.conceptNames, "概念名数与统计一致");
assert(dsJson.terms.every(t => t.entries.length > 0), "概念索引无空条目");
assert(dsJson.terms.every(t => t.entries.every(e => recKeys.has(e.key))),
  "概念索引条目全部指向存在的记录（否则运行时投影得到空壳）");
assert(dsJson.terms.every(t => new Set(t.entries.map(e => e.kind)).size === t.entries.length),
  "同名同种类不重复占位（「护盾」只能有一个卡牌条目）");
/* 牌面文本副本不进概念索引：否则概念页会并列两条一样的描述 */
const mirrorKeys = new Set(dsJson.records.filter(r => r.flags.mirror).map(r => r.key));
assert(dsJson.terms.every(t => t.entries.every(e => !mirrorKeys.has(e.key))), "牌面文本副本不进概念索引");
/* 同名身份（dupIdentity）要保留在索引里，只是检索不单列 */
assert(dsJson.terms.some(t => t.entries.some(e => dsJson.records.find(r => r.key === e.key)?.flags.dupIdentity)),
  "同名身份条目保留在概念索引中");
assert(dsJson.terms.some(t => t.name === "感电" && t.entries.length), "元素反应术语已派生（感电）");
assert(dsJson.terms.some(t => t.name === "结晶" && t.entries.length), "元素反应基名已归并（结晶）");
const unlinkableKeys = new Set(dsJson.records.filter(r => !r.linkable).map(r => r.key));
assert(dsJson.terms.every(t => t.entries.every(e => !unlinkableKeys.has(e.key))), "不可链接记录不进概念索引");

function makeEl(id) {
  const store = id ? { _id: id, children: [], innerHTML: "" } : { children: [], innerHTML: "" };
  const cls = new Set();
  return new Proxy(store, {
    get(t, k) {
      if (k === "classList") return {
        add: c => cls.add(c), remove: c => cls.delete(c),
        toggle: (c, f) => { (f === undefined ? !cls.has(c) : f) ? cls.add(c) : cls.delete(c); },
        contains: c => cls.has(c),
      };
      if (k === "style") return {};
      if (k === "dataset") return {};
      if (k in t) return t[k];
      if (["addEventListener", "removeEventListener", "appendChild", "remove", "click", "focus", "setAttribute", "scrollIntoView", "replaceWith"].includes(k)) return () => {};
      if (k === "closest" || k === "querySelector") return () => null;
      if (k === "querySelectorAll") return () => [];
      if (k === "value") return "";
      return undefined;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
const elCache = new Map();
const documentStub = {
  getElementById: id => { if (!elCache.has(id)) elCache.set(id, makeEl(id)); return elCache.get(id); },
  createElement: () => makeEl(null),
  addEventListener: () => {},
  querySelector: () => makeEl(null),
  querySelectorAll: () => [],
  body: { appendChild: () => {} },
  documentElement: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
};
const fetchStub = async url => {
  const cat = Object.keys(DATA).find(c => url.endsWith("/" + c));
  return { ok: true, json: async () => ({ data: cat ? DATA[cat] : [] }) };
};

const logic = readAppSource();
const harness = `
;(async () => {
  await ensureData();

  /* ===== 1. 装备牌特技进入技能索引 ===== */
  const yueSheng = skillsOfCard(113154).find(s => s.name === "跃升");
  assert(!!yueSheng, "驰轮车·跃升 的特技「跃升」进入技能索引");
  assert(yueSheng.ownerKind === "card" && yueSheng.ownerCardId === 113154, "跃升 归属卡牌 113154（不是角色）");
  assert(skillsOf(113154).length === 0, "角色技能查询不会返回卡牌特技");
  const zhuan = skillsOfCard(116102).find(s => s.name === "转转冲击");
  assert(!!zhuan && /岩元素伤害/.test(zhuan.effect), "转转冲击效果可读：" + (zhuan ? zhuan.effect.slice(0, 20) : "无"));

  /* ===== 2. 特技可被概念索引命中、可被卡文链接 ===== */
  const entries = termEntries("跃升");
  assert(entries.some(e => e.kind === "skill"), "跃升 进入概念索引（kind=skill）");
  assert(termRoute(entries) === "skill", "点击跃升 → 技能页");
  const linked = linkify(esc("特技：跃升"));
  assert(linked.includes('data-term="跃升"'), "卡文「特技：跃升」被标记为可点击");
  const linked2 = linkify(esc("特技：转转冲击"));
  assert(linked2.includes('data-term="转转冲击"'), "卡文「特技：转转冲击」被标记为可点击");

  /* 检索：特技不在牌库（pool）里，但必须能通过概念索引被搜到 */
  const hits = searchCards("跃升", { limit: 20 });
  assert(hits.some(r => r.kind === "concept" && r.name === "跃升"), "检索「跃升」返回结果（不再因不在牌库而丢失）");
  const hits2 = searchCards("转转冲击", { limit: 20 });
  assert(hits2.some(r => r.name === "转转冲击"), "检索「转转冲击」命中");

  /* ===== 3. 技能页有牌面（用所属卡牌作视觉锚点） ===== */
  state.overlayStack = [];
  showSkill(yueSheng.key);
  const skHtml = String(document.getElementById("detail").innerHTML || "");
  assert(skHtml.includes('class="dimg"') && skHtml.includes("/image/113154"), "技能页渲染所属卡牌牌面");
  assert(skHtml.includes("所属卡牌"), "技能页标注「所属卡牌」而不是「所属角色」");
  state.overlayStack = [];

  /* ===== 4. 角色简介不产生术语链接 ===== */
  const furina = state.CHAR.find(c => c.name === "芙宁娜") || state.CHAR[0];
  showDetail(furina.id);
  const detailHtml = String(document.getElementById("detail").innerHTML || "");
  const story = (detailHtml.match(/<div class="dtext dstory">([\\s\\S]*?)<\\/div>/) || [])[1] || "";
  assert(!!story, "角色详情含简介区");
  assert(!story.includes('class="term"'), "简介区不产生概念链接");
  assert(!story.includes("data-term="), "简介区不含 data-term");

  /* ===== 5. 概念页牌面统一：有牌面的条目走 cardArtHtml ===== */
  const termView = termHtml(termEntries("跃升"), true);
  assert(termView.includes("term-art"), "概念页条目使用统一牌面容器");
  assert(termView.includes("/image/113154"), "概念页技能条目渲染所属卡牌牌面");

  /* ===== 6. 卡牌详情列出特技 ===== */
  showDetail(113154);
  const cardHtml = String(document.getElementById("detail").innerHTML || "");
  assert(cardHtml.includes("特技") && cardHtml.includes("跃升"), "卡牌详情列出特技「跃升」");

  /* ===== 7. 概念索引：构建期判定，运行时只投影 ===== */
  assert(termIndex.size === DATASET.stats.conceptNames,
    "运行时概念索引规模与数据集一致：" + termIndex.size);
  const mirrorRec = DATASET.records.find(r => r.flags.mirror && r.name.length >= 2);
  assert(!!mirrorRec, "存在牌面文本副本记录（数据前提）");
  if (mirrorRec) {
    /* 副本之所以是「副本」，就是另有同名的身份记录承载展示；
       副本自身不进索引（静态断言已校验 key 级），名字仍要能被正文链接。 */
    const hasIdentity = DATASET.records.some(o => o !== mirrorRec && o.name === mirrorRec.name && !o.flags.mirror);
    assert(hasIdentity, "牌面副本必有同名身份记录承载展示：" + mirrorRec.name);
    assert(new RegExp(termRe.source).test(mirrorRec.name), "牌面文本副本仍可被正文链接：" + mirrorRec.name);
  }
  /* 反链来自构建期出边，不再运行时扫文本 */
  const bl = backlinks.get("跃升");
  assert(!!bl && bl.size > 0, "反链：跃升 被引用（出边来自构建期）");

  console.log(getFails() ? "\\n存在失败项" : "\\n全部通过");
  process.exit(getFails() ? 1 : 0);
})().catch(e => { console.error("执行异常:", e); process.exit(1); });
`;

await new Function(
  "document", "window", "localStorage", "location", "history", "fetch", "navigator", "assert", "getFails", "CONCEPTS_EXTRA",
  logic + harness,
)(
  documentStub, {}, { getItem: () => null, setItem() {}, removeItem() {} },
  { hash: "" }, { replaceState() {} },
  fetchStub, { clipboard: {} }, assert, () => fails, conceptsExtra,
);

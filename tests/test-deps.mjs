/* 牌间依赖（牌组限制 + 打出限制）统一模型 / 构筑门槛 / 测试卡过滤 逻辑验证 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAppSource } from "./test-lib.mjs";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = {};
for (const cat of ["characters", "entities", "keywords"])
  DATA[cat] = JSON.parse(fs.readFileSync(path.join(here, `gi-data/${cat}.json`), "utf8")).data;

let fails = 0;
const assert = (cond, msg) => { if (cond) console.log("  ok:", msg); else { console.error("  FAIL:", msg); fails++; } };

function makeEl(reg, id) {
  const store = id ? { _id: id, children: [] } : { children: [] };
  return new Proxy(store, {
    get(t, k) {
      if (k === "classList") return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (k === "style") return {};
      if (k === "dataset") return {};
      if (k in t) return t[k];
      if (k === "addEventListener" || k === "removeEventListener") return () => {};
      if (k === "appendChild" || k === "remove" || k === "click" || k === "focus" || k === "setAttribute" || k === "scrollIntoView" || k === "insertAdjacentHTML" || k === "select" || k === "blur") return () => {};
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
  getElementById: id => { if (!elCache.has(id)) elCache.set(id, makeEl(true, id)); return elCache.get(id); },
  createElement: () => makeEl(false),
  addEventListener: () => {},
  querySelector: () => makeEl(false),
  querySelectorAll: () => [],
  body: { appendChild: () => {} },
};
const fetchStub = async url => {
  const cat = Object.keys(DATA).find(c => url.endsWith("/" + c));
  return { ok: true, json: async () => ({ data: cat ? DATA[cat] : [] }) };
};
const lsStore = new Map();
const localStorageStub = {
  getItem: k => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => lsStore.set(k, String(v)),
  removeItem: k => lsStore.delete(k),
};
const logic = readAppSource();
const conceptsExtra = JSON.parse(
  fs.readFileSync(path.join(here, "gi-data/concepts-extra.js"), "utf8")
    .replace(/^window\.CONCEPTS_EXTRA = /, "").replace(/;\s*$/, "")
);

const harness = `
;(async () => {
  await ensureData();
  const byName = n => ENT.find(e => e.name === n);

  /* ===== 1. deckReqsOf：三类牌组限制解析 ===== */
  const ganyuTalent = byName("唯此一心");
  const r1 = deckReqsOf(ganyuTalent);
  assert(r1.length === 1 && r1[0].code === "deckChar" && r1[0].name === "甘雨" && r1[0].charId === 1101,
    "deckChar：天赋牌从 relatedCharacterId 解析出需包含的角色（甘雨）");

  const iceRes = byName("元素共鸣：交织之冰");
  const r2 = deckReqsOf(iceRes);
  assert(r2.length === 1 && r2[0].code === "deckEl" && r2[0].tag === "GCG_TAG_ELEMENT_CRYO" && r2[0].n === 2
    && r2[0].short === "牌组·2×冰", "deckEl：元素共鸣牌 → 需至少 2 名冰元素角色（短标「牌组·2×冰」）");

  const mond = byName("风与自由");
  const r3 = deckReqsOf(mond);
  assert(r3.length === 1 && r3[0].code === "deckTag" && r3[0].tag === "GCG_TAG_NATION_MONDSTADT"
    && r3[0].label.includes("至少 2 名「蒙德」"), "deckTag：地区牌 → 需至少 2 名蒙德角色");

  const fatui = byName("愚人众的阴谋");
  const r4 = deckReqsOf(fatui);
  assert(r4.length === 1 && r4[0].code === "deckTag" && r4[0].tag === "GCG_TAG_CAMP_FATUI",
    "deckTag：阵营牌 → 需至少 2 名愚人众角色");

  /* 占位符卡：描述残留 #{REALNAME[ID(1)]}，只能靠结构化 relatedCharacterId 还原 */
  const phantom = byName("梦迹一风");
  const r5 = deckReqsOf(phantom);
  assert(r5.length === 1 && r5[0].name === "流浪者" && r5[0].charId === 1506,
    "占位符卡：从 relatedCharacterId 还原角色名（梦迹一风 → 流浪者）");
  assert(!/[#{]|REALNAME/.test(r5[0].label + r5[0].short), "占位符卡：说明与徽标不泄漏 #{REALNAME 残渣");

  /* 全库卫生 + 覆盖计数（154 需角色 / 14 需元素 / 11 需地区阵营） */
  let leaked = 0, nChar = 0, nEl = 0, nTag = 0;
  for (const e of ENT) for (const r of deckReqsOf(e)) {
    if (/[#{]|REALNAME/.test(r.label + r.short)) leaked++;
    if (r.code === "deckChar") nChar++;
    else if (r.code === "deckEl") nEl++;
    else if (r.code === "deckTag") nTag++;
  }
  assert(leaked === 0, "全库牌组限制文案无占位符泄漏（0 处）");
  assert(nChar === 154 && nEl === 14 && nTag === 11,
    "覆盖计数：" + nChar + " 张需角色 / " + nEl + " 张需元素 / " + nTag + " 张需地区阵营");

  const plain = ENT.find(e => e.shareId != null && ["GCG_CARD_MODIFY", "GCG_CARD_EVENT"].includes(e.type) && deckReqsOf(e).length === 0);
  assert(plain && deckReqsOf(plain).length === 0, "普通卡（" + plain.name + "）无牌组限制");

  /* ===== 2. deckReqMet 校验语义 ===== */
  assert(deckReqMet(r1[0], [1101]) === true, "deckChar：牌组含甘雨 → 满足");
  assert(deckReqMet(r1[0], [1301]) === false, "deckChar：牌组不含甘雨 → 不满足");
  assert(deckReqMet({ code: "deckChar", name: "丝柯克", charId: 1116 }, [6605]) === true,
    "deckChar：同名多版本角色（丝柯克 6605 变体）也满足 1116 的要求");
  assert(deckReqMet(r2[0], [1101, 1102]) === true, "deckEl：2 名冰角色 → 满足");
  assert(deckReqMet(r2[0], [1101, 1301]) === false, "deckEl：仅 1 名冰角色 → 不满足");
  assert(deckReqMet(r3[0], [1102, 1103, 1301]) === true, "deckTag：2 名蒙德角色 → 满足");
  /* 甘雨(璃月) + 香菱(璃月) 与迪奥娜(蒙德) 同队 → 仅 1 名蒙德 */
  assert(deckReqMet(r3[0], [1102, 1101, 1302]) === false, "deckTag：仅 1 名蒙德角色 → 不满足");
  assert(deckReqMet(r4[0], [1112, 1204, 1301]) === true, "deckTag：2 名愚人众角色 → 满足");
  assert(deckReqMet(r4[0], [1112, 1301, 1302]) === false, "deckTag：仅 1 名愚人众角色 → 不满足");
  assert(deckReqMet({ code: "deckChar", name: "未知角色", charId: null }, []) === true,
    "无法校验（角色不在数据中）→ 放行，避免新卡误拦");

  /* ===== 3. 构筑门槛：draftAdd 拒绝 / 放行 ===== */
  draftClear();
  draftAdd(211011);
  assert(!draft.cards.has(211011), "门槛：无甘雨时加入其天赋牌被拒");
  draftAdd(1101);
  draftAdd(211011);
  assert(draft.cards.get(211011) === 1, "门槛：牌组含甘雨后天赋牌可加入");

  draftClear();
  draftAdd(331101);
  assert(!draft.cards.has(331101), "门槛：无冰元素角色时冰共鸣牌被拒");
  draftAdd(1101); draftAdd(1102);
  draftAdd(331101);
  assert(draft.cards.get(331101) === 1, "门槛：2 名冰角色后冰共鸣牌可加入");

  draftClear();
  /* 甘雨(璃月) + 重云(璃月) = 2 冰但无蒙德 → 「风与自由」被拒 */
  draftAdd(1101); draftAdd(1104); draftAdd(1301);
  draftAdd(331101); draftAdd(211011);
  draftAdd(331801);
  assert(!draft.cards.has(331801), "门槛：同套 2 冰无蒙德时「风与自由」被拒");
  draftClear();
  draftAdd(1102); draftAdd(1103); draftAdd(1301);
  draftAdd(331801);
  assert(draft.cards.get(331801) === 1, "门槛：2 名蒙德角色后「风与自由」可加入");

  /* ===== 4. deckProblems：缺口说明与归并 ===== */
  draftClear();
  draftAdd(1101); draftAdd(1102); draftAdd(1301);
  draftAdd(331101);
  assert(!deckProblems().some(m => m.includes("冰元素")), "校验：2 冰角色满足冰共鸣，无缺口");
  draftRemoveChar(1102);
  const p1 = deckProblems();
  assert(p1.some(m => m.includes("冰元素角色") && m.includes("当前 1")), "校验：移走一名冰角色后报出共鸣缺口（当前 1）");
  assert(p1.filter(m => m.includes("冰元素")).length === 1, "缺口归并：同类缺口只报一条");

  draftClear();
  draftAdd(1101); draftAdd(1102); draftAdd(1301);
  draftAdd(211011);
  draftRemoveChar(1101);
  assert(deckProblems().some(m => m.includes("甘雨")), "校验：移走关联角色后报出天赋牌缺口（需甘雨）");

  /* 绕过加入门槛直接构造（模拟换角色后的既有牌组）：两张冰共鸣并成一条提示 */
  draftClear();
  draftAdd(1101); draftAdd(1301); draftAdd(1302);
  draft.cards.set(331101, 1); draft.cards.set(331102, 1);
  const merged = deckProblems().filter(m => m.includes("冰元素"));
  assert(merged.length === 1 && merged[0].includes("交织之冰") && merged[0].includes("粉碎之冰"),
    "缺口归并：两张冰共鸣牌共用一条缺口提示");

  /* ===== 5. 测试卡过滤 ===== */
  const testNames = ["（Test）隐藏-费用不变", "（test）绿皮隐藏", "（test）PVEbuff", "（test）测试用", "火与战争（test）"];
  assert(poolStats.testFiltered === 5, "识别 5 张测试卡（实际 " + poolStats.testFiltered + "）");
  assert(testNames.every(n => !pool.some(x => x.name === n)), "测试卡全部不进卡池");
  assert(!searchCards("test").some(r => r.kind === "card" && testNames.includes(r.name)), "检索 test 不出测试卡");
  assert(!searchCards("测试").some(r => r.kind === "card" && r.name.includes("测试")), "检索「测试」不出测试卡");
  assert(testNames.every(n => ENT.some(e => e.name === n)), "测试卡仍在原始数据中（详情深链可查）");
  const testId = ENT.find(e => e.name === "（test）测试用").id;
  showDetail(testId);
  assert(String($("detail").innerHTML).includes("测试用"), "测试卡详情深链仍可渲染");
  draftClear();
  draftAdd(testId);
  assert(!draft.cards.has(testId), "测试卡不可加入构筑（shareId=null）");

  /* ===== 6. 统一呈现：徽标 / 详情双组 / 视图 / 导出 ===== */
  const talentPool = pool.find(x => x.id === 211011);
  assert(allReqs(talentPool).length === 2, "allReqs：天赋牌同时带牌组限制与打出限制");
  const badgeHtml = depBadges(allReqs(talentPool));
  assert(badgeHtml.includes("牌组·甘雨") && badgeHtml.includes("须在场"), "徽标：两类限制同套渲染");
  assert(browseTile(talentPool).includes("牌组·甘雨"), "卡库 tile：依赖徽标显示");
  const resPool = pool.find(x => x.id === 331101);
  assert(resPool.element === "CRYO", "卡池派生：元素共鸣牌继承牌组元素");
  assert(browseTile(resPool).includes("--ec:var(--cryo)"), "卡库 tile：元素共鸣牌显示元素图标");

  showDetail(211011);
  const detailHtml = String($("detail").innerHTML);
  assert(detailHtml.includes("牌组限制") && detailHtml.includes("加入牌组需满足"), "详情：牌组限制组标题与提示");
  assert(detailHtml.includes("打出限制") && detailHtml.includes("对局中生效"), "详情：打出限制组标题与提示");
  assert(detailHtml.includes('data-goto="1101"'), "详情：牌组限制中的角色名可点击跳转");
  assert(detailHtml.includes("--ec:var(--cryo)") && detailHtml.includes("ele-svg"), "详情：天赋牌按关联角色显示元素图标");
  showDetail(331101);
  const resDetail = String($("detail").innerHTML);
  assert(resDetail.includes("--ec:var(--cryo)") && resDetail.includes("元素共鸣"), "详情：元素共鸣牌由牌组限制继承元素图标");
  showDetail(1101);
  const charDetail = String($("detail").innerHTML);
  assert(charDetail.includes("--ec:var(--cryo)") && charDetail.includes("冰"), "详情：角色元信息使用元素矢量图标");

  /* 端到端：组一套含依赖卡的合法牌组 → 编码解析 → 各视图 / 导出 */
  draftClear();
  draftAdd(1101); draftAdd(1102); draftAdd(1301);
  draftAdd(211011); draftAdd(331101);
  const fill = ENT.filter(e => e.shareId != null && ["GCG_CARD_MODIFY", "GCG_CARD_EVENT", "GCG_CARD_ASSIST", "GCG_CARD_SUPPORT"].includes(e.type)
    && deckReqsOf(e).length === 0 && !(e.tags || []).includes("GCG_TAG_LEGEND"));
  for (const e of fill) {
    while (draftTotal() < 30 && (draft.cards.get(e.id) || 0) < 2) draftAdd(e.id);
    if (draftTotal() >= 30) break;
  }
  assert(draftTotal() === 30, "端到端：凑满 30 张行动牌");
  assert(deckProblems().length === 0, "端到端：含依赖卡的合法牌组校验通过（依赖已满足）");
  renderDraftPanel();
  assert(String($("draftPanel").innerHTML).includes("--ec:var(--cryo)"), "牌组面板：角色槽使用元素矢量图标");
  const code = draftEncode();
  await decodeAndRender(code);
  renderHistory();
  const histHtml = String($("histPanel").innerHTML);
  assert(histHtml.includes("eico hist-el") && !histHtml.includes('class="dot"'), "历史面板：角色元素改用矢量图标");
  const grp = current.order.flatMap(t => current.groups[t]);
  assert(grp.find(x => x.id === 211011)?.deckReqs?.length === 1, "解析：当前牌组卡片携带 deckReqs");
  renderList();
  const listElHtml = String($("view-list").innerHTML);
  assert(listElHtml.includes(eleIcon("CRYO", "inline-el") + "唯此一心"), "列表视图：卡名旁使用元素矢量图标");
  assert(listElHtml.includes(eleIcon("CRYO", "inline-el") + "牌组·2×冰"), "列表视图：元素限制 pill 使用元素图标");
  assert(listElHtml.includes("牌组·甘雨"), "列表视图：依赖列显示牌组限制");
  renderGrid();
  assert(String($("view-grid").innerHTML).includes("牌组·甘雨"), "卡面视图：依赖徽标显示");
  assert(String($("view-grid").innerHTML).includes(eleIcon("CRYO", "inline-el") + "唯此一心"), "卡面视图：行动牌元素图标");
  renderSummary();
  assert(String($("summary").innerHTML).includes("牌组限制"), "概览条：依赖统计按「牌组限制」分组");
  /* 概览统计点击 → 列表过滤（data-filter 传 R_ZH 文本，match 命中依赖类别） */
  listFilter = R_ZH.deckChar;
  renderList();
  const listHtml = String($("view-list").innerHTML);
  assert(listHtml.includes("唯此一心") && !listHtml.includes("魔导绪论"), "概览限制统计 → 列表按「牌组·角色」过滤生效");
  listFilter = "";
  const exp = buildExport();
  assert(exp.actionCards.every(c => Array.isArray(c.deckRequirements)), "导出 JSON：每张卡都有 deckRequirements 字段");
  assert(exp.actionCards.some(c => c.deckRequirements.some(r => r.code === "deckChar" && r.characterId === 1101)),
    "导出 JSON：牌组限制结构化导出（含 characterId）");
  assert(deckText().includes("〔牌组·甘雨"), "导出文本：牌组限制写进牌组表");
  assert(toCSV().includes("依赖限制"), "导出 CSV：列名为依赖限制");

  console.log(getFails() ? "\\\\n存在失败项" : "\\\\n全部通过");
  process.exit(getFails() ? 1 : 0);
})().catch(e => { console.error("执行异常:", e); process.exit(1); });
`;

await new Function(
  "document", "window", "localStorage", "location", "history", "fetch", "navigator", "assert", "getFails", "CONCEPTS_EXTRA",
  logic + harness,
)(
  documentStub, {}, localStorageStub,
  { hash: "" }, { replaceState() {} },
  fetchStub, { clipboard: {} }, assert, () => fails, conceptsExtra,
);

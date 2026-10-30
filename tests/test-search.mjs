/* src/ 应用源码 · 卡牌检索 / 牌组草稿 / 分享码生成逻辑验证（DOM stub + 缓存数据） */
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
  const store = id ? { _id: id } : {};
  return new Proxy(store, {
    get(t, k) {
      if (k === "classList") return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (k === "style") return {};
      if (k === "dataset") return {};
      if (k in t) return t[k];
      if (k === "addEventListener" || k === "removeEventListener") return () => {};
      if (k === "appendChild" || k === "remove" || k === "click" || k === "focus" || k === "setAttribute" || k === "removeAttribute" || k === "scrollIntoView" || k === "insertAdjacentHTML") return () => {};
      if (k === "children") return t.children || (t.children = []);
      if (k === "getBoundingClientRect") return () => ({ top: 0 });
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
  body: { appendChild: () => {}, dataset: {} },
};
const fetchStub = async url => {
  const cat = Object.keys(DATA).find(c => url.endsWith("/" + c));
  return { ok: true, json: async () => ({ data: cat ? DATA[cat] : [] }) };
};

const lsStore = new Map();
const localStorageStub = {
  getItem: k => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => lsStore.set(k, String(v)),
};
const logic = readAppSource();
const conceptsExtra = JSON.parse(
  fs.readFileSync(path.join(here, "gi-data/concepts-extra.js"), "utf8")
    .replace(/^export const CONCEPTS_EXTRA = /, "").replace(/;\s*$/, "")
);
const pinyinData = JSON.parse(
  fs.readFileSync(path.join(here, "gi-data/pinyin.js"), "utf8")
    .replace(/^export const PINYIN_DATA = /, "").replace(/;\s*$/, "")
);

const harness = `
;(async () => {
  /* ===== 0. 草稿持久化：数据未加载时恢复，就绪后清理失效条目 ===== */
  localStorage.setItem("gi-viewer-draft", JSON.stringify({ chars: [1711], cards: { "212111": 2 } }));
  loadDraft();
  assert(draft.chars.length === 1 && (draft.cards.get(212111) || 0) === 2, "localStorage 草稿在数据未加载时完整恢复（不做 id 过滤）");

  /* ===== 1. 输入路由：分享码 / 搜索词识别 ===== */
  assert(looksLikeCode(SAMPLE) === true, "识别：示例分享码 → true");
  assert(looksLikeCode(SAMPLE + "   ") === true, "识别：分享码容忍空白 → true");
  assert(looksLikeCode("JDCS4mwOFiLBRXUk") === false, "识别：短 base64 片段 → false");
  assert(looksLikeCode("芙宁娜") === false, "识别：中文名 → false");
  assert(looksLikeCode("") === false, "识别：空串 → false");

  await decodeAndRender(SAMPLE);
  assert(state.current && state.current.chars.length === 3 && state.current.order.length, "示例牌组解析成功（3 角色 + 行动牌分组）");
  assert(draft.chars.includes(1711) && (draft.cards.get(212111) || 0) === 2, "数据就绪后有效草稿条目被保留（pruneDraft 不过滤有效 id）");
  draft.cards.set(99999999, 1); pruneDraft();
  assert(!draft.cards.has(99999999), "pruneDraft 清除失效 id（数据版本更新场景）");
  draftClear();

  /* ===== 2. 卡牌检索 ===== */
  const rChar = searchCards("芙宁娜");
  assert(rChar.length && rChar[0].kind === "char" && rChar[0].name === "芙宁娜", "角色检索：精确名排首位");
  const rCard = searchCards("静水流涌之辉");
  assert(rCard.length && rCard[0].kind === "card" && rCard[0].name === "静水流涌之辉", "卡牌检索：精确名排首位");
  const rTerm = searchCards("感电");
  assert(rTerm.length && rTerm[0].kind === "concept", "术语检索：感电 → concept（反应拆解词条）");
  assert(searchCards("").length === 0, "空关键词返回空");
  const rDesc = searchCards("万能元素");
  assert(rDesc.some(x => x.kind === "card" && x.match === "desc"), "效果关键词命中卡牌（描述匹配后置）");
  assert(rDesc.every((x, i, a) => i === 0 || a[i - 1].score <= x.score), "结果按分数升序（分数越小越相关）");
  assert(searchCards("的").length <= 90, "结果限量 90 条");
  assert(resultTypeLabel(rCard[0]) === "装备牌", "类型标签：静水流涌之辉 → 装备牌");
  /* 概念类统一归入「概念」分类档（分类 chips 与分组标题一致）；具体种类看卡块自身 */
  assert(resultTypeLabel(rTerm[0]) === "概念", "类型标签：感电 → 概念");
  assert(rTerm[0].ckind === "keyword", "概念行携带具体种类 ckind=keyword");
  assert(resultTypeLabel(rChar[0]) === "角色", "类型标签：芙宁娜 → 角色");
  /* 同名多身份并列：结晶既是场地牌也是反应术语 → 两条结果都在 */
  const rJj = searchCards("结晶");
  assert(rJj.some(x => x.kind === "card"), "并列：结晶 → 卡牌结果");
  assert(rJj.some(x => x.kind === "concept" && x.ckind === "keyword"), "并列：结晶 → 术语概念结果");
  const rKs = searchCards("扩散");
  assert(rKs.some(x => x.kind === "concept" && x.ckind === "keyword"), "并列：扩散 → 术语概念结果（基名归并）");
  /* 概念去重：对局实体牌（状态/事件/援助等）与牌库同名时不再单列「概念」 */
  const conceptRows = q => searchCards(q).filter(x => x.kind === "concept");
  const rQldj = searchCards("拳力斗技");
  assert(conceptRows("拳力斗技").length === 0, "去重：拳力斗技 → 不再出现概念行");
  assert(rQldj.some(x => x.kind === "card" && x.name === "拳力斗技！"), "去重：拳力斗技 → 事件牌仍可检索");
  assert(rQldj.some(x => x.kind === "card" && x.name === "拳力斗技！（生效中）"), "去重不误伤变种：生效中版本仍单独保留");
  assert(termEntries("拳力斗技").some(e => e.kind === "status"), "去重不误伤链接：状态释义仍留在概念索引（术语页/正文可跳）");
  assert(conceptRows("清洁工作").length === 0, "去重：清洁工作 → 概念行消失");
  assert(searchCards("清洁工作").some(x => x.name === "「清洁工作」（生效中）"), "去重不误伤变种：清洁工作生效中版本保留");
  assert(conceptRows("焰主之祝").length === 0, "去重：焰主之祝 → 概念行消失");
  assert(searchCards("焰主之祝").some(x => x.kind === "card" && x.name === "「焰主之祝」"), "去重：焰主之祝 → 卡牌仍可检索");
  const rSnt = conceptRows("失能形态").filter(x => normCompact(x.name) === normCompact("失能形态"));
  assert(rSnt.length === 1, "概念归一化去重：「失能形态」/「失能形态」只留一行");
  /* 只比同名行：技能/卡牌因"描述里提到该名字"而命中是正常结果，不算概念重复 */
  const rFj = conceptRows("焚尽的炽炎魔女").filter(x => normCompact(x.name) === normCompact("焚尽的炽炎魔女"));
  assert(rFj.length === 0, "去重：角色形态说明不单列概念（同名概念行 " + rFj.length + "）");
  assert(termEntries("「焚尽的炽炎魔女」").length > 0, "去重不误伤链接：形态说明仍可被正文引用");
  assert(conceptRows("护盾").some(x => x.ckind === "keyword"), "不误伤双重含义：护盾 仍保留机制概念行");
  /* 排序权重：同分时 角色 < 卡牌 < 概念（不同分仍按分数优先） */
  const rW = searchCards("攻击");
  let sameScoreOrderOk = true;
  for (let i = 0; i < rW.length; i++)
    for (let j = i + 1; j < rW.length; j++)
      if (rW[i].kind === "concept" && (rW[j].kind === "card" || rW[j].kind === "char") && rW[i].score === rW[j].score)
        sameScoreOrderOk = false;
  assert(sameScoreOrderOk, "同分排序权重：卡牌/角色先于概念");

  /* ===== 2b. 拼音 / 首字母 / 模糊 / 去重 / 空态近似词 ===== */
  const rPy = searchCards("funingna");
  assert(rPy.length && rPy[0].name === "芙宁娜" && rPy[0].match === "pinyin", "拼音全拼：funingna → 芙宁娜 排首位");
  const rIni = searchCards("fnn");
  assert(rIni.length && rIni[0].name === "芙宁娜" && rIni[0].match === "initials", "拼音首字母：fnn → 芙宁娜 排首位");
  const rIni2 = searchCards("gy");
  assert(rIni2.length && rIni2[0].name === "甘雨" && rIni2[0].match === "initials", "短首字母：gy → 甘雨 排首位（不被英文前缀淹没）");
  const rPre = searchCards("jingshui");
  assert(rPre.length && rPre[0].name === "静水流涌之辉" && rPre[0].match === "pinyin", "拼音前缀：jingshui → 静水流涌之辉 排首位");
  const rJsly = searchCards("jsly");
  assert(rJsly.length && rJsly[0].name === "静水流涌之辉" && rJsly[0].match === "initials", "首字母前缀：jsly → 静水流涌之辉");
  const rFn = searchCards("fn");
  assert(rFn.length && rFn[0].match === "initials" && rFn[0].score <= 40, "2 字母查询：首字母精确命中优先于英文模糊");
  const rTypo = searchCards("芙宁那");
  assert(rTypo.length && rTypo[0].name === "芙宁娜" && rTypo[0].match === "fuzzy", "中文近似写法：芙宁那 → 芙宁娜");
  const rDup = searchCards("芙宁娜");
  assert(rDup.filter(x => x.kind === "char" && x.name === "芙宁娜").length === 1, "同名多版本去重（角色只留一条）");
  assert(rDup[0].buildable === true, "去重优先保留可构筑版本");
  assert(nearNames("静水辉").some(x => x.name === "静水流涌之辉"), "空态近似词：放宽间隔后给出最接近的名字");

  /* ===== 2c. 搜索范围（标题/拼音/描述）与"基于牌库" ===== */
  assert(searchScope.title && searchScope.pinyin && searchScope.desc, "范围默认：标题/拼音/描述全开");
  localStorage.setItem(STORAGE_KEYS.searchScope, JSON.stringify({ title: true, pinyin: false, desc: true }));
  assert(loadSearchScope().pinyin === false, "范围持久化：关闭拼音后可从 localStorage 恢复");
  localStorage.setItem(STORAGE_KEYS.searchScope, JSON.stringify({ title: true, pinyin: true, desc: true }));

  const rNoDesc = searchCards("回合结束时", { scope: { title: true, pinyin: true, desc: false } });
  assert(rNoDesc.length === 0, "关闭描述：效果关键词不再命中");
  const rDescOnly = searchCards("回合结束时", { scope: { title: false, pinyin: false, desc: true } });
  assert(rDescOnly.length > 0 && rDescOnly.every(x => x.match === "desc"), "只开描述：结果全部为释义命中");
  const rNoPy = searchCards("funingna", { scope: { title: true, pinyin: false, desc: false } });
  assert(rNoPy.length === 0, "关闭拼音：funingna 不再命中");
  const rTitleOnly = searchCards("静水流涌之辉", { scope: { title: true, pinyin: false, desc: false } });
  assert(rTitleOnly.length && rTitleOnly[0].name === "静水流涌之辉", "只开标题：中文名仍可检索");

  /* 牌库筛选：检索语料随之缩小，而不是全量数据 */
  browseState.el = "CRYO";
  assert(searchCorpus().every(x => x.element === "CRYO"), "牌库筛选生效：检索语料只含冰元素");
  assert(searchCards("芙宁娜").length === 0, "基于牌库：被筛掉的角色检索不到");
  assert(searchCards("甘雨").some(x => x.kind === "char" && x.name === "甘雨"), "基于牌库：仍在牌库中的角色可检索");
  browseState.el = "";
  assert(searchCards("芙宁娜").length > 0, "清除筛选：恢复全库检索");

  /* ===== 3. 草稿 → 生成分享码（与原码逐字节一致） ===== */
  draftClear();
  for (const c of state.current.chars) draftAdd(c.id);
  for (const t of state.current.order) for (const x of state.current.groups[t]) for (let i = 0; i < x.count; i++) draftAdd(x.id);
  assert(draft.chars.length === 3 && draftTotal() === 30, "草稿装满：3 角色 + 30 张行动牌");
  /* 草稿按加入顺序编码，与原码顺序未必一致——断言语义等价（解码后多重集相同） */
  const code = draftEncode();
  const norm = ids => JSON.stringify([...ids].sort((a, b) => a - b));
  assert(norm(decodeRaw(code)) === norm(decodeRaw(SAMPLE)), "草稿生成的牌组与原牌组语义等价（解码多重集一致）");
  /* 复制分享码走原始顺序，必须逐字节还原（此时 state.current 仍为 SAMPLE 顺序） */
  assert(encodeCurrent() === SAMPLE, "复制分享码按原始顺序重建，逐字节还原");
  /* 草稿码可被查看器自身完整解析（行为验证） */
  await decodeAndRender(code);
  assert(state.current && state.current.chars.length === 3 && state.current.order.reduce((a, t) => a + state.current.groups[t].reduce((b, x) => b + x.count, 0), 0) === 30,
    "草稿分享码可被完整解析回牌组（3 角色 + 30 张）");
  /* 解析草稿码后再编码，同样逐字节还原（草稿顺序被完整保留） */
  assert(encodeCurrent() === code, "再编码保序：草稿顺序也被逐字节保留");

  /* ===== 4. 构筑规则校验 ===== */
  draftClear();
  const legend = state.ENT.find(e => (e.tags || []).includes("GCG_TAG_LEGEND") && e.shareId != null);
  if (legend) {
    draftAdd(legend.id); draftAdd(legend.id);
    assert((draft.cards.get(legend.id) || 0) === 1, "秘传牌整套限 1 张（第二次加入被拒）");
  } else assert(true, "秘传牌限 1（数据中无样本，跳过）");

  draftClear();
  /* 只取无构筑门槛的行动牌（天赋/共鸣/地区牌依赖特定角色，这里不引入），
     否则「加入牌组」会按牌组限制拒绝，装不满 30 张 */
  const freeCards = state.ENT.filter(e => ["GCG_CARD_MODIFY","GCG_CARD_SUPPORT","GCG_CARD_EVENT","GCG_CARD_ASSIST"].includes(e.type)
    && e.shareId != null && deckReqsOf(e).length === 0 && !(e.tags || []).includes("GCG_TAG_LEGEND"));
  const pool = freeCards.slice(0, 16);
  for (const e of pool) { draftAdd(e.id); draftAdd(e.id); }
  assert(draftTotal() === 30, "行动牌满 30 张后拒绝更多加入");

  draftClear();
  const charPool = state.CHAR.filter(c => c.shareId != null).slice(0, 4);
  for (const c of charPool) draftAdd(c.id);
  assert(draft.chars.length === 3, "角色满 3 名后拒绝更多加入");

  draftClear();
  let errMsg = "";
  try { draftEncode(); } catch (e) { errMsg = e.message; }
  assert(errMsg.includes("3 名角色"), "空草稿生成 → 角色数量格式错误");

  /* 同名上限 2 */
  draftClear();
  const anyCard = freeCards.find(e => !(e.tags || []).includes("GCG_TAG_LEGEND"));
  draftAdd(anyCard.id); draftAdd(anyCard.id); draftAdd(anyCard.id);
  assert((draft.cards.get(anyCard.id) || 0) === 2, "同名普通卡上限 2 张");

  /* ===== 5. resolveInput 路由行为：顶部输入框只解析分享码 ===== */
  await resolveInput(SAMPLE);
  assert(String($("status").innerHTML).includes("解析成功"), "resolveInput：分享码 → 解析牌组");
  searchState.q = "";
  await resolveInput("芙宁娜");
  assert(String($("status").innerHTML).includes("不是牌组分享码"), "resolveInput：关键词不再触发检索，提示改用卡库检索框");
  assert(searchState.q === "", "顶部输入框不写入检索状态（两个入口已分离）");

  /* ===== 5b. 卡库检索：阶段二只作用于阶段一的子集 ===== */
  Object.assign(browseState, { type: "", el: "", cost: "", energy: "", tag: "", ver: "", sort: "name", dir: 1 });
  applyBrowseQuery("芙宁娜");
  assert(String($("browseResults").innerHTML).includes("命中"), "卡库检索框：关键词 → 结果区渲染");
  assert(searchState.q === "芙宁娜" && searchState.results.length > 0, "检索状态已更新（q + results）");
  const fullHits = searchState.results.length;

  /* 阶段一先收敛卡池：只留事件牌，再在同一子集内检索 */
  browseState.type = "GCG_CARD_EVENT";
  renderBrowseResults();
  assert(searchState.results.every(r => r.kind === "concept" || state.entById.get(r.id)?.type === "GCG_CARD_EVENT"),
    "双阶段：检索结果全部落在卡库筛选出的子集内");
  assert(searchState.results.length <= fullHits, "双阶段：筛选后命中数不超过全库检索");
  assert(browseState.type === "GCG_CARD_EVENT" && searchState.q === "芙宁娜", "筛选与检索各自持有状态，互不重置");

  /* ===== 6. 清空检索 → 回到卡库网格；清除筛选 → 保留检索词重算 ===== */
  clearBrowseQuery();
  assert(String($("browseResults").innerHTML).includes("bgrid"), "清空检索 → 恢复卡库网格");
  assert(searchState.q === "" && searchState.results.length === 0, "清空检索：q 与 results 同时归零");
  clearBrowseFilters();
  assert(browseState.type === "", "清除卡库筛选：维度归零");

  /* ===== 7. 空牌组时的视图保护 ===== */
  state.current = null;
  renderGrid(); renderList();
  assert(String($("view-grid").innerHTML).includes("尚未解析牌组"), "无牌组时卡面视图显示引导而非崩溃");
  assert(String($("view-list").innerHTML).includes("尚未解析牌组"), "无牌组时列表视图显示引导而非崩溃");

  console.log(getFails() ? "\\\\n存在失败项" : "\\\\n全部通过");
  process.exit(getFails() ? 1 : 0);
})().catch(e => { console.error("执行异常:", e); process.exit(1); });
`;

await new Function(
  "document", "window", "localStorage", "location", "history", "fetch", "navigator", "assert", "getFails", "CONCEPTS_EXTRA", "PINYIN_DATA",
  logic + harness,
)(
  documentStub, {}, localStorageStub,
  { hash: "" }, { replaceState() {} },
  fetchStub, { clipboard: {} }, assert, () => fails, conceptsExtra, pinyinData,
);

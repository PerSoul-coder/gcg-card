/* src/ 应用源码 · 概念索引（术语悬浮/展开）逻辑验证（DOM stub + 缓存数据） */
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
      if (k === "addEventListener" || k === "removeEventListener") return () => {};
      if (k === "appendChild" || k === "remove" || k === "click" || k === "focus" || k === "setAttribute" || k === "scrollIntoView") return () => {};
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

const logic = readAppSource();
/* 补充概念库（genshin-db 静态快照）——从 JS 包装中取 JSON 注入作用域 */
const conceptsExtra = JSON.parse(
  fs.readFileSync(path.join(here, "gi-data/concepts-extra.js"), "utf8")
    .replace(/^export const CONCEPTS_EXTRA = /, "").replace(/;\s*$/, "")
);
const harness = `
;(async () => {
  await decodeAndRender(SAMPLE);
  const k0 = n => termEntries(n)[0] && termEntries(n)[0].kind;
  const d0 = n => (termEntries(n)[0] && termEntries(n)[0].desc) || "";
  assert(state.KW.length === 149, "术语表加载：149 条");
  assert(termIndex.size > 1000, "概念索引规模：" + termIndex.size + "（卡牌+角色+术语）");
  assert(k0("战斗行动") === "keyword", "术语命中：战斗行动 → keyword");
  assert(k0("静水流涌之辉") === "card", "卡牌命中：静水流涌之辉 → card");
  assert(k0("芙宁娜") === "char", "角色命中：芙宁娜 → char");

  const out = linkify(esc("此牌为一个战斗行动。打出时，若芙宁娜在场，则视为打出了静水流涌之辉。"));
  assert(out.includes('<span class="term" data-term="战斗行动">战斗行动</span>'), "linkify 标记术语");
  assert((out.match(/class="term"/g) || []).length === 3, "同句 3 个概念全部标记（战斗行动/芙宁娜/静水流涌之辉）");
  assert(!out.includes("<color"), "无残留颜色标签");

  const plain = linkify(esc("普通描述不含概念"));
  assert(!plain.includes("class=\\"term\\""), "无概念文本不受影响");

  const modalHtml = $("view-grid").innerHTML; // 触发过渲染
  const detailStore = document.getElementById("detail");
  // 直接开一次详情，验证 dtext 含 term
  showDetail(state.current.chars[0].id);
  const rendered = String(detailStore.innerHTML || "");
  assert(rendered.includes('class="term"'), "详情弹层描述已 linkify（卡牌描述或技能文本命中概念）");

  const th = termHtml(termEntries("战斗行动"));
  assert(th.includes("轮到对方行动") && th.includes("term-body"), "termHtml 输出术语解释内容");
  assert(!th.includes('data-term="战斗行动"'), "展开内容不重复识别自身术语（防 toggle 冲突）");
  assert(th.includes('data-term="快速行动"'), "展开内容仍识别其他概念（快速行动）");
  const thChar = termHtml(termEntries("芙宁娜"));
  assert(!thChar.includes('data-term="芙宁娜"'), "角色展开同理不识别自身");

  /* ===== 多类型匹配：跨种类并列展示，同种类跨源排除 ===== */
  const GROUP = { card: "card", cardref: "card", char: "char", charref: "char" };
  let dupKind = 0, multiNames = 0;
  for (const [, list] of termIndex) {
    const groups = list.map(e => GROUP[e.kind] || e.kind);
    if (new Set(groups).size !== groups.length) dupKind++;
    if (list.length > 1) multiNames++;
  }
  assert(dupKind === 0, "全库无同种类重复条目（同类型不同源已排除，" + dupKind + " 处违规）");
  assert(multiNames > 0, "多类型匹配名字数：" + multiNames);

  /* 结晶：既是场地牌（id 111）也是反应术语 → 跨种类并列，两条都在 */
  const jj = termEntries("结晶");
  assert(jj.length === 2 && jj.map(e => e.kind).join("+") === "card+keyword",
    "结晶 → 场地牌 + 反应术语 跨种类并列（" + jj.map(e => e.kind).join(" + ") + "）");
  assert(jj[0].id === 111, "结晶 → card 条目为场地牌（id 111）");
  assert(jj[1].desc.includes("（冰）") && jj[1].desc.includes("（雷）"),
    "结晶 → 术语条目按元素后缀归并全版本");
  /* 扩散：基名词条归并（卡文写作「扩散反应」，基名缺失时无法链接） */
  const ks = termEntries("扩散");
  assert(ks.some(e => e.kind === "keyword" && e.desc.includes("（水）")),
    "扩散 → 基名词条已归并（卡文『扩散反应』可链接）");
  /* 经典反应词条不回退（早期修复的守护） */
  assert(k0("感电") === "keyword" && termEntries("感电")[0].desc.includes("穿透伤害"),
    "感电 → 反应词条仍在（早期修复不回退）");
  /* 护盾：状态牌 + 关键词，两个不同来源/种类并列 */
  const hud = termEntries("护盾");
  assert(hud.length === 2 && hud.map(e => e.kind).join("+") === "card+keyword",
    "护盾 → 状态牌 + 关键词 跨种类并列（" + hud.map(e => e.kind).join(" + ") + "）");
  const hudHtml = termHtml(hud);
  assert((hudHtml.match(/class="term-body/g) || []).length === 2, "termHtml 多匹配输出 2 个并列条目");
  assert(hudHtml.includes('class="term-kind">卡牌<') && hudHtml.includes('class="term-kind">术语<'),
    "并列条目各带种类标识（卡牌 / 术语）");
  assert(hudHtml.includes("状态牌") && !hudHtml.includes("GCG_CARD_STATE"),
    "状态牌类型已译名展示（无原始码 GCG_CARD_STATE）");
  assert(hudHtml.split("<small>术语</small>").length === 1,
    "并列时术语条目不重复 meta（种类徽标已标出）");
  assert(hud[0].kind === "card", "并列顺序：身份类（card）在前");

  /* 同源同名版本竞争：可入构筑 > 有描述 > 先到 */
  assert(termEntries("元素附魔：冰").length === 1 && termEntries("元素附魔：冰")[0].id === 154,
    "元素附魔：冰 → 唯一 card 条目，保留有描述的版本（id 154）");
  assert(termEntries("芙宁娜").length === 1 && termEntries("芙宁娜")[0].id === 1211,
    "芙宁娜 → 唯一 char 条目为牌组同版本（id 1211）");
  assert(termEntries("暗流涌动")[0].id === 222031, "暗流涌动 → 有 shareId 的版本（id 222031）");
  assert(termEntries("丝柯克")[0].id === 1116 && termEntries("杜林")[0].id === 1317,
    "丝柯克/杜林 → 主版本（1116/1317，非 66xx 变体）");
  /* 补充库卡牌不与 piovium 同名卡重复占位（同种类排除的跨源形态） */
  const piovCardNames = new Set(state.ENT.map(e => e.name));
  for (const [n, i] of Object.entries(EXTRA_CONCEPTS)) {
    if (i.kind !== "card" && i.kind !== "character") continue;
    if (!piovCardNames.has(n) && !new Set(state.CHAR.map(c => c.name)).has(n)) continue;
    const kinds = termEntries(n).map(e => GROUP[e.kind] || e.kind);
    assert(new Set(kinds).size === kinds.length, "跨源同种类排除：" + n + "（" + kinds.join("+") + "）");
  }

  /* ===== 定义质量（反向断言：释义必须出自定义性章节，不能是效果句） ===== */
  const zc = termEntries("出战角色");
  assert(zc.length === 1 && zc[0].kind === "rule", "出战角色 → 唯一 rule 词条");
  assert(zc[0].desc.startsWith("（官方规则·《七圣召唤》"), "出战角色 → 释义出自《七圣召唤》·游戏准备章");
  assert(zc[0].desc.includes("作为「出战角色」"), "出战角色 → 释义是定义句（『作为出战角色』）");
  assert(!zc[0].desc.includes("超载") && !zc[0].desc.includes("特技") && !zc[0].desc.includes("本伤害+2"),
    "出战角色 → 释义不是超载/特技的效果句（旧错配回归防护）");
  for (const t of ["切换角色", "手牌", "牌堆", "元素骰", "复苏", "重投", "附着", "普通攻击"]) {
    const e = termEntries(t)[0];
    assert(e && e.desc.startsWith("（官方规则·"), "核心术语带规则章节出处：" + t);
  }
  /* 宁缺勿滥：规则文档无定义句的概念不注册，而不是挂一句上下文充数 */
  assert(!termEntries("璃月").length, "璃月（地区标签，无定义）→ 不注册为术语");
  assert(!termEntries("每回合").length, "每回合（通用词组）→ 不注册为术语");

  /* ===== 点击路由（纯函数）：唯一身份直达详情，其余一律走概念页 ===== */
  assert(termRoute(termEntries("护盾")) === "term", "路由：多匹配（状态牌+术语）→ 概念页并列");
  assert(termRoute(termEntries("普通攻击")) === "term", "路由：仅概念 → 概念页");
  assert(termRoute(termEntries("静水流涌之辉")) === "detail", "路由：唯一卡牌身份 → 直接开详情");
  assert(termRoute(termEntries("芙宁娜")) === "detail", "路由：唯一角色身份 → 直接开详情");
  assert(termRoute(termEntries("结晶")) === "term", "路由：结晶（场地牌 + 反应术语）→ 概念页并列");
  assert(termHtml(termEntries("结晶"), true).includes('class="blchip term-jump" data-goto="111"'),
    "概念页：身份条目带「查看详情」直达入口");
  /* 概念页页头已写概念名，正文不再重复写一遍（悬浮预览仍需名称） */
  const cnt = (hay, needle) => hay.split(needle).length - 1;
  const cPage = termHtml(termEntries("结晶"), true, "结晶");
  const cTip = termHtml(termEntries("结晶"));
  assert(cnt(cPage, "<b>结晶</b>") === 0, "概念页正文不再重复概念名（页头已有）");
  assert(cnt(cTip, "<b>结晶</b>") >= 1, "悬浮预览仍保留概念名（无可依赖的页头）");
  assert(cnt(termHtml(termEntries("结晶"), true, "别的名字"), "<b>结晶</b>") >= 1,
    "仅名称与页头一致时才省略，避免误删异名条目");

  /* ===== 弹层视图栈：概念层层下钻，返回逐层回到来源卡牌 ===== */
  state.overlayStack = [];
  showDetail(termEntries("静水流涌之辉")[0].id);
  assert(state.overlayStack.length === 1 && topView().kind === "detail", "详情：压入第一层视图");
  showTermModal("出战角色");
  assert(state.overlayStack.length === 2 && topView().kind === "term" && topView().name === "出战角色",
    "卡牌详情点术语 → 压入概念层（任意入口一致）");
  showTermModal("切换角色");
  assert(state.overlayStack.length === 3 && topView().name === "切换角色", "概念页内再点术语：继续下钻");
  showTermModal("切换角色");
  assert(state.overlayStack.length === 3, "重复点击同一术语：不重复压栈");
  overlayBack();
  assert(state.overlayStack.length === 2 && topView().name === "出战角色", "返回：弹出顶层概念");
  overlayBack();
  assert(state.overlayStack.length === 1 && topView().kind === "detail", "返回：回到来源卡牌详情");
  overlayBack();
  assert(state.overlayStack.length === 0 && !$("overlay").classList.contains("show"), "再返回：栈空 → 关闭弹层");
  assert(termEntries("切换角色").length > 0, "下钻目标术语存在（切换角色）");

  /* 边界：短名"幻戏"是长名"幻戏倒计时：3"的子串 —— 长名必须整体命中 */
  assert(k0("幻戏") === "keyword" && termEntries("幻戏倒计时：3").length > 0, "索引包含幻戏(关键词)与幻戏倒计时：3(卡牌)");
  const ov = linkify(esc("幻戏倒计时：3"));
  assert(ov.includes('data-term="幻戏倒计时：3"') && !(ov.match(/data-term="幻戏"/g)), "同位置长名优先：幻戏倒计时：3 整体命中，不被拆成幻戏");
  const ov2 = linkify(esc("小小灵蕈大幻戏（生效中）"));
  assert(ov2.includes('data-term="小小灵蕈大幻戏（生效中）"'), "带括号后缀的完整卡名整体命中");
  const ex = linkifyExcept(esc("幻戏倒计时：3结束后幻戏结束"), "幻戏");
  assert(ex.includes('data-term="幻戏倒计时：3"'), "屏蔽幻戏时不拆坏长名（修复验证）");
  assert(!(ex.match(/data-term="幻戏"/g)), "屏蔽幻戏后自身不再可点");

  /* 边界：「」引号内部分命中不识别 —— 幻戏倒计时：3 的真实卡文场景 */
  const quoted = linkify(esc("将1张元素骰费用比此牌少1个的「幻戏倒计时」放置到你的牌库顶。"));
  assert(!(quoted.match(/data-term="幻戏"/g)), "「幻戏倒计时」中的幻戏不再误识别为术语");
  const quotedExact = linkify(esc("这是一个「战斗行动」。"));
  assert(quotedExact.includes('data-term="战斗行动"'), "引号内容与术语完全一致时仍正常识别");

  /* 边界：经典反应从"X元素相关反应"分组词条拆解（官方术语表无独立词条） */
  assert(k0("感电") === "keyword" && d0("感电").includes("穿透伤害"), "感电：拆解自官方分组词条，描述含穿透伤害");
  assert(d0("绽放").includes("草原核"), "绽放：描述含草原核");
  for (const r of ["蒸发", "冻结", "超载", "超导", "原激化", "燃烧", "扩散（水）", "结晶（水）"])
    assert(termEntries(r).length > 0, "反应术语已收录：" + r);
  assert(d0("月感电").includes("雷暴云"), "月感电保持术语表独立词条（不被拆解覆盖）");
  const sent = linkify(esc("敌方受到感电反应/绽放反应/结晶(水)反应时，改为月感电/月绽放/月结晶反应。"));
  for (const t of ["感电", "绽放", "月感电", "月绽放", "月结晶", "结晶"])
    assert(sent.includes('data-term="' + t + '"'), "真实卡文识别：" + t);

  /* 补充概念库（genshin-db 静态快照）并入验证 */
  for (const t of ["普通攻击", "元素骰", "结束阶段", "抓牌", "切换角色", "元素调和"])
    assert(termEntries(t).length > 0, "补充概念已入索引：" + t);
  assert(["rule", "rule-term"].includes(k0("普通攻击")), "普通攻击 → 规则类概念（" + k0("普通攻击") + "）");
  assert(k0("静水流涌之辉") === "card", "piovium 优先：静水流涌之辉 仍为 card（身份层不被补充库覆盖）");
  assert(k0("芙宁娜") === "char", "piovium 优先：芙宁娜 仍为 char");
  /* 补充库卡牌分两种：与现网同名的接回真实卡牌身份；对不上号的才降级 cardref */
  const realCard = Object.entries(EXTRA_CONCEPTS).find(([n, i]) => i.kind === "card" && k0(n) === "card" && termEntries(n)[0]?.id != null);
  assert(realCard, "补充库同名卡接回真实身份（可跳详情）：" + (realCard ? realCard[0] : "（无样本）"));
  const cardref = Object.entries(EXTRA_CONCEPTS).find(([n, i]) => i.kind === "card" && k0(n) === "cardref");
  assert(cardref, "补充库卡牌降级为 cardref（不跳转不存在详情）：" + (cardref ? cardref[0] : "（全部已接回真实卡牌）"));
  assert(termIndex.size > Object.keys(EXTRA_CONCEPTS).length, "索引规模含补充概念：" + termIndex.size);

  /* 占位符：可见文本零泄漏（残留仅存在于 hidden 引擎技能与未加工的 rawDescription） */
  let visLeak = 0;
  for (const x of [...state.CHAR, ...state.ENT]) {
    if (x.description && /D__KEY__|\$\[[KS]\d+\]/.test(x.description)) visLeak++;
    for (const s of x.skills || []) if (!s.hidden && s.description && /D__KEY__|\$\[[KS]\d+\]/.test(s.description)) visLeak++;
  }
  assert(visLeak === 0, "可见文本无占位符泄漏（" + visLeak + " 处）");

  console.log(getFails() ? "\\n存在失败项" : "\\n全部通过");
  process.exit(getFails() ? 1 : 0);
})().catch(e => { console.error("执行异常:", e); process.exit(1); });
`;

await new Function(
  "document", "window", "localStorage", "location", "history", "fetch", "navigator", "assert", "getFails", "CONCEPTS_EXTRA",
  logic + harness,
)(
  documentStub, {}, { getItem: () => null, setItem: () => {} },
  { hash: "" }, { replaceState() {} },
  fetchStub, { clipboard: {} }, assert, () => fails, conceptsExtra,
);

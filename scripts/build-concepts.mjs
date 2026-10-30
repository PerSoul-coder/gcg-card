// 从 genshin-db 数据构建概念补充库，并量化覆盖度
// 数据来源：theBowja/genshin-db（解析自游戏配置，中文档）
// 用法：node scripts/build-concepts.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.join(BASE, "vendor/genshin-db-data/genshin-db-main/src/data/ChineseSimplified");
const readDir = d => fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith(".json")).map(f => JSON.parse(fs.readFileSync(path.join(d, f), "utf8"))) : [];

const gdbKeywords = readDir(path.join(ROOT, "tcgkeywords"));
const gdbRules = readDir(path.join(ROOT, "tcgdetailedrules"));
const gdbStatus = readDir(path.join(ROOT, "tcgstatuseffects"));
const gdbSummons = readDir(path.join(ROOT, "tcgsummons"));
const gdbEnemies = readDir(path.join(ROOT, "tcgenemycards"));
const gdbAction = readDir(path.join(ROOT, "tcgactioncards"));
const gdbChars = readDir(path.join(ROOT, "tcgcharactercards"));

console.log("genshin-db 数据量: keywords=%d rules=%d status=%d summons=%d enemies=%d actionCards=%d charCards=%d",
  gdbKeywords.length, gdbRules.length, gdbStatus.length, gdbSummons.length, gdbEnemies.length, gdbAction.length, gdbChars.length);

// 规则词条：title + content（去掉 color 标签）
const clean = t => (t || "").replace(/<color=[^>]*>|<\/color>/g, "").trim();
// 罗马数字节标题（I.角色区 / II.角色附属…）是规则文档的目录结构，不是可引用概念
const isSectionTitle = t => /^[IVX]+[.、．]/.test(t);
// （test）开头是未进入正式卡池的测试卡，不会出现在任何卡文中
const isTestCard = t => /^（test）/.test(t);
const ruleEntries = [];
for (const ch of gdbRules) {
  for (const r of ch.rules || []) {
    const title = clean(r.title);
    if (title && title.length >= 2 && title.length <= 12 && !isSectionTitle(title))
      ruleEntries.push({ name: title, desc: clean(r.content), chapter: ch.name });
  }
}
console.log("规则词条(2-12字，已滤除目录节标题):", ruleEntries.length);

const isTriggerPhrase = t => /后$/.test(t) || t.length > 6;
    /* 规则正文中「」/【】引用的术语 → 定义句打分挑选释义。
   旧实现取"首个包含该词的句子"当定义，会把效果句误判为定义
   （如"出战角色"命中的是特技/超载的效果句）。改为对全部候选句打分：
   · 规则标题同名 +10；句首【术语】行动前缀 +8；句首即术语 +6
   · 定义线索词（会有一名/被称为/作为/才能…）邻近 +4；句内复现每次 +2（至多 +4）
   · 出自"元素反应·效果"章 −6（该章通篇是效果描述，不是定义）
   低于阈值不注册——宁缺勿滥，展示"暂无描述"好过展示错文。 */
const DEF_CUE = /会有一名|被称为|称为|是指|即指|指的是|表示|会放置|会附属|会生成|会从|拥有|持有|获得|作为|形成|视为|才能|可以|会受到|会使用/;
const DEF_THRESHOLD = 8;
function scoreDefinition(term, src, rule) {
  let s = 0;
  if (rule.title === term) s += 10;
  const stripped = src.replace(/^（\d+）/, "").trim();
  if (stripped.startsWith("【" + term + "】")) s += 8;
  else if (stripped.startsWith(term)) s += 6;
  const i = src.indexOf(term);
  if (i >= 0 && DEF_CUE.test(src.slice(Math.max(0, i - 14), i + term.length + 14))) s += 4;
  s += Math.min(src.split(term).length - 2, 2) * 2;
  if (rule.chapter === "元素反应·效果") s -= 6;
  return s;
}
const derived = new Map();
for (const ch of gdbRules) {
  for (const r of ch.rules || []) {
    const title = clean(r.title), content = clean(r.content);
    const rule = { title, chapter: ch.name };
    for (const src of [title, ...content.split("\n")]) {
      for (const m of src.matchAll(/[「【]([^」】\n]{2,15})[」】]/g)) {
        const t = m[1].trim();
        if (isTriggerPhrase(t)) continue;
        const s = scoreDefinition(t, src, rule);
        if (s < DEF_THRESHOLD) continue;
        const prev = derived.get(t);
        if (!prev || s > prev.score)
          derived.set(t, { name: t, desc: `（官方规则·${ch.name}）${src.trim()}`, chapter: ch.name, score: s });
      }
    }
  }
}
console.log("规则正文派生术语（打分≥" + DEF_THRESHOLD + "）:", derived.size);

/* 核心术语人工校订表：均为官方规则文档原文（含章节出处），优先级最高。
   覆盖两类：①打分器难以识别定义句的（出战角色/手牌/牌堆…）；
   ②规则散落多处需拼接的（普通攻击/元素战技）。
   注：万能元素/充能/元素爆发/快速行动/战斗行动/护盾/穿透伤害/特技/重击
   piovium 现网关键词已有权威释义，不在本表重复。 */
const CURATED = {
  "出战角色": ["《七圣召唤》·游戏准备", "双方各自选择一张自己的「角色牌」作为「出战角色」。其他未出战的角色被称为「后台角色」，可以通过「切换角色」行动来将他们切换为「出战角色」。"],
  "元素骰": ["回合流程·投掷阶段", "每回合的投掷阶段中，会投掷8个「元素骰」。每个「元素骰」，都可以投出冰、水、火、雷、风、岩、草7种元素，以及可以当作任何元素使用的「万能元素」。"],
  "后台角色": ["游戏区域", "其他未出战的角色被称为「后台角色」。可以通过「切换角色」行动来将他们切换为「出战角色」。"],
  "手牌": ["游戏区域", "游戏开始后，从「牌堆」中抓5张牌，作为初始的「手牌」。每个回合结束时，双方各抓2张牌。只有「手牌」中的行动牌可以被打出和用于元素调和。"],
  "牌堆": ["游戏区域", "游戏开始前，将牌组中的所有「行动牌」洗混，形成「牌堆」。进行「抓牌」时，会从「牌堆」顶部抓取「行动牌」加入手牌；此时如果「牌堆」中已经没有卡牌，则牌手不会获得手牌。"],
  "抓牌": ["游戏区域", "进行「抓牌」时，会从「牌堆」顶部抓取「行动牌」加入手牌。此时如果「牌堆」中已经没有卡牌，则牌手不会获得手牌。"],
  "普通攻击": ["进行行动", "支付所需费用，使用「出战角色」的技能。「普通攻击」「元素战技」「元素爆发」是角色可使用的三类技能；角色每次使用「普通攻击」或「元素战技」后，会获得1点「充能」。"],
  "元素战技": ["进行行动", "支付所需费用，使用「出战角色」的技能。角色每次使用「普通攻击」或「元素战技」后，会获得1点「充能」。"],
  "先手牌手": ["回合流程", "从「先手牌手」开始，双方「轮流进行行动」。每回合先「宣布结束」的牌手成为「先手牌手」。"],
  "复苏": ["特殊词条·料理", "「复苏」是部分「料理」事件牌的效果，可以复苏目标角色并治疗该角色。每回合中最多通过「料理」复苏1个角色，并且每个角色最多食用1次「料理」；打出具有「复苏」效果的「料理」事件牌后，本回合内就不能打出其他具有「复苏」效果的「料理」事件牌了。"],
  "重投": ["回合流程·投掷阶段", "每回合的投掷阶段中，会投掷8个「元素骰」。投掷完成后，还有1次机会选择任意数量元素骰进行「重投」。"],
  "附着": ["元素反应·规则", "角色在受到冰、水、火、雷、草的「元素伤害」时，会附着对应类型的元素。（风元素伤害和岩元素伤害，无法进行元素附着。）"],
  "武器": ["游戏区域·角色附属", "「装备牌」打出给角色后，会附属在角色牌上。每个角色最多装备1张「武器」、1张「圣遗物」、1张「特技」，和任意张其他类型的装备。"],
  "圣遗物": ["游戏区域·角色附属", "「装备牌」打出给角色后，会附属在角色牌上。每个角色最多装备1张「武器」、1张「圣遗物」、1张「特技」，和任意张其他类型的装备。"],
  "支援区": ["游戏区域", "「支援牌」打出后，会放置在支援区。支援区最多放置4张「支援牌」。占满后打出新的支援牌时，需要先选择一张支援区内的支援牌弃置。"],
  "召唤物区": ["游戏区域", "一些角色技能会在召唤物区生成「召唤物」。召唤物区最多放置4个「召唤物」。占满后，无法生成新的「召唤物」。"],
  "切换角色": ["回合流程·行动阶段", "【切换角色】支付1个任意元素骰，切换「出战角色」。"],
  "结束阶段": ["回合流程", "在行动阶段中所有牌手都「宣布回合结束」后，进入「结束阶段」。从「先手牌手」开始，处理在「结束阶段」触发的卡牌效果；每位牌手从自己的牌堆中抓2张牌。"],
  "击倒": ["其他规则", "当角色的生命值被降为0，则在技能或效果结算完成后，角色就会被「击倒」。此时，角色身上所附属的装备和状态都会被弃置，充能会被清空。"],
  "秘传": ["特殊词条", "在一场对局中，每位牌手只能使用一张「秘传」卡牌。「秘传」卡牌一定在你的起始手牌中。"],
  "料理": ["特殊词条", "当「料理」事件牌对角色生效后，角色会进入「饱腹」状态。处于「饱腹」状态下的角色，无法成为其他「料理」事件牌的目标，也无法受到其他「料理」事件牌的效果影响。「饱腹」状态会在回合结束或角色被击倒时解除。"],
  "元素调和": ["回合流程·行动阶段", "【元素调和】丢弃一张手牌，转换一个元素骰的类型。"],
  "宣布结束": ["回合流程·行动阶段", "【宣布结束】结束本回合的行动。每回合先宣布回合结束的牌手成为「先手牌手」。"],
  /* 以下为依据角色附属规则整理的装备类词条（规则文档无独立定义句） */
  "天赋": ["游戏区域·角色附属", "「天赋」牌是角色对应的装备牌，仅当对应角色在场时才能打出；每个角色最多装备1张「天赋」牌。"],
  "单手剑": ["游戏区域·角色附属", "武器类型。角色只能装备对应类型的「武器」牌，每个角色最多装备1张「武器」。"],
  "双手剑": ["游戏区域·角色附属", "武器类型。角色只能装备对应类型的「武器」牌，每个角色最多装备1张「武器」。"],
  "法器": ["游戏区域·角色附属", "武器类型。角色只能装备对应类型的「武器」牌，每个角色最多装备1张「武器」。"],
  "长柄武器": ["游戏区域·角色附属", "武器类型。角色只能装备对应类型的「武器」牌，每个角色最多装备1张「武器」。"],
};

// 合并概念库（按优先级，先到先得）
const concepts = new Map();
const add = (name, kind, desc, type) => {
  if (!name || name.length < 2) return;
  /* genshin-db 的卡名/术语名有时整体带「」括号（如「魔女M的祝福」）：
     仅当整名被括号包裹时才注册剥离版；不对称包裹（如「希穆兰卡」卡牌）不能剥，
     否则会产出"希穆兰卡」卡牌"这种垃圾名 */
  const m = name.match(/^[「【](.+)[」】]$/);
  const variants = m ? [name, m[1]] : [name];
  for (const n of variants) {
    if (n.length >= 2 && !concepts.has(n))
      concepts.set(n, { kind, desc: desc || "", ...(type ? { type } : {}) });
  }
};
// 1) 官方关键词（genshin-db 版，含「」包裹的原名和剥离版）
for (const k of gdbKeywords) add(clean(k.name), "keyword", clean(k.description));
// 2) 规则词条（独立成条）
for (const r of ruleEntries) add(r.name, "rule", r.desc);
// 3) 规则正文派生术语
for (const [t, info] of derived) add(t, "rule-term", info.desc);
// 3b) 核心术语人工校订（强制覆盖前面的自动派生，保证权威文本胜出）
for (const [name, [chapter, text]] of Object.entries(CURATED))
  concepts.set(name, { kind: "rule", desc: `（官方规则·${chapter}）${text}` });
// 4) 状态效果 / 召唤物 / 敌方牌 / 行动牌 / 角色牌（名称索引 + 可用描述）
for (const s of gdbStatus) add(clean(s.name), "status", clean(s.description));
for (const s of gdbSummons) add(clean(s.name), "summon", clean(s.description));
// 敌方牌无 description 字段，描述由 skills 的官方文本拼装
for (const e of gdbEnemies) {
  const sd = (e.skills || [])
    .map(s => [clean(s.name), clean(s.description)].filter(Boolean).join("："))
    .filter(Boolean).join("\n");
  add(clean(e.name), "enemy", sd);
}
// 行动牌：补录描述与类型文本（piovium 没有的历史版本卡也能展示卡文）
for (const c of gdbAction) {
  const n = clean(c.name);
  if (isTestCard(n)) continue;
  add(n, "card", clean(c.description), clean(c.cardtypetext));
}
for (const c of gdbChars) add(clean(c.name), "character", clean(c.storytext));

console.log("\ngenshin-db 侧概念总数:", concepts.size);

// ===== 与现有索引合并，量化覆盖度 =====
const piKW = JSON.parse(fs.readFileSync(path.join(BASE, "gi-data/keywords.json"), "utf8")).data;
const piENT = JSON.parse(fs.readFileSync(path.join(BASE, "gi-data/entities.json"), "utf8")).data;
const piCHAR = JSON.parse(fs.readFileSync(path.join(BASE, "gi-data/characters.json"), "utf8")).data;
const current = new Set();
for (const e of piENT) if (e.name && e.name.length >= 2) current.add(e.name);
for (const c of piCHAR) if (c.name && c.name.length >= 2) current.add(c.name);
for (const k of piKW) {
  if (k.name && k.name.length >= 2) current.add(k.name);
  if (/元素相关反应$/.test(k.name) && k.description)
    for (const line of k.description.split("\n")) {
      const m = line.match(/^([^：\n]{2,12})：([\s\S]+)$/);
      if (m) current.add(m[1].trim());
    }
}

// 全部卡文里「」引用审计
const texts = [...piENT.map(e => e.description || ""), ...piENT.map(e => JSON.stringify(e.skills || "")), ...piCHAR.map(c => JSON.stringify(c.skills || ""))].join("\n");
const quoted = [...new Set([...texts.matchAll(/「([^」\n]{2,15})」/g)].map(m => m[1]))];
const before = quoted.filter(n => current.has(n));
const after = quoted.filter(n => current.has(n) || concepts.has(n));
console.log("\n===== 「」引用覆盖审计 =====");
console.log("引用总数:", quoted.length);
console.log("修复前覆盖:", before.length, `(${(before.length / quoted.length * 100).toFixed(0)}%)`);
console.log("补充后覆盖:", after.length, `(${(after.length / quoted.length * 100).toFixed(0)}%)`);
const stillMissing = quoted.filter(n => !current.has(n) && !concepts.has(n));
console.log("仍缺失:", stillMissing.length, "→", stillMissing.join(" "));

/* 过度链接防护：自动派生的短通用词在中文卡文里极易被误命中——"行动"既是官方术语
   "战斗行动/快速行动"的子串（正式场合本就会长名优先命中），又大量出现在"对方行动"
   这类普通词组中，独立链接收益远小于噪音，显式排除。
   注：卡文真正引用的规则概念（普通攻击/元素骰/切换角色/结束阶段/元素调和…）均 ≥3 字，
   不受影响；2 字但罕见于普通词组的（秘传/重投/复苏/扩散/手牌…）保留。 */
const OVER_LINK_STOP = new Set(["行动"]);

// 保存补充库（只存现有索引没有的）
const supplement = {};
for (const [name, info] of concepts) {
  if (current.has(name)) continue;
  if (["rule", "rule-term"].includes(info.kind) && OVER_LINK_STOP.has(name)) continue;
  supplement[name] = info;
}
fs.writeFileSync(path.join(BASE, "gi-data/concepts-extra.json"), JSON.stringify(supplement, null, 1), "utf8");
console.log("\n补充条目已写入 gi-data/concepts-extra.json:", Object.keys(supplement).length, "条");

/* 同步产出浏览器直载的 JS 包装：file:// 下 fetch 本地 JSON 受 CORS 限制，
   经典 <script src> 不受限——查看器保持双击即开 */
fs.writeFileSync(path.join(BASE, "gi-data/concepts-extra.js"), "window.CONCEPTS_EXTRA = " + JSON.stringify(supplement) + ";\n", "utf8");
console.log("已写入 gi-data/concepts-extra.js（查看器 <script> 直载）");

const byKind = {};
for (const v of Object.values(supplement)) byKind[v.kind] = (byKind[v.kind] || 0) + 1;
console.log("补充库构成:", JSON.stringify(byKind));
console.log("有描述的补充条目:", Object.values(supplement).filter(v => v.desc).length);

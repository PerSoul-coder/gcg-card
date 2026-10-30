/* 七圣召唤 · 卡牌与牌组浏览器 — 逻辑
   牌组分享码解码/编码 + 卡库浏览 + 概念检索（术语下钻与反链）+ 多牌组管理
   解码/编码移植自 piovium/genius-invokation @gi-tcg/assets-manager/src/sharing.ts (AGPL-3.0)
   数据源: https://static-data.piovium.org/api/v5 (官方静态数据服务) */
"use strict";
const API = "https://static-data.piovium.org/api/v5";
const LANG = "CHS";
const SAMPLE = "JDCS4mwOFiLBRXUkJlLiRkwkEmCx8YAPGxFxaLcWFYGBilgYI6Ey2zMdDLEyaVIWJJAA";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));

/* ---------- 解码（移植自 sharing.ts decodeRaw） ---------- */
function decodeRaw(src) {
  const bin = atob(src.replace(/\s+/g, ""));
  const arr = Array.from(bin, c => c.codePointAt(0));
  if (arr.length !== 51) throw new Error(`分享码长度无效（期望 51 字节，实际 ${arr.length}）`);
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
  return result;
}

/* ---------- 编码（移植自 sharing.ts encodeRaw + 屏蔽词规避） ---------- */
const BLOCK_WORDS = ["1s","2c8","2g1c","4jg","4jk","5l3","64","6four","6iv","6si","89","8jiu","92f","99bb","a55","anal","anus","ass","ash0le","b00b","b1tch","b17ch","ba9","bb1","bbw","bdsm","beaner","bi7ch","bimbos","bitch","boob","boner","c0cks","c0n","c4","cag","ccp","chink","clit","cnm","cnn","cock","coons","cum","cunt","cuum","cv0","darkie","dick","dildo","dilld0","dommes","dpp","dvda","ecchi","erotic","f4k","fag1t","fagg1t","faggot","fck","fdp","fecal","felch","feltch","femdom","flg","fm2","fuck","gay","gcd","gdm","ggc","girlon","goatcx","goatse","gokkun","grope","guro","gwg","hentai","hitler","hjt","honkey","hooker","incest","j8","jba","ji8","jiba","jiz","juggs","jzm","k7","kike","kinky","kmt","kock","liu4","liusi","lolita","lsp","m0m","m2f","mh0","milf","mof0","nambla","negro","nignog","nigga","nigger","nipple","njink","nmd","ntd","ntr","nympho","orgasm","orgy","p0rn","p2np","p3t","paki","panty","pcp","penis","phuq","pig","poof","poon","porn","pqp","prr","pthc","pu55i","pu55y","pubes","puki","punany","pussy","queaf","queef","queer","quim","rape","raping","rapist","rbq","rectum","rimjob","s2x","s3x","sadism","scat","semen","sex","sh7t","shit","shota","six4","skeet","slut","slvt","smut","sodomy","spic","spooge","spunk","suck","t3k","t41","t43","t4e","t4i","tits","tiedup","titty","tmd","tosser","tranny","tushy","twat","twink","vagina","vi4","viiv","vpn","vulva","waf","wank","whore","wh0re","wtf","x3r","xdd","xjp","yaoi","yiffy"];
const BLOCK_RE = new RegExp(BLOCK_WORDS.map(w => w.split("").join("[+/]*")).join("|"), "i");
function encodeRaw(arr) {
  if (arr.length !== 33) throw new Error("编码需要恰好 33 张牌（3 角色 + 30 行动牌）");
  const padded = [...arr, 0];
  const reordered = Array.from({ length: 17 }).flatMap((_, i) => [
    padded[i * 2] >> 4,
    ((padded[i * 2] & 0xf) << 4) + (padded[i * 2 + 1] >> 8),
    arr[i * 2 + 1] & 0xff,
  ]);
  for (let last = 0; last < 0xff; last++) {
    const original = Array.from({ length: 25 }).flatMap((_, i) => [
      (reordered[i] + last) & 0xff,
      (reordered[i + 25] + last) & 0xff,
    ]);
    const encoded = btoa(String.fromCodePoint(...original, last));
    if (!BLOCK_RE.test(encoded)) return encoded;
  }
  throw new Error("未能生成避开屏蔽词的分享码");
}

/* ---------- 数据加载（内置快照 / localStorage 缓存 / 现网，三级来源 + 超时重试 + 单 flight） ----------
   来源优先级：本地缓存 → 内置快照（仅单文件版有）→ 现网。
   单文件版由构建脚本把三份数据快照内嵌进 HTML（window.BUILTIN_DATA），因此断网也能
   完整使用；「刷新数据」强制走现网，成功后写缓存覆盖。
   缓存带版本戳与写入时间：24 小时过期自动重拉（官方发新卡后本地不会永久过期），
   旧版裸数组缓存平滑接纳并按当前时间重新计时。 */
const CACHE_TTL_MS = 24 * 3600 * 1000;
const FETCH_TIMEOUT_MS = 15000;
/* 单文件版内置快照：构建脚本在本文件之前注入 window.BUILTIN_DATA。
   多文件版没有这个全局变量，BUILTIN_DATA 为 null，行为与过去完全一致。 */
const BUILTIN_DATA = (typeof window !== "undefined" && window.BUILTIN_DATA) || null;
const dataOrigins = new Set();   /* 本次加载实际用到的来源，供数据信息行展示 */
const ORIGIN_ZH = { builtin: "内置快照 · 离线可用", cache: "浏览器本地缓存", network: "现网最新" };
const cacheKey = cat => `gi-viewer-${LANG}-latest-${cat}`;
function readCache(cat, now = Date.now()) {
  try {
    const raw = localStorage.getItem(cacheKey(cat));
    if (!raw) return null;
    const j = JSON.parse(raw);
    /* 旧版格式（裸数组）无时间戳：接纳并按 now 重新计时，避免老用户被强制重拉 */
    if (Array.isArray(j)) return j.length ? { data: j, at: now } : null;
    if (j && j.v === 1 && Array.isArray(j.data)) {
      if (!j.data.length) return null;
      return now - j.at > CACHE_TTL_MS ? null : j;   /* 过期 → 重拉 */
    }
    return null;
  } catch (e) { return null; }
}
function writeCache(cat, data, now = Date.now()) {
  try { localStorage.setItem(cacheKey(cat), JSON.stringify({ v: 1, at: now, data })); } catch (e) {}
}
/* 带超时的 JSON 拉取（AbortController 超时即 reject，避免网络挂起永久转圈） */
async function fetchJson(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}
async function fetchCategory(cat, { forceNetwork = false } = {}) {
  /* 强制刷新：跳过缓存与内置快照，直接走现网（保证「刷新数据」真的拿到最新） */
  if (!forceNetwork) {
    const hit = readCache(cat);
    if (hit) { dataOrigins.add("cache"); return hit.data; }
    const builtin = BUILTIN_DATA && BUILTIN_DATA[cat];
    if (Array.isArray(builtin) && builtin.length) { dataOrigins.add("builtin"); return builtin; }
  }
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {          /* 网络失败重试一次 */
    try {
      const j = await fetchJson(`${API}/data/latest/${LANG}/${cat}`);
      const data = j && j.data;
      if (!Array.isArray(data) || !data.length) throw new Error("返回数据结构异常");
      writeCache(cat, data);
      dataOrigins.add("network");
      return data;
    } catch (e) { lastErr = e; }
  }
  throw new Error(`数据获取失败 ${cat}: ${lastErr && lastErr.message}`);
}

/* 拉取层入口：保证 CHAR/ENT/KW 与派生索引就绪。
   单 flight：并发调用（解析/切视图/深链同时触发）只发一次请求，失败不缓存、
   下次调用可重试；「刷新数据」通过重置 dataFlight 强制重新拉取。 */
let dataReady = false;
let dataFlight = null;
function ensureData(forceNetwork = false) {
  if (dataReady && !forceNetwork) return Promise.resolve();
  if (!dataFlight) {
    dataFlight = loadData(forceNetwork).finally(() => { dataFlight = null; });
  }
  return dataFlight;
}
async function loadData(forceNetwork = false) {
  dataOrigins.clear();
  if (forceNetwork) setStatus(`<span class="spin"></span>正在从官方数据服务重新拉取（约 2MB）…`);
  else if (BUILTIN_DATA) setStatus(`<span class="spin"></span>正在载入内置数据快照…`);
  else setStatus(`<span class="spin"></span>首次加载卡牌数据（约 2MB），之后会本地缓存…`);
  const res = await Promise.allSettled([
    fetchCategory("characters", { forceNetwork }),
    fetchCategory("entities", { forceNetwork }),
    fetchCategory("keywords", { forceNetwork }),
  ]);
  if (res[0].status !== "fulfilled" || res[1].status !== "fulfilled")
    throw new Error("卡牌数据获取失败，请检查网络后重试");
  CHAR = res[0].value; ENT = res[1].value;
  KW = res[2].status === "fulfilled" ? res[2].value : [];
  for (const c of [...CHAR, ...ENT]) if (c.shareId != null) {
    shareMap[c.shareId] = c.id;
    if (!(c.id in idToShare)) idToShare[c.id] = c.shareId;
  }
  charById = new Map(CHAR.map(c => [c.id, c]));
  charByName = new Map(CHAR.map(c => [c.name, c]));
  entById = new Map(ENT.map(e => [e.id, e]));
  buildTermIndex();
  buildPool();
  buildBacklinks();
  pruneDraft(); renderDraft();
  renderDataInfo();
  dataReady = true;
}

/* ---------- 翻译表 ---------- */
const ELE_ZH = { CRYO:"冰", HYDRO:"水", PYRO:"火", ELECTRO:"雷", ANEMO:"风", GEO:"岩", DENDRO:"草" };
const ELE_COLOR = { CRYO:"var(--cryo)", HYDRO:"var(--hydro)", PYRO:"var(--pyro)", ELECTRO:"var(--electro)", ANEMO:"var(--anemo)", GEO:"var(--geo)", DENDRO:"var(--dendro)" };
const WEAPON_ZH = { BOW:"弓", CATALYST:"法器", CLAYMORE:"双手剑", SWORD:"单手剑", POLE:"长柄武器", NONE:"其他武器" };
const TAG_ZH = { GCG_TAG_TALENT:"天赋", GCG_TAG_WEAPON:"武器", GCG_TAG_ARTIFACT:"圣遗物", GCG_TAG_PLACE:"场地", GCG_TAG_ALLY:"伙伴", GCG_TAG_ITEM:"道具", GCG_TAG_FOOD:"料理", GCG_TAG_RESONANCE:"元素共鸣", GCG_TAG_LEGEND:"秘传", GCG_TAG_SLOWLY:"战斗行动", GCG_TAG_CARD_BLESSING:"元素幻变", GCG_TAG_VEHICLE:"载具", GCG_TAG_HEXENZIRKEL:"魔女会", GCG_TAG_ADVENTURE_PLACE:"冒险场地", GCG_TAG_SUB_HURT:"减伤", GCG_TAG_NON_DISCOVERABLE:null };
const COST_ZH = { CRYO:"冰", HYDRO:"水", PYRO:"火", ELECTRO:"雷", ANEMO:"风", GEO:"岩", DENDRO:"草", VOID:"万能", ENERGY:"充能", LEGEND:"秘传" };
function tagZh(t) {
  if (t in TAG_ZH) return TAG_ZH[t];
  const m = t.match(/^GCG_TAG_(ELEMENT|WEAPON|NATION|CAMP|ARKHE)_(.+)$/);
  if (m) {
    if (m[1] === "ELEMENT") return ELE_ZH[m[2]] || m[2];
    if (m[1] === "WEAPON") return WEAPON_ZH[m[2]] || m[2];
    if (m[1] === "NATION") return ({ MONDSTADT:"蒙德", LIYUE:"璃月", INAZUMA:"稻妻", SUMERU:"须弥", FONTAINE:"枫丹", NATLAN:"纳塔", SNEZHNAYA:"至冬", FATUI:"愚人众", NODKRAI:"挪德卡莱" })[m[2]] || m[2];
    if (m[1] === "ARKHE") return ({ PNEUMA:"芒", OUSIA:"虚" })[m[2]] || m[2];
    return m[2];
  }
  return t.replace(/^GCG_TAG_/, "");
}
const TYPE_ZH = { GCG_CARD_MODIFY:"装备牌", GCG_CARD_SUPPORT:"支援牌", GCG_CARD_EVENT:"事件牌", GCG_CARD_ASSIST:"援助牌", GCG_CARD_CHARACTER:"角色牌", GCG_CARD_STATE:"状态牌", GCG_CARD_ONSTAGE:"场地牌", GCG_CARD_SUMMON:"召唤物", GCG_CARD_ATTACHMENT:"附加状态" };
/* 中文名 → 标签码反查（描述兜底解析牌组限制时还原结构化标签） */
const NATION_CODE = { 蒙德:"GCG_TAG_NATION_MONDSTADT", 璃月:"GCG_TAG_NATION_LIYUE", 稻妻:"GCG_TAG_NATION_INAZUMA", 须弥:"GCG_TAG_NATION_SUMERU", 枫丹:"GCG_TAG_NATION_FONTAINE", 纳塔:"GCG_TAG_NATION_NATLAN", 至冬:"GCG_TAG_NATION_SNEZHNAYA", 挪德卡莱:"GCG_TAG_NATION_NODKRAI" };
const CAMP_CODE = { 愚人众:"GCG_TAG_CAMP_FATUI", 魔物:"GCG_TAG_CAMP_MONSTER", 镀金旅团:"GCG_TAG_CAMP_EREMITE" };
const ELE_CODE = {};
for (const [k, v] of Object.entries(ELE_ZH)) ELE_CODE[v] = "GCG_TAG_ELEMENT_" + k;

/* ---------- 图标系统（内联 SVG） ----------
   充能用「金色实心四芒星」而非闪电：闪电是雷元素的符号，火焰又是火元素的符号，
   二者放在充能费用上都会被误读成元素骰。四芒星不属于七元素，且用实心填充，
   与元素图标的描边风格形成形态区分——色觉差异之外还有形状差异。
   元素图标按各自元素色着色，尺寸随字号缩放——emoji 在不同平台字形差异太大。 */
const ENERGY_ICON = `<svg class="ico i-en" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 1.5C13.4 7.2 16.8 10.6 22.5 12 16.8 13.4 13.4 16.8 12 22.5 10.6 16.8 7.2 13.4 1.5 12 7.2 10.6 10.6 7.2 12 1.5Z"/><circle class="core" cx="12" cy="12" r="1.5"/></svg>`;
const ELE_ICON_PATHS = {
  CRYO: `<path d="M12 3v18M4.6 7.5l14.8 9M19.4 7.5l-14.8 9"/><path d="m9.2 4.6 2.8 2.4 2.8-2.4M9.2 19.4l2.8-2.4 2.8 2.4"/>`,
  HYDRO: `<path d="M12 3.2c3.1 3.6 5.2 6.2 5.2 9.1a5.2 5.2 0 0 1-10.4 0c0-2.9 2.1-5.5 5.2-9.1Z"/>`,
  PYRO: `<path d="M12 2.8c.8 3 4.3 4.7 4.3 8.6a4.3 4.3 0 1 1-8.6 0c0-1.9 1-3.4 2.1-4.5.1 1.1.5 2 1.2 2.6-.1-2.3.3-4.6 1-6.7Z"/>`,
  ELECTRO: `<path d="M13.4 2.4 5.2 13.4h4.9l-1.5 8.2 9-11.4h-5l1.2-7.8Z"/>`,
  ANEMO: `<path d="M3.4 10.2c1.8-2.7 5.3-3.3 7.8-1.6 2.2 1.5 2.4 4.3.8 6-1.3 1.4-3.5 1.5-4.9.2-.9-.9-.9-2.5.1-3.3.9-.8 2.3-.6 3 .3"/><path d="M20.6 13.8c-1.8 2.7-5.3 3.3-7.8 1.6-2.2-1.5-2.4-4.3-.8-6 1.3-1.4 3.5-1.5 4.9-.2.9.9.9 2.5-.1 3.3-.9.8-2.3.6-3-.3"/>`,
  GEO: `<path d="m12 2.6 8 4.6v9.6l-8 4.6-8-4.6V7.2l8-4.6Z"/><path d="m12 7.4 4.4 2.6v5.2L12 17.8l-4.4-2.6V10l4.4-2.6Z"/>`,
  DENDRO: `<path d="M19.6 4.3C11.4 3.9 5.2 8.4 5.2 15c0 2.3 1.7 4.5 4.4 4.5 6.8 0 10.4-6.5 10-15.2Z"/><path d="M8.2 17.9c2.1-4.6 5.2-7.7 9.1-9.8"/>`,
};
const ELE_ICONS = {};
for (const [k, p] of Object.entries(ELE_ICON_PATHS))
  ELE_ICONS[k] = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const eleIcon = (el, cls = "") => ELE_ICONS[el]
  ? `<span class="eico ${cls}" style="--ec:${ELE_COLOR[el] || "var(--gold)"}">${ELE_ICONS[el]}</span>` : "";
const enPips = n => n > 0 ? `<span class="enpips" title="充能 ${n}" aria-label="充能 ${n}">${ENERGY_ICON.repeat(n)}</span>` : "";

/* ---------- 测试卡过滤 ----------
   明显是测试用途的实体不进卡库/检索（详情深链 #card=id 仍可按 id 访问）。
   判据（对全库 1347 张实体零误报）：名称括号片段含 ASCII 字母——命中
   （Test）隐藏-费用不变 / （test）绿皮隐藏 / （test）PVEbuff / （test）测试用 /
   火与战争（test）共 5 张，全部 shareId=null（本就不可构筑），或名称含「测试」。 */
const TEST_CARD_RE = /(?:[（(][^）)]*[A-Za-z][^）)]*[）)])|测试/;
const isTestCard = e => TEST_CARD_RE.test(e.name || "");

/* 费用拆分：元素骰 vs 充能 */
const diceCost = pc => (pc || []).filter(x => x.type !== "GCG_COST_ENERGY").reduce((a, x) => a + x.count, 0);
const energyCost = pc => (pc || []).filter(x => x.type === "GCG_COST_ENERGY").reduce((a, x) => a + x.count, 0);
function costHtml(playCost) {
  if (!playCost || !playCost.length) return "";
  return `<span class="cost">` + playCost.map(pc => {
    const t = (pc.type || "").replace("GCG_COST_DICE_", "").replace("GCG_COST_", "");
    const zh = COST_ZH[t] || t;
    const col = ELE_COLOR[t] || (t === "VOID" ? "#8b93a1" : t === "ENERGY" ? "#d3bc8e" : t === "LEGEND" ? "#c8a24b" : "#8b93a1");
    const bg = t === "ENERGY" ? "linear-gradient(180deg,#f2ddb0,#b99a5f)" : col;
    const label = t === "ENERGY" ? `${ENERGY_ICON}<b>${pc.count}</b>` : pc.count;
    return `<span class="die${t === "ENERGY" ? " en" : ""}" style="background:${bg}" title="${esc(zh)}×${pc.count}">${label}</span>`;
  }).join("") + `</span>`;
}
function costText(pc) {
  if (!pc || !pc.length) return "";
  return pc.map(p => {
    const t = (p.type || "").replace("GCG_COST_DICE_", "").replace("GCG_COST_", "");
    const zh = COST_ZH[t] || t;
    return t === "ENERGY" ? `充能×${p.count}` : `${zh}×${p.count}`;
  }).join(" ");
}

/* ---------- 牌间依赖（统一模型：牌组限制 + 打出限制） ----------
   牌组限制（构筑门槛，加入牌组前就要满足）——deckReqsOf：
   · deckChar：牌组需包含指定角色。来源 relatedCharacterId（权威；描述含
     #{REALNAME[..]} 占位的卡——如梦迹一风——只有它能给出正确角色名），
     描述正则「牌组中包含X，才能加入牌组」仅作兜底，且拒绝含 #/{/[ 的捕获；
   · deckEl  ：牌组需包含至少 N 名指定元素角色（元素共鸣牌）；
   · deckTag ：牌组需包含至少 N 名指定地区/阵营角色（风与自由 / 愚人众的阴谋…）。
     N 与元素/地区/阵营均取 relatedCharacterTags（结构化）+ 描述文本双重确认。
   打出限制（对局中生效）——restrictionsOf：秘传限1 / 天赋须在场 / 武器限定 / 限打张数。 */
function deckReqsOf(e) {
  const R = [];
  /* 具体角色：结构化 id 优先；id 缺失（新卡暂无角色数据）时退回描述正则 */
  if (e.relatedCharacterId != null) {
    const n = charById.get(e.relatedCharacterId)?.name || "";
    if (n) R.push({ code: "deckChar", name: n, charId: e.relatedCharacterId,
      short: `牌组·${n}`, label: `牌组限制：牌组中需包含角色「${n}」才能加入` });
  } else {
    const m = (e.description || "").match(/牌组中包含([^，。]{2,12}?)，才能加入牌组/);
    if (m && !/[#{\[]/.test(m[1])) {
      const n = m[1].trim();
      R.push({ code: "deckChar", name: n, charId: charByName.get(n)?.id ?? null,
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
    const m = t.match(/^GCG_TAG_(ELEMENT|NATION|CAMP)_(.+)$/);
    if (!m) continue;
    const mn = (e.description || "").match(/牌组包含至少(\d+)个[^，]*?角色，才能加入牌组/);
    push(t, tagZh(t), mn ? +mn[1] : 2);
  }
  if (!seen.size) {
    const m = (e.description || "").match(/牌组包含至少(\d+)个([^，]*?)(元素|)角色，才能加入牌组/);
    if (m) {
      const n = +m[1], txt = m[2].replace(/^「|」$/g, "");
      const tag = ELE_CODE[txt] || NATION_CODE[txt] || CAMP_CODE[txt];
      if (tag) push(tag, txt, n);
    }
  }
  return R;
}
/* 校验：给定牌组的角色 id 列表，是否满足该条牌组限制。
   deckChar 按角色名匹配（同名多版本——可构筑版与 66xx 变体——视为同一角色）；
   角色不在角色库中（新卡暂无数据）时无法校验，放行——避免误拦。 */
function deckReqMet(req, chars) {
  if (req.code === "deckChar") {
    const want = req.name || charById.get(req.charId)?.name || "";
    if (!want || !charByName.has(want)) return true;
    return chars.some(id => id === req.charId || charById.get(id)?.name === want);
  }
  if (req.code === "deckEl" || req.code === "deckTag") {
    const n = req.n || 2;
    let hit = 0;
    for (const id of chars) {
      const c = charById.get(id);
      if (!c) continue;
      if (req.code === "deckEl") { if ((c.tags || []).includes(req.tag)) hit++; }
      else if ((c.tags || []).includes(req.tag)) hit++;
    }
    return hit >= n;
  }
  return true;
}
/* 缺口说明：为什么这条限制当前不满足（toast / 校验面板共用） */
function reqGapText(req, chars) {
  if (req.code === "deckChar")
    return `需要牌组中包含角色「${req.name}」（当前未包含）`;
  if (req.code === "deckEl" || req.code === "deckTag") {
    let hit = 0;
    for (const id of chars) { const c = charById.get(id); if (c && (c.tags || []).includes(req.tag)) hit++; }
    const what = req.code === "deckEl" ? `${req.name}元素` : `「${req.name}」`;
    return `需要牌组中包含至少 ${req.n || 2} 名${what}角色（当前 ${hit}）`;
  }
  return "";
}
/* 打出限制（结构化推导）：秘传 tag / 天赋关联角色 / 武器类型 tag / 描述文本规则 */
function restrictionsOf(e) {
  const R = [];
  const tags = e.tags || [];
  if (tags.includes("GCG_TAG_LEGEND"))
    R.push({ code: "legend", short: "秘传·限1", label: "秘传牌：整套牌组只能放入 1 张（含同名卡）" });
  if (tags.includes("GCG_TAG_TALENT") && e.relatedCharacterId != null) {
    const n = charById.get(e.relatedCharacterId)?.name || e.relatedCharacterId;
    R.push({ code: "talent", short: "须在场", label: `天赋牌：仅当 ${n} 在场时才能打出` });
  }
  if (tags.includes("GCG_TAG_WEAPON")) {
    const w = tags.find(t => /^GCG_TAG_WEAPON_(?!.*NONE$).+$/.test(t) && t !== "GCG_TAG_WEAPON");
    if (w) {
      const zh = WEAPON_ZH[w.replace("GCG_TAG_WEAPON_", "")] || w;
      R.push({ code: "weapon", short: zh, label: `装备限制：仅可装备给${zh}角色` });
    }
  }
  const m = (e.description || "").match(/最多打出(\d+|一|两|二|三)张/);
  if (m) R.push({ code: "once", short: `限${m[1]}张`, label: `打出限制：本场对局最多打出 ${m[1]} 张` });
  return R;
}
/* 全部依赖（牌组限制在前，打出限制在后）——徽标 / 列表 / 导出统一渲染入口 */
const allReqs = x => [...(x.deckReqs || []), ...(x.restrictions || [])];
/* 徽标取色：牌组限制金/紫（构筑门槛），打出限制沿用既有色；
   deckEl 按元素取色（2×冰 徽标即冰蓝），一眼对上共鸣牌元素 */
const R_STYLE = {
  legend: "var(--gold)", talent: "var(--electro)", weapon: "var(--hydro)", once: "#e07a7a",
  deckChar: "#e0c068", deckTag: "#b48ce0",
};
const R_ZH = { legend: "秘传", talent: "天赋·须在场", weapon: "武器限定", once: "限打张数",
  deckChar: "牌组·角色", deckEl: "牌组·元素", deckTag: "牌组·地区" };
const depBadge = r => `<span class="rbadge" style="border-color:${r.code === "deckEl" ? (ELE_COLOR[r.name] || "var(--gold)") : R_STYLE[r.code]};color:${r.code === "deckEl" ? (ELE_COLOR[r.name] || "var(--gold)") : R_STYLE[r.code]}" title="${esc(r.label)}">${esc(r.short)}</span>`;
const depBadges = reqs => reqs.map(depBadge).join("");

/* ---------- 状态 ---------- */
let CHAR = [], ENT = [], KW = [], shareMap = {}, idToShare = {}, charById = new Map(), charByName = new Map(), entById = new Map();
let current = null;
let currentView = "grid";          /* 当前视图：grid / list / browse / search */
let deckOrder = [];                /* 牌组内有序 id（卡面/列表视图 → 详情翻页的顺序基准） */
/* 弹层视图栈：detail（卡牌/角色详情，自带同级翻页上下文）/ term（概念页，可继续下钻）。
   overlayStack 取代了早期"单一 modalList + 术语栈"的双轨状态——两者混用会导致
   从卡库/检索打开详情后 modalList 被压成单张，此后的翻页永远禁用。 */
let overlayStack = [];

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
const KIND_ORDER = ["card", "char", "keyword", "rule", "rule-term", "status", "summon", "enemy", "cardref", "charref"];
const kindGroup = k => KIND_GROUP[k] || k;
function entryBetter(a, b) {
  if (a.src !== b.src) return a.src < b.src;
  const sa = a.shareId != null ? 1 : 0, sb = b.shareId != null ? 1 : 0;
  if (sa !== sb) return sa > sb;
  const da = a.desc ? 1 : 0, db = b.desc ? 1 : 0;
  if (da !== db) return da > db;
  return false;
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
  for (const e of ENT) if (e.name && e.name.length >= 2)
    addTerm(e.name, { src: 0, kind: "card", id: e.id, name: e.name, shareId: e.shareId,
      type: TYPE_ZH[e.type] || e.type, playCost: e.playCost,
      desc: (e.description || "").trim(), image: imgFull(e.id) });
  for (const c of CHAR) if (c.name && c.name.length >= 2)
    addTerm(c.name, { src: 0, kind: "char", id: c.id, name: c.name, shareId: c.shareId,
      hp: c.hp, energy: c.maxEnergy, desc: (c.storyText || "").trim(), image: imgFull(c.id) });
  for (const k of KW) {
    if (k.name && k.name.length >= 2)
      addTerm(k.name, { src: 0, kind: "keyword", name: k.name, desc: (k.description || "").trim() });
  }
  buildReactionTerms();
  /* 补充概念（genshin-db 静态快照）：与 piovium 现网按种类互补，不挤占已有种类 */
  for (const [name, info] of Object.entries(EXTRA_CONCEPTS))
    addTerm(name, { src: 1, kind: EXTRA_KIND_MAP[info.kind] || info.kind || "keyword",
      name, desc: info.desc || "", type: info.type || "" });
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
/* ---------- 全量卡池（卡库浏览的数据基础） ----------
   收录角色牌 + 全部实体卡（装备/事件/援助/场地/状态/召唤物/附加状态）。
   与检索视图的分工：检索面向"找构筑组件"（可加入牌组的卡 + 概念），
   卡库面向"查全部数据"（含对局中生成的场地/状态/召唤物，不可入构筑）。
   统一派生字段一次算好，之后的筛选、排序、渲染都只读这份索引。 */
const POOL_TYPE_ORDER = ["GCG_CARD_CHARACTER", "GCG_CARD_MODIFY", "GCG_CARD_SUPPORT", "GCG_CARD_EVENT", "GCG_CARD_ASSIST", "GCG_CARD_ONSTAGE", "GCG_CARD_STATE", "GCG_CARD_SUMMON", "GCG_CARD_ATTACHMENT"];
const verTuple = v => { const m = String(v || "").match(/^v(\d+)\.(\d+)/); return m ? [+m[1], +m[2]] : [0, 0]; };
function verCmp(a, b) { const [a1, a2] = verTuple(a), [b1, b2] = verTuple(b); return a1 - b1 || a2 - b2; }
let pool = [];
let poolStats = { total: 0, buildable: 0, testFiltered: 0, byType: {}, byEl: {}, byTag: {}, versions: [] };
const charElement = c => (c.tags.find(t => t.startsWith("GCG_TAG_ELEMENT")) || "").replace("GCG_TAG_ELEMENT_", "");
function buildPool() {
  pool = [];
  for (const c of CHAR) pool.push({
    kind: "char", id: c.id, name: c.name, englishName: c.englishName,
    element: charElement(c), type: "角色牌", typeRaw: "GCG_CARD_CHARACTER",
    tags: c.tags.map(tagZh).filter(Boolean), tagsRaw: c.tags,
    hp: c.hp, energy: c.maxEnergy, ver: c.sinceVersion,
    share: c.shareId, restrictions: [], deckReqs: [], related: null, relatedId: null,
    playCost: [], dice: -1, energyCost: 0, desc: (c.storyText || "").trim(),
    descAll: [c.storyText || "", ...(c.skills || []).map(s => `${s.name || ""}${s.description || ""}`)].join("\n").toLowerCase(),
  });
  let testFiltered = 0;
  for (const e of ENT) {
    if (!POOL_TYPE_ORDER.includes(e.type)) continue;
    /* 明显测试卡不进牌库（判据见 isTestCard；详情深链仍可查） */
    if (isTestCard(e)) { testFiltered++; continue; }
    const rel = e.relatedCharacterId != null ? charById.get(e.relatedCharacterId) : null;
    pool.push({
      kind: "card", id: e.id, name: e.name, englishName: e.englishName,
      element: rel ? charElement(rel) : "", type: TYPE_ZH[e.type] || e.type, typeRaw: e.type,
      tags: e.tags.map(tagZh).filter(Boolean), tagsRaw: e.tags,
      hp: null, energy: null, ver: e.sinceVersion,
      share: e.shareId, restrictions: restrictionsOf(e), deckReqs: deckReqsOf(e),
      related: rel?.name || null, relatedId: e.relatedCharacterId ?? null,
      playCost: e.playCost, dice: diceCost(e.playCost), energyCost: energyCost(e.playCost),
      desc: (e.description || "").trim(), descAll: (e.description || "").toLowerCase(),
    });
  }
  /* 统计：筛选 chips 计数与全局数据信息行都读这里 */
  const byType = {}, byEl = {}, byTag = {};
  for (const x of pool) {
    byType[x.typeRaw] = (byType[x.typeRaw] || 0) + 1;
    if (x.element) byEl[x.element] = (byEl[x.element] || 0) + 1;
    for (const t of x.tags) byTag[t] = (byTag[t] || 0) + 1;
  }
  poolStats = {
    total: pool.length,
    buildable: pool.filter(x => x.share != null).length,
    testFiltered,
    byType, byEl, byTag,
    versions: [...new Set(pool.map(x => x.ver).filter(Boolean))].sort(verCmp),
  };
}
/* ---------- 反链索引：概念名 → 引用它的卡牌/角色 ----------
   卡文与技能文本里出现的其他卡牌、术语，反向收集为"被引用"清单，
   详情页可顺藤摸瓜。扫描复用 termRe（与链接高亮同一套词表，不重复造轮子）。 */
let backlinks = new Map();
function buildBacklinks() {
  backlinks.clear();
  if (!termRe) return;
  const scan = (text, id) => {
    if (!text) return;
    text.replace(termRe, m => {
      let b = backlinks.get(m);
      if (!b) backlinks.set(m, b = new Set());
      b.add(id);
      return m;
    });
  };
  for (const e of ENT) if (POOL_TYPE_ORDER.includes(e.type)) scan(e.description, e.id);
  for (const c of CHAR) {
    scan(c.storyText, c.id);
    for (const s of c.skills || []) scan(s.description || s.rawDescription, c.id);
  }
}
const KIND_ZH = { card: "卡牌", char: "角色", keyword: "术语", rule: "规则", "rule-term": "规则术语", status: "状态效果", summon: "召唤物", enemy: "敌方牌", cardref: "卡牌", charref: "角色" };
function termBodyHtml(info, big, showKind, hideName) {
  const kindLabel = KIND_ZH[info.kind] || info.kind;
  const img = info.image ? `<img src="${info.image}" loading="lazy" decoding="async" alt="" style="width:${big ? 110 : 78}px">` : "";
  const meta = info.kind === "card" ? `${info.type || ""}${info.playCost?.length ? " · " + costText(info.playCost) : ""}`
    : info.kind === "char" ? `角色 · 生命 ${info.hp} · 充能 ${info.energy}`
    : info.kind === "cardref" ? (info.type || kindLabel)
    : kindLabel;
  /* 多匹配并列时种类已由徽标标出，meta 与徽标相同则省略，避免信息重复 */
  const metaLine = showKind && meta === kindLabel ? "" : `<small>${esc(meta)}</small>`;
  /* 概念页的页头已经写了概念名，正文里再写一遍就是纯重复（尤其单条目时）；
     只在该条目名称与页头一致时省略，避免误删不同名的条目 */
  const nameLine = hideName && info.name === hideName ? "" : `<b>${esc(info.name)}</b>`;
  /* 概念页（big）里，带身份的条目给出直达详情的入口——从概念也能顺藤摸到卡牌 */
  const jump = big && info.id != null && (info.kind === "card" || info.kind === "char")
    ? `<button class="blchip term-jump" data-goto="${info.id}" title="打开「${esc(info.name)}」详情">查看详情</button>` : "";
  return `<div class="term-body${showKind ? " term-body-multi" : ""}">${img}<div>
    ${showKind ? `<small class="term-kind">${kindLabel}</small>` : ""}
    ${nameLine}${metaLine}
    <p>${linkifyExcept(esc(info.desc || "（暂无描述）"), info.name)}</p>${jump}</div></div>`;
}
/* 一个概念名可能匹配多个不同种类的条目（如"护盾"：状态牌 + 关键词）——
   悬浮提示与概念页中从上到下并列展示，每个条目带种类标识 */
function termHtml(entries, big = false, hideName = false) {
  const list = Array.isArray(entries) ? entries : [entries];
  return list.map(info => termBodyHtml(info, big, list.length > 1, hideName)).join("");
}

const imgFull = id => `${API}/image/${id}`;
function setStatus(msg, cls = "") { const s = $("status"); s.innerHTML = msg; s.className = cls; }
/* 提示条：最多同时 3 条（超出先撤最早一条），避免连续加入卡牌时堆满屏幕遮住内容 */
const TOAST_MAX = 3;
function toast(msg, err = false) {
  const box = $("toasts");
  const t = document.createElement("div");
  t.className = "toast" + (err ? " err" : "");
  t.textContent = msg;
  if (box && box.appendChild) box.appendChild(t);
  /* HTMLCollection 是活集合：撤掉最早一条后长度即刻更新 */
  const kids = box && box.children;
  if (kids && typeof kids.length === "number") {
    for (let guard = 0; kids.length > TOAST_MAX && guard < 50; guard++) {
      const first = kids[0];
      if (!first || first === t || typeof first.remove !== "function") break;
      first.remove();
    }
  }
  setTimeout(() => t.remove(), 2600);
}

/* ---------- 历史 ---------- */
function loadHistory() { try { return JSON.parse(localStorage.getItem("gi-viewer-history") || "[]"); } catch { return []; } }
function pushHistory(entry) {
  let h = loadHistory().filter(x => x.code !== entry.code);
  h.unshift(entry);
  try { localStorage.setItem("gi-viewer-history", JSON.stringify(h.slice(0, 12))); } catch {}
}
function renderHistory() {
  const h = loadHistory();
  const p = $("histPanel");
  if (!h.length) { p.innerHTML = `<div class="hist-item" style="cursor:default;color:var(--dim)">暂无历史记录</div>`; return; }
  p.innerHTML = h.map(x => `<div class="hist-item" data-code="${esc(x.code)}">
    ${x.chars.map(c => `<span class="dot" style="background:${ELE_COLOR[c.el] || '#888'}"></span>`).join("")}
    <span>${esc(x.chars.map(c => c.name).join(" / "))}</span>
    <span class="code">${esc(x.code)}</span></div>`).join("");
}

/* ---------- 解析主流程（分享码 → 牌组） ---------- */
async function decodeAndRender(code, opts = {}) {
  code = code.trim();
  if (!code) return;
  $("btnDecode").disabled = true;
  setStatus(`<span class="spin"></span>解析中…`);
  try {
    await ensureData();
    const shareIds = decodeRaw(code);
    const ids = shareIds.map(s => {
      const id = shareMap[s];
      if (!id) throw new Error(`未知的分享 id ${s}，分享码可能有误或数据版本不匹配`);
      return id;
    });
    const charIds = ids.slice(0, 3), cardIds = ids.slice(3);

    const countMap = new Map();
    for (const id of cardIds) countMap.set(id, (countMap.get(id) || 0) + 1);
    const groups = {};
    for (const [id, count] of countMap) {
      const e = entById.get(id);
      if (!e) throw new Error(`未知卡牌 id ${id}`);
      const type = TYPE_ZH[e.type] || e.type;
      (groups[type] ??= []).push({
        id, count, name: e.name, type, typeRaw: e.type,
        tags: e.tags.map(tagZh).filter(Boolean), tagsRaw: e.tags,
        playCost: e.playCost, dice: diceCost(e.playCost), energy: energyCost(e.playCost),
        related: e.relatedCharacterId ? charById.get(e.relatedCharacterId)?.name : null,
        relatedId: e.relatedCharacterId ?? null,
        restrictions: restrictionsOf(e), deckReqs: deckReqsOf(e),
        desc: (e.description || "").trim(), since: e.sinceVersion,
      });
    }
    const known = ["装备牌", "支援牌", "事件牌", "援助牌"];
    const order = known.filter(t => groups[t]).concat(Object.keys(groups).filter(t => !known.includes(t)));

    current = {
      code, charIds, cardIds,
      chars: charIds.map(id => {
        const c = charById.get(id);
        if (!c) throw new Error(`未知角色 id ${id}`);
        return { id, name: c.name, hp: c.hp, energy: c.maxEnergy, since: c.sinceVersion,
          element: (c.tags.find(t => t.startsWith("GCG_TAG_ELEMENT")) || "").replace("GCG_TAG_ELEMENT_", "") };
      }),
      groups, order,
    };
    deckOrder = [...current.chars.map(c => c.id),
      ...order.flatMap(t => current.groups[t].map(x => x.id))];

    renderSummary(); renderGrid(); renderList();
    $("summary").style.display = "block";
    ["btnCopyCode", "btnExport"].forEach(b => $(b).disabled = false);
    setStatus(`解析成功：3 名角色 + ${cardIds.length} 张行动牌（去重 ${countMap.size} 种）`, "ok");
    if (!opts.noHash) history.replaceState(null, "", "#" + code);
    if (!opts.noHistory) pushHistory({ code, chars: current.chars.map(c => ({ name: c.name, el: c.element })) });
  } catch (e) {
    setStatus(`解析失败：${e.message}`, "err");
  } finally {
    $("btnDecode").disabled = false;
  }
}

/* ---------- 输入路由：分享码 / 搜索词 自动识别 ----------
   顶部输入框是唯一入口：形如分享码（长 base64）→ 解析牌组；其余 → 卡牌检索 */
const CODE_RE = /^[A-Za-z0-9+/]{50,}={0,2}$/;
function looksLikeCode(text) {
  return CODE_RE.test((text || "").replace(/\s+/g, ""));
}
async function resolveInput(text) {
  const t = (text || "").trim();
  if (!t) return;
  closeSuggest();
  if (looksLikeCode(t)) { await decodeAndRender(t); return; }
  await ensureData();
  runSearch(t);
}

/* ---------- 卡牌检索（本地全量数据，无额外网络请求） ----------
   打分策略（分数越小越相关）：
     0   名称完全一致
     10  名称前缀          16  词首（按空格/标点切段）
     24  名称包含（按命中位置 +0~8）
     30  全拼完全          36  首字母完全
     38  全拼前缀          40  英文名完全
     44  首字母前缀（查询≥3 字母）
     46  英文名前缀        48  英文名词首（查询≥3 字母）
     52  全拼包含（查询≥3 字母，按位置 +0~4）
     56  英文名包含（查询≥4 字母，按位置 +0~4）
     64  英文名整串编辑距离 1（查询≥4 字母）
     66  全拼整串编辑距离 1
     68  中文近似写法（错一个字，如「芙宁那」→「芙宁娜」）
     70  模糊子序列（查询≥3 字符，间隔越大分越差）
     100 描述/释义命中（排在最后，且限量，避免长文淹没名称命中）
   短查询（2 字母）不做英文前缀/包含与子序列模糊——命中面过大只会制造噪音。
   同一分数内：角色 > 卡牌 > 概念；可构筑版本 > 历史变体；短名优先。
   范围开关（标题/拼音/描述）只决定哪些字段参与命中，不改变上述层级分数；
   检索语料始终是"当前牌库"（受牌库筛选约束），概念仅在筛选时按引用关系收敛。 */
const searchState = { q: "", results: [], filter: "", corpusKey: "" };
/* 搜索范围：只决定关键词去哪些字段里找，与牌库筛选（缩小卡池）是两套独立状态 */
const SCOPE_KEY = "gi-viewer-search-scope";
function loadSearchScope() {
  try {
    const v = JSON.parse(localStorage.getItem(SCOPE_KEY) || "null");
    if (v && typeof v === "object") return { title: v.title !== false, pinyin: v.pinyin !== false, desc: v.desc !== false };
  } catch (e) {}
  return { title: true, pinyin: true, desc: true };
}
const searchScope = loadSearchScope();
function saveSearchScope() { try { localStorage.setItem(SCOPE_KEY, JSON.stringify(searchScope)); } catch (e) {} }
const browseActive = () => BROWSE_DIMS.some(d => browseState[d] !== "");
const corpusKey = () => BROWSE_DIMS.map(d => browseState[d]).join("|");
/* 检索基于当前牌库：牌库筛选生效时只在该结果集内检索，避免"搜到了却被筛掉" */
function searchCorpus() { return browseActive() ? pool.filter(x => passFilter(x, browseState)) : pool; }
/* 概念不在牌库里：筛选生效时，只保留被当前牌库条目引用过的概念 */
function conceptInCorpus(name, corpusIds) {
  if (!corpusIds) return true;
  const refs = backlinks.get(name);
  if (!refs) return false;
  for (const id of refs) if (corpusIds.has(id)) return true;
  return false;
}
const CARD_LIKE_KINDS = new Set(["card", "char", "cardref", "charref"]);
const HAN_RE = /\p{Script=Han}/u;
const normCompact = s => String(s || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/* 拼音索引由 build-pinyin.mjs 构建期生成；缺失时自动退化为仅字面检索 */
const PY_DATA = (typeof PINYIN_DATA !== "undefined" && PINYIN_DATA) || null;
const pyCache = new Map();
function pinyinOf(name) {
  if (!PY_DATA) return null;
  if (pyCache.has(name)) return pyCache.get(name);
  let v = null;
  const hit = PY_DATA.names && PY_DATA.names[name];
  if (hit) {
    const [full, initials] = hit.split("|");
    v = { full, initials };
  } else {
    /* 未收录的新名字：逐字兜底（仅纯汉字名；含拉丁字符时无法可靠切分，直接放弃） */
    const chars = [...String(name || "")];
    if (chars.length && chars.every(ch => HAN_RE.test(ch))) {
      const syl = chars.map(ch => (PY_DATA.chars || {})[ch]).filter(Boolean);
      if (syl.length === chars.length) v = { full: syl.join(""), initials: syl.map(s => s[0]).join("") };
    }
  }
  pyCache.set(name, v);
  return v;
}

function queryCtx(q) {
  const raw = String(q || "").trim();
  const compact = normCompact(raw);
  return { raw, compact, len: compact.length, latin: /^[a-z]+$/.test(compact), han: HAN_RE.test(compact) };
}

const segmentsOf = s => String(s || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

function literalScore(ctx, name) {
  const t = normCompact(name);
  if (!t || !ctx.compact) return null;
  if (t === ctx.compact) return { score: 0, match: "exact" };
  if (t.startsWith(ctx.compact)) return { score: 10, match: "prefix" };
  const segs = segmentsOf(name);
  if (segs.length > 1 && segs.some(s => normCompact(s).startsWith(ctx.compact))) return { score: 16, match: "segment" };
  const i = t.indexOf(ctx.compact);
  if (i >= 0) return { score: 24 + Math.min(i, 8), match: "contains" };
  return null;
}

function englishScore(ctx, en) {
  if (!ctx.latin) return null;
  const t = normCompact(en);
  if (!t) return null;
  if (t === ctx.compact) return { score: 40, match: "en" };
  /* 2 字母的英文前缀/包含命中面过大（gy、fn 会命中几十张卡），只保留精确匹配 */
  if (ctx.len < 3) return null;
  if (t.startsWith(ctx.compact)) return { score: 46, match: "en" };
  const segs = segmentsOf(en);
  if (segs.length > 1 && segs.some(s => normCompact(s).startsWith(ctx.compact))) return { score: 48, match: "en" };
  if (ctx.len >= 4) {
    const i = t.indexOf(ctx.compact);
    if (i >= 0) return { score: 56 + Math.min(i, 4), match: "en" };
  }
  return null;
}

function pinyinScore(ctx, name) {
  if (!ctx.latin || ctx.len < 2) return null;
  const py = pinyinOf(name);
  if (!py) return null;
  const q = ctx.compact;
  if (py.full === q) return { score: 30, match: "pinyin", note: py.full };
  if (py.initials === q) return { score: 36, match: "initials", note: py.initials };
  if (py.full.startsWith(q)) return { score: 38, match: "pinyin", note: py.full };
  if (ctx.len >= 3) {
    if (py.initials.startsWith(q)) return { score: 44, match: "initials", note: py.initials };
    const i = py.full.indexOf(q);
    if (i >= 0) return { score: 52 + Math.min(i, 4), match: "pinyin", note: py.full };
  }
  return null;
}

/* 子序列匹配：返回最紧凑的窗口（gap = 窗口长度 - 查询长度） */
function subseqWindow(q, t) {
  if (q.length < 2 || t.length < q.length) return null;
  let best = null;
  for (let s = 0; s < t.length; s++) {
    if (t[s] !== q[0]) continue;
    let qi = 1, last = s;
    for (let i = s + 1; i < t.length && qi < q.length; i++) {
      if (t[i] === q[qi]) { qi++; last = i; }
    }
    if (qi === q.length) {
      const gap = last - s + 1 - q.length;
      if (!best || gap < best.gap) best = { gap, start: s };
    }
  }
  return best;
}

/* 编辑距离 ≤1（只用于整串，拉丁查询≥4 字母） */
function withinOneEdit(a, b) {
  if (!a || !b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function fuzzyScore(ctx, forms) {
  const q = ctx.compact;
  const maxGap = Math.max(1, Math.floor(q.length / 2));
  for (const f of forms) {
    const m = subseqWindow(q, f);
    if (m && m.gap <= maxGap) return { score: 70 + Math.min(m.gap * 2, 10), match: "fuzzy", note: f };
  }
  return null;
}

function scoreName(ctx, name, englishName, sc = searchScope) {
  let best = null;
  const take = r => { if (r && (!best || r.score < best.score)) best = r; };
  if (sc.title) {
    take(literalScore(ctx, name));
    if (ctx.latin) {
      take(englishScore(ctx, englishName));
      if (ctx.len >= 4 && withinOneEdit(ctx.compact, normCompact(englishName))) take({ score: 64, match: "fuzzy", note: "英文名近似" });
    }
  }
  if (sc.pinyin && ctx.latin) {
    take(pinyinScore(ctx, name));
    if (ctx.len >= 4) {
      const py = pinyinOf(name);
      if (py && withinOneEdit(ctx.compact, py.full)) take({ score: 66, match: "fuzzy", note: py.full });
    }
  }
  if (!best && ctx.len >= 2) {
    /* 中文近似写法（错一个字）：如「芙宁那」→「芙宁娜」，属于标题容错 */
    if (sc.title && ctx.han && !ctx.latin && withinOneEdit(ctx.compact, normCompact(name))) take({ score: 68, match: "fuzzy", note: "近似写法" });
    /* 子序列模糊：2 字母命中面太大，从 3 个字符起才启用 */
    if (!best && ctx.len >= 3) {
      const forms = [];
      if (sc.title) {
        forms.push(normCompact(name), normCompact(englishName));
      }
      if (sc.pinyin && ctx.latin) {
        const py = pinyinOf(name);
        if (py) forms.push(py.full);
      }
      if (forms.length) take(fuzzyScore(ctx, forms.filter(Boolean)));
    }
  }
  return best;
}

function compareResults(a, b) {
  const W = { char: 0, card: 1, concept: 2 };
  const bb = x => (x.kind === "concept" || x.buildable ? 0 : 1);
  return a.score - b.score
    || W[a.kind] - W[b.kind]
    || bb(a) - bb(b)
    || a.name.length - b.name.length
    || a.name.localeCompare(b.name, "zh");
}

function searchCards(q, opts = {}) {
  const ctx = queryCtx(q);
  if (!ctx.compact) return [];
  const sc = opts.scope || searchScope;
  const corpus = opts.corpus || searchCorpus();
  const corpusIds = browseActive() ? new Set(corpus.map(x => x.id)) : null;
  const out = [];
  const descOut = [];
  const nameKeys = new Set();
  const push = (kind, id, name, extra, src) => {
    const s = scoreName(ctx, name, src && src.englishName, sc);
    if (!s) return;
    nameKeys.add(kind + ":" + name);
    out.push({ kind, id, name, score: s.score, match: s.match, note: s.note, ...extra });
  };

  /* 角色/卡牌只来自当前牌库：牌库筛选生效时，检索范围随之缩小 */
  for (const x of corpus) {
    push(x.kind, x.id, x.name,
      x.kind === "char" ? { buildable: x.share != null } : { ver: x.ver, noShare: x.share == null, buildable: x.share != null },
      x);
  }
  /* 术语/规则/状态等概念不在牌库里：筛选生效时只保留被当前牌库条目引用过的 */
  for (const [name, entries] of termIndex) {
    const ck = entries.find(e => !CARD_LIKE_KINDS.has(e.kind));
    if (!ck || !conceptInCorpus(name, corpusIds)) continue;
    push("concept", null, name, { ckind: ck.kind }, { englishName: "", description: entries.map(e => e.desc || "").join("\n") });
  }

  /* 描述命中：仅在开启"描述"范围时扫描；小写文本在 buildPool 时已缓存 */
  const rawLower = ctx.raw.toLowerCase();
  if (rawLower && sc.desc && !opts.noDesc) {
    const descKeys = new Set();
    const pushDesc = r => {
      const k = r.kind + ":" + r.name;
      if (nameKeys.has(k) || descKeys.has(k)) return;
      descKeys.add(k);
      descOut.push(r);
    };
    for (const x of corpus) {
      if (nameKeys.has(x.kind + ":" + x.name)) continue;
      if (x.descAll && x.descAll.includes(rawLower))
        pushDesc({ kind: x.kind, id: x.id, name: x.name, score: 100, match: "desc", ver: x.ver, noShare: x.kind === "card" && x.share == null, buildable: x.share != null });
    }
    for (const [name, entries] of termIndex) {
      if (nameKeys.has("concept:" + name) || !conceptInCorpus(name, corpusIds)) continue;
      if (entries.some(e => (e.desc || "").toLowerCase().includes(rawLower)))
        pushDesc({ kind: "concept", id: null, name, score: 100, match: "desc", ckind: entries.find(e => !CARD_LIKE_KINDS.has(e.kind))?.kind });
    }
  }

  /* 同名多版本（如角色基础版 + 对局变体）只保留一条，优先可构筑版本 */
  const uniq = new Map();
  for (const r of out) {
    const k = r.kind + ":" + r.name;
    const prev = uniq.get(k);
    if (!prev) { uniq.set(k, r); continue; }
    const delta = Number(!!r.buildable) - Number(!!prev.buildable);
    if (delta > 0 || (delta === 0 && r.score < prev.score)) uniq.set(k, r);
  }
  const ranked = [...uniq.values()].sort(compareResults);
  const limit = opts.limit || 90;
  const keep = ranked.slice(0, limit);
  descOut.sort(compareResults);
  const descCap = Math.max(0, Math.min(30, limit - keep.length));
  return keep.concat(descOut.slice(0, descCap));
}

/* 空态近似词：放宽间隔限制，只用于"没找到"时给下一步线索 */
function nearNames(q, limit = 6) {
  const ctx = queryCtx(q);
  if (!ctx.compact) return [];
  const cand = [];
  const corpus = searchCorpus();
  const corpusIds = browseActive() ? new Set(corpus.map(x => x.id)) : null;
  for (const x of corpus) cand.push({ name: x.name, kind: x.kind, id: x.id });
  for (const [name, entries] of termIndex) {
    if (!conceptInCorpus(name, corpusIds)) continue;
    if (entries.some(e => !CARD_LIKE_KINDS.has(e.kind))) cand.push({ name, kind: "concept" });
  }
  const out = [];
  const maxGap = Math.max(2, ctx.len);
  for (const x of cand) {
    const m = subseqWindow(ctx.compact, normCompact(x.name));
    if (m && m.gap <= maxGap) { out.push({ ...x, gap: m.gap }); continue; }
    const py = ctx.latin ? pinyinOf(x.name) : null;
    if (py && (py.full.startsWith(ctx.compact) || py.initials.startsWith(ctx.compact))) out.push({ ...x, gap: 9 });
  }
  out.sort((a, b) => a.gap - b.gap || a.name.length - b.name.length);
  const seen = new Set();
  return out.filter(x => { const k = x.kind + ":" + x.name; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, limit);
}
/* 检索结果分类 chips 的固定顺序（含全部实体卡类型，概念收尾） */
const CAT_ORDER = ["角色", "装备牌", "支援牌", "事件牌", "援助牌", "场地牌", "状态牌", "召唤物", "附加状态", "概念"];
function resultTypeLabel(r) {
  if (r.kind === "char") return "角色";
  if (r.kind === "card") return TYPE_ZH[entById.get(r.id).type];
  return "概念";   /* 概念类统一一档分类；具体种类由卡块自身标出 */
}
async function runSearch(q, opts = {}) {
  const t = String(q || "").trim();
  searchState.q = t;
  searchState.filter = "";
  const box = $("view-search");
  if (!dataReady) {
    renderSearchLoading();
    try { await ensureData(); }
    catch (e) { setStatus("数据加载失败：" + e.message, "err"); return; }
  }
  searchState.results = searchCards(t);
  searchState.corpusKey = corpusKey();
  if (t && opts.record !== false) pushRecent(t);
  if (opts.keepView) renderSearch(); else switchView("search");
  const n = searchState.results.length;
  if (!opts.silent) setStatus(n ? `检索“${esc(searchState.q)}”：${n} 条结果` : `未找到与“${esc(searchState.q)}”匹配的卡牌或概念`, n ? "ok" : "err");
  if (!opts.noHash) history.replaceState(null, "", "#q=" + encodeURIComponent(searchState.q));
  if (opts.scroll && box && box.scrollIntoView) { try { box.scrollIntoView({ block: "start", behavior: "smooth" }); } catch (e) {} }
}

/* ---------- 最近搜索（本地记录，可点击重放） ---------- */
const RECENT_KEY = "gi-viewer-recent";
function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").filter(x => typeof x === "string").slice(0, 8); } catch { return []; }
}
function pushRecent(q) {
  const r = loadRecent().filter(x => x !== q);
  r.unshift(q);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, 8))); } catch (e) {}
}
/* 范围行：字段开关 + 当前牌库规模 + 筛选状态。
   开关只影响"关键词匹配哪些字段"，不会增删卡池；卡池由牌库筛选决定。 */
function scopeRow() {
  const n = searchCorpus().length;
  const sc = searchScope;
  const chip = (k, label, title) =>
    `<button class="fchip${sc[k] ? " on" : ""}" data-scope="${k}" aria-pressed="${sc[k]}" title="${title}">${label}</button>`;
  return `<div class="srow">
    <span class="slabel">搜索范围</span>
    ${chip("title", "标题", "中文名 / 英文名")}
    ${chip("pinyin", "拼音", "全拼 / 首字母（由标题生成）")}
    ${chip("desc", "描述", "卡牌效果、角色技能与故事、概念释义；关闭可提速")}
    <span class="smeta">牌库 <b>${n}</b> 项${browseActive() ? "（已筛选）" : ""}</span>
    ${sc.desc ? `<span class="smeta sslow" title="描述检索需扫描全文，比只搜标题慢">描述较慢</span>` : ""}
    ${browseActive() ? `<button class="slink" data-scope-clear title="清除牌库筛选，恢复全库检索">清除牌库筛选</button>` : ""}
  </div>`;
}
function inputHint() {
  const parts = [];
  if (searchScope.title) parts.push("中文名", "英文名");
  if (searchScope.pinyin) parts.push("拼音全拼 / 首字母");
  parts.push("模糊输入");
  return `支持${parts.join("、")}　|　描述检索${searchScope.desc ? "已开启（较慢）" : "已关闭（更快）"}`;
}
function toggleSearchScope(k) {
  const next = { ...searchScope, [k]: !searchScope[k] };
  if (!next.title && !next.pinyin && !next.desc) { toast("至少保留一个搜索范围"); return; }
  Object.assign(searchScope, next);
  saveSearchScope();
  if (searchState.q) {
    searchState.results = searchCards(searchState.q);
    searchState.corpusKey = corpusKey();
  }
  renderSearch();
}
function clearBrowseFilters() {
  Object.assign(browseState, { type: "", el: "", cost: "", energy: "", tag: "", ver: "" });
  if (searchState.q) {
    searchState.results = searchCards(searchState.q);
    searchState.corpusKey = corpusKey();
  }
  renderSearch();
}

/* ---------- 输入建议（combobox）：输入即出候选，↑↓ 选择，Enter 检索全部 ---------- */
const HOT_WORDS = ["感电", "护盾", "天赋", "芙宁娜", "幻戏", "秘传", "万能元素", "下落攻击"];
const MATCH_ZH = { pinyin: "拼音", initials: "首字母", fuzzy: "模糊", en: "英文", desc: "释义", segment: "词首" };
const sugState = { open: false, items: [], idx: -1 };
let sugTimer = 0, liveTimer = 0;

function matchChip(r) {
  const label = MATCH_ZH[r.match];
  if (!label) return "";
  const note = r.note ? ` title="命中：${esc(r.note)}"` : "";
  return `<span class="mchip${r.match === "desc" ? " dim" : ""}"${note}>${label}</span>`;
}

function sugKindLabel(r) {
  if (r.kind === "char") return "角色";
  if (r.kind === "card") return TYPE_ZH[entById.get(r.id).type] || "卡牌";
  return KIND_ZH[r.ckind] || "概念";
}

function hlText(text, q) {
  if (!q) return esc(text);
  return esc(text).replace(new RegExp(escapeRe(esc(q)), "gi"), m => `<b class="hl">${m}</b>`);
}

function renderSuggestItems(q, items) {
  const box = $("suggest");
  if (!box) return;
  sugState.items = items;
  sugState.idx = -1;
  if (!items.length) {
    closeSuggest();
    return;
  }
  box.innerHTML = items.map((r, i) => `
    <div class="sug-item" role="option" id="sug-opt-${i}" data-i="${i}" aria-selected="false">
      <span class="sug-name">${hlText(r.name, q)}</span>
      <span class="sug-kind">${esc(sugKindLabel(r))}</span>
      ${matchChip(r)}
    </div>`).join("") + `<div class="sug-foot" role="presentation">↑↓ 选择 · Enter 检索全部 · Esc 关闭</div>`;
  openSuggest();
}

function openSuggest() {
  const box = $("suggest");
  if (!box) return;
  box.classList.add("show");
  sugState.open = true;
  $("codeInput").setAttribute("aria-expanded", "true");
}

function closeSuggest() {
  const box = $("suggest");
  if (!box) return;
  box.classList.remove("show");
  sugState.open = false;
  sugState.idx = -1;
  sugState.items = [];
  $("codeInput").setAttribute("aria-expanded", "false");
  $("codeInput").removeAttribute("aria-activedescendant");
}

function moveSuggest(d) {
  if (!sugState.open || !sugState.items.length) return;
  sugState.idx = (sugState.idx + d + sugState.items.length) % sugState.items.length;
  const box = $("suggest");
  if (box) {
    box.querySelectorAll(".sug-item").forEach((el, i) => el.setAttribute("aria-selected", i === sugState.idx ? "true" : "false"));
    const active = box.querySelector(`#sug-opt-${sugState.idx}`);
    if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest" });
  }
  $("codeInput").setAttribute("aria-activedescendant", "sug-opt-" + sugState.idx);
}

function selectSuggest(i) {
  const r = sugState.items[i];
  if (!r) return;
  const name = r.name;
  closeSuggest();
  $("codeInput").value = name;
  updateBtnLabel();
  if (r.kind === "concept") showTermModal(name);
  else showDetail(r.id);
}

async function refreshSuggest() {
  const input = $("codeInput");
  const v = input.value.trim();
  if (!v || looksLikeCode(v)) { closeSuggest(); return; }
  if (!dataReady) {
    const box = $("suggest");
    if (box) {
      sugState.items = [];
      sugState.idx = -1;
      box.innerHTML = `<div class="sug-empty"><span class="spin"></span>正在载入数据…</div>`;
      openSuggest();
    }
    try { await ensureData(); } catch (e) { closeSuggest(); return; }
  }
  if (input.value.trim() !== v) return;   /* 异步期间用户已改动输入 → 丢弃这次结果 */
  renderSuggestItems(v, searchCards(v, { limit: 8, noDesc: true }));
}

/* ---------- 牌组：多牌组存储 + 草稿门面 ----------
   decks: [{id, name, chars:[], cards:[[id,count]], updatedAt}]，持久化于 localStorage。
   draft 是"当前活动牌组"的内存门面——draftAdd / draftEncode 等旧接口全部保留，
   底层改为读写活动牌组，任何变更即同步落盘。旧版单草稿（gi-viewer-draft）首次启动自动迁移。 */
const DRAFT_KEY = "gi-viewer-draft";   /* 仅用于迁移，不再写入 */
const DECKS_KEY = "gi-viewer-decks";
const draft = { chars: [], cards: new Map() };  /* chars: id[]；cards: id→count */
let decks = [];
let activeDeckId = null;
let deckRenameId = null;
function loadDecks() {
  decks = [];
  try {
    const d = JSON.parse(localStorage.getItem(DECKS_KEY) || "null");
    if (Array.isArray(d)) decks = d.filter(x => x && typeof x === "object" && Number.isFinite(x.id));
  } catch (e) { decks = []; }
}
function saveDecks() { try { localStorage.setItem(DECKS_KEY, JSON.stringify(decks)); } catch (e) {} }
function activeDeck() { return decks.find(d => d.id === activeDeckId) || null; }
let deckSeq = 0;
function newDeck(name) {
  /* id 带序号后缀：同一毫秒连建多个牌组也不会碰撞 */
  const d = { id: Date.now() * 1000 + (deckSeq++ % 1000), name: name || `牌组 ${decks.length + 1}`, chars: [], cards: [], updatedAt: Date.now() };
  decks.unshift(d); activeDeckId = d.id; return d;
}
/* 活动牌组 → draft 门面 */
function syncFromActive() {
  const a = activeDeck();
  draft.chars = a ? [...a.chars] : [];
  draft.cards = new Map(a ? a.cards.map(([id, c]) => [Number(id), c]) : []);
}
/* draft 门面 → 活动牌组并持久化（替代旧 saveDraft 语义） */
function saveDraft() {
  const a = activeDeck();
  if (a) {
    a.chars = [...draft.chars];
    a.cards = [...draft.cards].map(([id, c]) => [id, c]);
    a.updatedAt = Date.now();
  }
  saveDecks();
}
/* 恢复：读 decks；没有则迁移旧版单草稿；仍没有则建一个空牌组 */
function loadDraft() {
  loadDecks();
  if (!decks.length) {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (d && Array.isArray(d.chars) && d.cards && typeof d.cards === "object") {
        const m = newDeck("我的牌组");
        m.chars = d.chars.filter(id => Number.isFinite(id));
        m.cards = Object.entries(d.cards).map(([k, v]) => [Number(k), v]).filter(([, v]) => Number.isFinite(v) && v > 0);
      }
    } catch (e) {}
  }
  if (!decks.length) newDeck();
  else if (!activeDeck()) activeDeckId = decks[0].id;
  syncFromActive();
}
/* 数据就绪后清理失效 id（数据版本更新导致旧卡不存在） */
function pruneDraft() {
  draft.chars = draft.chars.filter(id => charById.has(id));
  draft.cards = new Map([...draft.cards].filter(([id, v]) => entById.has(id) && v > 0));
  saveDraft();
}
function draftTotal() { let n = 0; for (const v of draft.cards.values()) n += v; return n; }
function draftAdd(id) {
  if (charById.has(id)) {
    if (idToShare[id] == null) { toast("该角色版本不可加入构筑", true); return; }
    if (draft.chars.includes(id)) { toast("该角色已在牌组中"); return; }
    if (draft.chars.length >= 3) { toast("角色槽已满（3 名）", true); return; }
    draft.chars.push(id);
  } else if (entById.has(id)) {
    if (idToShare[id] == null) { toast("该版本不可加入构筑", true); return; }
    const e = entById.get(id);
    /* 牌组构筑门槛：不满足「才能加入牌组」的条件时拒绝加入（与官方选卡一致），
       并说明缺什么——先提示而不是让用户生成分享码时才发现 */
    const bad = deckReqsOf(e).find(r => !deckReqMet(r, draft.chars));
    if (bad) { toast(`「${e.name}」无法加入：${reqGapText(bad, draft.chars)}`, true); return; }
    const cur = draft.cards.get(id) || 0;
    const max = (e.tags || []).includes("GCG_TAG_LEGEND") ? 1 : 2;  /* 秘传限 1，其余同名上限 2 */
    if (cur >= max) { toast(max === 1 ? "秘传牌整套限 1 张" : "同名卡最多 2 张", true); return; }
    if (draftTotal() >= 30) { toast("行动牌已满（30 张）", true); return; }
    draft.cards.set(id, cur + 1);
  } else { toast("该卡牌不可加入牌组", true); return; }
  saveDraft(); renderDraft(); toast("已加入当前牌组");
}
function draftRemoveChar(id) { draft.chars = draft.chars.filter(x => x !== id); saveDraft(); renderDraft(); }
function draftRemoveCard(id) { draft.cards.delete(id); saveDraft(); renderDraft(); }
function draftSetCount(id, d) {
  const cur = draft.cards.get(id) || 0, next = cur + d;
  const e = entById.get(id);
  const max = (e.tags || []).includes("GCG_TAG_LEGEND") ? 1 : 2;
  if (next <= 0) draftRemoveCard(id);
  else if (next > max) return;
  else if (d > 0 && draftTotal() >= 30) { toast("行动牌已满（30 张）", true); return; }
  else {
    /* 加量同样过构筑门槛：中途换掉角色后，旧卡不应继续加量 */
    const bad = e ? deckReqsOf(e).find(r => !deckReqMet(r, draft.chars)) : null;
    if (bad) { toast(`「${e.name}」无法加入：${reqGapText(bad, draft.chars)}`, true); return; }
    draft.cards.set(id, next), saveDraft(), renderDraft();
  }
}
function draftClear() { draft.chars = []; draft.cards.clear(); saveDraft(); renderDraft(); toast("当前牌组已清空"); }
function draftLoadCurrent() {
  if (!current) { toast("请先解析一个牌组", true); return; }
  draft.chars = [...current.charIds];
  draft.cards = new Map(current.order.flatMap(t => current.groups[t].map(x => [x.id, x.count])));
  saveDraft(); renderDraft(); renderDraftPanel(); toast("已载入当前牌组");
}
/* 构筑规则校验：生成分享码的硬性检查，也是管理面板里的实时提示 */
function deckProblems() {
  const errs = [];
  if (draft.chars.length !== 3) errs.push(`需要 3 名角色（当前 ${draft.chars.length}）`);
  if (draftTotal() !== 30) errs.push(`需要 30 张行动牌（当前 ${draftTotal()}）`);
  const isLegend = id => (entById.get(id)?.tags || []).includes("GCG_TAG_LEGEND");
  const legendCount = [...draft.cards].filter(([id]) => isLegend(id)).reduce((a, [, c]) => a + c, 0);
  if (legendCount > 1) errs.push(`秘传牌整套限 1 张（当前 ${legendCount}）`);
  const over = [...draft.cards].filter(([id, c]) => c > (isLegend(id) ? 1 : 2));
  if (over.length) errs.push(`${over.length} 种卡牌超过同名上限（${over.map(([id]) => entById.get(id)?.name || id).join("、")}）`);
  /* 牌组限制（才能加入牌组的门槛）：当前 3 名角色是否满足每张卡的构筑依赖。
     同一缺口归并成一条，避免整齐的共鸣套刷出十几行重复提示。 */
  const byReq = new Map();
  for (const [id] of draft.cards) {
    const e = entById.get(id);
    if (!e) continue;
    for (const r of deckReqsOf(e)) {
      if (deckReqMet(r, draft.chars)) continue;
      const k = r.code + "|" + (r.tag || r.name || "");
      if (!byReq.has(k)) byReq.set(k, { req: r, cards: [] });
      byReq.get(k).cards.push(e.name);
    }
  }
  for (const { req, cards } of byReq.values())
    errs.push(`${reqGapText(req, draft.chars)}——${cards.join("、")}`);
  return errs;
}
/* 生成分享码：格式硬校验（3 角色 + 30 张 + 秘传限 1 + 同名上限）→ 编码 → 解码自校验 */
function draftEncode() {
  const errs = deckProblems();
  if (errs.length) throw new Error(errs[0]);
  const ids = [...draft.chars, ...[...draft.cards].flatMap(([id, c]) => Array(c).fill(id))];
  const shareIds = ids.map(id => {
    const s = idToShare[id];
    if (s == null) throw new Error(`「${(charById.get(id) || entById.get(id)).name}」无分享 id，不可生成分享码`);
    return s;
  });
  const code = encodeRaw(shareIds);
  if (JSON.stringify(decodeRaw(code)) !== JSON.stringify(shareIds)) throw new Error("编码自校验失败");
  return code;
}

/* ---------- 概览条（含费用曲线 / 充能 / 限制统计） ---------- */
function renderSummary() {
  const typeCounts = current.order.map(t => `${t} <b>${current.groups[t].reduce((a, x) => a + x.count, 0)}</b>`).join("　·　");
  const eles = [...new Set(current.chars.map(c => ELE_ZH[c.element] || c.element))].join(" / ");
  const vers = [...new Set([...current.chars.map(c => c.since), ...current.order.flatMap(t => current.groups[t].map(x => x.since))])].filter(Boolean).sort();

  /* 费用曲线（按张数计重）：元素骰 0~4 / 5+ */
  const buckets = Array(6).fill(0);
  let enCards = 0, enMax = 0, enTotal = 0, rCards = 0, dCards = 0;
  const rCount = {}, dCount = {};
  for (const t of current.order) for (const x of current.groups[t]) {
    buckets[Math.min(x.dice, 5)] += x.count;
    if (x.energy) { enCards += x.count; enMax = Math.max(enMax, x.energy); enTotal += x.energy * x.count; }
    for (const r of x.restrictions) { rCount[r.code] = (rCount[r.code] || 0) + x.count; rCards += x.count; }
    for (const r of x.deckReqs || []) { dCount[r.code] = (dCount[r.code] || 0) + x.count; dCards += x.count; }
  }
  const maxB = Math.max(...buckets, 1);
  const curve = `<div class="curve">${buckets.map((n, i) => `
    <div class="cbar" title="元素骰费用 ${i === 5 ? "5+" : i}：${n} 张">
      <span class="cnum">${n || ""}</span>
      <div class="cfill" style="height:${Math.round(n / maxB * 100)}%"></div>
      <span class="clabel">${i === 5 ? "5+" : i}</span>
    </div>`).join("")}<span class="ctitle">元素骰费用曲线</span></div>`;

  const energyChip = enCards
    ? `<span class="en-inline">${ENERGY_ICON}<span>充能费用：<b>${enCards}</b> 张 / 累计 <b>${enTotal}</b> 点（单卡最高 ${enMax}）</span></span>` : "";
  /* 依赖统计分两组：牌组限制（构筑门槛）/ 打出限制（对局中生效）。点击 chips 过滤列表 */
  const reqChips = (label, counts, total) => total
    ? `<span>${label}：<b>${total}</b> 张（${Object.entries(counts).map(([k, v]) => `<a class="rl" data-filter="${R_ZH[k]}" title="在列表视图中筛出这些卡">${R_ZH[k]} ${v}</a>`).join(" / ")}）</span>` : "";
  const rChips = reqChips("牌组限制", dCount, dCards) + reqChips("打出限制", rCount, rCards);

  $("summary").innerHTML = `
    <div class="sum-chars">${current.chars.map(c => `
      <span class="chip"><span class="edot" style="--ec:${ELE_COLOR[c.element] || '#888'}">${ELE_ICONS[c.element] || ""}</span>${esc(c.name)}<small class="chip-en">${enPips(c.energy)}</small></span>`).join("")}
    </div>
    <div class="sum-types"><span>元素构成：<b>${esc(eles)}</b></span><span>${typeCounts}</span><span>版本跨度：<b>${esc(vers.join(" ~ "))}</b></span></div>
    <div class="sum-extra">${energyChip}${rChips}</div>
    ${curve}`;
}
/* 点击概览中的限制统计 → 跳到列表视图并过滤 */
$("summary").addEventListener("click", ev => {
  const a = ev.target.closest("[data-filter]");
  if (!a) return;
  listFilter = a.dataset.filter;
  document.querySelector('.tab[data-view="list"]').click();
  renderList();
});

/* ---------- 卡面视图 ---------- */
function tileHtml(x) {
  const badges = depBadges(allReqs(x));
  const rel = x.related ? `${esc(x.related)}·天赋` : "";
  const en = x.energy ? ` <span class="en-mark" title="充能 ${x.energy}">${ENERGY_ICON}${x.energy}</span>` : "";
  return `<div class="tile" data-id="${x.id}">
    <div class="imgbox"><img class="card-img" src="${imgFull(x.id)}" loading="lazy" decoding="async" width="420" height="720" alt="${esc(x.name)}"
      onerror="this.onerror=null;this.removeAttribute('style');this.outerHTML='<div class=fallback>${esc(x.name)}<br><small>图片加载失败</small></div>'">
      <div class="badges">${badges}</div>
      ${x.count > 1 ? `<span class="cnt">×${x.count}</span>` : ""}
      <div class="capbar">${esc(x.name)}${en}${rel ? `<small>${rel}</small>` : ""}</div></div></div>`;
}
function renderGrid() {
  if (!current) {
    $("view-grid").innerHTML = `<div class="empty-hint">尚未解析牌组<br><small>粘贴分享码后自动解析，或点「示例」体验；也可以直接去「卡库浏览」或「卡牌检索」查卡</small></div>`;
    return;
  }
  $("view-grid").innerHTML = `<div class="sec-title">角色牌</div>
    <div class="char-row">${current.chars.map(c => `
      <div class="char-card"><div class="imgbox" data-id="${c.id}">
        <img class="card-img" src="${imgFull(c.id)}" decoding="async" width="420" height="720" alt="${esc(c.name)}"
          onerror="this.onerror=null;this.outerHTML='<div class=fallback>${esc(c.name)}</div>'">
        <span class="el-badge" style="background:${ELE_COLOR[c.element] || '#888'}"><span class="badge-ico">${ELE_ICONS[c.element] || ""}</span>${ELE_ZH[c.element] || c.element}</span>
        <span class="en-badge">${enPips(c.energy)}</span>
      </div>
      <div class="cap">${esc(c.name)}<small>生命 ${c.hp} · 充能 ${c.energy} · ${esc(c.since || "")}</small></div></div>`).join("")}
    </div>` +
    current.order.map(t => `<div class="sec-title">${t}（${current.groups[t].reduce((a, x) => a + x.count, 0)}）</div>
      <div class="card-grid">${current.groups[t].map(tileHtml).join("")}</div>`).join("");
}

/* ---------- 列表视图（含限制列 + 表头排序） ---------- */
let listFilter = "";
let listSort = { key: "count", dir: -1 };
const sortVal = {
  count: x => x.count,
  name: x => x.name,
  cost: x => x.dice * 100 + x.energy,
  since: x => parseFloat(String(x.since || "0").replace("v", "")) || 0,
};
function renderList() {
  if (!current) {
    $("view-list").innerHTML = `<div class="empty-hint">尚未解析牌组<br><small>解析分享码后，这里以表格形式展示全部卡牌与效果</small></div>`;
    return;
  }
  const f = listFilter.trim().toLowerCase();
  /* 筛选命中范围含依赖的 code / 中文类别（概览条按限制统计点击过滤时传 R_ZH 文本） */
  const match = x => !f || [x.name, x.related, x.type, ...(x.tags || []),
    ...allReqs(x).map(r => r.label + " " + r.short + " " + r.code + " " + (R_ZH[r.code] || "")), x.desc].join(" ").toLowerCase().includes(f);
  const arrow = k => listSort.key === k ? (listSort.dir < 0 ? " ▾" : " ▴") : "";
  const rows = t => current.groups[t].filter(match)
    .sort((a, b) => listSort.dir * (sortVal[listSort.key](a) < sortVal[listSort.key](b) ? -1 : sortVal[listSort.key](a) > sortVal[listSort.key](b) ? 1 : a.name.localeCompare(b.name, "zh")))
    .map(x => `<tr data-id="${x.id}">
    <td class="cnt">${x.count > 1 ? "×" + x.count : "1"}</td>
    <td>${esc(x.name)}</td><td>${costHtml(x.playCost)}</td>
    <td>${allReqs(x).map(r => `<span class="rpill" style="color:${r.code === "deckEl" ? (ELE_COLOR[r.name] || "var(--gold)") : R_STYLE[r.code]}" title="${esc(r.label)}">${esc(r.short)}</span>`).join("") || '<span style="color:#4a5261">—</span>'}</td>
    <td>${esc(x.related || "—")}</td><td>${esc(x.since || "—")}</td>
    <td class="desc">${linkify(esc(x.desc))}</td></tr>`).join("");
  const sections = current.order.map(t => {
    if (!current.groups[t].some(match)) return "";
    return `<div class="sec-title">${t}</div><div class="table-wrap"><table>
      <tr>
        <th class="sortable" data-key="count">数量${arrow("count")}</th>
        <th class="sortable" data-key="name">名称${arrow("name")}</th>
        <th class="sortable" data-key="cost">费用${arrow("cost")}</th>
        <th>依赖限制</th>
        <th>关联角色</th>
        <th class="sortable" data-key="since">版本${arrow("since")}</th>
        <th>效果</th></tr>
      ${rows(t)}</table></div>`;
  }).join("");
  $("view-list").innerHTML = `
    <div class="list-tools"><input id="listSearch" placeholder="筛选：名称 / 限制 / 标签 / 效果关键词…" value="${esc(listFilter)}">
      <span class="hint">点击行看详情 · 点表头排序 · 快捷键 1/2 切视图 · / 聚焦筛选 · Ctrl+P 打印</span></div>` +
    (sections || `<div style="color:var(--dim);padding:30px;text-align:center">无匹配卡牌</div>`);
  $("listSearch").addEventListener("input", e => {
    listFilter = e.target.value;
    const p = e.target.selectionStart;
    renderList();
    const n = $("listSearch");
    n.focus(); n.setSelectionRange(p, p);
  });
  document.querySelectorAll("#view-list th.sortable").forEach(th => th.addEventListener("click", () => {
    const k = th.dataset.key;
    listSort = { key: k, dir: listSort.key === k ? -listSort.dir : (k === "name" ? 1 : -1) };
    renderList();
  }));
}

/* ---------- 检索视图 ---------- */
function hlName(s) { return hlText(s, searchState.q); }

function renderSearchLoading() {
  const box = $("view-search");
  if (!box) return;
  box.setAttribute("aria-busy", "true");
  box.innerHTML = `<div class="search-head"><span><span class="spin"></span>正在载入本地数据…</span></div>
    <div class="card-grid">${Array.from({ length: 8 }, () => `<div class="skel-tile"><div class="skel"></div><div class="skel-line"></div><div class="skel-line short"></div></div>`).join("")}</div>`;
}

function searchTile(r) {
  if (r.kind === "concept") {
    /* 用行上携带的具体种类（ckind），而不是词条列表首项——
       首项可能是同名的卡牌/角色条目，会把"术语"错标成"卡牌" */
    const k = r.ckind || termEntries(r.name).find(e => e.kind !== "card" && e.kind !== "char")?.kind || "keyword";
    return `<div class="tile stile" data-term="${esc(r.name)}" title="点击查看概念解释">
      <div class="cbox"><span>${esc(KIND_ZH[k] || "概念")}</span></div>
      <div class="tname">${hlName(r.name)}</div>
      <div class="tmeta">${esc(KIND_ZH[k] || "概念")} ${matchChip(r)}</div></div>`;
  }
  const isChar = r.kind === "char";
  const raw = isChar ? charById.get(r.id) : entById.get(r.id);
  const ele = isChar ? (raw.tags.find(t => t.startsWith("GCG_TAG_ELEMENT")) || "").replace("GCG_TAG_ELEMENT_", "") : "";
  const meta = isChar ? `${eleIcon(ele)} ${ELE_ZH[ele] || ele} · 生命 ${raw.hp} · 充能 ${raw.maxEnergy}`
    : `${esc(TYPE_ZH[raw.type])}${costText(raw.playCost) ? " · " + esc(costText(raw.playCost)) : ""}`;
  /* 依赖徽标：与卡面/卡库同一套渲染（牌组限制 + 打出限制） */
  const badges = isChar ? "" : depBadges([...deckReqsOf(raw), ...restrictionsOf(raw)]);
  /* 不可构筑原因区分：对局实体（状态/场地/召唤物）vs 历史版本变体 */
  const noShareWarn = r.noShare
    ? (["GCG_CARD_STATE", "GCG_CARD_ONSTAGE", "GCG_CARD_SUMMON", "GCG_CARD_ATTACHMENT"].includes(raw.type)
      ? `<span class="vwarn" title="对局中生成的实体，不可加入构筑">实体</span>`
      : `<span class="vwarn" title="历史版本变体，不可加入构筑">变体</span>`)
    : "";
  return `<div class="tile stile" data-id="${r.id}" title="点击查看详情">
    <div class="imgbox"><img src="${imgFull(r.id)}" loading="lazy" decoding="async" width="420" height="720" alt="">
      ${badges ? `<div class="badges">${badges}</div>` : ""}</div>
    <div class="tname">${hlName(r.name)}${noShareWarn}</div>
    <div class="tmeta">${meta} ${matchChip(r)}</div>
    ${r.noShare ? "" : `<button class="addbtn" data-add="${r.id}" title="加入当前牌组">＋</button>`}</div>`;
}
function renderSearch() {
  const st = searchState;
  const box = $("view-search");
  if (box.removeAttribute) box.removeAttribute("aria-busy");
  /* 牌库筛选变化后回到检索视图：按新语料重算，保证结果与"基于当前牌库"一致 */
  if (st.q && dataReady && st.corpusKey !== corpusKey()) {
    st.results = searchCards(st.q);
    st.corpusKey = corpusKey();
  }
  if (!st.q) {
    const recent = loadRecent();
    box.innerHTML = `${scopeRow()}<div class="search-empty">输入卡牌名、角色名、术语或效果关键词开始检索
      <div class="hotrow">${HOT_WORDS.map(h => `<button class="fchip" data-q="${h}">${h}</button>`).join("")}</div>
      ${recent.length ? `<div class="hotrow">${recent.map(h => `<button class="fchip" data-q="${esc(h)}" title="最近搜索">${esc(h)}</button>`).join("")}</div>` : ""}
      <small>${inputHint()}</small></div>`;
    return;
  }
  if (!st.results.length) {
    const near = nearNames(st.q, 6);
    box.innerHTML = `${scopeRow()}<div class="search-empty">
      <div>未找到与“${esc(st.q)}”匹配的内容</div>
      ${near.length ? `<div class="near-title">最接近的名字</div>
        <div class="hotrow">${near.map(x => `<button class="fchip" data-q="${esc(x.name)}">${esc(x.name)}</button>`).join("")}</div>` : ""}
      <div class="near-title">换个说法试试</div>
      <div class="hotrow">${HOT_WORDS.slice(0, 6).map(h => `<button class="fchip" data-q="${h}">${h}</button>`).join("")}</div>
      <small>${inputHint()}</small></div>`;
    return;
  }
  const shown = st.results.filter(r => !st.filter || resultTypeLabel(r) === st.filter);
  const nOf = c => st.results.filter(r => resultTypeLabel(r) === c).length;
  const cats = ["全部", ...CAT_ORDER.filter(c => nOf(c) > 0)]
    .map(c => { const n = c === "全部" ? st.results.length : nOf(c); return `<button class="fchip${st.filter === (c === "全部" ? "" : c) ? " on" : ""}" data-f="${c === "全部" ? "" : esc(c)}">${c} <b>${n}</b></button>`; }).join("");
  const groups = [
    ["角色", shown.filter(r => r.kind === "char")],
    ["行动牌", shown.filter(r => r.kind === "card")],
    ["概念", shown.filter(r => r.kind === "concept")],
  ].filter(([, list]) => list.length);
  const fuzzyN = st.results.filter(r => ["pinyin", "initials", "fuzzy"].includes(r.match)).length;
  const descN = st.results.filter(r => r.match === "desc").length;
  const breakdown = [fuzzyN ? `拼音/模糊 ${fuzzyN}` : "", descN ? `释义 ${descN}` : ""].filter(Boolean).join(" · ");
  box.innerHTML = `
    ${scopeRow()}
    <div class="search-head"><span>“${esc(st.q)}” 命中 <b>${st.results.length}</b> 条${st.results.length >= 90 ? "（已截断，请细化关键词）" : ""}${breakdown ? `　<small class="sbreak">其中 ${breakdown}</small>` : ""}</span>
      <div class="fchips">${cats}</div></div>
    ${groups.map(([t, list]) => `<div class="sec-title">${t} <small>${list.length}</small></div>
      <div class="card-grid">${list.map(searchTile).join("")}</div>`).join("")}
    ${shown.length ? "" : `<div style="color:var(--dim);padding:30px;text-align:center">该分类下无匹配结果</div>`}`;
}

/* ---------- 卡库浏览：多维筛选 / 排序 / 分片渲染 ----------
   筛选维度：类别 / 元素（角色及其天赋）/ 骰子费用 / 充能 / 标签 / 版本。
   计数为 facet 计数：每个可选值按"其余维度全部生效"统计，点进去不会把人带向空结果。 */
const browseState = { type: "", el: "", cost: "", energy: "", tag: "", ver: "", sort: "name", dir: 1 };
const BROWSE_DIMS = ["type", "el", "cost", "energy", "tag", "ver"];
const BROWSE_PAGE = 60;
function facetKey(x, dim) {
  if (dim === "type") return x.typeRaw;
  if (dim === "el") return x.element || null;
  if (dim === "cost") return x.kind === "char" ? null : String(Math.min(x.dice, 5));
  if (dim === "energy") return x.kind === "char" ? null : (x.energyCost > 0 ? String(x.energyCost) : "0");
  if (dim === "ver") return x.ver || null;
  return null;
}
function passFilter(x, st) {
  if (st.type && x.typeRaw !== st.type) return false;
  if (st.el && x.element !== st.el) return false;
  if (st.cost !== "" && (x.kind === "char" || String(Math.min(x.dice, 5)) !== st.cost)) return false;
  if (st.energy !== "" && (x.kind === "char" || (x.energyCost > 0 ? String(x.energyCost) : "0") !== st.energy)) return false;
  if (st.tag && !x.tags.includes(st.tag)) return false;
  if (st.ver && x.ver !== st.ver) return false;
  return true;
}
function browseCmp(a, b, key, dir) {
  if (key === "name") return dir * a.name.localeCompare(b.name, "zh");
  if (key === "id") return dir * (a.id - b.id);
  if (key === "ver") return dir * (verCmp(a.ver, b.ver) || a.name.localeCompare(b.name, "zh"));
  /* cost：角色无骰子费用，按费用排序时固定沉到一端（升序在顶） */
  const va = a.kind === "char" ? -1 : a.dice * 100 + a.energyCost;
  const vb = b.kind === "char" ? -1 : b.dice * 100 + b.energyCost;
  return dir * (va - vb) || a.name.localeCompare(b.name, "zh");
}
function browseFilter(st = browseState) {
  return pool.filter(x => passFilter(x, st)).sort((a, b) => browseCmp(a, b, st.sort, st.dir));
}
/* facet 计数：某维度的每个可选值，在"其余维度全部生效"下的命中数。
   注意：撤下某一维度要置为 ""（初始值）而不是 delete——passFilter 判 `!== ""`，
   undefined 会被当成激活的筛选项。 */
function facetCounts(st = browseState) {
  const out = { type: {}, el: {}, cost: {}, energy: {}, tag: {}, ver: {} };
  for (const dim of BROWSE_DIMS) {
    const st2 = { ...st, [dim]: "" };
    for (const x of pool) {
      if (!passFilter(x, st2)) continue;
      if (dim === "tag") { for (const t of x.tags) out.tag[t] = (out.tag[t] || 0) + 1; continue; }
      const k = facetKey(x, dim);
      if (k != null) out[dim][k] = (out[dim][k] || 0) + 1;
    }
  }
  return out;
}
/* 筛选状态 ↔ hash（#b=t=GCG_CARD_EVENT,e=HYDO,c=2,...）便于分享当前视图。
   解析时容忍有无前导 #（init 传入的是剥掉 # 的串）。 */
function browseHash(st = browseState) {
  const p = [];
  if (st.type) p.push("t=" + st.type);
  if (st.el) p.push("e=" + st.el);
  if (st.cost !== "") p.push("c=" + st.cost);
  if (st.energy !== "") p.push("n=" + st.energy);
  if (st.tag) p.push("g=" + encodeURIComponent(st.tag));
  if (st.ver) p.push("v=" + st.ver);
  if (st.sort !== "name") p.push("s=" + st.sort);
  if (st.dir !== 1) p.push("d=-1");
  return p.length ? "#b=" + p.join(",") : "";
}
function parseBrowseHash(hash) {
  const st = { type: "", el: "", cost: "", energy: "", tag: "", ver: "", sort: "name", dir: 1 };
  const m = String(hash || "").match(/^#?b=(.*)$/);
  if (!m) return null;
  for (const kv of m[1].split(",")) {
    const i = kv.indexOf("=");
    if (i < 0) continue;
    const k = kv.slice(0, i), v = kv.slice(i + 1);
    if (k === "t") st.type = v;
    else if (k === "e") st.el = v;
    else if (k === "c") st.cost = v;
    else if (k === "n") st.energy = v;
    else if (k === "g") st.tag = decodeURIComponent(v);
    else if (k === "v") st.ver = v;
    else if (k === "s") st.sort = v;
    else if (k === "d") st.dir = -1;
  }
  return st;
}
function syncBrowseHash() {
  const h = browseHash();
  history.replaceState(null, "", h || location.pathname + location.search);
}
function browseChip(group, val, label, n, active, title) {
  return `<button class="fchip${active ? " on" : ""}" data-bg="${group}" data-bv="${esc(String(val))}" title="${esc(title || "")}">${label}${n != null ? ` <b>${n}</b>` : ""}</button>`;
}
function browseTile(x) {
  const elCol = x.element ? ELE_COLOR[x.element] : "";
  const badges = depBadges(allReqs(x));
  const add = x.share != null ? `<button class="addbtn" data-add="${x.id}" title="加入当前牌组">＋</button>` : "";
  const meta = x.kind === "char"
    ? `${eleIcon(x.element)} ${esc(ELE_ZH[x.element] || "")} · 生命 ${x.hp} · <span class="en-inline" title="充能 ${x.energy}">${ENERGY_ICON}${x.energy}</span>`
    : `${esc(x.type)}${costText(x.playCost) ? " · " + esc(costText(x.playCost)) : ""}${x.related ? " · " + esc(x.related) : ""}`;
  const warn = x.share == null ? `<span class="vwarn" title="对局实体或历史版本变体，不可加入构筑">不可构筑</span>` : "";
  return `<div class="tile stile btile" data-id="${x.id}" title="点击查看详情">
    <div class="imgbox"${elCol ? ` style="border-left-color:${elCol}"` : ""}>
      <img src="${imgFull(x.id)}" loading="lazy" decoding="async" width="420" height="720" alt="${esc(x.name)}">
      <div class="badges">${badges}</div>${add}</div>
    <div class="tname">${esc(x.name)}${warn}</div>
    <div class="tmeta">${meta}${x.ver ? " · " + esc(x.ver) : ""}</div></div>`;
}
/* 筛选栏展开状态：默认折叠——排序与已激活筛选常驻（低门槛、高频），
   六维筛选收进「筛选」按钮（ Progressive Disclosure），选择记忆在本地 */
const BROWSE_EXP_KEY = "gi-viewer-browse-exp";
let browseExpanded = false;
try { browseExpanded = localStorage.getItem(BROWSE_EXP_KEY) === "1"; } catch (e) {}
/* 已激活筛选 chips（折叠态展示，点击即移除该维度） */
function activeBrowseChips(st) {
  const chips = [];
  const push = (g, label, val) => chips.push(browseChip(g, val, label, null, true, "点击移除该筛选"));
  if (st.type) push("type", TYPE_ZH[st.type] || st.type, st.type);
  if (st.el) push("el", eleIcon(st.el) + (ELE_ZH[st.el] || st.el), st.el);
  if (st.cost !== "") push("cost", "骰子 " + (st.cost === "5" ? "5+" : st.cost), st.cost);
  if (st.energy !== "") push("energy", st.energy === "0" ? "无充能" : ENERGY_ICON + st.energy, st.energy);
  if (st.tag) push("tag", st.tag, st.tag);
  if (st.ver) push("ver", st.ver, st.ver);
  return chips.join("");
}
function browseBarHtml(st, facets) {
  const typeRow = browseChip("type", "", "全部", poolStats.total, !st.type) +
    POOL_TYPE_ORDER.filter(t => poolStats.byType[t]).map(t =>
      browseChip("type", t, TYPE_ZH[t] || t, facets.type[t], st.type === t)).join("");
  const elRow = browseChip("el", "", "全部", pool.filter(x => x.element).length, !st.el, "按角色元素筛选（含其天赋牌）") +
    Object.keys(ELE_ZH).filter(e => facets.el[e]).map(e =>
      browseChip("el", e, eleIcon(e) + ELE_ZH[e], facets.el[e], st.el === e)).join("");
  const costRow = browseChip("cost", "", "全部", null, st.cost === "") +
    ["0", "1", "2", "3", "4", "5"].filter(k => facets.cost[k]).map(k =>
      browseChip("cost", k, k === "5" ? "5+" : k, facets.cost[k], st.cost === k)).join("");
  const enRow = browseChip("energy", "", "全部", null, st.energy === "") +
    Object.keys(facets.energy).sort().map(k =>
      browseChip("energy", k, k === "0" ? "无充能" : ENERGY_ICON + k, facets.energy[k], st.energy === k)).join("");
  const tagRow = browseChip("tag", "", "全部", null, !st.tag) +
    Object.entries(facets.tag).sort((a, b) => b[1] - a[1]).map(([t, n]) =>
      browseChip("tag", t, t, n, st.tag === t)).join("");
  const verSel = `<select class="bg-sel" data-bg="ver" title="按版本筛选"><option value="">全部版本</option>` +
    poolStats.versions.map(v => `<option${st.ver === v ? " selected" : ""}>${esc(v)}</option>`).join("") + `</select>`;
  const sortSel = `<select class="bg-sel" data-bs="sort" title="排序方式">
      <option value="name"${st.sort === "name" ? " selected" : ""}>按名称</option>
      <option value="cost"${st.sort === "cost" ? " selected" : ""}>按费用</option>
      <option value="ver"${st.sort === "ver" ? " selected" : ""}>按版本</option>
      <option value="id"${st.sort === "id" ? " selected" : ""}>按编号</option></select>`;
  const dirBtn = `<button class="bg-dir" data-bdir="1" title="${st.dir < 0 ? "当前降序，点击升序" : "当前升序，点击降序"}">${st.dir < 0 ? "↑" : "↓"}</button>`;
  const activeCount = (st.type ? 1 : 0) + (st.el ? 1 : 0) + (st.tag ? 1 : 0) + (st.ver ? 1 : 0)
    + (st.cost !== "" ? 1 : 0) + (st.energy !== "" ? 1 : 0);
  const dirty = activeCount > 0 || st.sort !== "name" || st.dir !== 1;
  const toggle = `<button class="bg-toggle" data-btoggle="1" title="展开 / 收起多维筛选">${browseExpanded ? "收起筛选 ▴" : "筛选 ▾"}${activeCount ? `<b>${activeCount}</b>` : ""}</button>`;
  const reset = dirty ? `<button class="bg-reset" data-breset="1" title="清除全部筛选与排序">重置</button>` : "";
  /* 顶行（常驻）：筛选开关 + 已激活 chips（仅折叠态）+ 重置 + 排序 + 计数 */
  const top = `<div class="bg-row bg-top">${toggle}
      ${browseExpanded ? "" : `<div class="bg-chips">${activeBrowseChips(st)}</div>`}
      ${reset}<span class="bg-label">排序</span>${sortSel}${dirBtn}
      <span class="bg-count"></span></div>`;
  /* 展开态：六维筛选各行（激活态由 chip 高亮表示，无需再重复 chips） */
  const rows = browseExpanded ? `
    <div class="bg-row"><span class="bg-label">类别</span><div class="bg-chips">${typeRow}</div></div>
    <div class="bg-row"><span class="bg-label">元素</span><div class="bg-chips">${elRow}</div></div>
    <div class="bg-row"><span class="bg-label">骰子费用</span><div class="bg-chips">${costRow}</div></div>
    <div class="bg-row"><span class="bg-label">充能</span><div class="bg-chips">${enRow}</div></div>
    <div class="bg-row"><span class="bg-label">标签</span><div class="bg-chips">${tagRow}</div></div>
    <div class="bg-row bg-ctrl"><span class="bg-label">版本</span>${verSel}</div>` : "";
  return `<div class="browse-bar">${top}${rows}</div>`;
}
function renderBrowse() {
  const st = browseState;
  const facets = facetCounts(st);
  const list = browseFilter(st);
  $("view-browse").innerHTML = browseBarHtml(st, facets) +
    `<div class="card-grid" id="bgrid"></div>
     <div class="bsentinel" id="bsentinel"></div>`;
  const cnt = $("view-browse").querySelector(".bg-count");
  if (cnt) cnt.innerHTML = `共 <b>${list.length}</b> 张${dirtyBrowse() ? `（全库 ${poolStats.total}）` : ""}`;
  appendBrowseTiles();
}
const dirtyBrowse = () => browseState.type || browseState.el || browseState.cost !== "" || browseState.energy !== "" || browseState.tag || browseState.ver || browseState.sort !== "name" || browseState.dir !== 1;
function appendBrowseTiles() {
  const grid = $("bgrid"); if (!grid) return;
  const list = browseFilter();
  const start = grid.children.length;
  const end = Math.min(start + BROWSE_PAGE, list.length);
  if (end <= start) return;
  let html = "";
  for (let i = start; i < end; i++) html += browseTile(list[i]);
  grid.insertAdjacentHTML("beforeend", html);
  const s = $("bsentinel");
  if (s) s.innerHTML = end < list.length ? "滚动加载更多…" : (list.length ? `已展示全部 ${list.length} 张` : "");
}
/* 滚动哨兵：接近底部再补一页，避免一次性渲染上千张卡 */
function browseMaybeMore() {
  if (currentView !== "browse") return;
  const s = $("bsentinel"); if (!s) return;
  if (s.getBoundingClientRect().top < innerHeight + 600) appendBrowseTiles();
}
document.addEventListener("scroll", browseMaybeMore, { passive: true });
/* 筛选交互：chip 再点一次 = 取消；select/dir/reset 即时重渲染并同步 hash */
$("view-browse").addEventListener("click", ev => {
  const add = ev.target.closest("[data-add]");
  if (add) { ev.stopPropagation(); draftAdd(Number(add.dataset.add)); return; }
  if (ev.target.closest("[data-btoggle]")) {
    browseExpanded = !browseExpanded;
    try { localStorage.setItem(BROWSE_EXP_KEY, browseExpanded ? "1" : "0"); } catch (e) {}
    renderBrowse(); return;
  }
  const chip = ev.target.closest("button[data-bg]");
  if (chip) {
    const g = chip.dataset.bg;
    browseState[g] = browseState[g] === chip.dataset.bv ? "" : chip.dataset.bv;
    renderBrowse(); syncBrowseHash(); return;
  }
  if (ev.target.closest("[data-breset]")) {
    Object.assign(browseState, { type: "", el: "", cost: "", energy: "", tag: "", ver: "", sort: "name", dir: 1 });
    renderBrowse(); syncBrowseHash(); return;
  }
  if (ev.target.closest("[data-bdir]")) { browseState.dir = -browseState.dir; renderBrowse(); syncBrowseHash(); return; }
  const tile = ev.target.closest("[data-id]");
  if (tile) showDetail(Number(tile.dataset.id));
});
$("view-browse").addEventListener("change", ev => {
  const sel = ev.target.closest("[data-bg]");
  if (sel && sel.tagName === "SELECT") { browseState[sel.dataset.bg] = sel.value; renderBrowse(); syncBrowseHash(); return; }
  const s = ev.target.closest("[data-bs]");
  if (s) { browseState.sort = s.value; renderBrowse(); syncBrowseHash(); }
});

/* ---------- 草稿栏与牌组管理面板 ---------- */
function renderDraft() {
  const bar = $("draftBar");
  /* 栏常驻显示：它是牌组管理器的唯一入口——空牌组时若整条隐藏，用户既看不到
     当前进度，也无从打开管理器新建/切换牌组 */
  bar.style.display = "flex";
  bar.innerHTML = `<span class="dbar-title">${esc(activeDeck()?.name || "牌组草稿")}</span>
      <span class="dbar-count">角色 <b>${draft.chars.length}</b>/3 · 行动牌 <b>${draftTotal()}</b>/30</span>
      <span class="dbar-acts">
        <button id="draftManage">管理 ▾</button>
        <button id="draftGen" class="primary">生成分享码</button>
      </span>`;
  /* 面板可见性与牌组是否为空无关：切换/新建空牌组时管理器应保持打开，
     否则用户点了「新建牌组」面板就消失，无法继续操作 */
  if ($("draftPanel").classList.contains("show")) renderDraftPanel();
}
function renderDraftPanel() {
  const slot = i => {
    const id = draft.chars[i];
    if (id == null) return `<div class="dslot empty"><span>空角色槽</span></div>`;
    const c = charById.get(id);
    if (!c) return `<div class="dslot empty"><span>失效角色</span></div>`;
    return `<div class="dslot"><img src="${imgFull(id)}" loading="lazy" decoding="async" alt="">
      <b>${esc(c.name)}</b><button data-rmc="${id}" title="移除">✕</button></div>`;
  };
  /* 牌组列表：点击切换活动牌组；重命名/复制/删除逐项操作 */
  const deckList = decks.map(d => {
    const n = d.cards.reduce((s, [, c]) => s + c, 0);
    const avatars = d.chars.slice(0, 3).map(id => {
      const c = charById.get(id);
      return c ? `<img class="dk-av" src="${imgFull(id)}" alt="" title="${esc(c.name)}" loading="lazy">` : "";
    }).join("");
    const name = deckRenameId === d.id
      ? `<input class="dk-rename" data-dkren-input="${d.id}" value="${esc(d.name)}" maxlength="24">`
      : `<span class="dk-name">${esc(d.name)}</span>`;
    return `<div class="dk-item${d.id === activeDeckId ? " active" : ""}" data-deck="${d.id}">
      <span class="dk-dot"></span>${avatars}
      <span class="dk-meta">${name}<small>${d.chars.length} 角色 · ${n} 行动牌 · ${new Date(d.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })}</small></span>
      <span class="dk-acts">
        <button data-dkren="${d.id}" title="重命名">✎</button>
        <button data-dkcpy="${d.id}" title="复制为新牌组">⧉</button>
        <button data-dkdel="${d.id}" title="删除"${decks.length <= 1 ? " disabled" : ""}>✕</button>
      </span></div>`;
  }).join("");
  const byType = {};
  for (const [id, count] of draft.cards) {
    const e = entById.get(id);
    if (!e) continue;
    (byType[TYPE_ZH[e.type]] ??= []).push({ id, count, name: e.name, cost: costText(e.playCost) });
  }
  const order = ["装备牌", "支援牌", "事件牌", "援助牌"].filter(t => byType[t]).concat(Object.keys(byType).filter(t => !["装备牌", "支援牌", "事件牌", "援助牌"].includes(t)));
  const problems = deckProblems();
  $("draftPanel").innerHTML = `
    <div class="dp-head"><b>牌组管理</b>
      <span class="dp-acts">
        <button id="draftNew">＋ 新建牌组</button>
        <button id="draftLoad">载入当前牌组</button>
        <button id="draftClose">收起</button></span></div>
    <div class="dk-list">${deckList}</div>
    <div class="dp-head dp-sub"><b>正在编辑：${esc(activeDeck()?.name || "")}</b>
      <span class="dp-acts"><button id="draftClear">清空</button></span></div>
    <div class="dp-chars">${[0, 1, 2].map(slot).join("")}</div>
    ${order.map(t => `<div class="dp-type">${t}</div>` + byType[t].map(x => `
      <div class="dp-row"><span class="dp-name">${esc(x.name)}</span><span class="dp-cost">${esc(x.cost || "—")}</span>
        <span class="dp-cnt"><button data-dec="${x.id}">−</button><b>×${x.count}</b><button data-inc="${x.id}">＋</button></span>
        <button class="dp-rm" data-rm="${x.id}" title="移除">✕</button></div>`).join("")).join("") || `<div style="color:var(--dim);padding:10px 4px">行动牌为空——在卡库或检索中点击「＋」加入</div>`}
    <div class="dk-val${problems.length ? " err" : " ok"}">${problems.length ? "⚠ " + problems.map(esc).join("；") : "✓ 符合构筑规则，可生成分享码"}</div>`;
}
/* 重命名提交：Enter / 失焦均提交，Esc 取消 */
function commitDeckRename(inp) {
  const id = Number(inp.dataset.dkrenInput);
  const d = decks.find(x => x.id === id);
  const v = (inp.value || "").trim();
  if (d && v) d.name = v.slice(0, 24);
  deckRenameId = null;
  saveDecks(); renderDraft(); renderDraftPanel();
}
$("draftPanel").addEventListener("keydown", ev => {
  const inp = ev.target.closest("[data-dkren-input]");
  if (!inp) return;
  if (ev.key === "Enter") { commitDeckRename(inp); inp.blur(); }
  else if (ev.key === "Escape") {
    deckRenameId = null; renderDraftPanel();
    ev.stopPropagation();   /* 只取消重命名，不要连带关掉整个管理面板 */
  }
});
$("draftPanel").addEventListener("focusout", ev => {
  const inp = ev.target.closest("[data-dkren-input]");
  if (inp) commitDeckRename(inp);
});
/* 点击牌组项切换活动牌组（点在按钮/输入框上不切换） */
document.addEventListener("click", ev => {
  const item = ev.target.closest("[data-deck]");
  if (!item || ev.target.closest("button") || ev.target.closest("input")) return;
  activeDeckId = Number(item.dataset.deck);
  syncFromActive(); renderDraft(); renderDraftPanel();
});

/* ---------- 详情弹层（含限制、关联与反链导航） ---------- */
/* 反链 chips：引用该概念的其他卡牌/角色，点击跳转详情 */
function backlinkHtml(name, selfId) {
  const b = backlinks.get(name);
  if (!b || !b.size) return "";
  const ids = [...b].filter(x => x !== selfId);
  if (!ids.length) return "";
  const shown = ids.slice(0, 30);
  const chips = shown.map(id => {
    const c = charById.get(id), e = entById.get(id);
    if (!c && !e) return "";
    const n = c ? c.name : e.name;
    return `<button class="blchip" data-goto="${id}" title="查看：${esc(n)}">${esc(n)}</button>`;
  }).join("");
  const more = ids.length > shown.length ? `<span class="blmore">…等 ${ids.length} 条引用</span>` : "";
  return `<div class="drel"><b>被引用</b><span class="blchips">${chips}${more}</span></div>`;
}
/* 角色天赋牌 chips（卡牌详情中排除自身，避免自指） */
function charTalentChips(charId, excludeId) {
  const list = ENT.filter(x => x.relatedCharacterId === charId && (x.tags || []).includes("GCG_TAG_TALENT"));
  if (!list.length) return "";
  return `<div class="drel"><b>天赋牌</b><span class="blchips">` + list.map(x =>
    `<button class="blchip${x.id === excludeId ? " self" : ""}" data-goto="${x.id}" title="${esc(x.name)}${x.id === excludeId ? "（当前卡牌）" : ""}">${esc(x.name)}</button>`).join("") + `</span></div>`;
}
function draftHas(id) { return charById.has(id) ? draft.chars.includes(id) : draft.cards.has(id); }
/* ---------- 弹层导航模型 ----------
   弹层内部是一个「视图栈」，元素只有两种：
     · detail —— 卡牌 / 角色详情，自带同级翻页上下文（ids / idx）
     · term   —— 概念页；概念页里的术语链接继续压栈，可沿概念链一路深钻
   返回（‹ / Esc）逐层弹出：概念 → 来源概念 → … → 来源卡牌 → 关闭弹层。
   所有入口（卡面 / 列表 / 卡库 / 检索 / 深链 / 反链 chip / 术语链接）都走
   showDetail / showTermModal 这一条路径，因此翻页与下钻在任意界面表现一致。 */
function topView() { return overlayStack.length ? overlayStack[overlayStack.length - 1] : null; }
const overlayOpen = () => $("overlay").classList.contains("show");

/* 弹层的开关统一走这里：显示/隐藏 + 锁定背景滚动。
   只挂 fixed 遮罩是不够的——弹层滚到边界后滚动链会继续传给文档，
   于是"在弹层里上下滑，背景的卡面视图跟着动"。锁住文档滚动是最直接的断链方式，
   补偿 scrollbar 宽度避免锁定瞬间页面横向跳动。 */
function setOverlayOpen(open) {
  const ov = $("overlay");
  if (!ov || !ov.classList) return;
  const wasOpen = ov.classList.contains("show");
  ov.classList.toggle("show", open);
  const root = document.documentElement;
  if (root && root.classList) root.classList.toggle("ovl-lock", open);
  const body = document.body;
  if (body && body.style) {
    if (open && !wasOpen) {
      const sbw = root && typeof root.clientWidth === "number" ? window.innerWidth - root.clientWidth : 0;
      body.style.paddingRight = sbw > 0 ? sbw + "px" : "";
    } else if (!open) body.style.paddingRight = "";
  }
  if (open) hideTip();      /* 弹层盖上来时，残留的悬浮预览会浮在遮罩之上 */
}

/* 同级翻页列表：按打开入口推断——卡库 → 当前筛选结果；检索 → 命中列表；牌组 → 牌组内顺序。
   （旧实现把"牌组顺序"和"导航上下文"混成一个 modalList，从卡库/检索打开详情时会被
     压成单张，此后再从卡面视图打开详情也仍是单张，翻页永远禁用。） */
function pagerContextFor(id) {
  if (currentView === "browse") {
    const ids = browseFilter().map(x => x.id);
    if (ids.includes(id)) return ids;
  }
  if (currentView === "search") {
    const ids = (searchState.results || [])
      .filter(r => r.kind === "card" || r.kind === "char").map(r => r.id);
    if (ids.includes(id)) return ids;
  }
  return deckOrder.includes(id) ? deckOrder : [id];
}
function detailView(id, ids) {
  const list = ids && ids.length ? ids.slice() : [id];
  const i = list.indexOf(id);
  return { kind: "detail", id, ids: list, idx: i < 0 ? 0 : i };
}
function renderOverlay() {
  const top = topView();
  if (!top) { setOverlayOpen(false); return; }
  if (top.kind === "term") renderTermView(top); else renderDetailView(top);
  setOverlayOpen(true);
}
/* 打开详情：弹层已开（反链 / 关联 / 术语身份跳转）→ 压栈，返回可回上一张；
   未开 → 重置栈。同 id 连续点击不重复压栈。 */
function showDetail(id, ids) {
  id = Number(id);
  const top = topView();
  if (overlayOpen() && top && top.kind === "detail" && top.id === id) return;
  if (!overlayOpen()) overlayStack = [];
  overlayStack.push(detailView(id, ids || pagerContextFor(id)));
  renderOverlay();
}
function overlayBack() {
  overlayStack.pop();
  if (!overlayStack.length) { setOverlayOpen(false); return; }
  renderOverlay();
}
function overlayClose() { overlayStack = []; setOverlayOpen(false); }
/* 翻页：同一列表内前后跳 */
function modalStep(d) {
  const top = topView();
  if (!top || top.kind !== "detail") return;
  const n = top.idx + d;
  if (n < 0 || n >= top.ids.length) return;
  top.id = top.ids[n]; top.idx = n;
  renderOverlay();
}
window.overlayBack = overlayBack;
window.overlayClose = overlayClose;
window.modalStep = modalStep;
/* 视图标签（返回钮文字）：概念名 / 卡牌名 */
function viewLabel(v) {
  if (!v) return "";
  if (v.kind === "term") return v.name;
  const c = charById.get(v.id), e = entById.get(v.id);
  return (c && c.name) || (e && e.name) || "上一页";
}
/* 弹层顶栏：返回（仅栈深 > 1 时出现）+ 自定义按钮组 + 关闭 */
function navBar(extra = "") {
  const prev = overlayStack.length > 1 ? overlayStack[overlayStack.length - 2] : null;
  const back = prev
    ? `<button class="lbtn tm-back" title="返回「${esc(viewLabel(prev))}」" onclick="overlayBack()">‹ ${esc(viewLabel(prev))}</button>` : "";
  return `<div class="navbtns">${back}${extra}
      <button title="关闭 (Esc)" onclick="overlayClose()">✕</button></div>`;
}
/* 翻页控件：同级列表不足 2 张时不出现（避免"永远禁用"的误导），多张时显示位置「3/22」 */
function pagerHtml(v) {
  if (v.ids.length < 2) return "";
  return `<span class="pgbar" title="同一列表内翻页（← →）">
      <button title="上一张 (←)" ${v.idx <= 0 ? "disabled" : ""} onclick="modalStep(-1)">‹</button>
      <span class="pgnum">${v.idx + 1}/${v.ids.length}</span>
      <button title="下一张 (→)" ${v.idx >= v.ids.length - 1 ? "disabled" : ""} onclick="modalStep(1)">›</button>
    </span>`;
}
function renderDetailView(v) {
  const id = v.id;
  const c = charById.get(id), e = entById.get(id);
  const joinable = charById.has(id) || entById.has(id);
  /* 主行动（加入/移出牌组）文字化，一眼可读；复制链接降为次级 */
  const joinBtn = joinable
    ? (draftHas(id)
      ? `<button class="jbtn in" title="点击移出当前牌组" onclick="draftToggleModal()">移出牌组</button>`
      : `<button class="jbtn" title="加入当前牌组" onclick="draftToggleModal()">加入牌组</button>`)
    : "";
  const nav = navBar(`${pagerHtml(v)}${joinBtn}<button class="lbtn" title="复制该卡链接" onclick="copyCardLink()">复制链接</button>`);
  let html;
  if (c) {
    const tags = c.tags.map(tagZh).filter(Boolean);
    html = `${nav}<div class="dimg"><img src="${imgFull(id)}" alt=""></div>
      <div class="dinfo"><h2>${esc(c.name)}</h2>
      <div class="meta">${tags.map(t => `<span class="tagpill">${esc(t)}</span>`).join("")}<span class="tagpill">生命 ${c.hp}</span><span class="tagpill">充能上限 ${enPips(c.maxEnergy)}</span><span class="tagpill">${esc(c.sinceVersion || "")}</span></div>
      <div class="dtext">${c.skills.filter(s => !s.hidden).map(s => `<div class="skill"><b>【${esc(s.name)}】</b>\n${linkify(esc((s.description || s.rawDescription || "").trim()))}</div>`).join("")}</div>
      ${charTalentChips(id)}${backlinkHtml(c.name, id)}</div>`;
  } else if (e) {
    const tags = e.tags.map(tagZh).filter(Boolean);
    const dreqs = deckReqsOf(e);
    const rs = restrictionsOf(e);
    /* 统一「依赖与限制」：牌组限制（构筑门槛）与打出限制（对局中生效）同构呈现。
       deckChar 的角色名做成可跳转 chip，直接顺藤摸瓜到角色详情 */
    const reqRow = r => {
      const col = r.code === "deckEl" ? (ELE_COLOR[r.name] || "var(--gold)") : R_STYLE[r.code];
      let txt = esc(r.label);
      if (r.code === "deckChar" && r.charId != null && r.name)
        txt = txt.replace(`「${esc(r.name)}」`, `<button class="blchip" data-goto="${r.charId}" title="查看角色详情">${esc(r.name)}</button>`);
      return `<div class="rrow"><span class="rpill" style="color:${col}">${esc(r.short)}</span><span class="rtxt">${txt}</span></div>`;
    };
    const reqBlock = (dreqs.length || rs.length) ? `<div class="rblock">
      ${dreqs.length ? `<div class="rgroup rgroup-deck"><div class="rhead"><b>牌组限制</b><span class="rghint">加入牌组需满足</span></div>${dreqs.map(reqRow).join("")}</div>` : ""}
      ${rs.length ? `<div class="rgroup rgroup-play"><div class="rhead"><b>打出限制</b><span class="rghint">对局中生效</span></div>${rs.map(reqRow).join("")}</div>` : ""}
    </div>` : "";
    const relChip = e.relatedCharacterId != null
      ? `<div class="drel"><b>关联角色</b><span class="blchips"><button class="blchip" data-goto="${e.relatedCharacterId}">${esc(charById.get(e.relatedCharacterId)?.name || e.relatedCharacterId)}</button></span></div>` : "";
    html = `${nav}<div class="dimg"><img src="${imgFull(id)}" alt=""></div>
      <div class="dinfo"><h2>${esc(e.name)}</h2>
      <div class="meta"><span class="tagpill">${TYPE_ZH[e.type] || e.type}</span>${costHtml(e.playCost)}${tags.map(t => `<span class="tagpill">${esc(t)}</span>`).join("")}${e.relatedCharacterId ? `<span class="tagpill">关联：${esc(charById.get(e.relatedCharacterId)?.name || e.relatedCharacterId)}</span>` : ""}<span class="tagpill">${esc(e.sinceVersion || "")}</span></div>
      ${reqBlock}
      <div class="dtext">${linkify(esc((e.description || "").trim()))}</div>
      ${relChip}${e.relatedCharacterId != null ? charTalentChips(e.relatedCharacterId, id) : ""}${backlinkHtml(e.name, id)}</div>`;
  } else html = nav;
  $("detail").innerHTML = html;
}
window.copyCardLink = () => {
  const top = topView();
  if (!top || top.kind !== "detail") return;
  copyText(location.href.split("#")[0] + "#card=" + top.id)
    .then(() => toast("链接已复制（打开即显示该卡详情）"), () => toast("复制失败", true));
};
window.draftToggleModal = () => {
  const top = topView();
  if (!top || top.kind !== "detail") return;
  const id = top.id;
  if (draftHas(id)) {
    if (charById.has(id)) draftRemoveChar(id); else draftRemoveCard(id);
  } else draftAdd(id);
  renderOverlay();
};
/* 反链跳转：详情/术语弹层内的「被引用」chips */
document.addEventListener("click", ev => {
  const g = ev.target.closest("[data-goto]");
  if (!g) return;
  ev.stopPropagation();
  showDetail(Number(g.dataset.goto));
});

/* ---------- 帮助面板（快捷键与说明，复用详情弹层容器） ---------- */
function showHelp() {
  overlayStack = [];   /* 帮助不是视图栈的一层：先清栈，关闭时不会退回旧页面 */
  $("detail").innerHTML = `<div class="navbtns"><button title="关闭 (Esc)" onclick="overlayClose()">✕</button></div>
    <div class="dinfo"><h2>快捷键与说明</h2>
    <div class="dtext">
<b>快捷键</b>
1 / 2 / 3 / 4　切换 卡面视图 / 列表视图 / 卡库浏览 / 卡牌检索
/　聚焦顶部输入框
Esc　逐层回退：概念下钻（每次退一层）→ 上一视图 → 关闭弹层 → 牌组管理 → 历史面板
← / →　详情页翻页（同级列表内相邻项）
Ctrl+P　打印当前列表视图

<b>使用说明</b>
· 顶部输入框是唯一入口：粘贴分享码自动解析；输入卡牌名、角色名、术语或效果关键词，回车检索。
· 卡文中的术语（如「感电」「幻戏倒计时」）可悬浮预览释义；点击进入概念页，一个名字有多条解释时并列展示。
· 概念页可逐层下钻：释义里的其它术语继续点进去，会在弹层内叠一层（顶部返回钮显示来源名称，多概念层时右侧标出层数）；返回钮或 Esc 逐层退回，直到回到最初那张卡牌。
· 概念页里的卡牌/角色条目自带「查看详情」，可反向从概念跳到具体卡牌；「被引用」则列出引用了该概念的其它卡牌。
· 详情页的翻页（‹ › / ← →）翻的是「同级列表」：从卡面/列表进入 → 牌组内顺序；从卡库进入 → 当前筛选结果；从检索进入 → 命中列表。
· 卡牌详情页的「被引用」可顺藤摸瓜引用该概念的卡牌；「加入牌组」把卡牌加入底部牌组。
· <b>依赖与限制</b>统一在详情页分两组呈现：<b>牌组限制</b>（加入牌组前就要满足——需包含某角色、至少 2 名某元素/地区/阵营角色）与<b>打出限制</b>（对局中生效——秘传限 1、天赋须在场、武器限定、限打张数）。卡面左上角的徽标是同一套信息的简写，悬浮可看完整说明。
· 牌组限制会实时校验：不满足「才能加入牌组」的卡无法加入当前牌组，管理面板也会列出缺口（如「需要牌组中包含至少 2 名冰元素角色（当前 1）」）。
· 卡库浏览支持多维筛选，筛选状态会编码进地址栏（#b=...），复制链接即可分享当前视图。
· 底部牌组栏可管理多套牌组；凑齐 3 角色 + 30 行动牌后「生成分享码」，可复制给他人导入。

<b>数据来源</b>
卡牌数据来自 piovium 官方静态数据服务（static-data.piovium.org，v5 · 简体中文）${BUILTIN_DATA
  ? "，本单文件已内置一份数据快照，断网也能浏览与构筑；卡面图仍需联网，「更多 → 刷新数据」可拉取官方最新数据"
  : "，首次加载后缓存于浏览器本地，24 小时自动更新"}；规则与术语释义来自 genshin-db 静态快照。明显是测试用途的卡牌（名称含（test）/（Test）等标记，当前 ${poolStats.testFiltered} 张）不进入卡库与检索。解码与编码逻辑移植自 genius-invokation @gi-tcg/assets-manager（AGPL-3.0）。
</div></div>`;
  setOverlayOpen(true);
}

/* ---------- 概念交互：悬浮=预览，点击=前往（可逐层下钻） ----------
   心智模型只有一条：
   · 悬停任意术语 → 浮层预览释义（只读，不改变当前页面）；
   · 点击任意术语 → 进入概念页（若该名字只对应唯一一个卡牌/角色身份，则直接开详情）；
   · 概念页里的术语链接继续压栈 → 沿概念链下钻；返回钮 / Esc 逐层退回来源卡牌。
   早期实现有两种点击行为（卡文里就地展开、概念页里下钻），所以「深钻」只在部分
   界面生效；现在统一走 overlayStack，任意入口（卡文、卡名、检索、被引用）表现一致。 */
const tip = document.createElement("div");
tip.id = "tip";
document.body.appendChild(tip);
/* 悬浮预览只在"真正有指针悬停能力"的设备上启用。
   触摸设备点按会先合成一次 mousemove，把预览点亮；紧接着 click 打开概念页，
   预览却没人收掉 —— 结果就是一个正常大小的弹层，外加一个小一号、被屏幕边缘
   切掉一半的预览框（它的 z-index 比遮罩高，浮在最上层）。 */
function canHover() {
  try {
    return !(typeof matchMedia === "function") || matchMedia("(hover: hover) and (pointer: fine)").matches;
  } catch { return true; }
}
let tipTerm = null;      /* 预览当前展示的术语名，用于避免重复重建 DOM */
function hideTip() { if (tip && tip.classList) { tip.classList.remove("show"); tipTerm = null; } }
document.addEventListener("mousemove", ev => {
  /* 触摸设备没有悬停：不显示预览（触屏的"预览"由点击后的概念页承担）。
     弹层内不在此禁用——卡文里的术语在详情弹层里同样需要悬浮预览，
     真正要处理的是"弹层打开那一刻的残留"，由 setOverlayOpen 负责收起。 */
  if (!canHover()) { hideTip(); return; }
  const el = ev.target.closest ? ev.target.closest(".term") : null;
  if (!el) { hideTip(); return; }
  const entries = termEntries(el.dataset.term);
  if (!entries.length) { hideTip(); return; }
  /* mousemove 会连续触发：只有换了术语才重建内容，避免每次移动都重写 DOM */
  if (tipTerm !== el.dataset.term) {
    tipTerm = el.dataset.term;
    tip.innerHTML = `<div class="tip-kind">${entries.map(e => KIND_ZH[e.kind] || e.kind).join(" / ")}</div>${termHtml(entries)}`;
  }
  tip.classList.add("show");
  /* 四边钳制：以前只挡了右/下边界，靠屏幕右侧点时 x 会算成负数，
     预览框左半截跑到视口外，看起来像"被截断的第二个框"。 */
  const r = tip.getBoundingClientRect();
  const pad = 8;
  let x = ev.clientX + 16, y = ev.clientY + 18;
  if (x + r.width > innerWidth - pad) x = ev.clientX - r.width - 12;
  if (y + r.height > innerHeight - pad) y = ev.clientY - r.height - 12;
  x = Math.max(pad, Math.min(x, innerWidth - r.width - pad));
  y = Math.max(pad, Math.min(y, innerHeight - r.height - pad));
  tip.style.left = x + "px"; tip.style.top = y + "px";
});
/* 指针离开 / 页面滚动 / 触摸开始 → 收起预览（触摸开始就收，避免它跟着手指残留在屏幕上） */
document.addEventListener("touchstart", hideTip, { passive: true });
/* 滚动事件不冒泡，用捕获阶段在文档上兜住任意滚动容器 */
document.addEventListener("scroll", hideTip, true);
/* 概念页：一个名字可能匹配多个条目（如「结晶」= 场地牌 + 反应术语），
   从上到下并列；带卡牌/角色身份的条目附「查看详情」直达其详情页 */
function renderTermView(v) {
  const name = v.name;
  const entries = termEntries(name);
  if (!entries.length) { overlayBack(); return; }
  const depth = overlayStack.filter(x => x.kind === "term").length;
  const depthTag = depth > 1 ? `<span class="tm-depth" title="概念下钻层级">${depth} 层</span>` : "";
  $("detail").innerHTML = `${navBar(depthTag)}
    <div class="dinfo"><h2>${esc(name)}</h2>
    <div class="meta">${entries.map(e => `<span class="tagpill">${KIND_ZH[e.kind] || e.kind}</span>`).join("")}</div>
    <div class="dexp">${termHtml(entries, true, name)}</div>
    ${backlinkHtml(name)}</div>`;
}
/* 打开 / 下钻概念页。弹层已开 → 压栈；同名连续点击不重复压栈 */
function showTermModal(name) {
  if (!termEntries(name).length) return;
  const top = topView();
  if (top && top.kind === "term" && top.name === name) return;
  if (!overlayOpen()) overlayStack = [];
  overlayStack.push({ kind: "term", name });
  renderOverlay();
}
/* 概念点击路由（纯函数）：唯一条目且是卡牌/角色身份 → 直接开详情；其余一律进概念页 */
function termRoute(entries) {
  if (!entries || !entries.length) return "none";
  const only = entries.length === 1 ? entries[0] : null;
  return only && (only.kind === "card" || only.kind === "char") ? "detail" : "term";
}
/* 捕获阶段处理术语点击：避免触发行/卡片的点击（卡片 → 详情） */
document.addEventListener("click", ev => {
  const t = ev.target.closest ? ev.target.closest(".term") : null;
  if (!t) return;
  const name = t.dataset.term;
  const entries = termEntries(name);
  if (!entries.length) return;
  ev.stopPropagation();
  if (termRoute(entries) === "detail") showDetail(entries[0].id);
  else showTermModal(name);
}, true);
/* 点击遮罩空白处：关闭整个弹层（连同视图栈） */
$("overlay").addEventListener("click", ev => {
  if (ev.target === $("overlay")) overlayClose();
});
/* 弹层内方向键导航；Esc 统一由全局处理器逐层关闭（见文末快捷键区） */
document.addEventListener("keydown", ev => {
  if (!$("overlay").classList.contains("show")) return;
  if (ev.key === "ArrowLeft") window.modalStep(-1);
  if (ev.key === "ArrowRight") window.modalStep(1);
});
["view-grid", "view-list"].forEach(v => $(v).addEventListener("click", ev => {
  const el = ev.target.closest("[data-id]");
  if (el) showDetail(Number(el.dataset.id));
}));

/* ---------- 导出：文本 / Markdown / 结构化 JSON / CSV ---------- */
function copyText(t) { return navigator.clipboard.writeText(t); }
function download(name, content, mime) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function deckText() {
  const L = [`【角色】` + current.chars.map(c => c.name).join(" / ")];
  for (const t of current.order) {
    L.push(`【${t}】`);
    for (const x of current.groups[t]) {
      const r = allReqs(x).length ? `〔${allReqs(x).map(r => r.short).join("·")}〕` : "";
      const en = x.energy ? ` 充能×${x.energy}` : "";
      L.push(`  ${x.count > 1 ? x.count + "× " : ""}${x.name}${en}${r}${x.related ? `（${x.related}）` : ""}`);
    }
  }
  L.push(`【分享码】${current.code}`);
  return L.join("\n");
}
function deckMarkdown() {
  const L = [`# 七圣召唤牌组：${current.chars.map(c => c.name).join(" / ")}`, "",
    `> 分享码：\`${current.code}\`　导出时间：${new Date().toLocaleString("zh-CN")}`, ""];
  L.push(`## 角色`);
  for (const c of current.chars) {
    const raw = charById.get(c.id);
    const tags = (raw?.tags || []).map(tagZh).filter(Boolean).join("·");
    L.push(`- **${c.name}**（${tags}）　生命 ${c.hp} · 充能 ${c.energy} · ${c.since || ""}`);
  }
  for (const t of current.order) {
    L.push("", `## ${t}`);
    L.push(`| 数量 | 名称 | 费用 | 依赖限制 | 关联角色 | 版本 | 效果 |`);
    L.push(`|---|---|---|---|---|---|---|`);
    for (const x of current.groups[t]) {
      const r = allReqs(x).map(r => r.short).join("·") || "—";
      const d = (x.desc || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
      L.push(`| ${x.count} | ${x.name} | ${costText(x.playCost) || "—"} | ${r} | ${x.related || "—"} | ${x.since || "—"} | ${d} |`);
    }
  }
  return L.join("\n");
}
function buildExport() {
  const cards = [];
  for (const t of current.order) for (const x of current.groups[t]) {
    const e = entById.get(x.id);
    cards.push({
      id: x.id, shareId: idToShare[x.id] ?? null,
      name: x.name, typeRaw: e.type, type: x.type,
      tagsRaw: e.tags, tags: x.tags,
      playCostRaw: e.playCost,
      diceCost: x.dice, energyCost: x.energy,
      relatedCharacterId: e.relatedCharacterId ?? null, relatedCharacter: x.related,
      restrictions: x.restrictions,
      /* 牌组限制（加入牌组需满足的角色/元素/地区依赖）与打出限制分开导出 */
      deckRequirements: (x.deckReqs || []).map(r => ({ code: r.code, short: r.short, label: r.label, tag: r.tag || null, characterId: r.charId ?? null, minCount: r.n ?? null })),
      count: x.count, sinceVersion: x.since,
      description: (e.description || "").trim(),
      image: imgFull(x.id),
      category: t,
    });
  }
  const chars = current.chars.map(c => {
    const raw = charById.get(c.id);
    return {
      id: c.id, shareId: idToShare[c.id] ?? null,
      name: c.name, englishName: raw?.englishName || null,
      element: c.element, tagsRaw: raw?.tags || [], tags: (raw?.tags || []).map(tagZh).filter(Boolean),
      hp: c.hp, maxEnergy: c.energy, sinceVersion: c.since,
      skills: (raw?.skills || []).filter(s => !s.hidden).map(s => ({
        name: s.name, type: s.type || null,
        description: (s.description || s.rawDescription || "").trim(),
      })),
      image: imgFull(c.id),
    };
  });
  const byType = {}, costCurve = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, "5+": 0 };
  let energyTotal = 0;
  const versions = [...new Set(cards.map(x => x.sinceVersion).concat(chars.map(c => c.sinceVersion)))].filter(Boolean).sort();
  for (const x of cards) {
    byType[x.type] = (byType[x.type] || 0) + x.count;
    costCurve[Math.min(x.diceCost, 5) === 5 ? "5+" : x.diceCost] += x.count;
    energyTotal += x.energyCost * x.count;
  }
  return {
    format: "gi-deck-export", version: 1,
    exportedAt: new Date().toISOString(),
    source: `${API}/data/latest/${LANG}/{characters|entities}`,
    shareCode: current.code,
    characters: chars,
    actionCards: cards,
    stats: {
      totalCards: cards.reduce((a, x) => a + x.count, 0),
      uniqueCards: cards.length,
      byType, costCurve, energyCostTotal: energyTotal,
      versionRange: versions.length ? [versions[0], versions[versions.length - 1]] : [],
    },
  };
}
function toCSV() {
  const q = v => `"${String(v ?? "").replace(/"/g, '""').replace(/\n/g, " ")}"`;
  const head = ["类别", "数量", "名称", "类型", "费用", "元素骰", "充能", "依赖限制", "关联角色", "标签", "版本", "分享ID", "卡牌ID", "效果"];
  const rows = [];
  for (const t of current.order) for (const x of current.groups[t]) {
    rows.push([t, x.count, x.name, x.type, costText(x.playCost), x.dice, x.energy,
      allReqs(x).map(r => r.label).join("；"), x.related || "", x.tags.join("·"), x.since || "",
      idToShare[x.id] ?? "", x.id, x.desc].map(q).join(","));
  }
  return "\ufeff" + head.map(q).join(",") + "\n" + rows.join("\n");
}
function fileStamp() {
  const d = new Date(), p = n => String(n).padStart(2, "0");
  return `gi-deck-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/* ---------- 导出菜单 / 更多菜单 ---------- */
const openMenu = btn => {
  const menu = btn === "btnExport" ? "exportMenu" : "moreMenu";
  const other = menu === "exportMenu" ? "moreMenu" : "exportMenu";
  $(other).classList.remove("show");
  $(menu).classList.toggle("show");
};
$("btnExport").addEventListener("click", ev => { ev.stopPropagation(); openMenu("btnExport"); });
$("btnMore").addEventListener("click", ev => { ev.stopPropagation(); openMenu("btnMore"); });
document.addEventListener("click", ev => {
  if (!ev.target.closest(".expwrap")) { $("exportMenu").classList.remove("show"); $("moreMenu").classList.remove("show"); }
});
/* 更多菜单动作 */
$("btnDataInfo").addEventListener("click", () => {
  const el = $("dataInfo");
  const show = el.style.display === "none";
  el.style.display = show ? "" : "none";
  $("btnDataInfo").textContent = show ? "隐藏数据信息" : "数据信息";
  $("moreMenu").classList.remove("show");
});
$("btnHelp").addEventListener("click", () => { $("moreMenu").classList.remove("show"); showHelp(); });
$("exportMenu").addEventListener("click", ev => {
  const b = ev.target.closest("[data-exp]");
  if (!b) return;
  $("exportMenu").classList.remove("show");
  const act = b.dataset.exp;
  try {
    if (act === "text") { copyText(deckText()); toast("文本牌表已复制"); }
    else if (act === "md") { copyText(deckMarkdown()); toast("Markdown 牌表已复制"); }
    else if (act === "json-copy") { copyText(JSON.stringify(buildExport(), null, 2)); toast("结构化 JSON 已复制"); }
    else if (act === "json-dl") { download(`${fileStamp()}.json`, JSON.stringify(buildExport(), null, 2), "application/json"); toast("JSON 已下载"); }
    else if (act === "csv") { download(`${fileStamp()}.csv`, toCSV(), "text/csv;charset=utf-8"); toast("CSV 已下载（Excel 可直开）"); }
  } catch (e) { toast("导出失败：" + e.message, true); }
});

/* ---------- 分享码 ---------- */
/* 按分享码原始顺序（而非分组顺序）重建，保证再编码逐字节还原 */
function encodeCurrent() {
  const ids = [...current.charIds, ...current.cardIds];
  const shareIds = ids.map(id => {
    const s = idToShare[id];
    if (s == null) throw new Error(`卡牌 ${id} 不可分享`);
    return s;
  });
  const code = encodeRaw(shareIds);
  if (JSON.stringify(decodeRaw(code)) !== JSON.stringify(shareIds)) throw new Error("编码自校验失败");
  return code;
}
$("btnCopyCode").addEventListener("click", async () => {
  try {
    const code = encodeCurrent();
    await navigator.clipboard.writeText(code);
    toast("分享码已复制（已通过解码自校验）");
  } catch (e) { toast("生成失败：" + e.message, true); }
});

/* ---------- 事件绑定 ---------- */
function updateBtnLabel() {
  const v = $("codeInput").value.trim();
  $("btnDecode").textContent = v && !looksLikeCode(v) ? "搜索" : "解析牌组";
}
$("btnDecode").addEventListener("click", () => resolveInput($("codeInput").value));
/* 输入建议：200ms 防抖出候选；↑↓ 选择，Enter 检索全部，Esc 关闭 */
$("codeInput").addEventListener("keydown", ev => {
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    if (sugState.open && sugState.items.length) {
      ev.preventDefault();
      moveSuggest(ev.key === "ArrowDown" ? 1 : -1);
    }
    return;
  }
  if (ev.key === "Escape" && sugState.open) {
    ev.preventDefault();
    ev.stopPropagation();   /* 只关下拉，不触发全局 Esc 的逐层返回 */
    closeSuggest();
    return;
  }
  if (ev.key === "Enter") {
    if (sugState.open && sugState.idx >= 0) { ev.preventDefault(); selectSuggest(sugState.idx); return; }
    closeSuggest();
    resolveInput($("codeInput").value);
  }
});
$("codeInput").addEventListener("input", () => {
  updateBtnLabel();
  clearTimeout(sugTimer);
  const v = $("codeInput").value.trim();
  if (!v || looksLikeCode(v)) { closeSuggest(); return; }
  sugTimer = setTimeout(refreshSuggest, 200);
});
$("codeInput").addEventListener("focus", () => {
  const v = $("codeInput").value.trim();
  if (v && !looksLikeCode(v)) refreshSuggest();
});
/* mousedown 而非 click：在输入框失焦前完成选择 */
$("suggest").addEventListener("mousedown", ev => {
  const it = ev.target.closest(".sug-item");
  if (!it) return;
  ev.preventDefault();
  selectSuggest(Number(it.dataset.i));
});
document.addEventListener("click", ev => {
  if (sugState.open && !ev.target.closest("#suggest") && ev.target !== $("codeInput")) closeSuggest();
});
$("codeInput").addEventListener("paste", () => setTimeout(() => { if ($("codeInput").value.trim()) resolveInput($("codeInput").value); }, 0));
$("btnSample").addEventListener("click", () => { $("codeInput").value = SAMPLE; updateBtnLabel(); decodeAndRender(SAMPLE); });
$("btnHistory").addEventListener("click", () => { renderHistory(); $("histPanel").classList.toggle("show"); });
$("histPanel").addEventListener("click", ev => {
  const item = ev.target.closest("[data-code]");
  if (item) { $("histPanel").classList.remove("show"); $("codeInput").value = item.dataset.code; updateBtnLabel(); decodeAndRender(item.dataset.code); }
});
document.addEventListener("click", ev => {
  if (!ev.target.closest("#histPanel") && !ev.target.closest("#btnHistory")) $("histPanel").classList.remove("show");
});
/* ---------- 视图切换（含状态持久化与数据懒加载） ---------- */
const VIEW_KEY = "gi-viewer-view";
const VIEW_RENDER = { grid: renderGrid, list: renderList, browse: renderBrowse, search: renderSearch };
function switchView(name) {
  currentView = name;
  document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x.dataset.view === name));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + name));
  try { localStorage.setItem(VIEW_KEY, name); } catch (e) {}
  const render = VIEW_RENDER[name] || renderGrid;
  /* 卡库/检索依赖全量数据：未加载则先拉取，就绪后再渲染 */
  if (!dataReady && (name === "browse" || name === "search")) {
    ensureData().then(render).catch(e => setStatus("数据加载失败：" + e.message, "err"));
    return;
  }
  render();
}
document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => switchView(t.dataset.view)));

/* ---------- 数据信息行 + 刷新 ---------- */
function renderDataInfo() {
  const el = $("dataInfo"); if (!el) return;
  const testNote = poolStats.testFiltered ? `　|　已隐藏 ${poolStats.testFiltered} 张测试卡（不进卡库/检索）` : "";
  /* 来源如实展示：内置快照 / 本地缓存 / 现网，混合来源按实际出现的组合列出 */
  const origin = [...dataOrigins].map(k => ORIGIN_ZH[k] || k).join(" + ") || "—";
  const imgNote = dataOrigins.has("builtin") && !dataOrigins.has("network") ? "　|　卡面图需联网" : "";
  el.innerHTML = `数据源：piovium 官方静态数据 v5 · CHS　|　${CHAR.length} 角色 · ${pool.filter(x => x.kind === "card").length} 卡牌 · ${KW.length} 术语 + ${Object.keys(EXTRA_CONCEPTS).length} 规则概念${testNote}　|　${origin}${imgNote}`;
}
$("btnRefresh").addEventListener("click", async () => {
  /* 不预先清缓存：网络不可用时旧缓存 / 内置快照还能兜住，不至于整页失去数据。
     拉取成功后 writeCache 会自然覆盖旧值。 */
  dataReady = false;
  dataFlight = null;   /* 重置单 flight，强制 ensureData 真正重新拉取 */
  CHAR = []; ENT = []; KW = []; shareMap = {}; idToShare = {};
  charById = new Map(); charByName = new Map(); entById = new Map(); termIndex = new Map(); termRe = null;
  pool = []; backlinks = new Map(); poolStats = { total: 0, buildable: 0, testFiltered: 0, byType: {}, byEl: {}, byTag: {}, versions: [] };
  setStatus(`<span class="spin"></span>正在重新拉取数据…`);
  try {
    await ensureData(true);
    (VIEW_RENDER[currentView] || renderGrid)();
    renderDataInfo();
    toast("数据已刷新");
  } catch (e) {
    /* 刷新失败 → 回退到本地可用数据（内置快照或缓存），保证页面仍然可用 */
    try {
      await ensureData(false);
      (VIEW_RENDER[currentView] || renderGrid)();
      setStatus("刷新失败，已回退到本地数据：" + e.message, "err");
    } catch (e2) {
      setStatus("刷新失败：" + e.message + "；本地也没有可用数据", "err");
    }
  }
});

/* 检索视图：热门词 / 过滤 chips / 概念 / 详情 / 加入草稿 */
$("view-search").addEventListener("click", ev => {
  const add = ev.target.closest("[data-add]");
  if (add) { ev.stopPropagation(); draftAdd(Number(add.dataset.add)); return; }
  const scopeBtn = ev.target.closest("[data-scope]");
  if (scopeBtn) { toggleSearchScope(scopeBtn.dataset.scope); return; }
  if (ev.target.closest("[data-scope-clear]")) { clearBrowseFilters(); return; }
  const q = ev.target.closest("[data-q]");
  if (q) { $("codeInput").value = q.dataset.q; updateBtnLabel(); runSearch(q.dataset.q); return; }
  const chip = ev.target.closest("[data-f]");
  if (chip) { searchState.filter = chip.dataset.f; renderSearch(); return; }
  const term = ev.target.closest("[data-term]");
  if (term) { showTermModal(term.dataset.term); return; }
  const tile = ev.target.closest("[data-id]");
  if (tile) showDetail(Number(tile.dataset.id));
});

/* 草稿栏 / 牌组面板（innerHTML 重渲染 → 事件委托） */
document.addEventListener("click", ev => {
  const b = ev.target.closest("button");
  if (!b) return;
  if (b.id === "draftManage") { $("draftPanel").classList.toggle("show"); renderDraftPanel(); }
  else if (b.id === "draftClose") $("draftPanel").classList.remove("show");
  else if (b.id === "draftClear") draftClear();
  else if (b.id === "draftLoad") { draftLoadCurrent(); renderDraftPanel(); }
  else if (b.id === "draftNew") {
    newDeck(); syncFromActive(); renderDraft(); renderDraftPanel(); toast("已新建空牌组");
  }
  else if (b.dataset.dkren != null) {
    deckRenameId = Number(b.dataset.dkren); renderDraftPanel();
    const inp = $("draftPanel").querySelector(".dk-rename");
    if (inp) { inp.focus(); inp.select(); }
  }
  else if (b.dataset.dkcpy != null) {
    const src = decks.find(d => d.id === Number(b.dataset.dkcpy));
    if (src) {
      const d = newDeck(src.name + " 副本");
      d.chars = [...src.chars];
      d.cards = src.cards.map(([id, c]) => [id, c]);
      syncFromActive(); renderDraft(); renderDraftPanel(); toast("已复制为新牌组");
    }
  }
  else if (b.dataset.dkdel != null) {
    const id = Number(b.dataset.dkdel);
    decks = decks.filter(d => d.id !== id);
    if (!decks.length) newDeck();
    else if (activeDeckId === id) activeDeckId = decks[0].id;
    saveDecks(); syncFromActive(); renderDraft(); renderDraftPanel(); toast("牌组已删除");
  }
  else if (b.id === "draftGen") {
    try {
      const code = draftEncode();
      copyText(code).then(() => toast("分享码已生成并复制到剪贴板"), () => {});
      $("codeInput").value = code; updateBtnLabel();
      $("draftPanel").classList.remove("show");
      decodeAndRender(code);
      toast("分享码已生成（已通过解码自校验），牌组已加载");
    } catch (e) { toast(e.message, true); }
  }
  else if (b.dataset.rmc != null) draftRemoveChar(Number(b.dataset.rmc));
  else if (b.dataset.rm != null) draftRemoveCard(Number(b.dataset.rm));
  else if (b.dataset.inc != null) draftSetCount(Number(b.dataset.inc), 1);
  else if (b.dataset.dec != null) draftSetCount(Number(b.dataset.dec), -1);
});

/* 全局快捷键：1/2/3/4 切视图，/ 聚焦输入，Esc 逐层关闭浮层（输入框聚焦时不触发）。
   Esc 层级（自内向外）：弹层视图栈（概念下钻 → 上一视图，每次退一层）→
   关闭弹层 → 牌组管理面板 → 历史面板 → 导出菜单 */
document.addEventListener("keydown", ev => {
  if (ev.key === "Escape") {
    if (overlayOpen()) { overlayBack(); return; }   /* 弹层内：逐层退回，栈空即关闭 */
    if ($("draftPanel").classList.contains("show")) { $("draftPanel").classList.remove("show"); return; }
    if ($("histPanel").classList.contains("show")) { $("histPanel").classList.remove("show"); return; }
    $("exportMenu").classList.remove("show");
    return;
  }
  if (overlayOpen()) return;
  const tag = (ev.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea") return;
  if (ev.key === "1") switchView("grid");
  if (ev.key === "2") switchView("list");
  if (ev.key === "3") switchView("browse");
  if (ev.key === "4") switchView("search");
  if (ev.key === "/") { ev.preventDefault(); $("codeInput").focus(); }
});

/* ---------- 启动：hash 路由（#分享码 / #card=id / #q=关键词 / #b=卡库筛选） ---------- */
loadDraft(); renderDraft();
/* hash → 视图/动作。启动时执行一次；之后由 hashchange 驱动（页面不刷新也响应）。 */
function routeHash() {
  const h = decodeURIComponent(location.hash.replace(/^#/, "")).trim();
  if (h.startsWith("card=")) {
    const id = Number(h.slice(5));
    return (async () => {
      try {
        await ensureData();
        if (charById.has(id) || entById.has(id)) showDetail(id);
        else setStatus("链接中的卡牌 id 不存在或已失效", "err");
      } catch (e) { setStatus("加载失败：" + e.message, "err"); }
    })();
  }
  if (h.startsWith("q=")) {
    const q = h.slice(2);
    $("codeInput").value = q; updateBtnLabel();
    return (async () => {
      try { await ensureData(); runSearch(q, { noHash: true }); }
      catch (e) { setStatus("加载失败：" + e.message, "err"); }
    })();
  }
  if (h.startsWith("b=")) {
    const st = parseBrowseHash(h);
    if (st) Object.assign(browseState, st);
    return (async () => {
      try { await ensureData(); switchView("browse"); }
      catch (e) { setStatus("加载失败：" + e.message, "err"); }
    })();
  }
  if (h) {   /* 分享码 */
    $("codeInput").value = h; updateBtnLabel();
    return (async () => {
      try { await decodeAndRender(h); restoreView(); }
      catch (e) { setStatus("加载失败：" + e.message, "err"); }
    })();
  }
  /* 空 hash：加载示例牌组，并恢复上次停留的视图 */
  $("codeInput").value = SAMPLE; updateBtnLabel();
  return (async () => {
    try { await decodeAndRender(SAMPLE, { noHash: true }); restoreView(); }
    catch (e) { setStatus("加载失败：" + e.message, "err"); }
  })();
}
/* 恢复上次停留的视图（hash 指定具体视图时不恢复） */
function restoreView() {
  let v = "";
  try { v = localStorage.getItem(VIEW_KEY) || ""; } catch (e) {}
  if (v && VIEW_RENDER[v]) switchView(v);
}
/* hash 变化重新路由。history.replaceState 不触发 hashchange，因此筛选/检索内部
   改 hash 不会自触发；只有用户改地址栏、前进后退、外部链接才会进来。 */
if (window.addEventListener) window.addEventListener("hashchange", () => routeHash());
/* 启动兜底：初始化阶段的未捕获错误给出可操作提示，而非白屏无下文 */
if (window.addEventListener) window.addEventListener("error", ev => {
  if (window.__giBooted) return;
  setStatus("初始化失败：" + (ev.message || "未知错误") + "。请刷新页面重试；若反复出现，可用「更多 → 刷新数据」重新拉取数据", "err");
});
try {
  routeHash();
  window.__giBooted = true;
} catch (e) {
  setStatus("初始化失败：" + e.message + "。请刷新重试", "err");
}

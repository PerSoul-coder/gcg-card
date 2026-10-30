/* 七圣召唤浏览器 · 数据加载：内置快照 → 本地缓存 → 现网，超时重试与单 flight。
   源码按领域拆分，由 src/sources.mjs 统一声明加载顺序；单文件版构建时按同一顺序内联。 */
"use strict";

/* ---------- 数据加载（内置快照 / localStorage 缓存 / 现网，三级来源 + 超时重试 + 单 flight） ----------
   来源优先级：本地缓存 → 内置快照（仅单文件版有）→ 现网。
   单文件版由构建脚本把三份数据快照内嵌进 HTML（window.BUILTIN_DATA），因此断网也能
   完整使用；「刷新数据」强制走现网，成功后写缓存覆盖。
   缓存带版本戳与写入时间：24 小时过期自动重拉（官方发新卡后本地不会永久过期），
   旧版裸数组缓存平滑接纳并按当前时间重新计时。 */
/* 单文件版内置快照：构建脚本在本文件之前注入 window.BUILTIN_DATA。
   多文件版没有这个全局变量，BUILTIN_DATA 为 null，行为与过去完全一致。 */
const BUILTIN_DATA = (typeof window !== "undefined" && window.BUILTIN_DATA) || null;
const dataOrigins = new Set();   /* 本次加载实际用到的来源，供数据信息行展示 */
const ORIGIN_ZH = { builtin: "内置快照 · 离线可用", cache: "浏览器本地缓存", network: "现网最新" };
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
  buildShadowStates();   /* 准备状态影子：必须先于概念索引（重名的状态要让位给技能） */
  buildSkillIndex();     /* 技能索引：概念索引要用它注册「技能」条目 */
  buildTermIndex();
  buildPool();
  buildBacklinks();
  pruneDraft(); renderDraft();
  renderDataInfo();
  dataReady = true;
}


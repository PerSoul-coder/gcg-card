/* src/70-search.js —— 由 scripts/_convert.mjs 从旧脚本转换（迁移中间态）。 */
import { BROWSE_DIMS, browseFilter, browseState, passFilter, renderBrowse, renderBrowseResults, syncBrowseHash } from "./85-views";
import { $ } from "./core/dom";
import { cardElement, charElement, pool } from "./45-pool";
import { KIND_ZH, backlinks } from "./50-backlinks";
import { escapeRe, termIndex } from "./40-concepts";
import { dataReady, ensureData } from "./20-data";

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
function loadSearchScope() {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEYS.searchScope) || "null");
    if (v && typeof v === "object") return { title: v.title !== false, pinyin: v.pinyin !== false, desc: v.desc !== false };
  } catch (e) {}
  return { title: true, pinyin: true, desc: true };
}
type SearchScope = { title: boolean; pinyin: boolean; desc: boolean };
const searchScope: SearchScope = loadSearchScope();
function saveSearchScope() { try { localStorage.setItem(STORAGE_KEYS.searchScope, JSON.stringify(searchScope)); } catch (e) {} }
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
/* 只有「不是牌面镜像」的非卡牌条目才算独立概念：
   · 纯卡牌/角色词条（补充库里的历史卡、带书名号的变体）不单列概念；
   · 释义与牌面等价的镜像条目（如「焰主之祝」的状态说明）也不单列；
   · 结晶、护盾、下落攻击这类"同名但释义不同"的机制仍保留（双重含义）。 */
const conceptEntriesOf = entries => entries.filter(e => !CARD_LIKE_KINDS.has(e.kind));
const isConceptRow = entries => conceptEntriesOf(entries).some(e => !e.mirrorCard);
/* 概念按归一化名字去重：引号/感叹号写法不同但指向同一概念的只留一行 */
const conceptKeyOf = name => "concept#" + nameKey(name);
const HAN_RE = /\p{Script=Han}/u;
const normCompact = s => String(s || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/* 拼音索引由 build-pinyin.mjs 构建期生成；缺失时自动退化为仅字面检索 */
import { PINYIN_DATA } from "../gi-data/pinyin.js";
import { state } from "./data/state";
import type { PoolEntry, SearchHit, SuggestHit } from "./types";
import { STORAGE_KEYS, eleIcon } from "./core/resources";
import { esc, toast } from "./core/dom";
import { typeZhOf, nameKey } from "./data/model";
import { buildPool } from "./45-pool";
const PY_DATA = PINYIN_DATA || null;
const pyCache = new Map<string, { full: string; initials: string } | null>();
function pinyinOf(name) {
  if (!PY_DATA) return null;
  if (pyCache.has(name)) return pyCache.get(name);
  let v: { full: string; initials: string } | null = null;
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
function subseqWindow(q: string, t: string): { gap: number; start: number } | null {
  if (q.length < 2 || t.length < q.length) return null;
  let best: { gap: number; start: number } | null = null;
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

function scoreName(ctx, name, englishName, sc = searchScope): { score: number; match: string; note?: string } | null {
  let best: { score: number; match: string; note?: string } | null = null;
  const take = (r: { score: number; match: string; note?: string } | null) => { if (r && (!best || r.score < best.score)) best = r; };
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
      const forms: string[] = [];
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

function searchCards(q: string, opts: { scope?: SearchScope; corpus?: PoolEntry[]; noDesc?: boolean; limit?: number } = {}) {
  const ctx = queryCtx(q);
  if (!ctx.compact) return [];
  const sc = opts.scope || searchScope;
  const corpus = opts.corpus || searchCorpus();
  const corpusIds = browseActive() ? new Set(corpus.map(x => x.id)) : null;
  const out: SearchHit[] = [];
  const descOut: SearchHit[] = [];
  const nameKeys = new Set();
  const push = (kind: SearchHit["kind"], id: number | null, name: string, extra: Partial<SearchHit>, src?: { englishName?: string }) => {
    const s = scoreName(ctx, name, src && src.englishName, sc);
    if (!s) return false;
    nameKeys.add(kind + ":" + name);
    out.push({ kind, id, name, score: s.score, match: s.match, note: s.note, ...extra });
    return true;
  };

  /* 角色/卡牌只来自当前牌库：牌库筛选生效时，检索范围随之缩小 */
  for (const x of corpus) {
    push(x.kind, x.id, x.name,
      x.kind === "char" ? { buildable: x.share != null } : { ver: x.ver, noShare: x.share == null, buildable: x.share != null },
      x);
  }
  /* 术语/规则/状态等概念不在牌库里：筛选生效时只保留被当前牌库条目引用过的。
     牌面镜像（与实体卡同义）与纯卡牌/角色词条不单列；同一概念的不同写法
     （引号/感叹号差异）按归一化名只保留一行。 */
  const conceptKeys = new Set();
  for (const [name, entries] of termIndex) {
    if (!isConceptRow(entries) || !conceptInCorpus(name, corpusIds)) continue;
    const ck = conceptKeyOf(name);
    if (conceptKeys.has(ck)) continue;
    const ckind = conceptEntriesOf(entries).find(e => !e.mirrorCard)?.kind;
    if (push("concept", null, name, { ckind }, { englishName: "", description: entries.map(e => e.desc || "").join("\n") }))
      conceptKeys.add(ck);
  }

  /* 描述命中：仅在开启"描述"范围时扫描；小写文本在 buildPool 时已缓存 */
  const rawLower = ctx.raw.toLowerCase();
  if (rawLower && sc.desc && !opts.noDesc) {
    const descKeys = new Set();
    const pushDesc = (r: SearchHit) => {
      const k = r.kind + ":" + r.name;
      if (nameKeys.has(k) || descKeys.has(k)) return false;
      descKeys.add(k);
      descOut.push(r);
      return true;
    };
    for (const x of corpus) {
      if (nameKeys.has(x.kind + ":" + x.name)) continue;
      if (x.descAll && x.descAll.includes(rawLower))
        pushDesc({ kind: x.kind, id: x.id, name: x.name, score: 100, match: "desc", ver: x.ver, noShare: x.kind === "card" && x.share == null, buildable: x.share != null });
    }
    for (const [name, entries] of termIndex) {
      if (!isConceptRow(entries) || !conceptInCorpus(name, corpusIds)) continue;
      const ck = conceptKeyOf(name);
      if (conceptKeys.has(ck) || nameKeys.has("concept:" + name)) continue;
      const concept = conceptEntriesOf(entries).find(e => !e.mirrorCard && (e.desc || "").toLowerCase().includes(rawLower));
      if (concept && pushDesc({ kind: "concept", id: null, name, score: 100, match: "desc", ckind: concept.kind }))
        conceptKeys.add(ck);
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
  const cand: Array<{ name: string; kind: SearchHit["kind"]; id?: number }> = [];
  const corpus = searchCorpus();
  const corpusIds = browseActive() ? new Set(corpus.map(x => x.id)) : null;
  for (const x of corpus) cand.push({ name: x.name, kind: x.kind, id: x.id });
  const conceptSeen = new Set();
  for (const [name, entries] of termIndex) {
    if (!isConceptRow(entries) || !conceptInCorpus(name, corpusIds)) continue;
    const ck = conceptKeyOf(name);
    if (conceptSeen.has(ck)) continue;
    conceptSeen.add(ck);
    cand.push({ name, kind: "concept" });
  }
  const out: SuggestHit[] = [];
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
/* 检索结果分类 chips 的固定顺序（与 12-model.js 的类型序一致，概念收尾） */
const CAT_ORDER = ["角色", "装备牌", "支援牌", "事件牌", "队伍状态", "状态牌", "召唤物", "附加状态", "概念"];
function resultTypeLabel(r) {
  if (r.kind === "char") return "角色";
  if (r.kind === "card") return typeZhOf(state.entById.get(r.id));
  if (r.kind === "skill") return "技能";
  return "概念";   /* 概念类统一一档分类；具体种类由卡块自身标出 */
}
/* ---------- 最近搜索（本地记录，可点击重放） ---------- */
function loadRecent() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.recent) || "[]").filter(x => typeof x === "string").slice(0, 8); } catch { return []; }
}
function pushRecent(q) {
  const r = loadRecent().filter(x => x !== q);
  r.unshift(q);
  try { localStorage.setItem(STORAGE_KEYS.recent, JSON.stringify(r.slice(0, 8))); } catch (e) {}
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
  const parts: string[] = [];
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
    searchState.results = searchCards(searchState.q, { corpus: browseFilter() });
    searchState.corpusKey = corpusKey();
  }
  renderBrowseResults();
}
/* 清除卡库筛选（第一阶段），检索词保留并基于恢复后的全库重算 */
function clearBrowseFilters() {
  Object.assign(browseState, { type: "", el: "", cost: "", energy: "", tag: "", ver: "" });
  renderBrowse();
}

/* ---------- 输入建议（combobox）：输入即出候选，↑↓ 选择，Enter 检索全部 ---------- */
const HOT_WORDS = ["感电", "护盾", "天赋", "芙宁娜", "幻戏", "秘传", "万能元素", "下落攻击"];
const MATCH_ZH = { pinyin: "拼音", initials: "首字母", fuzzy: "模糊", en: "英文", desc: "释义", segment: "词首" };
const sugState = { open: false, items: [], idx: -1 };
let sugTimer = 0, liveTimer = 0;

/** 取消待执行的建议刷新。计时器的读写只发生在搜索模块内部。 */
export function resetSuggestTimer(): void {
  clearTimeout(sugTimer);
  sugTimer = 0;
}

/** 防抖刷新搜索建议。调用方只说"该刷新了"，不再关心具体延迟与计时器。 */
export function scheduleSuggest(delay = 200): void {
  clearTimeout(sugTimer);
  sugTimer = window.setTimeout(() => { void refreshSuggest(); }, delay);
}

function matchChip(r) {
  const label = MATCH_ZH[r.match];
  if (!label) return "";
  const note = r.note ? ` title="命中：${esc(r.note)}"` : "";
  return `<span class="mchip${r.match === "desc" ? " dim" : ""}"${note}>${label}</span>`;
}

function sugKindLabel(r) {
  if (r.kind === "char") return "角色";
  if (r.kind === "card") return typeZhOf(state.entById.get(r.id)) || "卡牌";
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
  box.innerHTML = items.map((r, i) => {
    const el = r.kind === "char" ? charElement(state.charById.get(r.id) || { tags: [] })
      : r.kind === "card" ? cardElement(state.entById.get(r.id)) : "";
    return `
    <div class="sug-item" role="option" id="sug-opt-${i}" data-i="${i}" aria-selected="false">
      ${el ? eleIcon(el, "sug-el") : ""}
      <span class="sug-name">${hlText(r.name, q)}</span>
      <span class="sug-kind">${esc(sugKindLabel(r))}</span>
      ${matchChip(r)}
    </div>`;
  }).join("") + `<div class="sug-foot" role="presentation">↑↓ 选择 · Enter 检索全部 · Esc 关闭</div>`;
  openSuggest();
}

function openSuggest() {
  const box = $("suggest"), input = $("browseSearch");
  if (!box) return;
  box.classList.add("show");
  sugState.open = true;
  if (input) input.setAttribute("aria-expanded", "true");
}

function closeSuggest() {
  const box = $("suggest"), input = $("browseSearch");
  if (!box) return;
  box.classList.remove("show");
  sugState.open = false;
  sugState.idx = -1;
  sugState.items = [];
  if (input) {
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }
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
  const input = $("browseSearch");
  if (input) input.setAttribute("aria-activedescendant", "sug-opt-" + sugState.idx);
}

/* 选中建议 = 用该名字在当前卡库子集内检索（不直接跳详情，保留结果全貌） */
function selectSuggest(i) {
  const r = sugState.items[i];
  if (!r) return;
  const name = r.name;
  const input = $("browseSearch");
  closeSuggest();
  if (input) input.value = name;
  searchState.q = name;
  searchState.filter = "";
  searchState.results = searchCards(name, { corpus: browseFilter() });
  searchState.corpusKey = corpusKey();
  renderBrowseResults();
  syncBrowseHash();
  const box = $("browseResults");
  if (box && box.scrollIntoView) { try { box.scrollIntoView({ block: "start", behavior: "smooth" }); } catch (e) {} }
}

async function refreshSuggest() {
  const input = $("browseSearch");
  if (!input) return;
  const v = input.value.trim();
  if (!v) { closeSuggest(); return; }
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
  if (!input || input.value.trim() !== v) return;   /* 异步期间用户已改动输入 → 丢弃这次结果 */
  renderSuggestItems(v, searchCards(v, { limit: 8, noDesc: true, corpus: browseFilter() }));
}

export { searchState, loadSearchScope, searchScope, saveSearchScope, browseActive, corpusKey, searchCorpus, conceptInCorpus, CARD_LIKE_KINDS, conceptEntriesOf, isConceptRow, conceptKeyOf, HAN_RE, normCompact, PY_DATA, pyCache, pinyinOf, queryCtx, segmentsOf, literalScore, englishScore, pinyinScore, subseqWindow, withinOneEdit, fuzzyScore, scoreName, compareResults, searchCards, nearNames, CAT_ORDER, resultTypeLabel, loadRecent, pushRecent, scopeRow, inputHint, toggleSearchScope, clearBrowseFilters, HOT_WORDS, MATCH_ZH, sugState, sugTimer, liveTimer, matchChip, sugKindLabel, hlText, renderSuggestItems, openSuggest, closeSuggest, moveSuggest, selectSuggest, refreshSuggest };
